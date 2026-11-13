/* Ini and one person's rules: Skip, the six rules of a person's own, and
   duties fixed by the manager. From what Claude might answer, through the
   server's checks (api/ai/parse.js), to the checklist lines and what they
   save. Claude itself is replaced by the answers written here; nothing
   reaches the live service. "Today" is Friday 13 November 2026. */

import { readReply, checkLines, applyLines } from "./index";
import { personChecks } from "../personRuleChecks";
import { mergeRules } from "../rosterConfig";

const parse = require("../../api/ai/parse.js")._test;

const TODAY = "2026-11-13";
const PARAGRAPH = "Ana gets all morning duty and is off on Friday and Saturday. Raheema is doing only morning and "
  + "afternoon duty, no night. Shau will get only 1 night duty a week. If Mariyam is having two nights in a week, "
  + "give them days apart. Rashee is going on leave on 28 December so the day before she leaves give a night duty.";
// The order here gives the refs Claude sees: s1 RN ANA, s2 RAHEEMA, … s9 ANA MOOSA.
const STAFF = [["ana", "RN ANA"], ["rah", "RAHEEMA"], ["sha", "SHAU"], ["mar", "MARIYAM"], ["ras", "RASHEE"],
  ["ali", "ALI"], ["haw", "HAWWA"], ["ais", "AISHATH"], ["ana2", "ANA MOOSA"]];
const makeData = (rosterRules = {}) => ({
  staff: STAFF.map(([id, name]) => ({ id, name, leavePeriods: [] })),
  codes: [], cells: {}, nonOfficial: [], dutyRequests: [], rosterRules,
});

// Claude's answer → the server's checks → the checklist, as the panel does it.
const linesFor = (claude, data = makeData(), text = PARAGRAPH) => {
  const { input } = parse.readInput({
    departmentId: "11111111-1111-1111-1111-111111111111", text, from: "2026-12-01", to: "2026-12-31",
    staff: data.staff.map((s) => ({ id: s.id, name: s.name })), shifts: ["morning", "afternoon", "night"],
    leaveTypes: ["annual", "maternity", "prematernity", "emergency", "other"],
  });
  const body = { ok: true, ...parse.checkAnswer(claude, input, TODAY) };
  const reply = readReply(body, { staffIds: data.staff.map((s) => s.id), from: "2026-12-01", to: "2026-12-31", today: TODAY });
  return { reply, check: (lines = reply.lines) => checkLines(lines, { data, today: TODAY }) };
};
// A line as the panel titles it.
const title = (l) => l.words.title
  || [l.words.what, Object.values(l.people).map((p) => p.name).join(" & "), l.words.when].filter(Boolean).join(" · ");
const answer = (lines, i, change) => lines.map((l, j) => (j === i ? { ...l, ...change } : l));
const save = (data, lines) => applyLines(data, lines, { uid: (() => { let n = 0; return () => `r${++n}`; })(), today: TODAY });
const rule = (staff, kind, extra = {}) => ({
  type: "person_rule", staff, rule: kind, shift: null, count: null, days: null, shifts: null, weekend: false, must: false, ...extra,
});

// What Claude is expected to answer for the paragraph, as the prompt asks.
const PARAGRAPH_ANSWER = {
  actions: [
    { type: "set_shifts", staff: "s1", shifts: ["morning"] },
    rule("s1", "offOn", { days: [5, 6] }),
    { type: "set_shifts", staff: "s2", shifts: ["morning", "afternoon"] },
    rule("s3", "atMost", { shift: "night", count: 1 }),
    rule("s4", "apart", { shift: "night" }),
    { type: "add_leave", staff: "s5", leaveType: null, start: "2026-12-28", end: null },
    { type: "fixed_duty", staff: "s5", date: "2026-12-27", duty: "night" },
  ],
  unclear: [],
};
// As on the rota tested: Mariyam already has a gap between nights of 4 days.
const MARIYAM_HAS = { id: "old", staffId: "mar", type: "apart", shift: "night", count: 4, strength: "soft" };

describe("the paragraph", () => {
  test("each sentence becomes its lines, and two of them ask", () => {
    const { reply, check } = linesFor(PARAGRAPH_ANSWER, makeData({ personRules: [MARIYAM_HAS] }));
    const lines = check();
    expect(lines.map((l) => [title(l), l.on, l.ask ? l.ask.question : null])).toEqual([
      ["Shifts · RN ANA · any shift → morning only", true, null],
      ["Rule · RN ANA · Always off on Friday and Saturday — starts as Must", true, null],
      ["Shifts · RAHEEMA · any shift → morning and afternoon only", true, null],
      ["Rule · SHAU · At most 1 night a week — starts as Try", true, null],
      ["Rule · MARIYAM · At least ? days between nights — starts as Try", false, "How many days between MARIYAM's nights?"],
      ["Leave · RASHEE · from Mon 28 Dec until ?", false, "What kind of leave is RASHEE on?"],
      ["Fixed duty · RASHEE · Night on Sun 27 Dec 2026, fixed by you — always kept", true, null],
    ]);
    expect(reply.unclear).toEqual([]);
  });

  test("answered: Mariyam's rule is changed in place, the leave has both dates, and nothing of the ward's moves", () => {
    const data = makeData({ personRules: [MARIYAM_HAS] });
    const { check } = linesFor(PARAGRAPH_ANSWER, data);
    let lines = check();
    lines = answer(lines, 4, { rule: { ...lines[4].rule, count: 3 }, checked: true });
    lines = answer(lines, 5, { leaveType: "annual", end: "2027-01-05", checked: true });
    lines = check(lines);
    expect(lines.every((l) => l.on)).toBe(true);
    expect(title(lines[4])).toBe("Change MARIYAM's gap between nights from 4 to 3 days");
    expect(title(lines[5])).toBe("Annual leave · RASHEE · 28 Dec 2026 – 5 Jan 2027");

    const saved = save(data, lines);
    expect(saved.rosterRules).toEqual({
      staffShifts: { ana: ["morning"], rah: ["morning", "afternoon"] },
      personRules: [
        { id: "old", staffId: "mar", type: "apart", shift: "night", count: 3, strength: "soft" },
        { id: "r1", staffId: "ana", type: "offOn", days: [5, 6], strength: "hard" },
        { id: "r2", staffId: "sha", type: "atMost", shift: "night", count: 1, strength: "soft" },
      ],
      fixedDuties: [{ id: "r4", staffId: "ras", date: "2026-12-27", duty: "night" }],
    });
    expect(saved.staff.find((s) => s.id === "ras").leavePeriods)
      .toEqual([{ id: "r3", type: "annual", start: "2026-12-28", end: "2027-01-05" }]);
    // The ward's own settings are exactly as they were.
    const before = mergeRules({}), after = mergeRules(saved.rosterRules);
    ["coverage", "weeklyMin", "weeklyMax", "weeklyDuties", "maxDaysOn", "blockDays", "seniorCover", "seniorStaff", "skipStaff"]
      .forEach((k) => expect(after[k]).toEqual(before[k]));
  });

  test("a line still asking is never saved, even if it was somehow ticked", () => {
    const { check } = linesFor(PARAGRAPH_ANSWER);
    const lines = check().map((l) => ({ ...l, checked: true }));
    const saved = save(makeData(), lines);
    expect(saved.rosterRules.personRules.map((r) => r.staffId)).toEqual(["ana", "sha"]);
    expect(saved.staff.find((s) => s.id === "ras").leavePeriods).toEqual([]);
  });
});

describe("a rule of the same kind already saved", () => {
  const one = (claude, personRules) => linesFor({ actions: [claude], unclear: [] }, makeData({ personRules })).check()[0];

  test("the same number is refused; a Must stays a Must when changed, and must: true makes it one", () => {
    expect(one(rule("s4", "apart", { shift: "night", count: 4 }), [MARIYAM_HAS]).blocked)
      .toBe('MARIYAM already has "at least 4 days between nights".');
    const must = { ...MARIYAM_HAS, strength: "hard" };
    const kept = one(rule("s4", "apart", { shift: "night", count: 2 }), [must]);
    expect([kept.on, title(kept)]).toEqual([true, "Change MARIYAM's gap between nights from 4 to 2 days"]);
    expect(save(makeData({ personRules: [must] }), [kept]).rosterRules.personRules).toEqual([{ ...must, count: 2 }]);
    const made = one(rule("s4", "apart", { shift: "night", count: 2, must: true }), [MARIYAM_HAS]);
    expect(save(makeData({ personRules: [MARIYAM_HAS] }), [made]).rosterRules.personRules)
      .toEqual([{ ...MARIYAM_HAS, count: 2, strength: "hard" }]);
  });

  test("at most and at least say what changes; the other checks still apply", () => {
    const most = { id: "m", staffId: "sha", type: "atMost", shift: "night", count: 2, strength: "soft" };
    expect(title(one(rule("s3", "atMost", { shift: "night", count: 1 }), [most]))).toBe("Change SHAU's most nights a week from 2 to 1");
    const least = { id: "l", staffId: "sha", type: "atLeast", shift: "night", count: 2, strength: "soft" };
    const below = one(rule("s3", "atMost", { shift: "night", count: 1 }), [{ ...most, count: 3 }, least]);
    expect(below.blocked).toBe('SHAU has "at least 2 nights a week", so at most 1 could never be met.');
  });
});

describe("a fixed duty on a date gone by", () => {
  test("asks which year, and saves the one chosen", () => {
    const { check } = linesFor({ actions: [{ type: "fixed_duty", staff: "s5", date: "2026-10-27", duty: "night" }], unclear: [] });
    let [l] = check();
    expect([l.ask.question, l.ask.options, l.on])
      .toEqual(["27 Oct 2026 has gone by. Which year did you mean?", ["2026-10-27", "2027-10-27"], false]);
    [l] = check([{ ...l, date: "2027-10-27", yearChosen: true, checked: true }]);
    expect([l.on, title(l)]).toEqual([true, "Fixed duty · RASHEE · Night on Wed 27 Oct 2027, fixed by you — always kept"]);
  });
});

describe("leave with no last day", () => {
  test("is asked for on the line; a last day before the first is not an answer", () => {
    const { check } = linesFor({ actions: [{ type: "add_leave", staff: "s6", leaveType: "annual", start: "2026-12-10", end: null }], unclear: [] });
    let [l] = check();
    expect([l.ask, l.on, l.waiting]).toEqual([{ kind: "leave", min: "2026-12-10", type: false, end: true,
      question: "Until when is ALI on leave?", endQuestion: "Until when is ALI on leave?" }, false, true]);
    [l] = check([{ ...l, end: "2026-12-09", checked: true }]);
    expect(l.waiting).toBe(true);
    [l] = check([{ ...l, end: "2026-12-12", checked: true }]);
    expect([l.on, title(l)]).toEqual([true, "Annual leave · ALI · 10–12 Dec"]);
  });

  test("the kind of leave is never assumed: not named, it is asked for too", () => {
    const { check } = linesFor({ actions: [{ type: "add_leave", staff: "s6", leaveType: "holiday", start: "2026-12-10", end: "2026-12-12" }], unclear: [] });
    let [l] = check();
    expect([l.leaveType, l.ask.type, l.ask.end, l.ask.question, l.on]).toEqual([null, true, false, "What kind of leave is ALI on?", false]);
    expect(title(l)).toBe("Leave · ALI · 10–12 Dec");
    [l] = check([{ ...l, leaveType: "emergency", checked: true }]);
    expect([l.on, title(l)]).toEqual([true, "Emergency leave · ALI · 10–12 Dec"]);
  });

  test("with no first day either, the server keeps it as a note, not a line", () => {
    const { reply } = linesFor({ actions: [{ type: "add_leave", staff: "s6", leaveType: "annual", start: null, end: null }], unclear: [] });
    expect(reply.lines).toEqual([]);
    expect(reply.unclear).toEqual(["Leave for ALI had dates that did not make sense, so it was left out."]);
  });
});

describe("the same refusals and warnings as the Your staff panel", () => {
  const panelSays = (data, staffId, r) => {
    const rules = mergeRules(data.rosterRules);
    const checks = personChecks({ rules, data, allStaff: data.staff, firstDay: 0 });
    const who = data.staff.find((s) => s.id === staffId);
    return r.date ? checks.fixedProblem(who, r) : checks.ruleProblem(who, r);
  };

  test("a rule that clashes with one already saved", () => {
    const data = makeData({ personRules: [{ id: "x", staffId: "ana", type: "offOn", days: [5], strength: "hard" }] });
    const [l] = linesFor({ actions: [rule("s1", "offOn", { days: [5, 6] })], unclear: [] }, data).check();
    expect(l.blocked).toBe(panelSays(data, "ana", { type: "offOn", days: [5, 6] }));
    expect(l.blocked).toBe('RN ANA already has "always off on Friday", which covers Friday. Remove it first to change it.');
  });

  test("an earlier line in the same note counts: morning only, then a night fixed", () => {
    const [, fixed] = linesFor({ actions: [
      { type: "set_shifts", staff: "s1", shifts: ["morning"] },
      { type: "fixed_duty", staff: "s1", date: "2026-12-02", duty: "night" },
    ], unclear: [] }).check();
    expect(fixed.blocked).toBe("RN ANA is set up for Morning only.");
  });

  test("a fixed duty on leave, and on a day with an approved request", () => {
    const data = makeData();
    data.staff[5].leavePeriods = [{ id: "lp", type: "annual", start: "2026-12-01", end: "2026-12-05" }];
    data.dutyRequests = [{ id: "q", staffId: "haw", date: "2026-12-03", category: "off", approved: true }];
    const [onLeave, asked] = linesFor({ actions: [
      { type: "fixed_duty", staff: "s6", date: "2026-12-02", duty: "morning" },
      { type: "fixed_duty", staff: "s7", date: "2026-12-03", duty: "night" },
    ], unclear: [] }, data).check();
    expect(onLeave.blocked).toBe(panelSays(data, "ali", { date: "2026-12-02", duty: "morning" }));
    expect(onLeave.blocked).toBe("ALI is on leave on Wed 2 Dec.");
    expect(asked.blocked).toMatch(/^HAWWA has an approved duty request on Thu 3 Dec \(Off\)/);
  });

  test("at most fewer than an at least already saved", () => {
    const data = makeData({ personRules: [{ id: "x", staffId: "sha", type: "atLeast", shift: "night", count: 2, strength: "soft" }] });
    const [l] = linesFor({ actions: [rule("s3", "atMost", { shift: "night", count: 1 })], unclear: [] }, data).check();
    expect(l.blocked).toBe('SHAU has "at least 2 nights a week", so at most 1 could never be met.');
  });

  test("more days off than the ward's most, said as the panel says it", () => {
    const [l] = linesFor({ actions: [rule("s1", "offOn", { days: [0, 5, 6] })], unclear: [] }, makeData({ weeklyMax: { off: 2 } })).check();
    expect(l.on).toBe(true);
    expect(l.warnings).toContain("That is 3 days off a week, more than the ward's most of 2, so for RN ANA the most off days is 3 and the fewest duties 4.");
  });

  test("a shift the ward does not run", () => {
    const [l] = linesFor({ actions: [rule("s3", "atMost", { shift: "evening", count: 1 })], unclear: [] },
      makeData({ coverage: { evening: { min: 0, max: 0 } } })).check();
    expect(l.blocked).toBe("The ward does not run evening shifts, so this rule cannot be added.");
  });
});

describe("asking instead of guessing", () => {
  test("a name that could be two people: only they are offered, and the line waits", () => {
    const { check } = linesFor({ actions: [{ ...rule(null, "atMost", { shift: "night", count: 1 }), choices: ["s1", "s9"], named: "Ana" }], unclear: [] });
    let [l] = check();
    expect(l.ask.question).toBe('Who is "Ana"?');
    expect(l.choices.map((c) => c.staffName)).toEqual(["RN ANA", "ANA MOOSA"]);
    expect([l.on, l.waiting, title(l)]).toEqual([false, true, "Rule · Ana · At most 1 night a week — starts as Try"]);
    [l] = check([{ ...l, staffId: "ana2", checked: true }]);
    expect([l.on, title(l)]).toEqual([true, "Rule · ANA MOOSA · At most 1 night a week — starts as Try"]);
  });

  test("a name that fits nobody, or one person only, is never offered as a choice", () => {
    const { reply } = linesFor({ actions: [
      { ...rule(null, "atMost", { shift: "night", count: 1 }), choices: ["s1"], named: "Ana" },
      { ...rule(null, "atMost", { shift: "night", count: 1 }), choices: [], named: "Zuha" },
    ], unclear: [] });
    expect(reply.lines).toEqual([]);
    expect(reply.unclear).toEqual(["2 changes named someone not on this rota's staff list, so they were left out."]);
  });

  test("the weekend: the ward's own days are asked for", () => {
    const { check } = linesFor({ actions: [rule("s7", "offOn", { weekend: true })], unclear: [] });
    let [l] = check();
    expect([l.ask.question, l.on, title(l)]).toEqual(["Which days are your weekend?", false, "Rule · HAWWA · Always off on ? — starts as Must"]);
    [l] = check([{ ...l, rule: { ...l.rule, days: [6, 5] }, checked: true }]);
    expect([l.on, title(l)]).toEqual([true, "Rule · HAWWA · Always off on Friday and Saturday — starts as Must"]);
  });

  test("a date not gone by is not asked about", () => {
    const [l] = linesFor({ actions: [{ type: "fixed_duty", staff: "s5", date: "2026-12-27", duty: "night" }], unclear: [] }).check();
    expect([l.ask, l.on]).toEqual([undefined, true]);
  });
});

describe("Skip, and Must from the note's own words", () => {
  test("skip saves where Skip does; skipping someone already skipped is refused", () => {
    const [l] = linesFor({ actions: [{ type: "set_skip", staff: "s6", skip: true }], unclear: [] }).check();
    expect([title(l), l.warnings]).toEqual(["Skip · ALI · on the rota → skipped", ["left out of Smart Roster; enter their duties by hand"]]);
    expect(save(makeData(), [l]).rosterRules).toEqual({ skipStaff: ["ali"] });
    const [again] = linesFor({ actions: [{ type: "set_skip", staff: "s6", skip: true }], unclear: [] }, makeData({ skipStaff: ["ali"] })).check();
    expect(again.blocked).toBe("ALI is already skipped.");
  });

  test("must: true makes a Try rule a Must; without it the panel's start is kept", () => {
    const { check } = linesFor({ actions: [
      rule("s3", "atLeast", { shift: "night", count: 1, must: true }),
      rule("s4", "offOn", { days: [1] }),
    ], unclear: [] });
    const [must, off] = check();
    expect(title(must)).toBe("Rule · SHAU · At least 1 night a week — starts as Must");
    expect(must.warnings.join(" ")).toMatch(/A Must here can leave another shift uncovered/);
    expect(title(off)).toBe("Rule · MARIYAM · Always off on Monday — starts as Must");
  });
});

describe("the server", () => {
  const { input } = parse.readInput({
    departmentId: "11111111-1111-1111-1111-111111111111", text: PARAGRAPH, from: "2026-12-01", to: "2026-12-31",
    staff: STAFF.map(([id, name]) => ({ id, name })), shifts: ["morning", "afternoon", "night"],
  });

  test("a rule that does not make sense is a note, not a line", () => {
    const out = parse.checkAnswer({ actions: [
      rule("s3", "atMost", { shift: "night", count: 9 }),
      rule("s3", "sometimes", { shift: "night", count: 1 }),
      rule("s3", "onlyOn", { days: [1], shifts: [] }),
    ], unclear: [] }, input, TODAY);
    expect(out.actions).toEqual([]);
    expect(out.unclear).toEqual(Array(3).fill("A rule for SHAU did not make sense, so it was left out."));
  });

  test("Not added only lists what is not saved: notes describing a line in the checklist are dropped", () => {
    const actions = [
      { type: "add_leave", staff: "s5", leaveType: null, start: "2026-12-28", end: null },
      rule("s4", "apart", { shift: "night" }),
    ];
    const out = parse.checkAnswer({ actions, unclear: [
      // As the real model wrote it, and others like it.
      "Rashee's leave type was not given in the note, so it is recorded as annual leave; the end date is left for the app to ask.",
      "Rashee is going on leave on 28 December, but the last day was not given.",
      "The number of days between Mariyam's nights was not given, so the app will ask you.",
      "I assumed Ana's mornings start this week.",
      // Real "not added" notes stay.
      "Shau at most 2 nights in a row can only be set for the whole ward, in Smart Roster.",
      "Hawwa's leave was not recorded because no first day was given. You can record it in the Staff tab.",
      "Zuha is not on this rota's staff list, so nothing was added for her.",
    ] }, input, TODAY);
    expect(out.unclear).toEqual([
      "Shau at most 2 nights in a row can only be set for the whole ward, in Smart Roster.",
      "Hawwa's leave was not recorded because no first day was given. You can record it in the Staff tab.",
      "Zuha is not on this rota's staff list, so nothing was added for her.",
    ]);
    // The server's own notes are not filtered.
    expect(parse.checkAnswer({ actions: [rule("s3", "atMost", { shift: "night", count: 9 })], unclear: [] }, input, TODAY).unclear)
      .toEqual(["A rule for SHAU did not make sense, so it was left out."]);
  });

  test("leave with no kind named reaches the app with none; the server never picks one", () => {
    const out = parse.checkAnswer({ actions: [{ type: "add_leave", staff: "s5", leaveType: null, start: "2026-12-28", end: null }], unclear: [] }, input, TODAY);
    expect(out.actions[0]).toMatchObject({ leaveType: null, start: "2026-12-28", end: null });
  });

  test("the prompt: one person never changes the ward, leave is never a rule, and staff are refs only", () => {
    const { system, user } = parse.buildPrompt(input, TODAY);
    expect(system).toMatch(/Never use set_offs_per_week,\s+set_senior_cover or set_max_in_a_row for one person/);
    expect(system).toMatch(/Leave is never a person_rule or a fixed_duty/);
    expect(system).toMatch(/recorded in the\s+Staff tab/);
    expect(system).toMatch(/"Shau gets only 1\s+night a week" gives atMost night 1/);
    expect(system).toMatch(/must is true only when the note says must or has to/);
    expect(system).toMatch(/"Ana gets all morning duty" -> \["morning"\]; "Ana only does mornings" -> \["morning"\]/);
    expect(system).toMatch(/Never assume annual leave/);
    expect(system).toMatch(/ONLY what is not done: never mention anything that is\s+in actions/);
    expect(user).toMatch(/s1: RN ANA/);
    STAFF.forEach(([id]) => expect(user).not.toMatch(new RegExp(`\\b${id}\\b`)));
    // What each request costs: the instructions stay under 12,500 characters (11,996 on 13 Nov 2026).
    expect(system.length).toBeLessThan(12500);
  });
});
