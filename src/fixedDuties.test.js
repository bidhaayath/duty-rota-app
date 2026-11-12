/* Duties the manager fixed: rosterRules.fixedDuties, [{ id, staffId, date,
   duty }]. Kept exactly as an approved request is, said as the manager's own,
   refused where they could never be kept, and nothing at all for a ward that
   fixes none. 1 November 2026 is a Sunday; the far dates stay on the same
   side of today. */

import React, { useState } from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { generateRoster, checkFeasible } from "./rosterEngine";
import { weekConfig, mergeRules, fixedDutiesIn } from "./rosterConfig";
import { prepareMonth, plainProblems } from "./monthBuild";
import { whyNoInCharge, noInChargeText } from "./inChargeGaps";
import SmartRosterTab from "./SmartRosterTab";
import { useRotaHistory } from "./useRotaHistory";
import { seededWard } from "../tools/engine-compare/wards";

const CODES = [
  { id: "M", code: "M", counts: "morning" }, { id: "A", code: "A", counts: "afternoon" },
  { id: "E", code: "E", counts: "evening" }, { id: "N", code: "N", counts: "night" },
  { id: "OFF", code: "OFF", counts: "off" },
];
const withFixed = (data, fixedDuties) => ({ ...data, rosterRules: { ...data.rosterRules, fixedDuties } });
const steady = (cfg) => ({ ...cfg, polishMaxMs: 1e9, polishSteps: 3000 });

describe("what the engine is given", () => {
  test("none in the week: exactly what a ward that fixes none is given", () => {
    const { start, data } = seededWard(2);
    const elsewhere = withFixed(data, [
      { id: "f1", staffId: data.staff[0].id, date: "2000-01-04", duty: "night" },
      { id: "f2", staffId: data.staff[1].id, date: "2099-01-04", duty: "off" },
      { id: "f3", staffId: data.staff[2].id, date: start, duty: "brunch" },       // not a duty: left out
    ]);
    expect(JSON.stringify(weekConfig(elsewhere, start))).toBe(JSON.stringify(weekConfig(data, start)));
    expect(JSON.stringify(generateRoster(steady(weekConfig(elsewhere, start)))))
      .toBe(JSON.stringify(generateRoster(steady(weekConfig(data, start)))));
  }, 60000);

  test("in the week: handed on as a request marked as the manager's, after the approved ones", () => {
    const rules = mergeRules({ fixedDuties: [{ id: "f", staffId: "s1", date: "2026-11-03", duty: "night" }] });
    expect(fixedDutiesIn(rules, "2026-11-01", "2026-11-07"))
      .toEqual([{ staffId: "s1", date: "2026-11-03", category: "night", source: "manager" }]);
    expect(fixedDutiesIn(rules, "2026-11-08", "2026-11-14")).toEqual([]);
  });

  test("kept in the week as built, and in Ini's month", () => {
    const { start, data } = seededWard(4);
    const who = data.staff[1].id;
    const day = start.slice(0, 8) + String(Number(start.slice(8)) + 2).padStart(2, "0");
    for (const duty of ["night", "off", "morning"]) {
      const out = generateRoster(steady(weekConfig(withFixed(data, [{ id: "f", staffId: who, date: day, duty }]), start)));
      expect(out.cells[`${who}|${day}`]).toBe(duty);
    }
    const month = prepareMonth({ data: withFixed(data, [{ id: "f", staffId: who, date: "2026-11-18", duty: "night" }]),
      month: "2026-11", lookFrom: null, keepExisting: false });
    expect(month.config.requests).toContainEqual({ staffId: who, date: "2026-11-18", category: "night", source: "manager" });
  }, 120000);
});

describe("said as the manager's, not as a request", () => {
  // Four people and three a day: two fixed off on Tuesday leaves two for three places.
  const crowded = (fixedDuties, dutyRequests = []) => ({
    staff: [...Array(4)].map((_, i) => ({ id: `s${i}`, name: `S${i}`, leavePeriods: [] })),
    codes: CODES, cells: {}, dutyRequests,
    rosterRules: {
      fixedDuties,
      coverage: { morning: { min: 1, max: 2 }, afternoon: { min: 1, max: 2 }, evening: { min: 0, max: 0 }, night: { min: 1, max: 1 } },
    },
  });
  const twoOff = [{ id: "a", staffId: "s0", date: "2026-11-03", duty: "off" }, { id: "b", staffId: "s1", date: "2026-11-03", duty: "off" }];

  test("only fixed duties: named as yours, and the way out is to remove one", () => {
    const { problems } = checkFeasible(weekConfig(crowded(twoOff), "2026-11-01"));
    expect(problems).toContain("2026-11-03: 2 duties fixed by you leave only 2 staff free, but 3 more are needed to cover the day. "
      + "Remove a fixed duty for that date, or lower the minimums.");
  });

  test("a request and a fixed duty: both named", () => {
    const { problems } = checkFeasible(weekConfig(crowded(twoOff.slice(0, 1),
      [{ id: "q", staffId: "s1", date: "2026-11-03", category: "off", approved: true }]), "2026-11-01"));
    expect(problems).toContain("2026-11-03: 1 approved request and 1 duty fixed by you leave only 2 staff free, but 3 more "
      + "are needed to cover the day. Un-approve a request for that date, or lower the minimums.");
  });

  test("only requests: as it always was", () => {
    const { problems } = checkFeasible(weekConfig(crowded(undefined, [
      { id: "q", staffId: "s0", date: "2026-11-03", category: "off", approved: true },
      { id: "r", staffId: "s1", date: "2026-11-03", category: "off", approved: true },
    ]), "2026-11-01"));
    expect(problems).toContain("2026-11-03: 2 approved requests leave only 2 staff free, but 3 more are needed to cover the day. "
      + "Un-approve a request for that date, or lower the minimums.");
  });

  test("Ini says it in plain words, with the duties you fixed where there are any", () => {
    const prep = { keepExisting: false };
    expect(plainProblems(prep, ["2026-11-03: 2 duties fixed by you leave only 2 staff free, but 3 more…"])[0])
      .toBe("Tue 3 Nov: the duties already on the rota, the approved requests and the duties you fixed leave too few people "
        + "free to cover the day. Change that day by hand, or lower the minimums.");
    expect(plainProblems(prep, ["2026-11-03: 2 approved requests leave only 2 staff free, but 3 more…"])[0])
      .toBe("Tue 3 Nov: the duties already on the rota and the approved requests leave too few people free to cover the day. "
        + "Change that day by hand, or lower the minimums.");
  });

  test("an in-charge on a duty you fixed is said as that", () => {
    const reasons = whyNoInCharge({
      date: "2026-11-03", shift: "night", from: "2026-11-01", to: "2026-11-07",
      cells: { "s0|2026-11-03": "morning" }, staff: [{ id: "s0", name: "S0", leavePeriods: [] }],
      data: { codes: CODES, cells: {}, dutyRequests: [] },
      rules: mergeRules({ seniorStaff: ["s0"], fixedDuties: [{ id: "f", staffId: "s0", date: "2026-11-03", duty: "morning" }] }),
    });
    expect(reasons).toEqual([["fixed"]]);
    expect(noInChargeText({ day: "Tue 3 Nov", shift: "night", reasons, termOne: "Senior" }))
      .toBe("Night on Tue 3 Nov has no Senior: the only one is on a duty fixed by you.");
  });
});

/* ── On the screen ── */
const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E", sand: "#C9A15A" };
const Card = ({ children }) => <div>{children}</div>;
const Btn = ({ children, kind, small, ...rest }) => <button {...rest}>{children}</button>;
const Field = ({ label, children }) => <label>{label}{children}</label>;
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clone = (x) => JSON.parse(JSON.stringify(x));
let h = {};
function Ward({ start }) {
  const [data, setData] = useState(null);
  const [deptId, setDeptId] = useState(null);
  const history = useRotaHistory(data, setData, deptId);
  const update = (fn) => { h.writes += 1; setData((d) => fn(clone(d))); };
  h = { ...h, data, history, open: () => { setData(null); setDeptId("d1"); setTimeout(() => setData(start), 0); } };
  if (!data) return <div>Loading rota…</div>;
  return (
    <SmartRosterTab deptId="d1" data={data} update={update} staffEditable T={T} Card={Card} Btn={Btn} Field={Field}
      inputStyle={{}} th={{}} td={{}} uid={() => "u1"} dstr={iso} onApplied={() => {}} />
  );
}
const ward = (rosterRules, extra = {}) => ({
  staff: [
    { id: "s0", name: "Shau", leavePeriods: [] },
    { id: "s1", name: "Mariyam", leavePeriods: [{ start: "2099-03-01", end: "2099-03-10" }] },
    { id: "s2", name: "Ana", leavePeriods: [], endDate: "2099-01-31" },
    { id: "s3", name: "Ali", leavePeriods: [] },
  ],
  codes: CODES, cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false,
  ...(rosterRules === undefined ? {} : { rosterRules }), ...extra,
});
const openWard = async (start) => {
  h = { writes: 0 };
  render(<Ward start={start} />);
  act(() => { h.open(); });
  await screen.findByRole("heading", { name: "Your staff" });
};
const row = (name) => within(screen.getByRole("group", { name }));
/* Open a person's panel and write a fixed duty, as far as Add. */
const write = (name, date, duty) => {
  fireEvent.click(row(name).getByRole("button", { name: /^(\+ Rule|Rules \(\d+\))$/ }));
  fireEvent.change(screen.getByLabelText(`Add a rule for ${name}`), { target: { value: "fixed" } });
  fireEvent.change(screen.getByLabelText("Date"), { target: { value: date } });
  fireEvent.change(screen.getByLabelText("Duty"), { target: { value: duty } });
};
const addButton = () => screen.getByRole("button", { name: /Add rule/ });

describe("a fixed duty, on Your staff", () => {
  test("only a date and a duty; the preview; always kept; purple on the row; one Undo step", async () => {
    await openWard(ward(undefined));
    fireEvent.click(row("Shau").getByRole("button", { name: "+ Rule" }));
    fireEvent.change(screen.getByLabelText("Add a rule for Shau"), { target: { value: "fixed" } });
    expect(screen.queryByLabelText("How many")).toBeNull();
    expect(screen.queryByLabelText("Shift")).toBeNull();
    // The duties the ward runs, and Off; Evening is not run here.
    expect([...screen.getByLabelText("Duty").options].map((o) => o.text)).toEqual(["Morning", "Afternoon", "Night", "Off"]);
    expect(addButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2099-12-12" } });
    expect(screen.getByText("Shau: Morning on Sat 12 Dec, fixed by you — always kept.")).toBeInTheDocument();
    const before = JSON.stringify(h.data);
    fireEvent.click(addButton());
    expect(h.data.rosterRules.fixedDuties).toEqual([{ id: "u1", staffId: "s0", date: "2099-12-12", duty: "morning" }]);
    // As a purple label on the row, and as a line in the open panel.
    expect(row("Shau").getAllByText("Fixed: Morning on Sat 12 Dec")).toHaveLength(2);
    expect(row("Shau").getByText("Always kept")).toBeInTheDocument();
    expect(row("Shau").queryByRole("group", { name: /Must or Try/ })).toBeNull();
    expect(row("Shau").getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(h.history.depth).toBe(1);
    act(() => { h.history.undo(); });
    expect(JSON.stringify(h.data)).toBe(before);
  });

  test("removing the last one leaves nothing behind", async () => {
    await openWard(ward({ fixedDuties: [{ id: "f", staffId: "s0", date: "2099-12-12", duty: "night" }] }));
    expect(row("Shau").getByRole("button", { name: "Rules (1)" })).toBeInTheDocument();
    fireEvent.click(row("Shau").getByRole("button", { name: "Rules (1)" }));
    fireEvent.click(screen.getByLabelText("Remove: Fixed: Night on Sat 12 Dec"));
    expect("fixedDuties" in h.data.rosterRules).toBe(false);
  });

  test("refused: an approved request that day", async () => {
    await openWard(ward(undefined, { dutyRequests: [{ id: "q", staffId: "s0", date: "2099-12-12", category: "off", approved: true }] }));
    write("Shau", "2099-12-12", "night");
    expect(screen.getByText("Shau has an approved duty request on Sat 12 Dec (Off). Change it in the Duty requests tab instead.")).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });

  test("refused: on leave, or no longer employed, that day", async () => {
    await openWard(ward(undefined));
    write("Mariyam", "2099-03-05", "morning");
    expect(screen.getByText("Mariyam is on leave on Thu 5 Mar.")).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
    write("Ana", "2099-02-03", "morning");
    expect(screen.getByText("Ana is not on the rota on Tue 3 Feb.")).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });

  test("refused: skipped", async () => {
    await openWard(ward({ skipStaff: ["s3"] }));
    write("Ali", "2099-12-12", "morning");
    expect(screen.getByText("Ali is skipped, so Smart Roster does not roster them. Untick Skip first.")).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });

  test("refused: a shift the person is not ticked for; Off is still fine", async () => {
    await openWard(ward({ staffShifts: { s0: ["morning", "afternoon"] } }));
    write("Shau", "2099-12-12", "night");
    expect(screen.getByText("Shau is set up for Morning & Afternoon only.")).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Duty"), { target: { value: "off" } });
    expect(addButton()).not.toBeDisabled();
  });

  test("refused: a duty on a day their own Must keeps them off; Off that day is fine, and a Try does not refuse", async () => {
    // 12 December 2099 is a Saturday.
    await openWard(ward({ personRules: [{ id: "r", staffId: "s0", type: "offOn", days: [6], strength: "hard" }] }));
    write("Shau", "2099-12-12", "morning");
    expect(screen.getByText('Shau has "always off on Saturday" as a Must, which covers Sat 12 Dec.')).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Duty"), { target: { value: "off" } });
    expect(addButton()).not.toBeDisabled();
  });

  test("refused: a second fixed duty the same day", async () => {
    await openWard(ward({ fixedDuties: [{ id: "f", staffId: "s0", date: "2099-12-12", duty: "night" }] }));
    write("Shau", "2099-12-12", "morning");
    expect(screen.getByText("Shau already has a fixed duty on Sat 12 Dec. Remove it first to change it.")).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
  });

  test("gone by: greyed, and cleared together in one step, leaving the rest", async () => {
    await openWard(ward({ fixedDuties: [
      { id: "p1", staffId: "s0", date: "2000-01-04", duty: "night" },
      { id: "p2", staffId: "s3", date: "2000-02-01", duty: "off" },
      { id: "n1", staffId: "s0", date: "2099-12-12", duty: "morning" },
    ] }));
    expect(row("Shau").getByText("Fixed: Night on Tue 4 Jan").parentElement).toHaveStyle({ opacity: 0.55 });
    expect(row("Shau").getByText("Fixed: Morning on Sat 12 Dec").parentElement).toHaveStyle({ opacity: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Clear past fixed duties (2)" }));
    expect(h.data.rosterRules.fixedDuties).toEqual([{ id: "n1", staffId: "s0", date: "2099-12-12", duty: "morning" }]);
    expect(screen.queryByRole("button", { name: /Clear past fixed duties/ })).toBeNull();
    expect(h.history.depth).toBe(1);
  });

  test("the key says what purple means", async () => {
    await openWard(ward(undefined));
    expect(screen.getByText(/Ticked shifts/).closest("p")).toHaveTextContent("Purple: duties you fixed, always kept.");
  });
});
