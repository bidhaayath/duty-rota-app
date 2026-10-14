/* Ini's catalogue: reading the server's answer, the checks on each line,
   and saving them all in one go. Pure functions; nothing here reaches the
   live service. */

import { actionsOf, readReply, checkLines, applyLines, savedWords } from "./index";

const makeData = () => ({
  staff: [
    { id: "a", name: "Ali", leavePeriods: [] },
    { id: "m", name: "Mariyam", leavePeriods: [{ id: "lp1", type: "annual", start: "2026-11-20", end: "2026-11-22" }] },
  ],
  codes: [{ id: "M", code: "M", counts: "morning" }],
  cells: {}, nonOfficial: [], dutyRequests: [],
});
const period = { staffIds: ["a", "m"], from: "2026-11-01", to: "2026-11-30" };
const lineOf = (lines, type) => lines.find((l) => l.type === type);

describe("reading the server's answer", () => {
  test("the older reply is turned into the same actions", () => {
    expect(actionsOf({
      leave: [{ staffId: "a", type: "annual", start: "2026-11-02", end: "2026-11-03" }],
      requests: [{ staffId: "m", date: "2026-11-05", category: "night" }],
      build: true, buildFrom: null, buildTo: null, historyFrom: null,
    })).toEqual([
      { type: "add_leave", staffId: "a", leaveType: "annual", start: "2026-11-02", end: "2026-11-03" },
      { type: "add_request", staffId: "m", date: "2026-11-05", duty: "night" },
      { type: "build", from: null, to: null, historyFrom: null },
    ]);
  });

  test("when both are sent, only the actions are used, so nothing is doubled", () => {
    const r = readReply({
      actions: [{ type: "add_request", staffId: "a", date: "2026-11-05", duty: "off" }],
      requests: [{ staffId: "a", date: "2026-11-05", category: "off" }],
      unclear: [],
    }, period);
    expect(r.lines).toHaveLength(1);
  });

  test("lines for unknown people, bad dates and unknown types are dropped; outside lines start unticked", () => {
    const r = readReply({
      actions: [
        { type: "add_leave", staffId: "zz", leaveType: "annual", start: "2026-11-02", end: "2026-11-03" },
        { type: "add_leave", staffId: "a", leaveType: "annual", start: "2026-11-05", end: "2026-11-02" },
        { type: "add_leave", staffId: "a", leaveType: "made-up", start: "2026-11-02", end: "2026-11-03" },
        { type: "add_request", staffId: "a", date: "2026-12-05", duty: "off" },
        { type: "delete_department" },
      ],
      unclear: ["Fathimath could be two people."],
    }, period);
    expect(r.lines).toHaveLength(2);
    expect(lineOf(r.lines, "add_leave")).toMatchObject({ leaveType: "other", checked: true, outside: false });
    expect(lineOf(r.lines, "add_request")).toMatchObject({ checked: false, outside: true });
    expect(r.unclear).toEqual(["Fathimath could be two people."]);
  });

  test("actions this panel cannot do yet are mentioned once under Not added", () => {
    const r = readReply({
      actions: [
        { type: "set_shifts", staffId: "a", shifts: ["night"] },
        { type: "set_shifts", staffId: "m", shifts: [] },
      ],
      unclear: [],
    }, period);
    expect(r.lines).toHaveLength(0);
    expect(r.unclear).toHaveLength(1);
    expect(r.unclear[0]).toMatch(/shift setting for a person/);
  });

  test("the build is read out separately, and its dates set what counts as outside", () => {
    const r = readReply({
      actions: [
        { type: "add_request", staffId: "a", date: "2026-12-05", duty: "off" },
        { type: "build", from: "2026-11-15", to: "2026-12-14", historyFrom: "2026-09-01" },
      ],
      unclear: [],
    }, period);
    expect(r.build).toEqual({ from: "2026-11-15", to: "2026-12-14", historyFrom: "2026-09-01" });
    expect(r.lines[0].checked).toBe(true);
    // A build without dates of its own is the planning period.
    expect(readReply({ actions: [{ type: "build", from: null, to: null, historyFrom: null }] }, period).build)
      .toEqual({ from: "2026-11-01", to: "2026-11-30", historyFrom: null });
  });
});

describe("the checks", () => {
  const read = (actions) => readReply({ actions, unclear: [] }, period).lines;

  test("a request on a date that already has one is blocked, and so is a second line for it", () => {
    const data = makeData();
    data.dutyRequests = [{ id: "r1", staffId: "a", date: "2026-11-05", category: "off", approved: true }];
    const lines = checkLines(read([
      { type: "add_request", staffId: "a", date: "2026-11-05", duty: "night" },
      { type: "add_request", staffId: "m", date: "2026-11-06", duty: "night" },
      { type: "add_request", staffId: "m", date: "2026-11-06", duty: "off" },
    ]), { data });
    expect(lines[0].blocked).toMatch(/already has a request/);
    expect(lines[1].on).toBe(true);
    expect(lines[2].blocked).toBe("A line above already asks for this person on this date.");
  });

  test("a request sees leave from the same note, even when the leave is listed after it", () => {
    const lines = read([
      { type: "add_request", staffId: "a", date: "2026-11-10", duty: "night" },
      { type: "add_leave", staffId: "a", leaveType: "annual", start: "2026-11-09", end: "2026-11-11" },
      { type: "add_request", staffId: "m", date: "2026-11-21", duty: "off" },
    ]);
    const checked = checkLines(lines, { data: makeData() });
    expect(checked[0].warnings.join(" ")).toMatch(/on leave you are adding in this note/);
    expect(checked[2].warnings.join(" ")).toMatch(/on recorded leave that day/);

    // Unticking the leave takes the warning away.
    const unticked = lines.map((l) => (l.type === "add_leave" ? { ...l, checked: false } : l));
    expect(checkLines(unticked, { data: makeData() })[0].warnings).toEqual([]);
  });

  test("view-only staff are blocked, and the checks use the person chosen on the line", () => {
    const lines = read([{ type: "add_leave", staffId: "a", leaveType: "annual", start: "2026-11-21", end: "2026-11-21" }]);
    const viewOnly = checkLines(lines, { data: makeData(), staffEditable: (id) => id !== "a" });
    expect(viewOnly[0].blocked).toMatch(/Ali is view-only/);
    const moved = checkLines([{ ...lines[0], staffId: "m" }], { data: makeData() });
    expect(moved[0].people.staffId.name).toBe("Mariyam");
    expect(moved[0].warnings[0]).toMatch(/overlaps annual leave already recorded/);
  });

  test("working out the warnings never changes the rota it was given", () => {
    const data = makeData();
    const before = JSON.stringify(data);
    checkLines(read([
      { type: "add_leave", staffId: "a", leaveType: "annual", start: "2026-11-02", end: "2026-11-03" },
      { type: "add_request", staffId: "m", date: "2026-11-05", duty: "off" },
    ]), { data });
    expect(JSON.stringify(data)).toBe(before);
  });
});

describe("saving", () => {
  const read = (actions) => readReply({ actions, unclear: [] }, period).lines;

  test("every ticked line is saved in one draft, in the shapes the app uses", () => {
    const lines = read([
      { type: "add_request", staffId: "m", date: "2026-11-05", duty: "night" },
      { type: "add_leave", staffId: "a", leaveType: "annual", start: "2026-11-02", end: "2026-11-03" },
    ]);
    let n = 0;
    const d = applyLines(makeData(), lines, { uid: () => `id${++n}`, today: "2026-10-14" });
    expect(d.staff[0].leavePeriods).toEqual([{ type: "annual", start: "2026-11-02", end: "2026-11-03", id: expect.any(String) }]);
    expect(d.dutyRequests).toEqual([{
      id: expect.any(String), staffId: "m", date: "2026-11-05", category: "night",
      approved: true, enteredBy: "assistant", enteredOn: "2026-10-14",
    }]);
  });

  test("unticked lines are left out, and a request that clashes by now is skipped", () => {
    const lines = read([
      { type: "add_request", staffId: "a", date: "2026-11-05", duty: "night" },
      { type: "add_request", staffId: "m", date: "2026-11-06", duty: "night" },
    ]);
    const data = makeData();
    data.dutyRequests = [{ id: "r1", staffId: "a", date: "2026-11-05", category: "off", approved: true }];
    const d = applyLines(data, [lines[0], { ...lines[1], checked: false }], { uid: () => "x", today: "2026-10-14" });
    expect(d.dutyRequests).toHaveLength(1);
    expect(d.dutyRequests[0].id).toBe("r1");
  });

  test("the message after saving counts each kind", () => {
    const lines = read([
      { type: "add_leave", staffId: "a", leaveType: "annual", start: "2026-11-02", end: "2026-11-03" },
      { type: "add_request", staffId: "m", date: "2026-11-05", duty: "night" },
      { type: "add_request", staffId: "m", date: "2026-11-06", duty: "night" },
    ]);
    expect(savedWords(lines)).toBe("1 leave period and 2 duty requests");
  });
});
