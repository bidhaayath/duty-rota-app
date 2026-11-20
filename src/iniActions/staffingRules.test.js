/* Ini's ward staffing settings: staff on each shift (set_coverage) and each
   person's shifts per week (set_weekly_shifts). Pure functions; nothing
   here reaches the live service. The ward has never changed Smart Roster's
   coverage: morning 2–3, afternoon 2–3, night 1–2, no evening. */

import { readReply, checkLines, applyLines } from "./index";
import { mergeRules } from "../rosterConfig";

const parse = require("../../api/ai/parse.js")._test;

const makeData = () => ({
  staff: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((id) => ({ id, name: `RN ${id.toUpperCase()}`, leavePeriods: [] })),
  codes: [{ id: "M", code: "M", counts: "morning" }],
  cells: {}, nonOfficial: [], dutyRequests: [], rosterRules: {},
});
const period = { staffIds: ["a", "b"], from: "2026-11-29", to: "2026-12-05" };
const read = (actions) => readReply({ actions, unclear: [] }, period).lines;
const check = (actions, data = makeData()) => checkLines(read(actions), { data, today: "2026-11-20" });
const save = (data, lines) => applyLines(data, lines, { uid: () => "x", today: "2026-11-20" });
const text = (l) => l.warnings.join(" | ");

describe("the server", () => {
  const input = parse.readInput({
    departmentId: "11111111-1111-1111-1111-111111111111", text: "x", from: "2026-11-29", to: "2026-12-05",
    staff: [{ id: "a", name: "AHMED" }], shifts: ["morning", "afternoon", "night"],
  }).input;
  const run = (actions) => parse.checkAnswer({ actions, unclear: [] }, input, "2026-11-20");

  test("keeps staff on each shift, both sides of a shift together", () => {
    const out = run([{ type: "set_coverage", cover: [
      { shift: "morning", min: 3, max: null }, { shift: "afternoon", min: 3, max: null }, { shift: "night", min: 3, max: 3 },
    ] }]);
    expect(out.unclear).toEqual([]);
    expect(out.actions).toEqual([{ type: "set_coverage", cover: {
      morning: { min: 3, max: null }, afternoon: { min: 3, max: null }, night: { min: 3, max: 3 } } }]);
  });

  test("leaves out a shift the ward does not run, and numbers that clash", () => {
    const out = run([{ type: "set_coverage", cover: [{ shift: "evening", min: 2, max: null }, { shift: "night", min: 4, max: 2 }] }]);
    expect(out.actions).toEqual([]);
    expect(out.unclear.length).toBe(2);
  });

  test("keeps a weekly limit for everyone", () => {
    const out = run([{ type: "set_weekly_shifts", shift: "night", min: null, max: 2 }]);
    expect(out.actions).toEqual([{ type: "set_weekly_shifts", shift: "night", min: null, max: 2 }]);
    expect(run([{ type: "set_weekly_shifts", shift: "night", min: null, max: 9 }]).actions).toEqual([]);
  });

  test("the prompt tells Ini about both, and that leave may run up to a year", () => {
    const { system } = parse.buildPrompt(input, "2026-11-20");
    expect(system).toMatch(/set_coverage/);
    expect(system).toMatch(/set_weekly_shifts/);
    expect(system).toMatch(/a leave may run up to a year/);
  });
});

describe("set_coverage", () => {
  test("at least 3 on every shift and at most 3 on nights: shown, then saved where Smart Roster keeps it", () => {
    const [l] = check([{ type: "set_coverage", cover: {
      morning: { min: 3, max: null }, afternoon: { min: 3, max: null }, night: { min: 3, max: 3 } } }]);
    expect(l.on).toBe(true);
    expect(l.words.what).toBe("Staff on each shift, every day");
    expect(l.words.when).toBe("morning 2–3 → 3–3, afternoon 2–3 → 3–3, night 1–2 → 3–3");
    const d = save(makeData(), [l]);
    const cov = mergeRules(d.rosterRules).coverage;
    expect([cov.morning, cov.afternoon, cov.night]).toEqual([{ min: 3, max: 3 }, { min: 3, max: 3 }, { min: 3, max: 3 }]);
    expect(cov.evening).toEqual({ min: 0, max: 0 });
  });

  test("an at least above the saved at most raises it, and says so", () => {
    const [l] = check([{ type: "set_coverage", cover: { morning: { min: 5, max: null } } }]);
    expect(l.words.when).toBe("morning 2–3 → 5–5");
    expect(text(l)).toMatch(/at most raised to 5 to match/);
  });

  test("an at most below the saved at least lowers it, and says so", () => {
    const [l] = check([{ type: "set_coverage", cover: { morning: { min: null, max: 1 } } }]);
    expect(l.words.when).toBe("morning 2–3 → 1–1");
    expect(text(l)).toMatch(/at least lowered to 1 to match/);
  });

  test("more people every day than the ward has is warned about", () => {
    const [l] = check([{ type: "set_coverage", cover: { morning: { min: 6, max: null }, afternoon: { min: 6, max: null } } }]);
    expect(text(l)).toMatch(/13 people on duty every day, but the ward has 10 people/);
  });

  test("no change is blocked", () => {
    const [l] = check([{ type: "set_coverage", cover: { morning: { min: 2, max: 3 } } }]);
    expect(l.blocked).toBe("Staff on each shift are already set like this.");
  });
});

describe("set_weekly_shifts", () => {
  test("at most 2 nights per person a week", () => {
    const [l] = check([{ type: "set_weekly_shifts", shift: "night", min: null, max: 2 }]);
    expect(l.on).toBe(true);
    expect(l.words).toEqual({ what: "Nights per person, each week", when: "1–no limit → 1–2" });
    const d = save(makeData(), [l]);
    expect(mergeRules(d.rosterRules).weeklyMax.night).toBe(2);
    expect(mergeRules(d.rosterRules).weeklyMin.night).toBe(1);
  });

  test("numbers that clash with the saved ones are blocked", () => {
    const data = makeData();
    data.rosterRules = { weeklyMin: { night: 3 } };
    const [l] = check([{ type: "set_weekly_shifts", shift: "night", min: null, max: 2 }], data);
    expect(l.blocked).toMatch(/fewest nights a week \(3\) would be more than the most \(2\)/);
  });
});

test("the whole note: leave, offs, staff on each shift and nights per week save together", () => {
  const lines = check([
    { type: "set_offs_per_week", min: 2, max: 2 },
    { type: "set_coverage", cover: { morning: { min: 3, max: null }, afternoon: { min: 3, max: null }, night: { min: 3, max: 3 } } },
    { type: "set_weekly_shifts", shift: "night", min: null, max: 2 },
  ]);
  expect(lines.every((l) => l.on)).toBe(true);
  const r = mergeRules(save(makeData(), lines).rosterRules);
  expect([r.weeklyMin.off, r.weeklyMax.off, r.coverage.night.max, r.weeklyMax.night]).toEqual([2, 2, 3, 2]);
});
