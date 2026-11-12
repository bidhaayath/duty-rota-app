/* One person's own rules in Smart Roster: "at most 1 Night a week", "at
   least 2 days between Nights", and the rest. The engine keeps them, says
   when it could not, names a Must that left a shift uncovered, and the
   screen adds, refuses and removes them. 1 November 2026 is a Sunday. */

import React, { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { generateRoster, personRuleText, mustCauseText, rosterContext, auditRoster } from "./rosterEngine";
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

/* Rules about days of the week: "always off on Friday and Saturday", "on
   Friday and Saturday only Morning". Days are numbers, 0 for Sunday to 6 for
   Saturday; in this week Friday is 6 November and Saturday the 7th. */
describe("the engine, rules about days", () => {
  const FRI = "2026-11-06", SAT = "2026-11-07";
  const offOn = (staffId, days, strength = "hard") => ({ id: `${staffId}-off`, staffId, type: "offOn", days, strength });
  const onlyOn = (staffId, days, shifts, strength = "soft") => ({ id: `${staffId}-only`, staffId, type: "onlyOn", days, shifts, strength });
  const of = (cells, id) => week.map((d) => cells[`${id}|${d}`]);
  const offs = (cells, id) => of(cells, id).filter((c) => c === "off").length;
  /* Somebody always off on certain days was off on them before this week
     too, so their history says so. Without it the week would open on eight
     days worked in a row, and the engine would rightly break that up. */
  const wardWith = (rules, weekdays = [5, 6], staffId = "r2") => {
    const data = ward(rules);
    Object.keys(data.cells).forEach((date) => {
      const [y, m, d] = date.split("-").map(Number);
      if (weekdays.includes(new Date(y, m - 1, d).getDay())) data.cells[date][staffId] = "OFF";
    });
    return data;
  };

  test.each(["soft", "hard"])("Ana always off Friday and Saturday (%s): those two days, and no others", (strength) => {
    const out = generateRoster(weekConfig(wardWith([offOn("r2", [5, 6], strength)]), WEEK));
    expect(out.ok).toBe(true);
    expect(out.cells[`r2|${FRI}`]).toBe("off");
    expect(out.cells[`r2|${SAT}`]).toBe("off");
    // The ward's most is two off days a week: the fixed days are those two.
    expect(offs(out.cells, "r2")).toBe(2);
    expect(out.report.relaxations.filter((r) => r.personal || r.staffId === "r2")).toEqual([]);
    expect(out.report.shortfalls).toEqual([]);
  }, 60000);

  test.each(["soft", "hard"])("Mariyam on Friday and Saturday only Morning (%s): a morning or off, nothing else", (strength) => {
    const out = generateRoster(weekConfig(ward([onlyOn("r1", [5, 6], ["morning"], strength)]), WEEK));
    expect(out.ok).toBe(true);
    [FRI, SAT].forEach((d) => expect(["morning", "off"]).toContain(out.cells[`r1|${d}`]));
    expect(out.report.relaxations.filter((r) => r.personal)).toEqual([]);
    expect(out.report.shortfalls).toEqual([]);
  }, 60000);

  test("two fixed off days side by side are not counted as two off days together", () => {
    const withRule = weekConfig(wardWith([offOn("r2", [5, 6])]), WEEK);
    const without = weekConfig(wardWith(undefined), WEEK);
    const out = generateRoster({ ...withRule, polishSteps: 3000 });
    const pairs = (cfg) => {
      const staff = cfg.staff.filter((s) => !cfg.skipStaff.includes(s.id));
      return auditRoster(cfg, rosterContext(cfg, week, staff), out.cells).issues
        .filter((i) => i.kind === "doubleOff" && i.date === SAT).length;
    };
    expect(pairs(without) - pairs(withRule)).toBe(1);
  });

  test("three fixed days where the ward's most is two: her number is hers, and not reported", () => {
    const out = generateRoster(weekConfig(wardWith([offOn("r2", [1, 2, 3])], [1, 2, 3]), WEEK));
    expect(of(out.cells, "r2").slice(1, 4)).toEqual(["off", "off", "off"]);
    expect(offs(out.cells, "r2")).toBe(3);
    expect(out.report.relaxations.filter((r) => r.staffId === "r2")).toEqual([]);
  }, 60000);

  test("an approved request on a fixed day wins, and the rule is reported with the day", () => {
    const data = wardWith([offOn("r2", [5, 6])]);
    data.dutyRequests = [{ id: "q1", staffId: "r2", date: FRI, category: "night", approved: true }];
    const out = generateRoster({ ...weekConfig(data, WEEK), polishSteps: 3000 });
    expect(out.cells[`r2|${FRI}`]).toBe("night");
    expect(out.report.relaxations).toContainEqual({
      date: FRI, shift: "night", staffId: "r2", rule: "always off on Friday and Saturday",
      personal: true, ruleType: "offOn", strength: "hard",
    });
  });

  test("a Must that leaves Friday short is named on each gap; a Try is given up to cover it", () => {
    // Everybody but two is always off on Friday, and Friday needs nine.
    const rules = (strength) => [...Array(12)].map((_, i) => offOn(`r${i + 2}`, [5], strength));
    const must = generateRoster({ ...weekConfig(ward(rules("hard")), WEEK), polishSteps: 3000 });
    expect(must.ok).toBe(true);
    const gaps = must.report.shortfalls.filter((g) => g.date === FRI);
    expect(gaps.length).toBeGreaterThan(0);
    gaps.forEach((g) => expect(mustCauseText(g.because))
      .toMatch(/ others are off that day by a personal rule: always off on Friday \(Must\)$/));
    week.forEach((d) => { if (d !== FRI) expect(must.report.shortfalls.filter((g) => g.date === d && g.because)).toEqual([]); });
    for (let i = 2; i < 14; i++) expect(must.cells[`r${i}|${FRI}`]).toBe("off");

    const uncovered = (out) => out.report.shortfalls.reduce((n, g) => n + g.needed, 0);
    const soft = generateRoster({ ...weekConfig(ward(rules("soft")), WEEK), polishSteps: 3000 });
    expect(uncovered(soft)).toBeLessThan(uncovered(must));
    expect(soft.report.relaxations.some((r) => r.personal && r.ruleType === "offOn" && r.strength === "soft")).toBe(true);
    expect(soft.report.shortfalls.filter((g) => g.because)).toEqual([]);
  }, 60000);
});

describe("how a rule is said", () => {
  test("a rule about days, in the manager's words", () => {
    expect(personRuleText({ type: "offOn", days: [5, 6] })).toBe("always off on Friday and Saturday");
    expect(personRuleText({ type: "offOn", days: [0] })).toBe("always off on Sunday");
    expect(personRuleText({ type: "onlyOn", days: [5, 6], shifts: ["morning"] })).toBe("on Friday and Saturday only mornings");
    expect(personRuleText({ type: "onlyOn", days: [4], shifts: ["morning", "afternoon"] })).toBe("on Thursday only mornings and afternoons");
    expect(mustCauseText([{ name: "Ana", rule: { type: "offOn", days: [5, 6], strength: "hard" } }]))
      .toBe("Ana is off that day by a personal rule: always off on Friday and Saturday (Must)");
    expect(mustCauseText([{ name: "Mariyam", rule: { type: "onlyOn", days: [5], shifts: ["morning"], strength: "hard" } }]))
      .toBe("Mariyam is limited that day by a personal rule: on Friday only mornings (Must)");
    expect(mustCauseText([
      { name: "Ana", rule: { type: "offOn", days: [5], strength: "hard" } },
      { name: "Hawwa", rule: { type: "offOn", days: [5], strength: "hard" } },
      { name: "Shau", rule: rule("x", "atMost", "night", 1, "hard") },
    ])).toBe("Ana and Hawwa are off that day by a personal rule: always off on Friday (Must); Shau: at most 1 night a week (Must)");
  });

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
  function App({ count = 4 }) {
    const [data, setData] = useState(() => ({
      staff: [...Array(count)].map((_, i) => ({ id: `a${i}`, name: NAMES[i] || `Nurse ${i}`, leavePeriods: [] })),
      codes: CODES, cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false,
    }));
    saved = data;
    const update = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
    return (
      <SmartRosterTab deptId="d1" data={data} update={update} staffEditable T={T} Card={Card} Btn={Btn} Field={Field}
        inputStyle={{}} th={{}} td={{}} uid={() => `p${(n += 1)}`} dstr={iso} onApplied={() => {}} />
    );
  }
  /* The rows of Your staff: a person's row, their rules panel, and the rule being written in it. */
  const row = (name) => within(screen.getByRole("group", { name }));
  const openRules = (name) => fireEvent.click(row(name).getByRole("button", { name: /^(\+ Rule|Rules \(\d+\))$/ }));
  const ruleType = (name, value) => fireEvent.change(screen.getByLabelText(`Add a rule for ${name}`), { target: { value } });
  const add = () => fireEvent.click(screen.getByRole("button", { name: /Add rule/ }));
  const addButton = () => screen.getByRole("button", { name: /Add rule/ });
  const strength = (text, which) => fireEvent.click(within(screen.getByRole("group", { name: `${text}: Must or Try` })).getByRole("button", { name: which }));
  const remove = (text) => fireEvent.click(screen.getByLabelText(`Remove: ${text}`));

  test("adds a rule as Try, warns on a Must at least, refuses a gap between with pairs, and removes cleanly", () => {
    render(<App />);
    // Shau: at most 1 Night a week, the rule as it starts.
    openRules("Shau");
    expect(screen.getByText("Shau: at most 1 night a week — starts as Try.")).toBeInTheDocument();
    add();
    expect(saved.rosterRules.personRules).toEqual([
      { id: "p1", staffId: "a0", type: "atMost", shift: "night", count: 1, strength: "soft" },
    ]);
    // On the row as a grey label, and in the panel as a line with Must or Try.
    expect(row("Shau").getAllByText("At most 1 night a week")).toHaveLength(2);
    expect(row("Shau").getByRole("button", { name: "Close" })).toBeInTheDocument();

    // The same rule again is refused, and Add stays off.
    expect(screen.getByText(/Shau already has "at most 1 night a week"\. Remove it first/)).toBeInTheDocument();
    expect(addButton()).toBeDisabled();

    // At least: starts as Try; switched to Must, a warning.
    ruleType("Shau", "atLeast");
    add();
    expect(saved.rosterRules.personRules[1]).toMatchObject({ type: "atLeast", count: 1, strength: "soft" });
    expect(screen.queryByText(/A Must here can leave another shift uncovered/)).toBeNull();
    strength("At least 1 night a week", "Must");
    expect(saved.rosterRules.personRules[1].strength).toBe("hard");
    expect(screen.getByText(/A Must here can leave another shift uncovered so that Shau gets 1 night/)).toBeInTheDocument();
    expect(row("Shau").getByText("At least 1 night a week (Must)")).toBeInTheDocument();

    // Mariyam: pairs, then a gap between on the same shift is refused, under its new name.
    openRules("Mariyam");
    ruleType("Mariyam", "together");
    add();
    ruleType("Mariyam", "apart");
    expect(screen.getByRole("option", { name: "Gap between shifts: at least … days" }).selected).toBe(true);
    expect(screen.getByText(/Mariyam already has "nights kept in pairs"\. A gap between shifts and pairs cannot both apply to nights/)).toBeInTheDocument();
    expect(addButton()).toBeDisabled();
    expect(saved.rosterRules.personRules).toHaveLength(3);

    // Removing every rule leaves nothing saved behind.
    remove("Nights kept in pairs");
    openRules("Shau");
    remove("At most 1 night a week");
    remove("At least 1 night a week");
    expect("personRules" in saved.rosterRules).toBe(false);
  });

  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const tick = (name) => fireEvent.click(screen.getByRole("button", { name }));

  test("rules about days: seven day chips, always off starts as Must, only shifts as Try, and refusals", () => {
    render(<App />);
    openRules("Ana");
    ruleType("Ana", "offOn");
    // The seven days and no shortcut for a weekend.
    DAYS.forEach((d) => expect(screen.getByRole("button", { name: d })).toBeInTheDocument());
    expect(screen.queryByText(/weekend/i)).toBeNull();
    expect(addButton()).toBeDisabled();
    tick("Friday"); tick("Saturday");
    expect(screen.getByText("Ana: always off on Friday and Saturday — starts as Must.")).toBeInTheDocument();
    add();
    expect(saved.rosterRules.personRules).toEqual([
      { id: expect.any(String), staffId: "a2", type: "offOn", days: [5, 6], strength: "hard" },
    ]);
    expect(row("Ana").getByText("Always off on Friday and Saturday (Must)")).toBeInTheDocument();

    // A day already spoken for, in either kind, is refused.
    ruleType("Ana", "onlyOn");
    tick("Only mornings");
    expect(screen.getByText(/Ana already has "always off on Friday and Saturday", which covers Friday\. Remove it first/)).toBeInTheDocument();
    expect(addButton()).toBeDisabled();

    // Every shift ticked would change nothing.
    tick("Friday"); tick("Saturday"); tick("Thursday");
    tick("Only afternoons"); tick("Only nights");
    expect(screen.getByText(/Those are all the shifts Ana works, so this rule would change nothing/)).toBeInTheDocument();
    tick("Only afternoons"); tick("Only nights");
    expect(screen.getByText("Ana: on Thursday only mornings — starts as Try.")).toBeInTheDocument();
    add();
    expect(saved.rosterRules.personRules[1]).toMatchObject(
      { staffId: "a2", type: "onlyOn", days: [4], shifts: ["morning"], strength: "soft" });
    expect(row("Ana").getAllByText("On Thursday only mornings")).toHaveLength(2);

    // At least more nights than the days left open is refused: four are left.
    ruleType("Ana", "atLeast");
    fireEvent.change(screen.getByLabelText("How many"), { target: { value: "5" } });
    expect(screen.getByText(/Ana's rules about days leave 4 days a week for nights, so at least 5 could never be met/)).toBeInTheDocument();
    expect(addButton()).toBeDisabled();

    // More days off than the ward's most of 2: said before Add and after.
    openRules("Mariyam");
    ruleType("Mariyam", "offOn");
    tick("Sunday"); tick("Monday"); tick("Tuesday");
    const note = "That is 3 days off a week, more than the ward's most of 2, so for Mariyam the most off days is 3 and the fewest duties 4.";
    expect(screen.getByText(note)).toBeInTheDocument();
    add();
    // Now under the saved rule (the draft itself is refused as a repeat), and said once.
    expect(screen.getAllByText(note)).toHaveLength(1);
    expect(screen.getByLabelText("Remove: Always off on Sunday, Monday and Tuesday").parentElement.parentElement)
      .toHaveTextContent(note);

    // Removing them leaves nothing behind.
    remove("Always off on Sunday, Monday and Tuesday");
    openRules("Ana");
    remove("Always off on Friday and Saturday");
    remove("On Thursday only mornings");
    expect("personRules" in saved.rosterRules).toBe(false);
  });

  test("a gap named with its Must is not listed again as one the rest rules left unfilled", async () => {
    // Eight on the rota and five places a day; four always off on Friday by a Must.
    const offFriday = [0, 1, 2, 3].map((i) => ({ id: `f${i}`, staffId: `a${i}`, type: "offOn", days: [5], strength: "hard" }));
    function Ward() {
      const [data, setData] = useState(() => ({
        staff: [...Array(8)].map((_, i) => ({ id: `a${i}`, name: NAMES[i] || `Nurse ${i}`, leavePeriods: [] })),
        codes: CODES, cells: {}, cellMeta: {}, nonOfficial: [], dutyRequests: [], fridayRule: false,
        rosterRules: { personRules: offFriday },
      }));
      const update = (fn) => setData((d) => fn(JSON.parse(JSON.stringify(d))));
      return (
        <SmartRosterTab deptId="d1" data={data} update={update} staffEditable T={T} Card={Card} Btn={Btn} Field={Field}
          inputStyle={{}} th={{}} td={{}} uid={() => "u"} dstr={iso} onApplied={() => {}} />
      );
    }
    render(<Ward />);
    fireEvent.click(screen.getByText("Generate this week"));
    const red = (await screen.findByText("Left uncovered by a personal Must rule:", {}, { timeout: 30000 })).parentElement;
    const named = within(red).getAllByRole("listitem").map((li) => {
      const [, shift, day] = li.textContent.match(/^(\w+) on \w+ (\d+) \w+ uncovered\. .* off that day by a personal rule: always off on Friday \(Must\)\.$/);
      return `${day} ${shift.toLowerCase()}`;
    });
    expect(named.length).toBeGreaterThan(0);
    expect(within(red).getByText("You can apply this and fill them by hand.")).toBeInTheDocument();
    // The amber box, if there is one, lists only gaps nobody's Must is named on.
    const amber = screen.queryByText(/shifts? could not be filled:/);
    if (amber) named.forEach((gap) => expect(amber.parentElement.textContent).not.toMatch(new RegExp(`\\b${gap}\\b`)));
  }, 60000);

  test("a day too many people are always off by a Must is warned about", () => {
    render(<App count={6} />);
    // Six on the rota and five places a day: two off every Friday leaves four.
    const offFriday = (name) => { openRules(name); ruleType(name, "offOn"); tick("Friday"); };
    offFriday("Shau");
    add();
    expect(screen.queryByText(/only \d people are left/)).toBeNull();
    offFriday("Mariyam");
    expect(screen.getByText(/On Friday only 4 people are left for the 5 places the ward fills each day/)).toBeInTheDocument();
    add();
    // Said once, above the list, not under each Friday rule.
    expect(screen.getAllByText(/On Friday only 4 people are left/)).toHaveLength(1);
    // A third on Friday: Friday is already said, so not again before Add.
    offFriday("Ana");
    expect(screen.getAllByText(/On Friday only/)).toHaveLength(1);
    add();
    expect(screen.getAllByText(/On Friday only/)).toHaveLength(1);
    expect(screen.getByText(/On Friday only 3 people are left/)).toBeInTheDocument();
    // Gone once enough of them are Try.
    strength("Always off on Friday", "Try");
    openRules("Mariyam");
    strength("Always off on Friday", "Try");
    expect(screen.queryByText(/On Friday only/)).toBeNull();
  });
});
