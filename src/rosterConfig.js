/* ─────────────── Roster settings → engine configuration ───────────────
   Shared by Smart Roster (one week) and Ini (a whole month), so the two
   always hand the engine the same rules. Moved here from SmartRosterTab.js
   unchanged: what Smart Roster produces for a week must not move by a
   single cell, and rosterConfig.test.js holds a frozen copy of the old code
   to prove it.

   Pure functions only — no React, nothing saved. The Apply helpers at the
   bottom plan a write, perform it inside an update(), and compare what
   landed, but the update() call itself stays with the screen.          */

/* The defaults are the rules you described, already set up. Someone opening
   this page for the first time should be able to press Generate and get a
   sensible week without configuring anything. */
export const DEFAULT_RULES = {
  coverage: {
    morning: { min: 2, max: 3 }, afternoon: { min: 2, max: 3 },
    evening: { min: 0, max: 0 }, night: { min: 1, max: 2 },
  },
  // At least one of every shift the ward runs, so nobody goes a week
  // without seeing a night, or without a morning.
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
  /* Who can take charge of a shift, and how many each shift needs. Off by
     default — every number zero — so nothing changes for a ward that has
     never thought about it. The word is theirs to choose: "senior" is only
     one of the ones in use. */
  seniorStaff: [],
  seniorCover: { morning: 0, afternoon: 0, evening: 0, night: 0 },
  seniorTerm: "Senior",
  seniorTermPlural: "",
  /* Which code gets written for each kind of duty. Empty = work it out, which
     is what every existing rota does today, so nothing changes until a ward
     says otherwise. Stored as code ids, not code text, so renaming a code in
     Settings does not quietly break the choice. */
  codeFor: { morning: "", afternoon: "", evening: "", night: "", off: "", nightOff: "" },
  ruleStates: { coverage: { state: 'hard', priority: 1 }, sequence: { state: 'hard', priority: 1 },
                offMax: { state: 'hard', priority: 1 }, workPattern: { state: 'soft', priority: 4 } },
};

// The ward's saved settings laid over the defaults, one group at a time.
export const mergeRules = (saved = {}) => ({
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
});

/* The word this ward uses. Everything on the page and every message the
   engine produces follows it, so a ward that says "in-charge" never sees
   the word "senior" anywhere. */
export const seniorTermsOf = (rules) => {
  const termOne = (rules.seniorTerm || "Senior").trim() || "Senior";
  const termMany = (rules.seniorTermPlural || "").trim() || `${termOne}s`;
  return { termOne, termMany, lower: termOne.toLowerCase() };
};

/* Enough seniors for the week? Smart Roster's sum under "How many staff on
   each shift", moved here unchanged so Ini can say the same thing:
   seniors asked for each day (counting only shifts the ward staffs) times
   seven, shared out at the weekly duty maximum, against the people ticked
   who are not skipped. `staff` is whoever the screen is counting — the
   week's staff on Smart Roster, everyone still with the ward for Ini.
   rosterConfig.test.js holds the old inline code to prove it.          */
// The engine's SHIFTS; not imported, so this file stays free of the engine.
const SENIOR_SHIFTS = ["morning", "afternoon", "evening", "night"];
export const seniorNeedOf = (rules, staff) => {
  const seniorCount = staff.filter((s) => rules.seniorStaff.includes(s.id) && !rules.skipStaff.includes(s.id)).length;
  const seniorPerDay = SENIOR_SHIFTS.reduce((n, sh) => n + ((rules.coverage[sh]?.min || 0) > 0 ? (rules.seniorCover[sh] || 0) : 0), 0);
  const perPerson = rules.weeklyDuties?.max || 5;
  return { seniorCount, seniorPerDay, perPerson, needed: Math.ceil((seniorPerDay * 7) / perPerson) };
};

/* ── Dates ──
   The same three helpers Smart Roster has always used, kept exactly as they
   were — including reading "YYYY-MM-DD" with new Date(), which a week's
   result depends on. Ini's month passes its own plain date strings in. */
const pad = (n) => String(n).padStart(2, "0");
export const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const shiftISO = (iso, n) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() + n);
  return dstr(x);
};

/* ── Who is actually on the rota ──
   Employment dates are inclusive, and the rota grid only shows somebody on
   the days between their joining date and their last working day. The
   generator has to use the same rule, or it rosters people the rota will
   not display: their duties are written, nobody can see them, and the ward
   is quietly a person short for the week.

   Read from the same two fields the Staff tab sets, in plain string
   comparison — the dates are stored as YYYY-MM-DD, which sorts correctly
   as text and avoids every timezone trap. */
export const employedOn = (s, date) => {
  if (s.startDate && date < s.startDate) return false;
  if (s.endDate && date > s.endDate) return false;
  return true;
};
// Everyone employed on at least one of these dates — the ones to roster.
export const activeStaffFor = (staff, dates) =>
  (staff || []).filter((s) => dates.some((d) => employedOn(s, d)));

export const nonOfficialFor = (data, from, to) => {
  const out = new Set(data.nonOfficial || []);
  if (data.fridayRule) {
    for (let d = new Date(from); dstr(d) <= to; d = addDays(d, 1)) if (d.getDay() === 5) out.add(dstr(d));
  }
  return [...out];
};

/* The rota stores cells as cells[date][staffId] = codeId — nested by
   date, holding the code's id. The engine works in flat "staffId|date"
   keys holding the code itself. These translate between them; getting
   this wrong means the engine reads no history and writes nothing the
   rota can see. */
export const codeTextById = (codes) => {
  const m = {}; (codes || []).forEach((c) => { m[c.id] = c.code; }); return m;
};
/* Code text back to the code's id. FIRST match wins, because that is what
   the engine picks too — it takes the first code counting as a category.
   Last-wins would quietly hand every morning to a second code that
   happens to share the letters, and the preview would look right while
   the rota got something else. */
export const codeIdByText = (codes) => {
  const m = {};
  (codes || []).forEach((c) => { if (!(c.code in m)) m[c.code] = c.id; });
  return m;
};

/* A cell is either a plain duty code id, or a list of duties when a
   department uses tasks or split shifts:
       "abc123"   or   [{ code: "abc", task: "Waiter" }, ...]
   The engine holds one duty per staff member per day, so a split duty
   contributes its first duty here. Reading the raw value instead would
   find no matching code and skip the day entirely — the engine would
   then treat a person who worked twice as having been free, and roster
   them again. Silent, and exactly the kind of unfairness the lookback
   exists to prevent. */
export const firstCodeIdOf = (raw) => {
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const first = raw.find((e) => e && e.code);
    return first ? first.code : "";
  }
  return "";
};

export const flattenCells = (cells, codeById, from, to) => {
  const out = {};
  for (const [date, row] of Object.entries(cells || {})) {
    if (date < from || date > to) continue;
    if (!row || typeof row !== "object") continue;
    for (const [sid, raw] of Object.entries(row)) {
      const code = codeById[firstCodeIdOf(raw)];
      if (code) out[`${sid}|${date}`] = code;
    }
  }
  return out;
};

/* The ward's code choices, turned from ids into the code text the engine
   writes. A choice pointing at a code that has since been deleted simply
   drops out here, and the engine falls back to working it out. */
export const chosenCodesFor = (rules, codes) => {
  const out = {};
  Object.entries(rules.codeFor || {}).forEach(([slot, id]) => {
    const c = (codes || []).find((x) => x.id === id);
    if (c) out[slot] = c.code;
  });
  return out;
};

/* ── The configuration the engine is given ──
   `staff` is everyone employed somewhere in from..to; `lookFrom`..`lookTo`
   is the history read for fairness. Everything else comes from the ward's
   own settings. */
export const buildRosterConfig = ({ data, rules, from, to, staff, lookFrom, lookTo }) => {
  const codeById = codeTextById(data.codes);
  const { termMany, lower } = seniorTermsOf(rules);
  const history = flattenCells(data.cells, codeById, lookFrom, lookTo);
  /* Somebody who joins on the Wednesday should be rostered from Wednesday,
     not from Sunday. The engine has no notion of employment dates, but it
     does understand leave — so the days outside somebody's employment are
     handed to it as leave periods. It then leaves those cells untouched,
     exactly as the rota grid shows them. */
  const rosterStaff = staff.map((s) => {
    const gaps = [];
    if (s.startDate && s.startDate > from) {
      gaps.push({ id: `pre-${s.id}`, type: "other", start: from, end: shiftISO(s.startDate, -1) });
    }
    if (s.endDate && s.endDate < to) {
      gaps.push({ id: `post-${s.id}`, type: "other", start: shiftISO(s.endDate, 1), end: to });
    }
    return gaps.length ? { ...s, leavePeriods: [...(s.leavePeriods || []), ...gaps] } : s;
  });
  return {
    from, to,
    // The weekly limits below reset on the ward's own week boundary.
    weekStartsOn: data.weekStartsOn ?? 0,
    staff: rosterStaff,
    codes: data.codes || [],
    existingCells: flattenCells(data.cells, codeById, from, to),
    coverage: rules.coverage,
    /* Per-shift caps are left off deliberately: the generator already
       spreads shift types within the week, so a cap would only get in its
       way. Off days carry both ends — `off` is the FEWEST somebody should
       get, `offMax` the most. These were once both fed from the "most"
       column, which quietly held everyone to exactly that many. */
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
    // Who can take charge, how many each shift needs, and what they are
    // called — the last so the engine's own messages use the ward's word.
    seniorStaff: rules.seniorStaff,
    seniorCover: rules.seniorCover,
    seniorTerm: lower,
    seniorTermPlural: termMany.toLowerCase(),
    // Blocks are kept short so a week reads as a mix rather than five
    // afternoons running. Nights are the exception: they pair.
    maxBlock: rules.blockDays,
    maxConsecutiveDays: rules.maxDaysOn ?? 5,
    // The working pattern is held firm: it is what stops one person
    // collecting a whole week of the same duty. Only the off-day floor
    // gives way, and only to keep a shift covered.
    ruleStates: rules.ruleStates,
    nonOfficialDates: nonOfficialFor(data, from, to),
    requests: (data.dutyRequests || [])
      .filter((r) => r.approved && r.date >= from && r.date <= to)
      .map((r) => ({ staffId: r.staffId, date: r.date, category: r.category })),
    history: { cells: history, nonOfficialDates: nonOfficialFor(data, lookFrom, lookTo) },
  };
};

/* Smart Roster's week, worked out exactly as the Smart Roster page always
   has: seven days from the week start, history over the look-back setting
   ending the day before. */
export const weekDatesFrom = (weekStart) =>
  [...Array(7)].map((_, i) => dstr(addDays(new Date(weekStart), i)));

export const weekConfig = (data, weekStart) => {
  const rules = mergeRules(data.rosterRules || {});
  const weekEnd = dstr(addDays(new Date(weekStart), 6));
  return buildRosterConfig({
    data, rules,
    from: weekStart, to: weekEnd,
    staff: activeStaffFor(data.staff, weekDatesFrom(weekStart)),
    lookFrom: dstr(addDays(new Date(weekStart), -(rules.lookbackDays || 0))),
    lookTo: dstr(addDays(new Date(weekStart), -1)),
  });
};

/* ── Applying, and checking that it landed ──
   Writing the rota and trusting that it worked is how a rota that looks
   nothing like the preview goes unnoticed. So the write is planned first,
   performed, and then read back and compared cell by cell. */

// Plan the write before touching anything, so a code that cannot be
// resolved stops the whole thing rather than leaving half a week behind.
export const planWrites = (rotaCells, idByCode) => {
  const writes = [];
  const missing = new Set();
  for (const [key, code] of Object.entries(rotaCells)) {
    const cut = key.lastIndexOf("|");            // a date never contains "|"
    const sid = key.slice(0, cut);
    const date = key.slice(cut + 1);
    const id = idByCode[code];
    if (!id) { missing.add(code); continue; }
    writes.push({ sid, date, id, code });
  }
  return { writes, missing };
};

/* A "changed duty" mark remembers the duty a cell held before it was
   exchanged. Once the cell is rewritten that memory points at a duty
   nobody worked, so applying clears it — counted beforehand so it can be
   said out loud rather than discovered later in Insights. */
export const exchangeMarksIn = (data, writes) =>
  writes.filter((w) => data.cellMeta?.[w.date]?.[w.sid]?.exchange).length;

// The body of the update(): writes every planned cell into the draft rota.
export const writeCells = (d, writes) => {
  const next = { ...(d.cells || {}) };
  for (const w of writes) {
    next[w.date] = { ...(next[w.date] || {}), [w.sid]: w.id };
    /* A "changed duty" mark remembers what a cell held before it was
       exchanged. Once the cell has been rewritten by a fresh rota that
       memory is of a duty nobody ever worked, so it goes. Notes on the
       cell are about the person and the day, so those stay. */
    const meta = d.cellMeta?.[w.date]?.[w.sid];
    if (meta?.exchange) {
      delete meta.exchange;
      if (!Object.keys(meta).length) delete d.cellMeta[w.date][w.sid];
    }
  }
  d.cells = next;
  return d;
};

/* Every planned cell that did not land, in words. A cell is either a plain
   duty code id or a list of duties carrying a post. Comparing the raw value
   only works for the first shape: a cell holding a post would never match
   and would be reported as empty even though the duty landed correctly.
   Compare the duty itself. */
export const findMismatches = (data, writes, codeById) => {
  const wrong = [];
  for (const w of writes) {
    const landedId = firstCodeIdOf((data.cells?.[w.date] || {})[w.sid]);
    if (landedId !== w.id) {
      const who = (data.staff || []).find((s) => String(s.id) === String(w.sid))?.name || w.sid;
      wrong.push(`${w.date} · ${who}: expected ${w.code}, rota has ${codeById[landedId] || "nothing"}`);
    }
  }
  return wrong;
};
