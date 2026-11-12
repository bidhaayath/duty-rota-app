/* Step 2, "Your staff": one list of everyone, with their shifts, the ward's
   in-charge tick, Skip, their own rules and their approved duty requests, and
   a panel under each row for their rules. A new face on what was the Staff
   exceptions and Personal rules cards: every control writes the very keys the
   old ones did, opening writes nothing, and Undo takes each change back.
   The dates are far enough from today to stay on the same side of it. */

import React, { useState } from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import SmartRosterTab from "./SmartRosterTab";
import { useRotaHistory } from "./useRotaHistory";
import { mergeRules } from "./rosterConfig";

const CODES = [
  { id: "M", code: "M", counts: "morning" }, { id: "A", code: "A", counts: "afternoon" },
  { id: "E", code: "E", counts: "evening" }, { id: "N", code: "N", counts: "night" },
  { id: "OFF", code: "OFF", counts: "off" },
];
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const NAMES = ["Shau", "Mariyam", "Ana", "Ali"];
const people = () => NAMES.map((name, i) => ({ id: `s${i}`, name, leavePeriods: [] }));
const rota = (rosterRules, extra = {}) => ({
  staff: people(), codes: CODES, cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false,
  ...(rosterRules === undefined ? {} : { rosterRules }), ...extra,
});
const clone = (x) => JSON.parse(JSON.stringify(x));

const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E", sand: "#C9A15A" };
const Card = ({ children }) => <div>{children}</div>;
const Btn = ({ children, kind, small, ...rest }) => <button {...rest}>{children}</button>;
const Field = ({ label, children }) => <label>{label}{children}</label>;

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
const openWard = async (start) => {
  h = { writes: 0 };
  render(<Ward start={start} />);
  act(() => { h.open(); });
  await screen.findByRole("heading", { name: "Your staff" });
  return start;
};
const row = (name) => within(screen.getByRole("group", { name }));
const rowEl = (name) => screen.getByRole("group", { name });

describe("opening writes nothing, and every saved setting shows", () => {
  test("a ward that never set anything", async () => {
    const start = await openWard(rota(undefined));
    expect(screen.getByLabelText("This ward calls the person in charge")).toHaveValue("Senior");
    expect(row("Shau").getByRole("button", { name: "+ Rule" })).toBeInTheDocument();
    expect(row("Shau").getByRole("button", { name: "Morning" })).toHaveAttribute("aria-pressed", "false");
    expect(h.writes).toBe(0);
    expect(h.data).toBe(start);
  });

  test("ticks, an in-charge, a skip, rules and requests, as saved", async () => {
    const start = await openWard(rota({
      seniorTerm: "Shift Manager", seniorStaff: ["s1"], skipStaff: ["s3"],
      staffShifts: { s0: ["morning", "afternoon"], s2: ["evening"] },
      personRules: [
        { id: "r1", staffId: "s1", type: "atMost", shift: "night", count: 1, strength: "soft" },
        { id: "r2", staffId: "s1", type: "offOn", days: [5], strength: "hard" },
      ],
    }, {
      dutyRequests: [
        { id: "q1", staffId: "s1", date: "2099-03-06", category: "off", approved: true },
        { id: "q2", staffId: "s1", date: "2000-01-01", category: "night", approved: true },   // past: not shown
        { id: "q3", staffId: "s1", date: "2099-03-02", category: "night", approved: false },  // not approved
      ],
    }));
    expect(row("Shau").getByText("Morning & Afternoon only")).toBeInTheDocument();
    expect(row("Shau").getByRole("button", { name: "✓ Morning" })).toHaveAttribute("aria-pressed", "true");
    // Evening is not run here, but Ana is ticked for it: still shown, so nothing saved is hidden.
    expect(row("Ana").getByRole("button", { name: "✓ Evening" })).toBeInTheDocument();
    expect(row("Shau").queryByRole("button", { name: "Evening" })).toBeNull();
    expect(row("Mariyam").getByRole("button", { name: "✓ Shift Manager" })).toBeInTheDocument();
    expect(row("Mariyam").getByText("At most 1 night a week")).toBeInTheDocument();
    expect(row("Mariyam").getByText("Always off on Friday (Must)")).toBeInTheDocument();
    expect(row("Mariyam").getByText("Off on Fri 6 Mar")).toBeInTheDocument();
    expect(row("Mariyam").queryByText(/Sat 1 Jan/)).toBeNull();
    expect(row("Mariyam").queryByText(/Mon 2 Mar/)).toBeNull();
    expect(row("Mariyam").getByRole("button", { name: "Rules (2)" })).toBeInTheDocument();
    expect(row("Ali").getByRole("button", { name: "✓ Skipped" })).toBeInTheDocument();
    expect(h.writes).toBe(0);
    expect(h.data).toBe(start);
  });

  test("a ward with its own plural keeps the box for it", async () => {
    await openWard(rota({ seniorTerm: "Sister", seniorTermPlural: "Sisters-in-charge" }));
    expect(screen.getByLabelText("More than one of them")).toHaveValue("Sisters-in-charge");
  });
});

/* Each control once, against what the old handler wrote: the merged
   settings with the one key changed, in one Undo step. */
const was = (patch) => { const r = mergeRules({}); return JSON.stringify({ ...r, ...patch(r) }); };
const CONTROLS = [
  ["tick a shift", () => fireEvent.click(row("Shau").getByRole("button", { name: "Night" })),
    () => ({ staffShifts: { s0: ["night"] } })],
  ["tick in-charge", () => fireEvent.click(row("Mariyam").getByRole("button", { name: "Senior" })),
    () => ({ seniorStaff: ["s1"] })],
  ["skip", () => fireEvent.click(row("Ali").getByRole("button", { name: "Skip" })),
    () => ({ skipStaff: ["s3"] })],
  ["the ward's word", () => fireEvent.change(screen.getByLabelText("This ward calls the person in charge"), { target: { value: "Sister" } }),
    () => ({ seniorTerm: "Sister" })],
  ["add a rule", () => {
    fireEvent.click(row("Ana").getByRole("button", { name: "+ Rule" }));
    fireEvent.click(screen.getByRole("button", { name: /Add rule/ }));
  }, () => ({ personRules: [{ id: "u1", staffId: "s2", type: "atMost", shift: "night", count: 1, strength: "soft" }] })],
];

describe("each control writes what the old one wrote, in one Undo step", () => {
  test.each(CONTROLS)("%s", async (_name, act_, patch) => {
    await openWard(rota(undefined));
    const before = JSON.stringify(h.data);
    act_();
    expect(h.writes).toBe(1);
    expect(JSON.stringify(h.data.rosterRules)).toBe(was(patch));
    expect(h.history.depth).toBe(1);
    act(() => { h.history.undo(); });
    expect(JSON.stringify(h.data)).toBe(before);
  });

  test("untick the last shift, change Must or Try, and remove the last rule: the same keys as before", async () => {
    await openWard(rota({
      staffShifts: { s0: ["night"] },
      personRules: [{ id: "r1", staffId: "s0", type: "atMost", shift: "night", count: 1, strength: "soft" }],
    }));
    fireEvent.click(row("Shau").getByRole("button", { name: "✓ Night" }));
    expect(h.data.rosterRules.staffShifts).toEqual({});
    fireEvent.click(row("Shau").getByRole("button", { name: "Rules (1)" }));
    fireEvent.click(within(screen.getByRole("group", { name: "At most 1 night a week: Must or Try" })).getByRole("button", { name: "Must" }));
    expect(h.data.rosterRules.personRules[0].strength).toBe("hard");
    fireEvent.click(screen.getByLabelText("Remove: At most 1 night a week"));
    expect("personRules" in h.data.rosterRules).toBe(false);
    expect(h.history.depth).toBe(3);
  });
});

describe("the rows", () => {
  test("Skip greys the row out and leaves only Skip and Rules to press", async () => {
    await openWard(rota({ skipStaff: ["s3"] }));
    expect(row("Ali").getByRole("button", { name: "✓ Skipped" }).parentElement.parentElement).toHaveStyle({ opacity: 0.55 });
    expect(row("Ali").getByRole("button", { name: "Morning" })).toBeDisabled();
    expect(row("Ali").getByRole("button", { name: "Senior" })).toBeDisabled();
    expect(row("Ali").getByRole("button", { name: "✓ Skipped" })).not.toBeDisabled();
  });

  test("three requests, then +N more, which shows the rest and folds them away again", async () => {
    const asks = ["2099-03-02", "2099-03-03", "2099-03-04", "2099-03-05", "2099-03-06"]
      .map((date, i) => ({ id: `q${i}`, staffId: "s0", date, category: i % 2 ? "night" : "off", approved: true }));
    await openWard(rota(undefined, { dutyRequests: asks }));
    expect(row("Shau").getByText("Off on Mon 2 Mar")).toBeInTheDocument();
    expect(row("Shau").getByText("Off on Wed 4 Mar")).toBeInTheDocument();
    expect(row("Shau").queryByText("Night on Thu 5 Mar")).toBeNull();
    const more = row("Shau").getByRole("button", { name: "+2 more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(row("Shau").getByText("Night on Thu 5 Mar")).toBeInTheDocument();
    expect(row("Shau").getByText("Off on Fri 6 Mar")).toBeInTheDocument();
    fireEvent.click(row("Shau").getByRole("button", { name: "Show fewer" }));
    expect(row("Shau").queryByText("Night on Thu 5 Mar")).toBeNull();
    expect(h.writes).toBe(0);
  });

  test("one panel open at a time; the requests note only for someone with requests", async () => {
    await openWard(rota(undefined, { dutyRequests: [{ id: "q", staffId: "s1", date: "2099-03-06", category: "off", approved: true }] }));
    const note = "Blue labels are approved duty requests. Change them in the Duty requests tab.";
    fireEvent.click(row("Shau").getByRole("button", { name: "+ Rule" }));
    expect(screen.getByLabelText("Add a rule for Shau")).toBeInTheDocument();
    expect(screen.queryByText(note)).toBeNull();
    fireEvent.click(row("Mariyam").getByRole("button", { name: "+ Rule" }));
    expect(screen.queryByLabelText("Add a rule for Shau")).toBeNull();
    expect(screen.getByLabelText("Add a rule for Mariyam")).toBeInTheDocument();
    expect(row("Mariyam").getByText(note)).toBeInTheDocument();
    fireEvent.click(row("Mariyam").getByRole("button", { name: "Close" }));
    expect(screen.queryByLabelText("Add a rule for Mariyam")).toBeNull();
  });

  test("the seven kinds of rule, and only the fields each needs", async () => {
    await openWard(rota(undefined));
    fireEvent.click(row("Shau").getByRole("button", { name: "+ Rule" }));
    const box = screen.getByLabelText("Add a rule for Shau");
    expect([...box.options].map((o) => o.text)).toEqual([
      "At most … of a shift a week", "At least … of a shift a week", "Gap between shifts: at least … days",
      "A shift in pairs (2 together)", "Always off on … (days)", "On … (days), only … (shifts)",
      "Fixed duty on a date (set by you)",
    ]);
    expect(screen.getByLabelText("How many")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "apart" } });
    expect(screen.getByLabelText("Days")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "together" } });
    expect(screen.queryByLabelText("How many")).toBeNull();
    expect(screen.getByLabelText("Shift")).toBeInTheDocument();
    fireEvent.change(box, { target: { value: "offOn" } });
    expect(screen.queryByLabelText("Shift")).toBeNull();
    expect(screen.getByRole("button", { name: "Friday" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add rule/ })).toBeDisabled();
  });

  test("a key for the list, and staff on leave are skipped for those days", async () => {
    await openWard(rota(undefined));
    expect(screen.getByText(/Ticked shifts/).closest("p")).toHaveTextContent("Ticked shifts: they only ever do those (no ticks = any shift). Senior: can take charge. Skip: left out; enter their duties by hand.");
    expect(screen.getByText("Staff on recorded leave are skipped automatically for those days.")).toBeInTheDocument();
  });

  test("rules saved for somebody no longer on the ward stay in view, and can be taken away", async () => {
    await openWard(rota({ personRules: [{ id: "g", staffId: "gone", type: "atMost", shift: "night", count: 0, strength: "hard" }] }));
    expect(screen.getByText("Rules for people no longer on this ward")).toBeInTheDocument();
    expect(screen.getByText("Someone no longer on this ward: No nights")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Remove: No nights"));
    expect("personRules" in h.data.rosterRules).toBe(false);
  });

  test("every button in a row and its panel is at least 44px high, +N more included", async () => {
    const asks = ["2099-03-02", "2099-03-03", "2099-03-04", "2099-03-05"]
      .map((date, i) => ({ id: `q${i}`, staffId: "s0", date, category: "off", approved: true }));
    await openWard(rota({ personRules: [{ id: "r", staffId: "s0", type: "atMost", shift: "night", count: 1, strength: "soft" }] },
      { dutyRequests: asks }));
    fireEvent.click(row("Shau").getByRole("button", { name: "Rules (1)" }));
    fireEvent.change(screen.getByLabelText("Add a rule for Shau"), { target: { value: "offOn" } });
    const heightOf = (b) => parseInt(b.style.minHeight || b.style.height, 10);
    row("Shau").getAllByRole("button").forEach((b) => expect([b.textContent || b.getAttribute("aria-label"), heightOf(b) >= 44])
      .toEqual([b.textContent || b.getAttribute("aria-label"), true]));
  });
});
