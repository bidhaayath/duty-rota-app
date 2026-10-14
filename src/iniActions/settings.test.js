/* Ini's standing settings (shifts a person may do, off days per week) and
   weekly days off. Pure functions; nothing here reaches the live service.
   1 November 2026 is a Sunday. The ward has never changed Smart Roster's
   coverage, so it runs morning, afternoon and night, not evening. */

import { readReply, checkLines, applyLines, savedWords } from "./index";
import { mergeRules } from "../rosterConfig";

const makeData = () => ({
  staff: [
    { id: "h", name: "Hawwa", leavePeriods: [{ id: "lp1", type: "annual", start: "2026-11-20", end: "2026-11-22" }] },
    { id: "a", name: "Ali", leavePeriods: [] },
  ],
  codes: [{ id: "M", code: "M", counts: "morning" }, { id: "OFF", code: "OFF", counts: "off" }],
  cells: { "2026-11-06": { h: "M" }, "2026-11-07": { h: "OFF" } },
  nonOfficial: [], dutyRequests: [],
  rosterRules: { staffShifts: { a: ["night"] } },
});
const period = { staffIds: ["h", "a"], from: "2026-11-01", to: "2026-11-30" };
const read = (actions) => readReply({ actions, unclear: [] }, period).lines;
const check = (actions, data = makeData()) => checkLines(read(actions), { data });
const save = (data, lines) => applyLines(data, lines, { uid: () => "x", today: "2026-10-14" });
const text = (l) => l.warnings.join(" | ");

describe("set_shifts", () => {
  test("shows the change, and saves where Smart Roster keeps it", () => {
    const [l] = check([{ type: "set_shifts", staffId: "h", shifts: ["night"] }]);
    expect(l.on).toBe(true);
    expect(l.words).toMatchObject({ what: "Shifts", when: "any shift → night only" });
    const d = save(makeData(), [l]);
    expect(d.rosterRules.staffShifts).toEqual({ a: ["night"], h: ["night"] });
    expect(mergeRules(d.rosterRules).staffShifts.h).toEqual(["night"]);
  });

  test("an empty list removes the restriction, as unticking every chip does", () => {
    const [l] = check([{ type: "set_shifts", staffId: "a", shifts: [] }]);
    expect(l.words.when).toBe("night only → any shift");
    expect(save(makeData(), [l]).rosterRules.staffShifts).toEqual({});
  });

  test("shifts the ward does not run are left out, and only those is blocked", () => {
    const [some] = check([{ type: "set_shifts", staffId: "h", shifts: ["evening", "night"] }]);
    expect(some.on).toBe(true);
    expect(text(some)).toMatch(/the ward does not run evening shifts, so that one is left out/);
    expect(save(makeData(), [some]).rosterRules.staffShifts.h).toEqual(["night"]);

    const [none] = check([{ type: "set_shifts", staffId: "h", shifts: ["evening"] }]);
    expect(none.blocked).toMatch(/Hawwa would be left with no shifts/);
    expect(none.words.when).toBe("any shift → evening only");
    expect(save(makeData(), [none]).rosterRules.staffShifts.h).toBeUndefined();
  });

  test("no change is blocked; a skipped person is warned about; the person can be corrected", () => {
    const [same] = check([{ type: "set_shifts", staffId: "a", shifts: ["night"] }]);
    expect(same.blocked).toBe("Ali is already set up for night only.");
    const data = makeData();
    data.rosterRules.skipStaff = ["h"];
    const [l] = check([{ type: "set_shifts", staffId: "h", shifts: ["morning"] }], data);
    expect(text(l)).toMatch(/skipped in Smart Roster/);
    // Moving the line to Ali, who is already night only.
    const [moved] = checkLines([{ ...l, staffId: "a" }], { data });
    expect(moved.words.when).toBe("night only → morning only");
  });
});

describe("set_offs_per_week", () => {
  test("shows current → new; a side left out keeps its value", () => {
    const [l] = check([{ type: "set_offs_per_week", min: 2, max: null }]);
    expect(l.words).toMatchObject({ what: "Off days per week", when: "1–2 → 2–2" });
    expect(l.on).toBe(true);
    const d = save(makeData(), [l]);
    expect(mergeRules(d.rosterRules).weeklyMin.off).toBe(2);
    expect(mergeRules(d.rosterRules).weeklyMax.off).toBe(2);
    // The other weekly limits are untouched.
    expect(mergeRules(d.rosterRules).weeklyMin.night).toBe(1);
    expect(d.rosterRules.staffShifts).toEqual({ a: ["night"] });
  });

  test("fewest more than most is blocked; no change is blocked", () => {
    const [bad] = check([{ type: "set_offs_per_week", min: 3, max: null }]);
    expect(bad.blocked).toMatch(/The fewest off days \(3\) would be more than the most \(2\)/);
    expect(mergeRules(save(makeData(), [bad]).rosterRules).weeklyMin.off).toBe(1);
    const [same] = check([{ type: "set_offs_per_week", min: 1, max: 2 }]);
    expect(same.blocked).toBe("Off days per week are already set like this.");
  });

  test("warns when off days and weekly duties cannot both fit in 7 days", () => {
    const [l] = check([{ type: "set_offs_per_week", min: 3, max: 3 }]);
    expect(text(l)).toMatch(/with at least 5 duties a week as well, that comes to more than 7 days/);
  });
});

describe("weekly_off", () => {
  const line = { type: "weekly_off", staffId: "h", weekdays: [5, 6], start: "2026-11-01", end: "2026-11-30" };

  test("one line; leave days and days with a request are skipped and counted", () => {
    const data = makeData();
    data.dutyRequests = [{ id: "r", staffId: "h", date: "2026-11-13", category: "night", approved: false }];
    const [l] = check([line], data);
    // Fridays and Saturdays: 6, 7, 13, 14, 20, 21, 27, 28. 13 has a request; 20, 21 are leave.
    expect(l.words.what).toBe("Off every Fri and Sat");
    expect(l.words.when).toBe("5 days, 1–30 Nov");
    expect(l.words.details).toHaveLength(8);
    expect(l.words.details[2]).toBe("Fri 13 Nov: skipped — already has a request");
    expect(l.words.details[4]).toBe("Fri 20 Nov: skipped — on annual leave");
    expect(text(l)).toMatch(/skips 1 day that already has a request \(Fri 13 Nov\)/);
    expect(text(l)).toMatch(/skips 2 days — Hawwa is on annual leave \(Fri 20 Nov and Sat 21 Nov\)/);
    // The 6th has a duty (M); the 7th already holds an off code, so it is fine.
    expect(text(l)).toMatch(/1 of these days already has a duty on the rota.*\(Fri 6 Nov\)/);

    const d = save(data, [l]);
    const mine = d.dutyRequests.filter((r) => r.enteredBy === "assistant");
    expect(mine.map((r) => r.date)).toEqual(["2026-11-06", "2026-11-07", "2026-11-14", "2026-11-27", "2026-11-28"]);
    expect(mine[0]).toEqual({ id: "x", staffId: "h", date: "2026-11-06", category: "off", approved: true, enteredBy: "assistant", enteredOn: "2026-10-14" });
  });

  test("a single request in the same note wins its day; every day skipped is blocked", () => {
    const lines = check([
      line,
      { type: "add_request", staffId: "h", date: "2026-11-14", duty: "night" },
    ]);
    expect(text(lines[0])).toMatch(/skips 1 day that already has a request \(Sat 14 Nov\)/);
    const [none] = check([{ ...line, start: "2026-11-20", end: "2026-11-22" }]);
    expect(none.blocked).toBe("Nothing to add: every matching day is skipped.");
  });

  test("the saved message counts each kind", () => {
    const lines = check([
      line,
      { type: "set_shifts", staffId: "h", shifts: ["night"] },
      { type: "set_offs_per_week", min: 2, max: null },
    ]);
    expect(savedWords(lines.filter((l) => l.on))).toBe("1 set of weekly days off and 2 standing settings");
  });
});
