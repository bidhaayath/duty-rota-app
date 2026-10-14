/* Ini's changes to the rota: writing a code, clearing days, swapping two
   people's days and marking non-official days. Pure functions; nothing here
   reaches the live service. 1 November 2026 is a Sunday. */

import { readReply, checkLines, applyLines, savedWords } from "./index";

const makeData = () => ({
  staff: [
    { id: "a", name: "Ali", leavePeriods: [{ id: "lp1", type: "annual", start: "2026-11-04", end: "2026-11-05" }] },
    { id: "m", name: "Mariyam", leavePeriods: [] },
    { id: "h", name: "Hawwa", leavePeriods: [], endDate: "2026-11-03" },
  ],
  codes: [
    { id: "M", code: "M", label: "Morning duty", counts: "morning" },
    { id: "N", code: "N", label: "Night duty", counts: "night" },
    { id: "E", code: "E", label: "Evening duty", counts: "evening" },
    { id: "SL", code: "SL", label: "Sick leave", counts: "sl" },
  ],
  posts: [{ id: "p1", name: "Front Gate" }],
  cells: {
    "2026-11-02": { a: "M", m: "N" },
    "2026-11-03": { a: [{ code: "M", post: "p1" }, { code: "E", post: "" }], m: "SL" },
  },
  nonOfficial: ["2026-11-10"], fridayRule: true, dutyRequests: [],
});
const period = { staffIds: ["a", "m", "h"], from: "2026-11-01", to: "2026-11-30" };
const read = (actions) => readReply({ actions, unclear: [] }, period).lines;
const save = (data, lines) => applyLines(data, lines, { uid: () => "x", today: "2026-10-14" });
const text = (l) => l.warnings.join(" | ");

describe("set_code", () => {
  const line = [{ type: "set_code", staffId: "a", start: "2026-11-02", end: "2026-11-05", codeId: "N", code: "N" }];

  test("replaces like tapping a cell: the first post stays, a second duty goes, leave days are skipped", () => {
    const data = makeData();
    const before = JSON.stringify(data);
    const [l] = checkLines(read(line), { data });
    expect(l.on).toBe(true);
    expect(l.words.what).toBe("N (Night duty)");
    expect(text(l)).toMatch(/replaces what is already there on 2 days: M \(Mon 2 Nov\) and M at Front Gate \(Tue 3 Nov\)/);
    expect(text(l)).toMatch(/removes the second duty \(E\) on Tue 3 Nov/);
    expect(text(l)).toMatch(/skips Wed 4 Nov and Thu 5 Nov — Ali is on annual leave/);
    expect(l.words.details[3]).toBe("Thu 5 Nov: skipped — Ali is on annual leave");
    expect(JSON.stringify(data)).toBe(before);       // checking changes nothing

    const d = save(makeData(), [l]);
    expect(d.cells["2026-11-02"].a).toBe("N");
    expect(d.cells["2026-11-03"].a).toEqual([{ code: "N", post: "p1" }]);
    expect(d.cells["2026-11-04"]).toBeUndefined();
    expect(d.cells["2026-11-02"].m).toBe("N");        // nobody else touched
  });

  test("skips leave added in the same note, even when the leave line comes after it", () => {
    const lines = checkLines(read([
      { type: "set_code", staffId: "m", start: "2026-11-06", end: "2026-11-08", codeId: "N", code: "N" },
      { type: "add_leave", staffId: "m", leaveType: "annual", start: "2026-11-07", end: "2026-11-08" },
    ]), { data: makeData() });
    expect(text(lines[0])).toMatch(/skips Sat 7 Nov and Sun 8 Nov — Mariyam is on annual leave/);
    const d = save(makeData(), lines);
    expect(d.cells["2026-11-06"].m).toBe("N");
    expect(d.cells["2026-11-07"]).toBeUndefined();
    expect(d.staff[1].leavePeriods).toHaveLength(1);
  });

  test("warns about an approved request for something else, and blocks when nothing would change", () => {
    const data = makeData();
    data.dutyRequests = [{ id: "r", staffId: "m", date: "2026-11-02", category: "off", approved: true }];
    const [l] = checkLines(read([{ type: "set_code", staffId: "m", start: "2026-11-02", end: "2026-11-03", codeId: "M", code: "M" }]), { data });
    expect(text(l)).toMatch(/has an approved request for off day on Mon 2 Nov/);
    const [same] = checkLines(read([{ type: "set_code", staffId: "m", start: "2026-11-02", end: "2026-11-02", codeId: "N", code: "N" }]), { data });
    expect(same.blocked).toBe("Already N on every one of these days.");
  });

  test("a code that has been deleted is blocked", () => {
    const data = makeData();
    const [l] = checkLines(read([{ type: "set_code", staffId: "m", start: "2026-11-06", end: "2026-11-06", codeId: "GONE", code: "X" }]), { data });
    expect(l.blocked).toMatch(/X is no longer one of this department's codes/);
    expect(save(data, [l]).cells["2026-11-06"]).toBeUndefined();
  });
});

describe("clear_days", () => {
  test("empties the days, warns about leave codes and approved requests", () => {
    const data = makeData();
    data.dutyRequests = [{ id: "r", staffId: "m", date: "2026-11-02", category: "night", approved: true }];
    const [l] = checkLines(read([{ type: "clear_days", staffId: "m", start: "2026-11-01", end: "2026-11-05" }]), { data });
    expect(text(l)).toMatch(/removes SL \(sick leave\) on Tue 3 Nov/);
    expect(text(l)).toMatch(/has an approved request for night duty on Mon 2 Nov/);
    expect(l.words.details).toEqual(["Mon 2 Nov: N → empty", "Tue 3 Nov: SL → empty"]);
    const d = save(data, [l]);
    expect(d.cells["2026-11-02"]).toEqual({ a: "M" });
    expect(d.cells["2026-11-03"].m).toBeUndefined();
  });

  test("nothing to clear is blocked; a day under leave is left alone", () => {
    const data = makeData();
    data.cells["2026-11-04"] = { a: "M" };              // hidden under Ali's leave
    const [l] = checkLines(read([{ type: "clear_days", staffId: "a", start: "2026-11-04", end: "2026-11-06" }]), { data });
    expect(l.blocked).toBe("Nothing to clear: the only filled days are skipped.");
    expect(save(data, [l]).cells["2026-11-04"].a).toBe("M");
  });
});

describe("swap_duties", () => {
  test("swaps whole cells, posts and second duties included", () => {
    const [l] = checkLines(read([{ type: "swap_duties", staffA: "a", staffB: "m", start: "2026-11-02", end: "2026-11-03" }]), { data: makeData() });
    expect(l.on).toBe(true);
    expect(l.words.details[1]).toBe("Tue 3 Nov: Ali M at Front Gate + E ↔ Mariyam SL");
    const d = save(makeData(), [l]);
    expect(d.cells["2026-11-02"]).toEqual({ a: "N", m: "M" });
    expect(d.cells["2026-11-03"]).toEqual({ a: "SL", m: [{ code: "M", post: "p1" }, { code: "E", post: "" }] });
  });

  test("skips days either person is on leave or not employed, and blocks the same person twice", () => {
    const data = makeData();
    data.cells["2026-11-04"] = { m: "M", h: "N" };
    data.cells["2026-11-05"] = { m: "M" };
    const [l] = checkLines(read([{ type: "swap_duties", staffA: "a", staffB: "m", start: "2026-11-04", end: "2026-11-05" }]), { data });
    expect(l.blocked).toBe("Nothing to swap: every day that differs is skipped.");
    expect(text(l)).toMatch(/Ali is on annual leave/);
    const [h] = checkLines(read([{ type: "swap_duties", staffA: "h", staffB: "m", start: "2026-11-03", end: "2026-11-04" }]), { data });
    expect(text(h)).toMatch(/skips Wed 4 Nov — Hawwa is not employed here then/);
    expect(save(data, [h]).cells["2026-11-04"]).toEqual({ m: "M", h: "N" });
    const [same] = checkLines([{ ...l, staffB: "a" }], { data });
    expect(same.blocked).toBe("Choose two different people to swap.");
  });

  test("warns about approved requests on swapped days", () => {
    const data = makeData();
    data.dutyRequests = [{ id: "r", staffId: "a", date: "2026-11-02", category: "morning", approved: true }];
    const [l] = checkLines(read([{ type: "swap_duties", staffA: "a", staffB: "m", start: "2026-11-02", end: "2026-11-02" }]), { data });
    expect(text(l)).toMatch(/Ali has an approved request for morning duty on Mon 2 Nov/);
  });
});

describe("set_non_official", () => {
  test("marks days, leaving Fridays alone while the Friday rule is on", () => {
    const [l] = checkLines(read([{ type: "set_non_official", start: "2026-11-05", end: "2026-11-07", nonOfficial: true }]), { data: makeData() });
    expect(l.words.details).toEqual(["Thu 5 Nov", "Sat 7 Nov"]);
    expect(text(l)).toMatch(/non-official day payment/);
    expect(text(l)).toMatch(/Fri 6 Nov already counts/);
    expect(save(makeData(), [l]).nonOfficial).toEqual(["2026-11-05", "2026-11-07", "2026-11-10"]);
  });

  test("unmarks, and blocks when nothing would change", () => {
    const [off] = checkLines(read([{ type: "set_non_official", start: "2026-11-10", end: "2026-11-10", nonOfficial: false }]), { data: makeData() });
    expect(save(makeData(), [off]).nonOfficial).toEqual([]);
    const [again] = checkLines(read([{ type: "set_non_official", start: "2026-11-10", end: "2026-11-10", nonOfficial: true }]), { data: makeData() });
    expect(again.blocked).toBe("These days are already non-official.");
    const [friday] = checkLines(read([{ type: "set_non_official", start: "2026-11-06", end: "2026-11-06", nonOfficial: false }]), { data: makeData() });
    expect(friday.blocked).toBe("None of these days is marked non-official.");
    expect(text(friday)).toMatch(/Friday rule is on/);
  });
});

test("two lines on the same day know about each other, and everything is one save", () => {
  const lines = checkLines(read([
    { type: "set_code", staffId: "m", start: "2026-11-06", end: "2026-11-06", codeId: "M", code: "M" },
    { type: "set_code", staffId: "m", start: "2026-11-06", end: "2026-11-06", codeId: "N", code: "N" },
    { type: "add_leave", staffId: "a", leaveType: "annual", start: "2026-11-20", end: "2026-11-21" },
  ]), { data: makeData() });
  expect(text(lines[1])).toMatch(/a line above also changes Fri 6 Nov/);
  expect(save(makeData(), lines).cells["2026-11-06"].m).toBe("N");
  expect(savedWords(lines)).toBe("2 changes to the rota and 1 leave period");
});
