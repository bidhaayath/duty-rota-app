/* Seeded wards for comparing two versions of the Smart Roster engine.
   The same seed always gives the same ward, so the numbers one branch
   reports are the baseline the next branch is measured against. Changing
   anything in seededWard() changes every baseline: add, do not edit.     */

export const rng = (seed) => {
  let a = (seed | 0) + 0x9E3779B9;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const pad = (n) => String(n).padStart(2, "0");
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (s, n) => {
  const [y, m, d] = s.split("-").map(Number);
  return iso(new Date(y, m - 1, d + n));
};
export const days = (start, n) => [...Array(n)].map((_, i) => addDays(start, i));

export const CODES = [
  { id: "M", code: "M", counts: "morning" }, { id: "A", code: "A", counts: "afternoon" },
  { id: "E", code: "E", counts: "evening" }, { id: "N", code: "N", counts: "night" },
  { id: "OFF", code: "OFF", counts: "off" }, { id: "NOFF", code: "(N)OFF", counts: "off" },
  { id: "SL", code: "SL", counts: "sl" },
];
const CYCLE = ["M", "A", "N", "NOFF", "OFF", "M", "A"];

/* One ward, sized and ruled by its seed: 7 to 18 staff, cover from
   comfortable to slightly short, and a mix of the settings a real ward
   uses — ticks, seniors, skipped staff, leave, requests, a Monday week. */
export function seededWard(seed, { from, historyDays = 28, span = 7 } = {}) {
  const r = rng(seed * 7919 + 101);
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const chance = (p) => r() < p;

  const n = int(7, 18);
  const staff = [...Array(n)].map((_, i) => ({ id: `s${i}`, name: `Nurse ${i}`, leavePeriods: [] }));
  const weekStartsOn = chance(0.2) ? 1 : 0;
  const start = from || addDays("2026-11-01", 7 * int(0, 8) + weekStartsOn);

  const tight = 0.72 + r() * 0.32;
  const perDay = Math.max(3, Math.round((n * 5 / 7) * tight));
  const evening = chance(0.25);
  const night = Math.max(1, Math.round(perDay * 0.22));
  const dayShifts = evening ? 3 : 2;
  const rest = perDay - night;
  const share = (i) => Math.max(1, Math.floor(rest / dayShifts) + (i < rest % dayShifts ? 1 : 0));
  const cover = (min, extra) => ({ min, max: min + extra });
  const coverage = {
    morning: cover(share(0), int(0, 1)),
    afternoon: cover(share(1), int(0, 1)),
    evening: evening ? cover(share(2), int(0, 1)) : { min: 0, max: 0 },
    night: cover(night, chance(0.5) ? 1 : 0),
  };

  const rosterRules = {
    lookbackDays: chance(0.5) ? 14 : 28,
    coverage,
    weeklyMin: { morning: 1, afternoon: 1, evening: evening ? 1 : 0, night: chance(0.8) ? 1 : 0, off: 1 },
    weeklyMax: { morning: null, afternoon: null, evening: null, night: chance(0.3) ? 2 : null, off: chance(0.85) ? 2 : 3 },
  };
  const ticks = {};
  staff.forEach((s, i) => {
    if (i > 2 && chance(0.08)) ticks[s.id] = chance(0.5) ? ["morning"] : ["morning", "afternoon"];
  });
  if (Object.keys(ticks).length) rosterRules.staffShifts = ticks;
  if (chance(0.3)) rosterRules.skipStaff = [staff[n - 1].id];
  if (chance(0.3)) {
    rosterRules.seniorStaff = staff.filter((_, i) => i % 3 === 0).map((s) => s.id);
    rosterRules.seniorCover = { morning: 0, afternoon: 0, evening: 0, night: 1 };
  }
  if (chance(0.3)) rosterRules.blockTogether = { night: 2 };
  if (chance(0.3)) {
    rosterRules.sequenceRules = [
      { id: "d1", type: "never", after: "night", then: "morning" },
      { id: "d2", type: "never", after: "night", then: "afternoon" },
      { id: "d3", type: "never", after: "night", then: "evening" },
      { id: "d4", type: "never", after: "afternoon", then: "morning" },
      { id: "x1", type: "must", after: "night", then: "off" },
    ];
  }
  const states = {};
  if (chance(0.25)) states.offMax = { state: "soft", priority: 2 };
  if (chance(0.2)) states.workPattern = { state: "hard", priority: 1 };
  if (Object.keys(states).length) rosterRules.ruleStates = states;

  // History: a plain rotation before the first day, each person offset.
  const cells = {};
  const shiftBy = int(0, 6);
  days(addDays(start, -historyDays), historyDays).forEach((date, di) => {
    cells[date] = {};
    staff.forEach((s, si) => { cells[date][s.id] = CYCLE[(di + si + shiftBy) % 7]; });
  });

  // Leave that cuts into the range, a late joiner, and a few approved requests.
  staff.forEach((s, i) => {
    if (i > 1 && chance(0.12)) {
      const a = addDays(start, int(0, span - 2));
      s.leavePeriods.push({ id: `lv${i}`, type: "annual", start: a, end: addDays(a, int(0, 3)) });
    }
  });
  if (chance(0.15)) staff[n - 2].startDate = addDays(start, int(1, 3));
  const dutyRequests = [];
  const asks = int(0, 3) * Math.ceil(span / 7);
  for (let k = 0; k < asks; k++) {
    const who = staff[int(0, n - 1)], date = addDays(start, int(0, span - 1));
    if (dutyRequests.some((q) => q.staffId === who.id && q.date === date)) continue;
    dutyRequests.push({ id: `q${k}`, staffId: who.id, date, approved: true,
      category: ["off", "off", "morning", "night"][int(0, 3)] });
  }

  return {
    start,
    data: {
      staff, codes: CODES, cells, cellMeta: {}, dutyRequests, rosterRules, weekStartsOn,
      fridayRule: true, nonOfficial: chance(0.3) ? [addDays(start, int(0, span - 1))] : [],
    },
  };
}

// Stage 1 rules for people on the ward, Must and Try mixed by the seed.
export function stageOneRules(seed, staff) {
  const r = rng(seed * 31 + 5);
  const s = (i) => staff[i % staff.length].id;
  const strength = () => (r() < 0.5 ? "hard" : "soft");
  return [
    { id: "p1", staffId: s(0), type: "atMost", shift: "night", count: 1, strength: strength() },
    { id: "p2", staffId: s(1), type: "apart", shift: "night", count: 2, strength: strength() },
    { id: "p3", staffId: s(2), type: "atLeast", shift: "morning", count: 2, strength: "soft" },
    { id: "p4", staffId: s(3), type: "together", shift: "night", count: 2, strength: strength() },
  ];
}

// Day rules nothing can read: each is to be dropped, not guessed at.
export const unreadableDayRules = (staff) => [
  null,
  { id: "u1", staffId: staff[0].id, type: "offOn", days: [], strength: "hard" },
  { id: "u2", staffId: staff[0].id, type: "offOn", days: "5", strength: "hard" },
  { id: "u3", staffId: staff[1].id, type: "offOn", days: [5, 7], strength: "hard" },
  { id: "u4", staffId: staff[1].id, type: "offOn", strength: "hard" },
  { id: "u5", staffId: staff[2].id, type: "onlyOn", days: [5], shifts: [], strength: "hard" },
  { id: "u6", staffId: staff[2].id, type: "onlyOn", days: [5], shifts: ["brunch"], strength: "hard" },
  { id: "u7", staffId: staff[3].id, type: "onlyOn", days: [5], strength: "soft" },
  { id: "u8", staffId: staff[3].id, type: "onlyOn", days: [1.5], shifts: ["morning"], strength: "soft" },
];

// Real rules of both stages, for people who are no longer on the ward.
export const departedRules = () => [
  { id: "g1", staffId: "gone1", type: "offOn", days: [5, 6], strength: "hard" },
  { id: "g2", staffId: "gone2", type: "onlyOn", days: [5, 6], shifts: ["morning"], strength: "soft" },
  { id: "g3", staffId: "gone1", type: "atMost", shift: "night", count: 0, strength: "hard" },
];

// Day rules: the first person always off Friday and Saturday, the second
// on Friday and Saturday only Morning.
export const offRule = (staff, strength) =>
  ({ id: "y1", staffId: staff[0].id, type: "offOn", days: [5, 6], strength });
export const onlyRule = (staff, strength) =>
  ({ id: "y2", staffId: staff[1].id, type: "onlyOn", days: [5, 6], shifts: ["morning"], strength });

/* The lists a ward is tried with. `SAME` must change nothing between two
   engines that agree on what a rule means; `RULES` are measured. A list of
   `undefined` means the ward has no personRules at all. */
export const SAME = (seed, staff) => ({
  absent: undefined,
  empty: [],
  stageOne: stageOneRules(seed, staff),
  unreadable: unreadableDayRules(staff),
  departed: departedRules(),
  stageOneAndUnreadable: [...stageOneRules(seed, staff), ...unreadableDayRules(staff)],
});
export const RULES = (seed, staff) => ({
  none: undefined,
  stageOne: stageOneRules(seed, staff),
  offTry: [offRule(staff, "soft")],
  offMust: [offRule(staff, "hard")],
  onlyTry: [onlyRule(staff, "soft")],
  onlyMust: [onlyRule(staff, "hard")],
  offMustOnlyTry: [offRule(staff, "hard"), onlyRule(staff, "soft")],
  everything: [...stageOneRules(seed, staff), offRule(staff, "hard"), onlyRule(staff, "soft")],
});
export const withRules = (data, list) => {
  const rosterRules = { ...data.rosterRules };
  if (list === undefined) delete rosterRules.personRules; else rosterRules.personRules = list;
  return { ...data, rosterRules };
};

/* Somebody always off on certain days was off on them last month too. The
   plain rotation above knows nothing of that, and would open the week on a
   past the rule could never have produced — eight days worked in a row, or
   a night on the eve of the first working day. So their history is rewritten
   as the rule would have left it: off on the fixed days, and between them
   mornings, then afternoons, then a night. Both engines are given the same. */
export function fitHistory(data) {
  const offs = (data.rosterRules.personRules || [])
    .filter((r) => r && r.type === "offOn" && Array.isArray(r.days) && r.days.length);
  if (!offs.length) return data;
  const cells = { ...data.cells };
  const run = ["M", "M", "A", "A", "N"];
  for (const id of new Set(offs.map((r) => r.staffId))) {
    const fixed = new Set(offs.filter((r) => r.staffId === id).flatMap((r) => r.days));
    let worked = 0;
    for (const date of Object.keys(cells).sort()) {
      if (cells[date][id] === undefined) continue;
      const [y, m, d] = date.split("-").map(Number);
      const off = fixed.has(new Date(y, m - 1, d).getDay());
      cells[date] = { ...cells[date], [id]: off ? "OFF" : run[Math.min(worked, run.length - 1)] };
      worked = off ? 0 : worked + 1;
    }
  }
  return { ...data, cells };
}
