/* One person's own rules in Smart Roster: "at most 1 Night a week", "at
   least 2 days between Nights", and the rest. The engine keeps them, says
   when it could not, names a Must that left a shift uncovered, and the
   screen adds, refuses and removes them. 1 November 2026 is a Sunday. */

import React, { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { generateRoster, personRuleText, mustCauseText } from "./rosterEngine";
import { weekConfig } from "./rosterConfig";
import SmartRosterTab from "./SmartRosterTab";

const WEEK = "2026-11-01";
const CODES = [
  { id: "M", code: "M", counts: "morning" }, { id: "A", code: "A", counts: "afternoon" },
  { id: "E", code: "E", counts: "evening" }, { id: "N", code: "N", counts: "night" },
  { id: "OFF", code: "OFF", counts: "off" }, { id: "NOFF", code: "(N)OFF", counts: "off" },
];
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const days = (start, n) => {
  const [y, m, d] = start.split("-").map(Number);
  return [...Array(n)].map((_, i) => iso(new Date(y, m - 1, d + i)));
};
// Four weeks of a plain rotation before the week, so the engine has history.
const history = (staff) => {
  const cycle = ["M", "A", "N", "NOFF", "OFF", "M", "A"];
  const cells = {};
  days("2026-10-04", 28).forEach((date, di) => {
    cells[date] = {};
    staff.forEach((s, si) => { cells[date][s.id] = cycle[(di + si) % 7]; });
  });
  return cells;
};
const NAMES = ["Shau", "Mariyam", "Ana"];
// The shape of the Emergency Room: 16 staff, two left to hand entry, 3 on each night.
const ward = (personRules) => {
  const staff = [...Array(16)].map((_, i) => ({ id: `r${i}`, name: NAMES[i] || `Nurse ${i}` }));
  return {
    staff, codes: CODES, cells: history(staff), dutyRequests: [],
    rosterRules: {
      lookbackDays: 14,
      coverage: { morning: { min: 3, max: 4 }, afternoon: { min: 3, max: 4 }, evening: { min: 0, max: 0 }, night: { min: 3, max: 3 } },
      weeklyMin: { morning: 1, afternoon: 1, evening: 0, night: 1, off: 1 },
      skipStaff: ["r14", "r15"],
      ...(personRules ? { personRules } : {}),
    },
  };
};
const rule = (staffId, type, shift, count, strength = "soft") => ({ id: `${staffId}-${type}`, staffId, type, shift, count, strength });
const week = days(WEEK, 7);
const nightsOf = (cells, id) => week.filter((d) => cells[`${id}|${d}`] === "night");

describe("the engine", () => {
  test("with no rules, an empty list builds exactly the week no list does", () => {
    const a = generateRoster({ ...weekConfig(ward(), WEEK), polishSteps: 3000 });
    const b = generateRoster({ ...weekConfig(ward([]), WEEK), polishSteps: 3000 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  test.each(["soft", "hard"])("Shau at most 1 Night, Mariyam 2 days between Nights (%s): both kept", (strength) => {
    const out = generateRoster(weekConfig(ward([
      rule("r0", "atMost", "night", 1, strength), rule("r1", "apart", "night", 2, strength),
    ]), WEEK));
    expect(out.ok).toBe(true);
    expect(nightsOf(out.cells, "r0").length).toBeLessThanOrEqual(1);
    const n = nightsOf(out.cells, "r1").map((d) => week.indexOf(d));
    n.slice(1).forEach((day, i) => expect(day - n[i] - 1).toBeGreaterThanOrEqual(2));
    expect(out.report.relaxations.filter((r) => r.personal)).toEqual([]);
    expect(out.report.shortfalls).toEqual([]);
  }, 60000);

  test("a rule an approved request breaks is reported, as it was set and with the person", () => {
    const data = ward([rule("r1", "apart", "night", 2)]);
    data.dutyRequests = [
      { id: "q1", staffId: "r1", date: "2026-11-02", category: "night", approved: true },
      { id: "q2", staffId: "r1", date: "2026-11-03", category: "night", approved: true },
    ];
    const out = generateRoster({ ...weekConfig(data, WEEK), polishSteps: 3000 });
    expect(out.report.relaxations).toContainEqual({
      date: "2026-11-03", shift: "night", staffId: "r1", rule: "at least 2 days between nights",
      personal: true, ruleType: "apart", strength: "soft",
    });
  });

  test("a Must that leaves a Night uncovered is named on the gap; a week is still made", () => {
    const data = ward();
    data.rosterRules.coverage.night = { min: 1, max: 1 };
    data.rosterRules.personRules = data.staff.slice(1, 14).map((s) => rule(s.id, "atMost", "night", 0, "hard"));
    const out = generateRoster({ ...weekConfig(data, WEEK), polishSteps: 3000 });
    expect(out.ok).toBe(true);
    const gaps = out.report.shortfalls.filter((g) => g.shift === "night");
    expect(gaps.length).toBeGreaterThan(0);
    gaps.forEach((g) => expect(mustCauseText(g.because)).toMatch(/, .+ and \d+ others: no nights \(Must\)$/));
  });
});

describe("how a rule is said", () => {
  test("each kind, in the manager's words", () => {
    expect(personRuleText(rule("x", "atMost", "night", 1))).toBe("at most 1 night a week");
    expect(personRuleText(rule("x", "atMost", "night", 0))).toBe("no nights");
    expect(personRuleText(rule("x", "atLeast", "morning", 3))).toBe("at least 3 mornings a week");
    expect(personRuleText(rule("x", "apart", "night", 2))).toBe("at least 2 days between nights");
    expect(personRuleText(rule("x", "apart", "night", 1))).toBe("at least 1 day between nights");
    expect(personRuleText(rule("x", "together", "night", 2))).toBe("nights kept in pairs");
  });

  test("the reasons for a gap: one, a few, many, and two different rules", () => {
    const most = rule("x", "atMost", "night", 1, "hard"), none = rule("x", "atMost", "night", 0, "hard");
    const by = (names, r) => names.map((name) => ({ name, rule: r }));
    expect(mustCauseText(by(["Shau"], most))).toBe("Shau: at most 1 night a week (Must)");
    expect(mustCauseText(by(["A", "B", "C"], none))).toBe("A, B and C: no nights (Must)");
    expect(mustCauseText(by(["A", "B", "C", "D", "E", "F", "G"], none))).toBe("A, B and 5 others: no nights (Must)");
    expect(mustCauseText([...by(["Shau"], most), ...by(["A", "B"], none)]))
      .toBe("Shau: at most 1 night a week (Must); A and B: no nights (Must)");
  });
});

describe("the Personal rules card", () => {
  const T = { lagoon: "#0F8B7E", ink: "#142B33", inkSoft: "#4A6570", line: "#DCE8E6", mist: "#EEF4F3", coral: "#E4604E", sand: "#C9A15A" };
  const Card = ({ children }) => <div>{children}</div>;
  const Btn = ({ children, kind, small, ...rest }) => <button {...rest}>{children}</button>;
  const Field = ({ label, children }) => <label>{label}{children}</label>;
  let saved;
  let n = 0;
  function App() {
    const [data, setData] = useState(() => ({
      staff: [...Array(4)].map((_, i) => ({ id: `a${i}`, name: NAMES[i] || `Nurse ${i}`, leavePeriods: [] })),
      codes: CODES, cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false,
    }));
    saved = data;
    const update = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
    return (
      <SmartRosterTab deptId="d1" data={data} update={update} staffEditable T={T} Card={Card} Btn={Btn} Field={Field}
        inputStyle={{}} th={{}} td={{}} uid={() => `p${(n += 1)}`} dstr={iso} onApplied={() => {}} />
    );
  }
  const choose = (current, value) => fireEvent.change(screen.getByDisplayValue(current), { target: { value } });
  const add = () => fireEvent.click(screen.getByRole("button", { name: "Add" }));
  const rowOf = (text) => screen.getByText(text).parentElement;

  test("adds a rule as Try, warns on a Must at least, refuses days between with pairs, and removes cleanly", () => {
    render(<App />);
    // Shau: at most 1 Night a week, the rule as it starts.
    choose("Choose…", "a0");
    expect(screen.getByText("Shau: at most 1 night a week — starts as Try.")).toBeInTheDocument();
    add();
    expect(saved.rosterRules.personRules).toEqual([
      { id: "p1", staffId: "a0", type: "atMost", shift: "night", count: 1, strength: "soft" },
    ]);
    expect(screen.getByText("At most 1 night a week")).toBeInTheDocument();

    // The same rule again is refused, and Add stays off.
    expect(screen.getByText(/Shau already has "at most 1 night a week"\. Remove it first/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();

    // At least: starts as Try; switched to Must, a warning.
    choose("At most … a week", "atLeast");
    add();
    expect(saved.rosterRules.personRules[1]).toMatchObject({ type: "atLeast", count: 1, strength: "soft" });
    expect(screen.queryByText(/A Must here can leave another shift uncovered/)).toBeNull();
    fireEvent.click(within(rowOf("At least 1 night a week")).getByRole("button", { name: "Must" }));
    expect(saved.rosterRules.personRules[1].strength).toBe("hard");
    expect(screen.getByText(/A Must here can leave another shift uncovered so that Shau gets 1 night/)).toBeInTheDocument();

    // Mariyam: pairs, then days between on the same shift is refused.
    choose("Shau", "a1");
    choose("At least … a week", "together");
    add();
    choose("Kept in pairs", "apart");
    expect(screen.getByText(/Mariyam already has "nights kept in pairs"\. Days between and pairs cannot both apply to nights/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    expect(saved.rosterRules.personRules).toHaveLength(3);

    // Removing every rule leaves nothing saved behind.
    ["At most 1 night a week", "At least 1 night a week", "Nights kept in pairs"].forEach((text) =>
      fireEvent.click(within(rowOf(text)).getAllByRole("button").pop()));
    expect("personRules" in saved.rosterRules).toBe(false);
  });
});
