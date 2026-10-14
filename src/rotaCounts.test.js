/* Proof that moving the rota's counting code into rotaCounts.js changed
   nothing. OLD is a frozen copy of the code as it stood in
   DutyRotaOriginal.js (commit 4400c26). Do not "tidy" it.               */

import {
  isNonOff, leaveOn, entriesOf, cellEntries, isEmployedOn, weekTotalsFor, dayCountFor,
  FRIDAY, DUTY_CATS,
} from "./rotaCounts";

/* ─────────────── OLD (frozen copy) ─────────────── */
const OLD = (() => {
  const FRIDAY = 5;
  const DUTY_CATS = ["morning", "afternoon", "evening", "night", "other", "release"];
  const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const isNonOff = (data, date) =>
    (data.fridayRule && parseD(date).getDay() === FRIDAY) || data.nonOfficial.includes(date);
  const leaveOn = (staff, date) => (staff.leavePeriods || []).find((p) => date >= p.start && date <= p.end) || null;
  const codeByIdOf = (data) => (id) => data.codes.find((c) => c.id === id);
  const entriesOf = (raw) => {
    if (!raw) return [];
    if (typeof raw === "string") return [{ code: raw, post: "" }];
    if (Array.isArray(raw)) {
      return raw.filter((e) => e && e.code)
                .map((e) => ({ code: e.code, post: e.post || "" }));
    }
    return [];
  };
  const cellEntries = (data, date, staffId) => entriesOf((data.cells?.[date] || {})[staffId]);
  const isEmployedOn = (staff, date) => {
    if (staff.startDate && date < staff.startDate) return false;
    if (staff.endDate && date > staff.endDate) return false;
    return true;
  };
  const weekTotalsFor = (data, staff, days) => {
    const codeById = codeByIdOf(data);
    const t = { morning: 0, afternoon: 0, evening: 0, night: 0, other: 0, release: 0, off: 0, nonOfficialDuty: 0 };
    days.forEach((date) => {
      if (!isEmployedOn(staff, date)) return;
      if (leaveOn(staff, date)) return;
      const codes = cellEntries(data, date, staff.id).map((e) => codeById(e.code)).filter(Boolean);
      if (!codes.length) return;
      codes.forEach((code) => { if (code.counts in t) t[code.counts]++; });
      if (isNonOff(data, date) && codes.some((c) => DUTY_CATS.includes(c.counts))) t.nonOfficialDuty++;
    });
    return t;
  };
  const dayCountFor = (data, date, cat) => {
    const codeById = codeByIdOf(data);
    return data.staff.reduce((a, s) => {
      if (!isEmployedOn(s, date)) return a;
      if (leaveOn(s, date)) return a;
      const n = cellEntries(data, date, s.id)
        .map((e) => codeById(e.code))
        .filter((code) => code?.counts === cat).length;
      return a + n;
    }, 0);
  };
  return { FRIDAY, DUTY_CATS, isNonOff, leaveOn, entriesOf, cellEntries, isEmployedOn, weekTotalsFor, dayCountFor };
})();

/* ─────────────── A rota with every kind of cell ─────────────── */
const CODES = [
  { id: "M", code: "M", counts: "morning" }, { id: "A", code: "A", counts: "afternoon" },
  { id: "E", code: "E", counts: "evening" }, { id: "N", code: "N", counts: "night" },
  { id: "OD", code: "OD", counts: "other" }, { id: "RD", code: "RD", counts: "release" },
  { id: "OFF", code: "OFF", counts: "off" }, { id: "SL", code: "SL", counts: "sl" },
  { id: "X", code: "X" },
];
const IDS = ["M", "A", "E", "N", "OD", "RD", "OFF", "SL", "X", "gone"];
const days = [...Array(35)].map((_, i) => {
  const d = new Date(2026, 9, 1 + i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});
const staff = [...Array(8)].map((_, i) => ({ id: `s${i}`, name: `S${i}` }));
staff[1].startDate = "2026-10-10";
staff[2].endDate = "2026-10-20";
staff[3].leavePeriods = [{ id: "l", type: "annual", start: "2026-10-05", end: "2026-10-09" }];
const cells = {};
days.forEach((date, di) => {
  cells[date] = {};
  staff.forEach((s, si) => {
    const k = di * 3 + si;
    if (k % 9 === 0) cells[date][s.id] = [{ code: IDS[k % 10], post: "p" }, { code: IDS[(k + 3) % 10] }];
    else if (k % 13 === 0) cells[date][s.id] = [];
    else if (k % 17 === 0) return;
    else cells[date][s.id] = IDS[k % 10];
  });
});
const data = { staff, codes: CODES, cells, fridayRule: true, nonOfficial: ["2026-10-13", "2026-10-28"] };

test("constants are unchanged", () => {
  expect(FRIDAY).toBe(OLD.FRIDAY);
  expect(DUTY_CATS).toEqual(OLD.DUTY_CATS);
});

test("cell, leave, employment and non-official readings are unchanged", () => {
  days.forEach((date) => {
    expect(isNonOff(data, date)).toBe(OLD.isNonOff(data, date));
    staff.forEach((s) => {
      expect(leaveOn(s, date)).toEqual(OLD.leaveOn(s, date));
      expect(isEmployedOn(s, date)).toBe(OLD.isEmployedOn(s, date));
      expect(cellEntries(data, date, s.id)).toEqual(OLD.cellEntries(data, date, s.id));
    });
  });
  [null, "", "M", [], [{ code: "M" }, null, { code: "" }, { code: "A", post: "p" }], { code: "M" }]
    .forEach((raw) => expect(entriesOf(raw)).toEqual(OLD.entriesOf(raw)));
});

test("per-person totals and per-day coverage are unchanged", () => {
  [days.slice(0, 7), days.slice(7, 21), days].forEach((range) => {
    staff.forEach((s) => expect(weekTotalsFor(data, s, range)).toEqual(OLD.weekTotalsFor(data, s, range)));
  });
  days.forEach((date) => {
    ["morning", "afternoon", "evening", "night", "other", "release"].forEach((cat) => {
      expect(dayCountFor(data, date, cat)).toBe(OLD.dayCountFor(data, date, cat));
    });
  });
});
