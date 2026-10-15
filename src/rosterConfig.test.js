/* Proof that moving Smart Roster's configuration code into rosterConfig.js
   changed nothing. OLD below is a frozen copy of the code as it stood in
   SmartRosterTab.js before the move (commit 5198a84). Each sample rota is
   run through the old code and the new, and the two must agree exactly:
   the configuration handed to the engine, the week the engine produces,
   and the cells Apply writes and checks.

   Do not "tidy" OLD — its whole value is that it is the old code.      */

import { generateRoster, toRotaCells } from "./rosterEngine";
import {
  weekConfig, mergeRules, chosenCodesFor, codeTextById, codeIdByText, flattenCells,
  activeStaffFor, weekDatesFrom, planWrites, writeCells, findMismatches, exchangeMarksIn, seniorNeedOf,
} from "./rosterConfig";

/* ─────────────── OLD (frozen copy) ─────────────── */
const OLD = (() => {
  const DEFAULT_RULES = {
    coverage: {
      morning: { min: 2, max: 3 }, afternoon: { min: 2, max: 3 },
      evening: { min: 0, max: 0 }, night: { min: 1, max: 2 },
    },
    weeklyMin: { morning: 1, afternoon: 1, evening: 1, night: 1, off: 1 },
    weeklyMax: { morning: null, afternoon: null, evening: null, night: null, off: 2 },
    blockDays: { morning: 3, afternoon: 3, evening: 3, night: 2 },
    sequenceRules: [
      { id: "d1", type: "never", after: "night", then: "morning" },
      { id: "d2", type: "never", after: "night", then: "afternoon" },
      { id: "d3", type: "never", after: "night", then: "evening" },
      { id: "d4", type: "never", after: "afternoon", then: "morning" },
      { id: "d5", type: "never", after: "evening", then: "morning" },
    ],
    maxDaysOn: 5,
    skipStaff: [],
    staffShifts: {},
    weeklyDuties: { min: 5, max: 5 },
    lookbackDays: 30,
    seniorStaff: [],
    seniorCover: { morning: 0, afternoon: 0, evening: 0, night: 0 },
    seniorTerm: "Senior",
    seniorTermPlural: "",
    codeFor: { morning: "", afternoon: "", evening: "", night: "", off: "", nightOff: "" },
    ruleStates: { coverage: { state: 'hard', priority: 1 }, sequence: { state: 'hard', priority: 1 },
                  offMax: { state: 'hard', priority: 1 }, workPattern: { state: 'soft', priority: 4 } },
  };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  // The app's own dstr, handed to SmartRosterTab as a prop.
  const pad = (n) => String(n).padStart(2, "0");
  const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  return function oldSmartRoster(data, weekStart) {
    const saved = data.rosterRules || {};
    const rules = {
      ...DEFAULT_RULES, ...saved,
      coverage: { ...DEFAULT_RULES.coverage, ...(saved.coverage || {}) },
      weeklyMin: { ...DEFAULT_RULES.weeklyMin, ...(saved.weeklyMin || {}) },
      weeklyMax: { ...DEFAULT_RULES.weeklyMax, ...(saved.weeklyMax || {}) },
      blockDays: { ...DEFAULT_RULES.blockDays, ...(saved.blockDays || {}) },
      sequenceRules: saved.sequenceRules || DEFAULT_RULES.sequenceRules,
      staffShifts: saved.staffShifts || {},
      skipStaff: saved.skipStaff || [],
      seniorStaff: saved.seniorStaff || [],
      seniorCover: { ...DEFAULT_RULES.seniorCover, ...(saved.seniorCover || {}) },
      codeFor: { ...DEFAULT_RULES.codeFor, ...(saved.codeFor || {}) },
      ruleStates: { ...DEFAULT_RULES.ruleStates, ...(saved.ruleStates || {}) },
      weeklyDuties: { ...DEFAULT_RULES.weeklyDuties, ...(saved.weeklyDuties || {}) },
    };
    const termOne = (rules.seniorTerm || "Senior").trim() || "Senior";
    const termMany = (rules.seniorTermPlural || "").trim() || `${termOne}s`;
    const lower = termOne.toLowerCase();
    const firstDay = data.weekStartsOn ?? 0;
    const weekEnd = dstr(addDays(new Date(weekStart), 6));

    const employedOn = (s, date) => {
      if (s.startDate && date < s.startDate) return false;
      if (s.endDate && date > s.endDate) return false;
      return true;
    };
    const shiftISO = (iso, n) => {
      const [y, m, d] = String(iso).split("-").map(Number);
      const x = new Date(y, m - 1, d);
      x.setDate(x.getDate() + n);
      return dstr(x);
    };
    const weekDates = [...Array(7)].map((_, i) => dstr(addDays(new Date(weekStart), i)));
    const activeStaff = (data.staff || []).filter((s) => weekDates.some((d) => employedOn(s, d)));

    const nonOfficialFor = (from, to) => {
      const out = new Set(data.nonOfficial || []);
      if (data.fridayRule) {
        for (let d = new Date(from); dstr(d) <= to; d = addDays(d, 1)) if (d.getDay() === 5) out.add(dstr(d));
      }
      return [...out];
    };
    const codeById = (() => {
      const m = {}; (data.codes || []).forEach((c) => { m[c.id] = c.code; }); return m;
    })();
    const idByCode = (() => {
      const m = {};
      (data.codes || []).forEach((c) => { if (!(c.code in m)) m[c.code] = c.id; });
      return m;
    })();
    const firstCodeIdOf = (raw) => {
      if (!raw) return "";
      if (typeof raw === "string") return raw;
      if (Array.isArray(raw)) {
        const first = raw.find((e) => e && e.code);
        return first ? first.code : "";
      }
      return "";
    };
    const flatten = (from, to) => {
      const out = {};
      for (const [date, row] of Object.entries(data.cells || {})) {
        if (date < from || date > to) continue;
        if (!row || typeof row !== "object") continue;
        for (const [sid, raw] of Object.entries(row)) {
          const code = codeById[firstCodeIdOf(raw)];
          if (code) out[`${sid}|${date}`] = code;
        }
      }
      return out;
    };
    const buildConfig = () => {
      const lookFrom = dstr(addDays(new Date(weekStart), -(rules.lookbackDays || 0)));
      const lookTo = dstr(addDays(new Date(weekStart), -1));
      const history = flatten(lookFrom, lookTo);
      const rosterStaff = activeStaff.map((s) => {
        const gaps = [];
        if (s.startDate && s.startDate > weekStart) {
          gaps.push({ id: `pre-${s.id}`, type: "other", start: weekStart, end: shiftISO(s.startDate, -1) });
        }
        if (s.endDate && s.endDate < weekEnd) {
          gaps.push({ id: `post-${s.id}`, type: "other", start: shiftISO(s.endDate, 1), end: weekEnd });
        }
        return gaps.length ? { ...s, leavePeriods: [...(s.leavePeriods || []), ...gaps] } : s;
      });
      return {
        from: weekStart, to: weekEnd,
        weekStartsOn: firstDay,
        staff: rosterStaff,
        codes: data.codes || [],
        existingCells: flatten(weekStart, weekEnd),
        coverage: rules.coverage,
        weeklyPerStaff: {
          ...rules.weeklyMax,
          off: rules.weeklyMin?.off ?? null,
          offMax: rules.weeklyMax?.off ?? null,
        },
        weeklyMin: rules.weeklyMin,
        weeklyDuties: rules.weeklyDuties,
        sequenceRules: rules.sequenceRules,
        skipStaff: rules.skipStaff,
        staffShifts: rules.staffShifts,
        seniorStaff: rules.seniorStaff,
        seniorCover: rules.seniorCover,
        seniorTerm: lower,
        seniorTermPlural: termMany.toLowerCase(),
        maxBlock: rules.blockDays,
        maxConsecutiveDays: rules.maxDaysOn ?? 5,
        ruleStates: rules.ruleStates,
        nonOfficialDates: nonOfficialFor(weekStart, weekEnd),
        requests: (data.dutyRequests || [])
          .filter((r) => r.approved && r.date >= weekStart && r.date <= weekEnd)
          .map((r) => ({ staffId: r.staffId, date: r.date, category: r.category })),
        history: { cells: history, nonOfficialDates: nonOfficialFor(lookFrom, lookTo) },
      };
    };
    const chosenCodes = (() => {
      const out = {};
      Object.entries(rules.codeFor || {}).forEach(([slot, id]) => {
        const c = (data.codes || []).find((x) => x.id === id);
        if (c) out[slot] = c.code;
      });
      return out;
    })();

    // apply(): the write plan and the update() body.
    const planApply = (rotaCells) => {
      const writes = [];
      const missing = new Set();
      for (const [key, code] of Object.entries(rotaCells)) {
        const cut = key.lastIndexOf("|");
        const sid = key.slice(0, cut);
        const date = key.slice(cut + 1);
        const id = idByCode[code];
        if (!id) { missing.add(code); continue; }
        writes.push({ sid, date, id, code });
      }
      const marksCleared = writes.filter((w) => data.cellMeta?.[w.date]?.[w.sid]?.exchange).length;
      return { writes, missing, marksCleared };
    };
    const applyBody = (writes) => (d) => {
      const next = { ...(d.cells || {}) };
      for (const w of writes) {
        next[w.date] = { ...(next[w.date] || {}), [w.sid]: w.id };
        const meta = d.cellMeta?.[w.date]?.[w.sid];
        if (meta?.exchange) {
          delete meta.exchange;
          if (!Object.keys(meta).length) delete d.cellMeta[w.date][w.sid];
        }
      }
      d.cells = next;
      return d;
    };
    // The read-back check, given the rota after the write.
    const verify = (after, writes) => {
      const wrong = [];
      for (const w of writes) {
        const landedId = firstCodeIdOf((after.cells?.[w.date] || {})[w.sid]);
        if (landedId !== w.id) {
          const who = (after.staff || []).find((s) => String(s.id) === String(w.sid))?.name || w.sid;
          wrong.push(`${w.date} · ${who}: expected ${w.code}, rota has ${codeById[landedId] || "nothing"}`);
        }
      }
      return wrong;
    };
    const yearStart = `${weekStart.slice(0, 4)}-01-01`;

    return {
      config: buildConfig(), chosenCodes, activeStaff, weekDates, codeById, idByCode,
      yearToDate: flatten(yearStart, weekEnd), planApply, applyBody, verify,
    };
  };
})();

/* ─────────────── Sample rotas ─────────────── */
const CODES = [
  { id: "M", code: "M", label: "Morning duty", color: "#F4B860", counts: "morning" },
  { id: "MR", code: "M(R)", label: "Morning request", color: "#E8A33D", counts: "morning" },
  { id: "A", code: "A", label: "Afternoon duty", color: "#8FBF6B", counts: "afternoon" },
  { id: "N", code: "N", label: "Night duty", color: "#6FA8DC", counts: "night" },
  { id: "E", code: "E", label: "Evening duty", color: "#8E7CC3", counts: "evening" },
  { id: "RD", code: "RD", label: "Release duty", color: "#C08552", counts: "release" },
  { id: "OFF", code: "OFF", label: "Off day", color: "#FFFFFF", counts: "off" },
  { id: "NOFF", code: "(N)OFF", label: "Off after night", color: "#E8EEF2", counts: "off" },
  { id: "SL", code: "SL", label: "Sick leave", color: "#F0A090", counts: "sl" },
  { id: "X1", code: "M", label: "Second code sharing the letters", color: "#000000", counts: "morning" },
  { id: "OT", code: "OT", label: "Other duty", color: "#8E7CC3", counts: "other" },
];

const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const datesFrom = (start, n) => {
  const [y, m, d] = start.split("-").map(Number);
  return [...Array(n)].map((_, i) => { const x = new Date(y, m - 1, d + i); return iso(x.getFullYear(), x.getMonth() + 1, x.getDate()); });
};

// A rota with history in every cell shape: plain ids, split duties with
// posts, empty lists, unknown codes, and junk rows.
const fillCells = (staff, start, n) => {
  const cells = {};
  const cycle = ["M", "A", "N", "NOFF", "OFF", "M", "A"];
  datesFrom(start, n).forEach((date, di) => {
    cells[date] = {};
    staff.forEach((s, si) => {
      const id = cycle[(di + si) % cycle.length];
      if ((di + si) % 11 === 0) cells[date][s.id] = [{ code: id, post: "p1" }, { code: "E", post: "p2" }];
      else if ((di + si) % 13 === 0) cells[date][s.id] = [];
      else if ((di + si) % 17 === 0) cells[date][s.id] = "deleted-code";
      else if ((di + si) % 19 === 0) cells[date][s.id] = "OT";
      else cells[date][s.id] = id;
    });
  });
  cells["junk"] = "not a row";
  return cells;
};

const staffList = (n) => [...Array(n)].map((_, i) => ({ id: `s${i}`, name: `Staff ${i}` }));

const sampleA = () => {
  const staff = staffList(10);
  staff[1].startDate = "2026-10-07";            // joins mid-week
  staff[2].endDate = "2026-10-08";              // leaves mid-week
  staff[3].endDate = "2026-08-01";              // left long ago
  staff[4].startDate = "2026-12-01";            // not started yet
  staff[5].leavePeriods = [{ id: "lv", type: "annual", start: "2026-10-05", end: "2026-10-06" }];
  const cells = fillCells(staff, "2026-08-20", 60);
  cells["2026-10-07"].s6 = "SL";                 // preserved inside the week
  cells["2026-10-08"].s7 = "RD";
  return {
    staff, codes: CODES, cells, fridayRule: true, nonOfficial: ["2026-10-06", "2026-09-20"],
    dutyRequests: [
      { id: "r1", staffId: "s0", date: "2026-10-05", category: "night", approved: true },
      { id: "r2", staffId: "s8", date: "2026-10-09", category: "off", approved: true },
      { id: "r3", staffId: "s9", date: "2026-10-06", category: "morning", approved: false },
      { id: "r4", staffId: "s0", date: "2026-10-20", category: "off", approved: true },
    ],
    cellMeta: {
      "2026-10-05": { s1: { exchange: { originalCode: "A" } }, s2: { note: "keep me", exchange: { originalCode: "N" } } },
      "2026-10-06": { s3: { note: "only a note" } },
    },
  };
};

const sampleB = () => {
  const staff = staffList(12);
  staff[0].startDate = "2026-11-03";
  return {
    staff, codes: CODES, cells: fillCells(staff, "2026-10-01", 40),
    weekStartsOn: 1, fridayRule: false, nonOfficial: ["2026-11-04"],
    rosterRules: {
      lookbackDays: 14,
      coverage: { morning: { min: 3, max: 4 }, evening: { min: 1, max: 1 } },
      weeklyMin: { off: 2 }, weeklyMax: { night: 2 },
      blockDays: { night: 3 },
      sequenceRules: [{ id: "x", type: "must", after: "night", then: "off" }],
      skipStaff: ["s11"], staffShifts: { s10: ["night"], s9: ["morning", "afternoon"] },
      seniorStaff: ["s1", "s2", "s3", "s4"], seniorCover: { night: 1, morning: 1 },
      seniorTerm: "  In-charge ", seniorTermPlural: "",
      codeFor: { morning: "MR", nightOff: "NOFF", off: "deleted" },
      ruleStates: { workPattern: { state: "hard", priority: 1 }, offMin: { state: "soft", priority: 2 } },
      weeklyDuties: { min: 4 },
      maxDaysOn: 4,
    },
    dutyRequests: [{ id: "q", staffId: "s5", date: "2026-11-05", category: "evening", approved: true }],
  };
};

const sampleC = () => ({        // bare rota: no rules, no cells, no look-back
  staff: staffList(7), codes: CODES, rosterRules: { lookbackDays: 0 },
});

const sampleD = () => {         // a week that crosses into a new year
  const staff = staffList(9);
  return { staff, codes: CODES, cells: fillCells(staff, "2026-11-20", 45), fridayRule: true };
};

const CASES = [
  ["joiners, leavers, leave, split duties, requests, Friday rule", sampleA, "2026-10-04"],
  ["custom rules, Monday weeks, seniors, code choices", sampleB, "2026-11-02"],
  ["empty rota with no look-back", sampleC, "2026-10-04"],
  ["week crossing the new year", sampleD, "2026-12-27"],
];

const clone = (x) => JSON.parse(JSON.stringify(x));

/* ─────────────── The checks ─────────────── */
describe.each(CASES)("Smart Roster unchanged: %s", (_label, make, weekStart) => {
  const data = make();
  const old = OLD(data, weekStart);

  test("the engine configuration is identical", () => {
    expect(weekConfig(data, weekStart)).toEqual(old.config);
  });

  test("the staff, dates, code maps and code choices are identical", () => {
    const rules = mergeRules(data.rosterRules || {});
    expect(weekDatesFrom(weekStart)).toEqual(old.weekDates);
    expect(activeStaffFor(data.staff, weekDatesFrom(weekStart))).toEqual(old.activeStaff);
    expect(codeTextById(data.codes)).toEqual(old.codeById);
    expect(codeIdByText(data.codes)).toEqual(old.idByCode);
    expect(chosenCodesFor(rules, data.codes)).toEqual(old.chosenCodes);
    expect(flattenCells(data.cells, old.codeById, `${weekStart.slice(0, 4)}-01-01`, old.config.to))
      .toEqual(old.yearToDate);
  });

  test("the generated week, and what Apply writes and checks, are identical", () => {
    const rules = mergeRules(data.rosterRules || {});
    const resOld = generateRoster(old.config);
    const resNew = generateRoster(weekConfig(data, weekStart));
    expect(resNew.ok).toBe(resOld.ok);
    if (!resOld.ok) { expect(resNew.problems).toEqual(resOld.problems); return; }
    expect(resNew.cells).toEqual(resOld.cells);
    expect(resNew.report.shortfalls).toEqual(resOld.report.shortfalls);

    const rotaOld = toRotaCells(resOld.cells, data.codes, resOld.nightRest, old.chosenCodes);
    const rotaNew = toRotaCells(resNew.cells, data.codes, resNew.nightRest, chosenCodesFor(rules, data.codes));
    expect(rotaNew).toEqual(rotaOld);

    // Plus one code with no matching duty code, which must stop Apply.
    const withMissing = { ...rotaOld, [`s0|${weekStart}`]: "NOPE" };
    const planOld = old.planApply(withMissing);
    const planNew = planWrites(withMissing, codeIdByText(data.codes));
    expect(planNew.writes).toEqual(planOld.writes);
    expect([...planNew.missing]).toEqual([...planOld.missing]);
    expect(exchangeMarksIn(data, planNew.writes)).toBe(planOld.marksCleared);

    const writes = old.planApply(rotaOld).writes;
    const afterOld = old.applyBody(writes)(clone(data));
    const afterNew = writeCells(clone(data), writes);
    expect(afterNew).toEqual(afterOld);

    // The read-back check: clean after a good write, and the same words
    // for every cell that did not land — including split-duty cells.
    expect(findMismatches(afterNew, writes, old.codeById)).toEqual([]);
    const tampered = clone(afterOld);
    writes.slice(0, 3).forEach((w, i) => {
      tampered.cells[w.date][w.sid] = i === 0 ? undefined : i === 1 ? [{ code: "SL", post: "p" }] : "deleted-code";
    });
    if (writes.length) {
      const wrongOld = old.verify(tampered, writes);
      expect(findMismatches(tampered, writes, old.codeById)).toEqual(wrongOld);
    }
  }, 60000);
});

/* ─────────────── Smart Roster's "enough seniors?" hint ───────────────
   OLD_HINT is the sum exactly as it stood inline in SmartRosterTab.js
   before it moved to seniorNeedOf (commit 66f3aab). Do not tidy it. */
const OLD_HINT = (rules, activeStaff) => {
  const SHIFTS = ["morning", "afternoon", "evening", "night"];
  const seniorCount = activeStaff.filter((s) => rules.seniorStaff.includes(s.id) && !rules.skipStaff.includes(s.id)).length;
  const seniorPerDay = SHIFTS.reduce((n, sh) => n + ((rules.coverage[sh]?.min || 0) > 0 ? (rules.seniorCover[sh] || 0) : 0), 0);
  return {
    show: seniorPerDay > 0,
    seniorCount, seniorPerDay,
    perPerson: rules.weeklyDuties?.max || 5,
    needed: Math.ceil((seniorPerDay * 7) / (rules.weeklyDuties?.max || 5)),
  };
};

describe("Smart Roster's senior hint is unchanged", () => {
  const staff = staffList(12);
  const SAVED = [
    {},
    { seniorStaff: ["s1", "s2"], seniorCover: { morning: 1 } },
    { seniorStaff: ["s1", "s2", "s3"], seniorCover: { morning: 1, night: 2 }, skipStaff: ["s2"] },
    // A senior on a shift the ward does not staff is not counted.
    { seniorStaff: ["s0"], seniorCover: { evening: 3, night: 1 }, coverage: { evening: { min: 0, max: 2 } } },
    { seniorStaff: ["s4", "ghost"], seniorCover: { morning: 2, afternoon: 2, night: 2 }, weeklyDuties: { max: 4 } },
    { seniorStaff: ["s5"], seniorCover: { morning: 1 }, weeklyDuties: { max: 0 } },
    { seniorStaff: ["s5"], seniorCover: { morning: 1 }, weeklyDuties: { max: null } },
    { seniorStaff: ["s6"], seniorCover: { morning: "" }, coverage: { morning: { min: null, max: 3 } } },
    { seniorStaff: ["s7", "s8"], seniorCover: { morning: 10, afternoon: 0, evening: 4, night: 7 },
      coverage: { evening: { min: 1, max: 4 } }, weeklyDuties: { max: 6 } },
  ];
  test.each(SAVED.map((s, i) => [i, s]))("settings %i", (_i, saved) => {
    const rules = mergeRules(saved);
    [staff, staff.slice(0, 3), []].forEach((list) => {
      const old = OLD_HINT(rules, list);
      const now = seniorNeedOf(rules, list);
      expect(now.seniorPerDay > 0).toBe(old.show);
      expect(now).toEqual({ seniorCount: old.seniorCount, seniorPerDay: old.seniorPerDay, perPerson: old.perPerson, needed: old.needed });
    });
  });
});
