import { buildStatsModel } from "./statsModel";

/* A small made-up ward, 1–7 Dec 2026 (Tue–Mon). Friday 4 Dec is non-official. */
const codes = [
  { id: "M", code: "M", counts: "morning" }, { id: "N", code: "N", counts: "night" },
  { id: "OFF", code: "OFF", counts: "off" }, { id: "SL", code: "SL", counts: "sl" },
  { id: "LV", code: "CL", counts: "leave" },
];
const data = {
  fridayRule: true, nonOfficial: [], codes, postsEnabled: true,
  posts: [{ id: "p1", name: "Triage" }, { id: "p2", name: "Resus" }, { id: "p3", name: "Unused" }],
  staff: [
    { id: "a", name: "Aisha", leavePeriods: [{ id: "x", type: "annual", start: "2026-12-05", end: "2026-12-20" }] },
    { id: "b", name: "Bilal", leavePeriods: [] },
    { id: "c", name: "Castro", startDate: "2026-12-04", leavePeriods: [] },
  ],
  cells: {
    "2026-12-01": { a: [{ code: "M", post: "p1" }], b: "N", c: "M" },
    "2026-12-02": { a: "SL", b: [{ code: "M", post: "p2" }, { code: "N", post: "p1" }] },
    "2026-12-03": { a: "M", b: "SL" },
    "2026-12-04": { a: "N", b: "OFF", c: [{ code: "M", post: "p1" }] },
    // Aisha is on annual leave from the 5th: this cell must be ignored.
    "2026-12-06": { a: "M", b: "LV", c: "N" },
  },
};
// The figures recordsFor() would give for these three people.
const row = (staff, t) => ({
  staff, morning: 0, afternoon: 0, evening: 0, night: 0, other: 0, release: 0, off: 0,
  annualDays: 0, maternityDays: 0, sl: 0, frl: 0, ml: 0, otherLeave: 0, nonOfficialDuty: 0, ...t,
  dutyShifts: (t.morning || 0) + (t.night || 0),
});
const rows = [
  row(data.staff[0], { morning: 2, night: 1, sl: 1, annualDays: 3, nonOfficialDuty: 1 }),
  row(data.staff[1], { morning: 1, night: 2, sl: 1, off: 1, otherLeave: 1 }),
  row(data.staff[2], { morning: 1, night: 1, nonOfficialDuty: 1 }),
];
const m = buildStatsModel(data, rows, "2026-12-01", "2026-12-07");

test("non-official dates in range", () => {
  expect(m.nodDates).toEqual(["2026-12-04"]);
});

test("annual leave is clipped to the range", () => {
  expect(m.away).toEqual([expect.objectContaining({ name: "Aisha", when: "from 5 Dec" })]);
});

test("leave lists add up to the Staff Records totals", () => {
  const sl = m.leave.find((g) => g.key === "sl");
  expect(sl.days).toBe(rows.reduce((a, r) => a + r.sl, 0));
  expect(sl.people.map((p) => [p.name, p.days, p.when])).toEqual([["Aisha", 1, "2 Dec"], ["Bilal", 1, "3 Dec"]]);
  const al = m.leave.find((g) => g.key === "annual");
  expect(al.days).toBe(rows.reduce((a, r) => a + r.annualDays, 0));
  expect(m.leave.find((g) => g.key === "otherCodes").days).toBe(1);
});

test("most duties ranks by duty shifts, fewest explains why", () => {
  expect(m.fewest).toEqual({ name: "Castro", total: 2, why: "joined 4 Dec" });
  expect(m.ranked.map((x) => x.total)).toEqual([3, 3, 2]);
  expect(m.ranked[0].name).toBe("Aisha");
  expect(m.mix.total).toBe(8);
});

test("posts count duties per post, skip leave days and unused posts", () => {
  expect(m.posts.map((p) => [p.name, p.n])).toEqual([["Triage", 3], ["Resus", 1]]);
  expect(m.posts[0].people.map((p) => [p.name, p.n])).toEqual([["Aisha", 1], ["Bilal", 1], ["Castro", 1]]);
});

test("posts stay hidden when the department has them switched off", () => {
  expect(buildStatsModel({ ...data, postsEnabled: false }, rows, "2026-12-01", "2026-12-07").posts).toBeNull();
});

test("rota squares: leave period wins over the cell, not employed is blank", () => {
  const aisha = m.heat.people.find((p) => p.name === "Aisha");
  expect(aisha.cells[5].cat).toBe("leave"); // 6 Dec, inside annual leave
  const castro = m.heat.people.find((p) => p.name === "Castro");
  expect(castro.cells[0].cat).toBe("none"); // before start date
  expect(castro.cells[3].tip).toContain("M at Triage");
});

test("no squares for ranges over two months", () => {
  expect(buildStatsModel(data, rows, "2026-10-01", "2026-12-31").heat).toBeNull();
});

test("staff joined and left, with headcount at the start and end", () => {
  const withLeaver = { ...data, staff: [...data.staff, { id: "d", name: "Dana", endDate: "2026-12-03", leavePeriods: [] }] };
  const p = buildStatsModel(withLeaver, rows, "2026-12-01", "2026-12-07").people;
  expect(p.joined.map((x) => [x.name, x.when])).toEqual([["Castro", "4 Dec"]]);
  expect(p.left.map((x) => [x.name, x.when])).toEqual([["Dana", "3 Dec"]]);
  expect([p.atStart, p.atEnd]).toEqual([3, 3]);
});
