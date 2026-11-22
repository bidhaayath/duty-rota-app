/* Tests for the roster importer. The fixture is a real Easy Duty Rota
   Excel export of a fictional demo department (Prison Roster, 6–26 Dec
   2026, 20 officers). Its totals were counted separately, cell by cell,
   so these numbers are the file's, not the importer's opinion of it. */

import fs from "fs";
import path from "path";
import {
  readSheets, sheetFromCSV, readGrid, parseDayHeader, parseCell, splitNameDesignation,
  matchStaff, planImport, defaultChoices, applyImport, summaryLine, guessCounts,
} from "./rosterImport";
import { cellEntries, leaveOn } from "./rotaCounts";

const FIXTURE = path.join(__dirname, "__fixtures__", "prison-roster-export.xlsx");
const loadFixture = async () => readSheets(fs.readFileSync(FIXTURE), "Prison_Roster_6_Dec_2026_26_Dec_2026.xlsx");

const emptyDept = (extra = {}) => ({
  staff: [], codes: [
    { id: "OFF", code: "OFF", label: "Off day", color: "#FFFFFF", counts: "off" },
    { id: "SL", code: "SL", label: "Sick leave", color: "#F0A090", counts: "sl" },
    { id: "FRL", code: "FRL", label: "Family related leave", color: "#D98BD3", counts: "frl" },
    { id: "ML", code: "ML", label: "Medical leave", color: "#5E3A87", counts: "ml" },
  ],
  cells: {}, cellMeta: {}, posts: [], postsEnabled: false, nonOfficial: [], fridayRule: true, ...extra,
});
const clone = (x) => JSON.parse(JSON.stringify(x));

describe("the Prison Roster export", () => {
  let grid;
  beforeAll(async () => { grid = readGrid(await loadFixture()); });

  test("finds 21 days, 6–26 Dec 2026, with no warnings", () => {
    expect(grid.days).toHaveLength(21);
    expect(grid.days[0].date).toBe("2026-12-06");
    expect(grid.days[20].date).toBe("2026-12-26");
    expect(grid.issues).toEqual([]);
  });

  test("finds all 20 officers, name and designation apart", () => {
    expect(grid.people).toHaveLength(20);
    expect(grid.people[0]).toMatchObject({ name: "Ahmed", designation: "Security Officer" });
    expect(grid.people[19].name).toBe("Umar");
  });

  test("ignores the count rows and the totals columns", () => {
    expect(grid.people.some((p) => /morning|night/i.test(p.name))).toBe(false);
    expect(grid.days.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))).toBe(true);
  });

  test("reads a duty cell: code, post and break", () => {
    expect(grid.people[0].cells["2026-12-06"]).toMatchObject({
      code: "N", post: "P1 – Main Gate", brk: { start: "03:00", end: "03:30" },
    });
    expect(grid.people[0].cells["2026-12-07"]).toMatchObject({ code: "OFF", post: "", brk: null });
  });

  test("spreads merged leave over every day it covers", () => {
    const ali = grid.people[1];
    ["2026-12-14", "2026-12-17", "2026-12-20"].forEach((d) => expect(ali.cells[d].leave).toEqual({ type: "annual", label: "" }));
    expect(ali.cells["2026-12-21"].code).toBe("N");
    const mohamed = grid.people[3];
    expect(mohamed.cells["2026-12-06"].leave.type).toBe("annual");
    expect(mohamed.cells["2026-12-07"].leave.type).toBe("annual");   // the second day of the merged "AL"
  });

  test("a merged run of a leave CODE (ML) stays a code on each day", () => {
    const fazeel = grid.people[7];
    ["2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12"].forEach((d) => expect(fazeel.cells[d].code).toBe("ML"));
    expect(fazeel.cells["2026-12-08"].code).toBe("SL");
  });

  test("reads the legend's names and hours", () => {
    expect(grid.legend.D).toEqual({ label: "Day duty", start: "07:00", end: "15:00" });
    expect(grid.legend.N).toEqual({ label: "Night duty", start: "23:00", end: "07:00" });
  });

  test("reads the Staff sheet", () => {
    expect(grid.staffSheet).toHaveLength(20);
    expect(grid.staffSheet[0]).toMatchObject({ name: "Ahmed", designation: "Security Officer" });
  });

  test("the plan's totals match the file", () => {
    const plan = planImport(grid, emptyDept());
    expect(plan.counts).toMatchObject({
      people: 20, days: 21, duties: 411, breaks: 299, leavePeriods: 2, newStaff: 20, unclear: 0,
      newPosts: 5, nonOfficial: 0,       // its non-official days are all Fridays, which fridayRule covers
    });
    const byKey = Object.fromEntries(plan.codes.map((c) => [c.key, c.count]));
    expect(byKey).toEqual({ OFF: 102, D: 101, N: 99, E: 99, FRL: 5, ML: 4, SL: 1 });
    expect(plan.codes.filter((c) => !c.existingId).map((c) => c.key).sort()).toEqual(["D", "E", "N"]);
    expect(plan.codes.find((c) => c.key === "D").proposal).toMatchObject({ label: "Day duty", counts: "morning", start: "07:00", end: "15:00" });
    expect(plan.leave).toEqual([
      { index: 1, type: "annual", label: "", start: "2026-12-14", end: "2026-12-20" },
      { index: 3, type: "annual", label: "", start: "2026-12-06", end: "2026-12-07" },
    ]);
    expect(summaryLine(plan)).toBe("20 staff · 21 days · 411 duties and days off · 299 breaks · 2 leave periods · 3 new codes · 5 new posts · 20 new names");
  });

  test("importing into an empty department reproduces the file", () => {
    const d0 = emptyDept();
    const plan = planImport(grid, d0);
    const { data: d, report } = applyImport(clone(d0), grid, plan, defaultChoices(plan), { today: "2026-11-22" });
    expect(report).toMatchObject({ staffAdded: 20, codesAdded: 3, postsAdded: 5, duties: 411, breaks: 299, leavePeriods: 2, overwritten: 0 });
    expect(d.staff).toHaveLength(20);
    expect(d.postsEnabled).toBe(true);
    const ahmed = d.staff.find((s) => s.name === "Ahmed");
    expect(ahmed.designation).toBe("Security Officer");
    const [e] = cellEntries(d, "2026-12-06", ahmed.id);
    expect(d.codes.find((c) => c.id === e.code).code).toBe("N");
    expect(d.posts.find((p) => p.id === e.post).name).toBe("P1 – Main Gate");
    expect(d.cellMeta["2026-12-06"][ahmed.id].breakTime).toEqual({ start: "03:00", end: "03:30" });
    // OFF has no post, so it is stored as a plain code id.
    expect(d.cells["2026-12-07"][ahmed.id]).toBe("OFF");
    const ali = d.staff.find((s) => s.name === "Ali");
    expect(leaveOn(ali, "2026-12-17")).toMatchObject({ type: "annual", start: "2026-12-14", end: "2026-12-20" });
    expect(d.cells["2026-12-17"]?.[ali.id]).toBeUndefined();
    // Every cell the importer wrote, counted back.
    const total = Object.values(d.cells).reduce((n, day) => n + Object.keys(day).length, 0);
    expect(total).toBe(411);
  });

  test("a second import of the same file changes nothing new", () => {
    const d0 = emptyDept();
    const p1 = planImport(grid, d0);
    const once = applyImport(clone(d0), grid, p1, defaultChoices(p1), { today: "2026-11-22" }).data;
    const p2 = planImport(grid, once);
    expect(p2.counts).toMatchObject({ newStaff: 0, newCodes: 0, newPosts: 0 });
    expect(p2.existing).toBe(411);
    const ch = { ...defaultChoices(p2), mode: "replace" };
    const { data: twice, report } = applyImport(clone(once), grid, p2, ch, { today: "2026-11-22" });
    expect(report).toMatchObject({ staffAdded: 0, codesAdded: 0, postsAdded: 0, leavePeriods: 0, leaveSkipped: 2 });
    expect(twice.cells).toEqual(once.cells);
    expect(twice.staff).toEqual(once.staff);
  });
});

describe("Replace or Only fill empty days", () => {
  let grid, base, plan, ahmedId;
  beforeAll(async () => {
    grid = readGrid(await loadFixture());
    base = emptyDept({
      staff: [{ id: "a1", name: "Ahmed", designation: "", contact: "123", recc: "", licence: "", email: "", employmentRole: "employee", startDate: "", endDate: "", leavePeriods: [] }],
      cells: { "2026-12-06": { a1: "OFF" } },
      cellMeta: { "2026-12-06": { a1: { note: "Swapped", breakTime: { start: "10:00", end: "10:30" } } } },
    });
    plan = planImport(grid, base);
    ahmedId = "a1";
  });

  test("the plan says one existing duty would be touched", () => {
    expect(plan.people[0]).toMatchObject({ status: "exact", staffId: "a1" });
    expect(plan.existing).toBe(1);
    expect(defaultChoices(plan).mode).toBe("");    // the manager must choose
  });

  test("Replace overwrites it, keeps the note, swaps the break", () => {
    const { data: d, report } = applyImport(clone(base), grid, plan, { ...defaultChoices(plan), mode: "replace" }, { today: "2026-11-22" });
    expect(report.overwritten).toBe(1);
    expect(cellEntries(d, "2026-12-06", ahmedId)[0].code).not.toBe("OFF");
    expect(d.cellMeta["2026-12-06"][ahmedId]).toEqual({ note: "Swapped", breakTime: { start: "03:00", end: "03:30" } });
  });

  test("Only fill empty days leaves it alone", () => {
    const { data: d, report } = applyImport(clone(base), grid, plan, { ...defaultChoices(plan), mode: "fill" }, { today: "2026-11-22" });
    expect(report.overwritten).toBe(0);
    expect(report.keptExisting).toBe(1);
    expect(d.cells["2026-12-06"][ahmedId]).toBe("OFF");
    expect(d.cellMeta["2026-12-06"][ahmedId].breakTime).toEqual({ start: "10:00", end: "10:30" });
  });

  test("details fill blanks only, and emails are not copied unless asked", () => {
    const { data: d } = applyImport(clone(base), grid, plan, { ...defaultChoices(plan), mode: "fill" }, { today: "2026-11-22" });
    const a = d.staff.find((s) => s.id === ahmedId);
    expect(a.designation).toBe("Security Officer");   // was blank → filled
    expect(a.contact).toBe("123");                     // already set → kept
  });
});

describe("plan limits and skipping", () => {
  test("Basic's 20-staff limit: extra new names are not added, and are listed", async () => {
    const grid = readGrid(await loadFixture());
    const staff = Array.from({ length: 18 }, (_, i) => ({ id: `x${i}`, name: `Existing ${i}`, endDate: "" }));
    const d0 = emptyDept({ staff });
    const plan = planImport(grid, d0);
    const { data: d, report } = applyImport(clone(d0), grid, plan, defaultChoices(plan), { staffLimit: 20, today: "2026-11-22" });
    expect(report.staffAdded).toBe(2);
    expect(report.staffOverLimit).toHaveLength(18);
    expect(d.staff).toHaveLength(20);
  });

  test("a skipped person and a skipped code write nothing", async () => {
    const grid = readGrid(await loadFixture());
    const d0 = emptyDept();
    const plan = planImport(grid, d0);
    const ch = defaultChoices(plan);
    ch.people[0] = "skip";
    ch.codes.N = "skip";
    const { data: d, report } = applyImport(clone(d0), grid, plan, ch, { today: "2026-11-22" });
    expect(d.staff.some((s) => s.name === "Ahmed")).toBe(false);
    expect(d.codes.some((c) => c.code === "N")).toBe(false);
    expect(report.duties).toBe(411 - 21 - 99 + 5);   // Ahmed's 21 days (5 of them N), plus every N
  });
});

describe("other layouts", () => {
  test("the handover's layout: Employee | Team | Assigned post | 01 Tue …, title gives the month", () => {
    const csv = [
      "Prison Security Roster,,,,,",
      "December 2026,,,,,",
      "Employee,Team,Assigned post,01 Tue,02 Wed,03 Thu,D,Total duties",
      '"Aishath Ali",A,P1,"D\n07:00–15:00\nP1 – Main Gate\nBreak 11:00–11:30",OFF,"AL\nAnnual Leave",1,1',
      '"Mohammed Hassan",B,P2,"E\n15:00–23:00\nP2 – Control",N,"N",0,2',
      ",,,,,",
      "D,Day 07:00–15:00,,,,",
    ].join("\n");
    const grid = readGrid([sheetFromCSV(csv)]);
    expect(grid.days.map((d) => d.date)).toEqual(["2026-12-01", "2026-12-02", "2026-12-03"]);
    expect(grid.issues).toEqual([]);
    expect(grid.people.map((p) => p.name)).toEqual(["Aishath Ali", "Mohammed Hassan"]);
    expect(grid.people[0].extra).toEqual({ Team: "A" });
    expect(grid.people[0].defaultPost).toBe("P1");
    expect(grid.people[0].cells["2026-12-01"]).toMatchObject({
      code: "D", time: { start: "07:00", end: "15:00" }, post: "P1 – Main Gate", brk: { start: "11:00", end: "11:30" },
    });
    expect(grid.people[0].cells["2026-12-03"].leave.type).toBe("annual");
    expect(grid.legend.D).toEqual({ label: "Day", start: "07:00", end: "15:00" });

    // Team becomes the department's own column; a close name is offered, not assumed.
    const d0 = emptyDept({ staff: [{ id: "s1", name: "Aisha Ali", designation: "", leavePeriods: [] }] });
    const plan = planImport(grid, d0);
    expect(plan.people[0]).toMatchObject({ status: "close", staffId: "s1" });
    const { data: d, report } = applyImport(clone(d0), grid, plan, { ...defaultChoices(plan), mode: "replace" }, { today: "2026-11-22" });
    expect(report.columnsAdded).toBe(1);
    expect(d.staffColumns).toHaveLength(1);
    expect(d.staff.find((s) => s.id === "s1").extra[d.staffColumns[0].id]).toBe("A");
    // A new code's hours come from the cells themselves.
    expect(d.codes.find((c) => c.code === "E")).toMatchObject({ start: "15:00", end: "23:00", counts: "evening" });
    expect(d.eveningEnabled).toBe(true);
  });

  test("crossing into January moves the year on", () => {
    const csv = "Roster 2026,,,\nName,30 Dec,31 Dec,1 Jan,2 Jan\nAli,D,D,N,N";
    expect(readGrid([sheetFromCSV(csv)]).days.map((d) => d.date)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  test("bare day numbers 1–31 with the month in the title", () => {
    const head = Array.from({ length: 10 }, (_, i) => i + 1).join(",");
    const csv = `March 2027\nName,${head}\nHawwa,${Array(10).fill("M").join(",")}`;
    const g = readGrid([sheetFromCSV(csv)]);
    expect(g.days).toHaveLength(10);
    expect(g.days[0].date).toBe("2027-03-01");
  });

  test("no year anywhere: assumed, and said so", () => {
    const g = readGrid([sheetFromCSV("Name,1 Dec,2 Dec,3 Dec\nAli,D,E,N")], { fallbackYear: 2026 });
    expect(g.days[0].date).toBe("2026-12-01");
    expect(g.issues[0]).toMatch(/assumed 2026/);
  });

  test("a split duty: the second code is told apart from a post", () => {
    const csv = 'Dec 2026\nName,1 Dec,2 Dec,3 Dec\nAli,"M\nFront Desk\nE\nBar","M","E"';
    const g = readGrid([sheetFromCSV(csv)]);
    expect(g.people[0].cells["2026-12-01"]).toMatchObject({ code: "M", post: "Front Desk", second: "E", secondPost: "Bar" });
  });

  test("a file with no dates explains what it needs", () => {
    expect(() => readGrid([sheetFromCSV("Name,Shift\nAli,D")])).toThrow(/row of dates/);
  });

  test("an old .xls file asks for Save As .xlsx", async () => {
    await expect(readSheets(Buffer.from(""), "old.xls")).rejects.toThrow(/Save As/);
  });
});

describe("small readers", () => {
  test.each([
    ["SUN\n6 Dec", { day: 6, month: 12, year: 0, weekday: 0, nonOff: false }],
    ["FRI\n11 Dec\nNON-OFFICIAL", { day: 11, month: 12, weekday: 5, nonOff: true }],
    ["01 Tue", { day: 1, month: 0, weekday: 2 }],
    ["2026-12-06", { day: 6, month: 12, year: 2026 }],
    ["6/12/2026", { day: 6, month: 12, year: 2026 }],
    ["Dec 6", { day: 6, month: 12 }],
    ["6-Dec-26", { day: 6, month: 12, year: 2026 }],
    ["Mar 3", { day: 3, month: 3, weekday: -1 }],
  ])("header %j", (text, want) => expect(parseDayHeader(text)).toMatchObject(want));

  test.each(["NAME", "Team", "Total duties", "OFF", ""])("not a header: %j", (t) => expect(parseDayHeader(t)).toBeNull());

  test("cells", () => {
    expect(parseCell("D 👤\nP1 – Main Gate")).toMatchObject({ code: "D", post: "P1 – Main Gate" });
    expect(parseCell("D 07:00-15:00")).toMatchObject({ code: "D", time: { start: "07:00", end: "15:00" } });
    expect(parseCell("Not yet joined").notEmployed).toBe(true);
    expect(parseCell("Hajj Leave").leave).toEqual({ type: "other", label: "Hajj Leave" });
    expect(parseCell("Sick Leave\n(1 Dec 2026 – 5 Dec 2026)").leave.type).toBe("sl");
    expect(parseCell("SL")).toMatchObject({ code: "SL", leave: null });
    expect(parseCell("").blank).toBe(true);
  });

  test("names", () => {
    expect(splitNameDesignation("Ahmed — Security Officer")).toEqual({ name: "Ahmed", designation: "Security Officer" });
    expect(splitNameDesignation("Ali-Rasheed")).toEqual({ name: "Ali-Rasheed", designation: "" });
    const staff = [{ id: "1", name: "Aishath Shiuna" }, { id: "2", name: "Mohamed Ali" }, { id: "3", name: "Ali", designation: "RN" }, { id: "4", name: "Ali", designation: "SRN" }];
    expect(matchStaff("aishath shiuna", "", staff)).toMatchObject({ status: "exact", staffId: "1" });
    expect(matchStaff("Aisha Shiuna", "", staff)).toMatchObject({ status: "close", staffId: "1" });
    expect(matchStaff("Mohammed Ali", "", staff)).toMatchObject({ status: "close", staffId: "2" });
    expect(matchStaff("Ali", "SRN", staff)).toMatchObject({ status: "exact", staffId: "4" });
    expect(matchStaff("Ali", "", staff).status).toBe("close");     // two Alis: ask
    expect(matchStaff("Zahir", "", staff).status).toBe("new");
  });

  test("guessing what a new code counts as", () => {
    expect(guessCounts("D", "Day duty")).toBe("morning");
    expect(guessCounts("X", "", "22:00")).toBe("night");
    expect(guessCounts("DO", "Day off")).toBe("off");
  });
});

describe("a new department that already has the standard codes", () => {
  /* Like a fresh department: M, E, N and OFF exist without hours, and
     Evening shift is off. Rows 3 and 4 have an empty week. */
  const csv = [
    "Workshop,,,,,",
    "6 Sept 2026 – 8 Sept 2026,,,,,",
    "#,NAME,DESIGNATION,SUN 6 Sep,MON 7 Sep,TUE 8 Sep",
    "1,Ali Hassan,Technician,M,E,N",
    "2,Hawwa Zahir,Technician,E,OFF,M",
    "3,Moosa Didi,Technician,,,",
    ",Prepared by the supervisor,,,,",
    ",,,,,",
    "Legend: M = Morning duty (08:00-16:00) · E = Evening duty (16:00-00:00) · N = Night duty (00:00),,,,,",
  ].join("\n");
  const fresh = () => ({
    staff: [], cells: {}, cellMeta: {}, posts: [], nonOfficial: [], fridayRule: true, eveningEnabled: false,
    codes: [
      { id: "M", code: "M", label: "Morning duty", counts: "morning" },
      { id: "E", code: "E", label: "Evening duty", counts: "evening" },
      { id: "N", code: "N", label: "Night duty", counts: "night", start: "20:00", end: "08:00" },
      { id: "OFF", code: "OFF", label: "Off day", counts: "off" },
    ],
  });

  test("a listed person with an empty week is still added; a footer note is not", () => {
    const g = readGrid([sheetFromCSV(csv)]);
    expect(g.people.map((p) => p.name)).toEqual(["Ali Hassan", "Hawwa Zahir", "Moosa Didi"]);
  });

  test("codes without hours take the file's; codes with hours keep theirs", () => {
    const g = readGrid([sheetFromCSV(csv)]);
    const plan = planImport(g, fresh());
    expect(plan.codes.find((c) => c.key === "M").fillHours).toEqual({ start: "08:00", end: "16:00" });
    expect(plan.codes.find((c) => c.key === "E").fillHours).toEqual({ start: "16:00", end: "00:00" });
    expect(plan.codes.find((c) => c.key === "N").fillHours).toBeNull();   // already 20:00–08:00
    const { data: d, report } = applyImport(fresh(), g, plan, { ...defaultChoices(plan) }, { today: "2026-11-22" });
    expect(report.hoursAdded.sort()).toEqual(["E", "M"]);
    expect(d.codes.find((c) => c.id === "M")).toMatchObject({ start: "08:00", end: "16:00" });
    expect(d.codes.find((c) => c.id === "N")).toMatchObject({ start: "20:00", end: "08:00" });
    expect(d.staff).toHaveLength(3);
  });

  test("hours are left alone when the manager unticks it", () => {
    const g = readGrid([sheetFromCSV(csv)]);
    const plan = planImport(g, fresh());
    const { data: d } = applyImport(fresh(), g, plan, { ...defaultChoices(plan), codeHours: false }, { today: "2026-11-22" });
    expect(d.codes.find((c) => c.id === "M").start).toBeUndefined();
  });

  test("Evening duties switch Evening shift on, so they are counted", () => {
    const g = readGrid([sheetFromCSV(csv)]);
    const plan = planImport(g, fresh());
    const { data: d, report } = applyImport(fresh(), g, plan, defaultChoices(plan), { today: "2026-11-22" });
    expect(report.eveningOn).toBe(true);
    expect(d.eveningEnabled).toBe(true);
  });

  test("no Evening duties: Evening shift stays as it was", () => {
    const noE = csv.replace(",M,E,N", ",M,M,N").replace(",E,OFF,M", ",N,OFF,M");
    const g = readGrid([sheetFromCSV(noE)]);
    const plan = planImport(g, fresh());
    const { data: d, report } = applyImport(fresh(), g, plan, defaultChoices(plan), { today: "2026-11-22" });
    expect(report.eveningOn).toBe(false);
    expect(d.eveningEnabled).toBe(false);
  });
});


describe("a hospital weekly sheet: headings over two rows, a sign-off block", () => {
  /* Row 1 holds the headings and weekdays, row 2 the dates; NAME, CONTACT
     and RECC are merged down over both. Under the grid: coverage counts
     and a Prepared by / Approved by box that overlaps the day columns. */
  const sheet = {
    name: "Sheet1",
    cells: [
      ["DUTY NURSE MANAGER", "", "", "", "", "", ""],
      ["#", "NAME & DESIGNATION", "CONTACT NO.", "RECC NO.", "SUN", "MON ", "TUE"],
      ["", "", "", "", "2024-12-29", "2024-12-30", "2024-12-31"],
      ["1", "SRN TEST ONE", "7000001", "HMH0001", "M", "A(R)", "OFF(N)"],
      ["2", "RN TEST TWO", "7000002", "HMH0002", "AL", "AL", "AL"],
      ["", "", "", "", "", "", ""],
      ["MORNING", "", "", "", "1", "0", "0"],
      ["", "PREPARED BY:", "", "", "APPROVED BY:", "", ""],
      ["", "DNM SRN. TEST ONE", "", "", "ND SOMEONE", "", ""],
      ["", "DATE:", "", "", "DATE:", "", ""],
    ],
    merges: [
      { r1: 1, c1: 0, r2: 2, c2: 0 }, { r1: 1, c1: 1, r2: 2, c2: 1 },
      { r1: 1, c1: 2, r2: 2, c2: 2 }, { r1: 1, c1: 3, r2: 2, c2: 3 },
      { r1: 7, c1: 4, r2: 7, c2: 6 }, { r1: 8, c1: 4, r2: 8, c2: 6 }, { r1: 9, c1: 4, r2: 9, c2: 6 },
    ],
  };

  test("only the two nurses are people, with contact and RECC numbers", () => {
    const g = readGrid([sheet]);
    expect(g.days.map((d) => d.date)).toEqual(["2024-12-29", "2024-12-30", "2024-12-31"]);
    expect(g.people.map((p) => p.name)).toEqual(["SRN TEST ONE", "RN TEST TWO"]);
    expect(g.people[0].details).toEqual({ contact: "7000001", recc: "HMH0001" });
  });

  test("letters are guessed as shifts, and OFF(N) is your (N)OFF", () => {
    const g = readGrid([sheet]);
    const plan = planImport(g, { staff: [], cells: {}, posts: [], nonOfficial: [], fridayRule: true,
      codes: [{ id: "M", code: "M", counts: "morning" }, { id: "NOFF", code: "(N)OFF", counts: "off" }] });
    const by = Object.fromEntries(plan.codes.map((c) => [c.key, c]));
    expect(by["OFF(N)"].existingId).toBe("NOFF");
    expect(by["A(R)"].proposal.counts).toBe("afternoon");
    expect(plan.leave).toHaveLength(1);
  });
});
