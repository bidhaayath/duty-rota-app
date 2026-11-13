/* The engine in src against an older copy of itself (old/rosterEngine.js,
   written by run.js from a git ref), over the seeded wards in wards.js.
   Not part of the app's tests: run it with `node tools/engine-compare/run.js`.

   Everything counted here is counted from the finished rota, not read from
   the engine's report — and then the report is checked against the count. */

import * as oldE from "./old/rosterEngine";
import * as newE from "../../src/rosterEngine";
import { weekConfig } from "../../src/rosterConfig";
import { prepareMonth } from "../../src/monthBuild";
import {
  seededWard, SAME, RULES, withRules, fitHistory, addDays, days, erWard, withNightGap, erRealWard, thoiWard, withWeek,
  withInARowLevel, withoutPairs,
} from "./wards";

const fs = require("fs");
const path = require("path");

const JOB = process.env.EC_JOB || "";
const OUT = process.env.EC_OUT || "";
const [PART, OF] = (process.env.EC_PART || "0/1").split("/").map(Number);
const SAME_WEEKS = Number(process.env.EC_SAME_WEEKS || 126);
const RULE_WEEKS = Number(process.env.EC_RULE_WEEKS || 63);
const MONTHS = ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]
  .slice(0, Number(process.env.EC_MONTHS || 6));
const SHIFTS = ["morning", "afternoon", "evening", "night"];
const DAY_TYPES = ["offOn", "onlyOn"];

// Counted in steps only, so a busy machine cannot change an answer.
const steady = (cfg) => ({ ...cfg, polishMaxMs: 1e9 });
const save = (name, value) => {
  if (OUT) fs.writeFileSync(path.join(OUT, `${name}-${PART}.json`), JSON.stringify(value));
};
const only = (job) => (JOB === job ? test : test.skip);

/* ── Counting, from the cells alone ── */
const catOfCode = (cfg) => {
  const m = {}; (cfg.codes || []).forEach((c) => { m[c.code] = c.counts; }); return m;
};
function recount(cfg, out) {
  const dates = days(cfg.from, Math.round((new Date(cfg.to) - new Date(cfg.from)) / 86400000) + 1);
  const staff = cfg.staff.filter((s) => !(cfg.skipStaff || []).includes(s.id));
  const cells = out.cells;
  const on = (date, sh) => staff.reduce((n, s) => n + (cells[`${s.id}|${date}`] === sh ? 1 : 0), 0);
  const cats = catOfCode(cfg);
  const before = (id, date) => {
    const y = addDays(date, -1);
    return cells[`${id}|${y}`] ?? cats[cfg.history?.cells?.[`${id}|${y}`]];
  };
  const asked = new Set((cfg.requests || []).map((r) => `${r.staffId}|${r.date}`));
  const rules = (cfg.sequenceRules || []).filter((r) => r.enabled !== false);
  const barredAfter = (y, sh) => rules.some((r) => r.type === "never" && r.after === y && r.then === sh)
    && !rules.some((r) => r.type === "can" && r.after === y && r.then === sh);
  const weekStart = (date) => {
    const [y, m, d] = date.split("-").map(Number);
    const x = new Date(y, m - 1, d);
    return addDays(date, -((((x.getDay() - (cfg.weekStartsOn ?? 0)) % 7) + 7) % 7));
  };
  const dow = (date) => { const [y, m, d] = date.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };

  let uncovered = 0, aboveMost = 0;
  const gaps = [];
  for (const date of dates) {
    for (const sh of SHIFTS) {
      const min = cfg.coverage?.[sh]?.min || 0, max = cfg.coverage?.[sh]?.max;
      const n = on(date, sh);
      if (n < min) { uncovered += min - n; gaps.push({ date, shift: sh }); }
      if (max != null && n > max) aboveMost += 1;
    }
  }

  // Day rules that can be read, as the screen will save them.
  const dayRules = (cfg.personRules || []).filter((r) => r && DAY_TYPES.includes(r.type)
    && Array.isArray(r.days) && r.days.length && r.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    && (r.type === "offOn" || (Array.isArray(r.shifts) && r.shifts.length && r.shifts.every((x) => SHIFTS.includes(x)))));
  const ruleOn = (id, date, type) => dayRules.filter((r) => String(r.staffId) === String(id)
    && r.type === type && r.days.includes(dow(date))).pop();

  // Days a day rule was not kept.
  const misses = [];
  for (const s of staff) {
    for (const date of dates) {
      const cat = cells[`${s.id}|${date}`];
      if (cat == null || cat === "off") continue;
      const off = ruleOn(s.id, date, "offOn"), few = ruleOn(s.id, date, "onlyOn");
      if (off) misses.push(`${s.id}|${date}|offOn|${off.strength === "hard" ? "hard" : "soft"}`);
      else if (few && !few.shifts.includes(cat)) misses.push(`${s.id}|${date}|onlyOn|${few.strength === "hard" ? "hard" : "soft"}`);
    }
  }

  // Who a gap should name: a Must day rule that stood in the way.
  const names = [];
  for (const { date, shift } of gaps) {
    const week = dates.filter((d) => weekStart(d) === weekStart(date));
    for (const s of staff) {
      const key = `${s.id}|${date}`;
      const now = cells[key];
      if (now == null || now === shift || asked.has(key)) continue;
      const ticks = cfg.staffShifts?.[s.id];
      if (ticks && ticks.length && !ticks.includes(shift)) continue;
      const off = ruleOn(s.id, date, "offOn"), few = ruleOn(s.id, date, "onlyOn");
      if (now === "off" && off && off.strength === "hard") {
        if (!barredAfter(before(s.id, date), shift)) names.push(`${date}|${shift}|${s.id}|offOn`);
        continue;
      }
      if (off || !few || few.strength !== "hard" || few.shifts.includes(shift)) continue;
      if (now === "off") {
        const dMax = cfg.weeklyDuties?.max;
        const worked = week.filter((d) => { const c = cells[`${s.id}|${d}`]; return c && c !== "off"; }).length;
        if (dMax != null && worked >= dMax) continue;
      } else if (on(date, now) <= (cfg.coverage?.[now]?.min || 0)) continue;
      names.push(`${date}|${shift}|${s.id}|onlyOn`);
    }
  }

  /* Whole weeks of somebody always off on certain days, with no leave and
     no request of theirs in the week: are the fixed days off, and is that
     all the off days there are? */
  const fixed = { weeks: 0, fixedDaysWorked: 0, weeksWithExtraOff: 0, weeksShortOfDuties: 0 };
  const wardMost = cfg.weeklyPerStaff?.offMax, wardFewest = cfg.weeklyDuties?.min;
  for (const s of staff) {
    const mine = dayRules.filter((r) => String(r.staffId) === String(s.id) && r.type === "offOn");
    if (!mine.length) continue;
    const fixedDays = new Set(mine.flatMap((r) => r.days));
    for (const wk of [...new Set(dates.map(weekStart))]) {
      const week = dates.filter((d) => weekStart(d) === wk);
      if (week.length !== 7) continue;
      if (week.some((d) => cells[`${s.id}|${d}`] == null || asked.has(`${s.id}|${d}`))) continue;
      fixed.weeks += 1;
      const offs = week.filter((d) => cells[`${s.id}|${d}`] === "off").length;
      fixed.fixedDaysWorked += week.filter((d) => fixedDays.has(dow(d)) && cells[`${s.id}|${d}`] !== "off").length;
      if (wardMost != null && offs > Math.max(wardMost, fixedDays.size)) fixed.weeksWithExtraOff += 1;
      if (wardFewest != null && 7 - offs < Math.min(wardFewest, 7 - fixedDays.size)) fixed.weeksShortOfDuties += 1;
    }
  }

  return { uncovered, aboveMost, misses: misses.sort(), names: names.sort(), fixed };
}

// What the engine's own report says about the same things.
function reported(out) {
  const misses = out.report.relaxations
    .filter((r) => r.personal && DAY_TYPES.includes(r.ruleType))
    .map((r) => `${r.staffId}|${r.date}|${r.ruleType}|${r.strength}`).sort();
  const names = out.report.shortfalls.flatMap((g) => (g.because || [])
    .filter((b) => DAY_TYPES.includes(b.rule.type))
    .map((b) => `${g.date}|${g.shift}|${b.staffId}|${b.rule.type}`)).sort();
  const uncovered = out.report.shortfalls.reduce((n, g) => n + g.needed, 0);
  return { misses, names, uncovered };
}

const timed = (engine, cfg) => {
  const began = Date.now();
  const out = engine.generateRoster(cfg);
  return { out, ms: Date.now() - began };
};

/* ── Lists that must change nothing ── */
function sameRun(tally, label, lists, configOf) {
  const texts = {};
  for (const [name, list] of Object.entries(lists)) {
    const cfg = steady(configOf(list));
    const a = JSON.stringify(oldE.generateRoster(cfg));
    const b = JSON.stringify(newE.generateRoster(cfg));
    texts[name] = b;
    const t = tally[`${label} / ${name}`] || (tally[`${label} / ${name}`] = { runs: 0, different: 0 });
    t.runs += 1;
    if (a !== b) t.different += 1;
  }
  // With nothing the engine can act on, the answer is the one no list gives.
  for (const [name, like] of [["empty", "absent"], ["unreadable", "absent"], ["departed", "absent"],
    ["stageOneAndUnreadable", "stageOne"]]) {
    const t = tally[`${label} / ${name} = ${like}`] || (tally[`${label} / ${name} = ${like}`] = { runs: 0, different: 0 });
    t.runs += 1;
    if (texts[name] !== texts[like]) t.different += 1;
  }
}

only("same-weeks")("weeks: lists that must change nothing", () => {
  const tally = {};
  for (let seed = 1; seed <= SAME_WEEKS; seed++) {
    if (seed % OF !== PART) continue;
    const { data, start } = seededWard(seed);
    sameRun(tally, "week", SAME(seed, data.staff), (list) => weekConfig(withRules(data, list), start));
  }
  save("same-weeks", tally);
}, 7200000);

only("same-months")("months: lists that must change nothing", () => {
  const tally = {};
  MONTHS.forEach((month, i) => {
    if (i % OF !== PART) return;
    const first = `${month}-01`;
    const { data } = seededWard(500 + i, { from: first, historyDays: 35, span: 28 });
    // A few duties already on the rota, so "keep" has something to keep.
    data.cells[addDays(first, 3)] = { [data.staff[0].id]: "N", [data.staff[1].id]: "SL" };
    data.cells[addDays(first, 12)] = { [data.staff[2].id]: "M" };
    sameRun(tally, "month", SAME(500 + i, data.staff), (list) => prepareMonth({
      data: withRules(data, list), month, lookFrom: addDays(first, -28), keepExisting: i % 2 === 0,
      lockedStaffIds: i === 3 ? [data.staff[4].id] : [],
    }).config);
  });
  save("same-months", tally);
}, 7200000);

/* ── Rules that are measured ── */
only("rules")("weeks with rules set: old and new, counted from the finished rota", () => {
  const tally = {};
  for (let seed = 1; seed <= RULE_WEEKS; seed++) {
    if (seed % OF !== PART) continue;
    const { data, start } = seededWard(seed);
    for (const [name, list] of Object.entries(RULES(seed, data.staff))) {
      const cfg = steady(weekConfig(fitHistory(withRules(data, list)), start));
      const a = timed(oldE, cfg), b = timed(newE, cfg);
      const t = tally[name] || (tally[name] = {
        weeks: 0, refused: 0, sameText: 0, old: { uncovered: 0, aboveMost: 0, ms: 0, weekMs: [] },
        new: { uncovered: 0, aboveMost: 0, ms: 0, weekMs: [], tryMissed: 0, mustMissed: 0, gapsNamed: 0 },
        fixed: { weeks: 0, fixedDaysWorked: 0, weeksWithExtraOff: 0, weeksShortOfDuties: 0 },
        reportDisagrees: [],
      });
      t.weeks += 1;
      if (!b.out.ok || !a.out.ok) { t.refused += 1; continue; }
      if (JSON.stringify(a.out) === JSON.stringify(b.out)) t.sameText += 1;
      const ca = recount(cfg, a.out), cb = recount(cfg, b.out), said = reported(b.out);
      t.old.uncovered += ca.uncovered; t.old.aboveMost += ca.aboveMost; t.old.ms += a.ms;
      t.new.uncovered += cb.uncovered; t.new.aboveMost += cb.aboveMost; t.new.ms += b.ms;
      t.old.weekMs.push(a.ms); t.new.weekMs.push(b.ms);
      t.new.tryMissed += cb.misses.filter((m) => m.endsWith("soft")).length;
      t.new.mustMissed += cb.misses.filter((m) => m.endsWith("hard")).length;
      t.new.gapsNamed += cb.names.length;
      Object.keys(t.fixed).forEach((k) => { t.fixed[k] += cb.fixed[k]; });
      if (said.uncovered !== cb.uncovered || said.misses.join() !== cb.misses.join()
          || said.names.join() !== cb.names.join()) {
        t.reportDisagrees.push({ seed, counted: { ...cb, fixed: undefined }, said });
      }
    }
  }
  save("rules", tally);
}, 7200000);

/* ── The strength keys of stage 2b ──
   Each key at a level of its own, against the same week built without it.
   Both are built by the engine in src: a ward without the key is proven to
   build exactly as main (the same-weeks job), and the old engine already
   honours singleOffDays, so it could not stand in for "without" there.
   The in-charge runs use the seeded ward with an in-charge asked for on
   Mornings and Nights and every third person able to take charge; two of
   the days-in-a-row runs use it with working days in a row set to 3. */
const LEVEL = {
  must: { state: "hard", priority: 1 }, protectMost: { state: "soft", priority: 1 },
  protect: { state: "soft", priority: 2 }, bendFirst: { state: "soft", priority: 4 },
  ignore: { state: "disabled", priority: 1 },
};
const withStates = (data, states) => ({
  ...data, rosterRules: { ...data.rosterRules, ruleStates: { ...(data.rosterRules.ruleStates || {}), ...states } },
});
const withSeniors = (data) => ({
  ...data,
  rosterRules: {
    ...data.rosterRules,
    seniorStaff: data.staff.filter((_, i) => i % 3 === 0).map((s) => s.id),
    seniorCover: { morning: 1, afternoon: 0, evening: 0, night: 1 },
  },
});
const KEY_RUNS = [
  // name, which ward, the change, the measure it controls
  // At the seeded wards' 5 days a week rarely runs past; at 3, the key has something to hold.
  ["days in a row Must", "plain", (d) => withStates(d, { daysInRow: LEVEL.must }), "daysOver"],
  ["days in a row Ignore", "plain", (d) => withStates(d, { daysInRow: LEVEL.ignore }), "daysOver"],
  ["days in a row Must (3)", "tight", (d) => withStates(d, { daysInRow: LEVEL.must }), "daysOver"],
  ["days in a row Ignore (3)", "tight", (d) => withStates(d, { daysInRow: LEVEL.ignore }), "daysOver"],
  ["in-charge Must", "seniors", (d) => withStates(d, { seniors: LEVEL.must }), "noInCharge"],
  ["in-charge Protect", "seniors", (d) => withStates(d, { seniors: LEVEL.protect }), "noInCharge"],
  ["in-charge Bend first", "seniors", (d) => withStates(d, { seniors: LEVEL.bendFirst }), "noInCharge"],
  ["in-charge Ignore", "seniors", (d) => withStates(d, { seniors: LEVEL.ignore }), "noInCharge"],
  ["nights Protect most", "plain", (d) => withStates(d, { fairNights: LEVEL.protectMost }), "nightSpread"],
  ["nights Bend first", "plain", (d) => withStates(d, { fairNights: LEVEL.bendFirst }), "nightSpread"],
  ["nights Ignore", "plain", (d) => withStates(d, { fairNights: LEVEL.ignore }), "nightSpread"],
  ["non-official Protect most", "plain", (d) => withStates(d, { fairNonOfficial: LEVEL.protectMost }), "nonOfficialSpread"],
  ["non-official Bend first", "plain", (d) => withStates(d, { fairNonOfficial: LEVEL.bendFirst }), "nonOfficialSpread"],
  ["non-official Ignore", "plain", (d) => withStates(d, { fairNonOfficial: LEVEL.ignore }), "nonOfficialSpread"],
  ["off days together", "plain", (d) => ({ ...d, rosterRules: { ...d.rosterRules, singleOffDays: false } }), "offPairs"],
];

/* What each key controls, counted from the finished week:
     daysOver           days worked past "working days in a row"
     noInCharge         shift-days with fewer in-charge than the ward's numbers ask
     nightSpread        most Nights anyone had less the fewest
     nonOfficialSpread  the same, for duty on non-official days
     offPairs           off days straight after an off day                  */
function keyMeasures(cfg, out) {
  const dates = days(cfg.from, Math.round((new Date(cfg.to) - new Date(cfg.from)) / 86400000) + 1);
  const staff = cfg.staff.filter((s) => !(cfg.skipStaff || []).includes(s.id));
  const cell = (id, d) => out.cells[`${id}|${d}`];
  const limit = cfg.maxConsecutiveDays ?? 4;
  let daysOver = 0, offPairs = 0;
  const nights = [], nonOff = [];
  const nonOfficial = new Set(cfg.nonOfficialDates || []);
  for (const s of staff) {
    let run = 0, n = 0, no = 0;
    dates.forEach((d, i) => {
      const c = cell(s.id, d);
      run = c && c !== "off" ? run + 1 : 0;
      if (run > limit) daysOver += 1;
      if (c === "off" && i > 0 && cell(s.id, dates[i - 1]) === "off") offPairs += 1;
      if (c === "night") n += 1;
      if (c && c !== "off" && nonOfficial.has(d)) no += 1;
    });
    nights.push(n); nonOff.push(no);
  }
  const seniors = new Set((cfg.seniorStaff || []).map(String));
  let noInCharge = 0;
  for (const d of dates) {
    for (const sh of SHIFTS) {
      if ((cfg.coverage?.[sh]?.min || 0) <= 0) continue;
      const need = cfg.seniorCover?.[sh] || 0;
      const led = staff.filter((s) => cell(s.id, d) === sh && seniors.has(String(s.id))).length;
      if (led < need) noInCharge += need - led;
    }
  }
  const spread = (xs) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
  const { uncovered, aboveMost } = recount(cfg, out);
  return { uncovered, aboveMost, daysOver, noInCharge, nightSpread: spread(nights), nonOfficialSpread: spread(nonOff), offPairs };
}

only("keys")("strength keys: each at a level of its own, against the same week without it", () => {
  const tally = {};
  const blank = () => ({ uncovered: 0, aboveMost: 0, measure: 0, weekMs: [] });
  for (let seed = 1; seed <= RULE_WEEKS; seed++) {
    if (seed % OF !== PART) continue;
    const { data, start } = seededWard(seed);
    const wards = {
      plain: data, seniors: withSeniors(data),
      tight: { ...data, rosterRules: { ...data.rosterRules, maxDaysOn: 3 } },
    };
    const without = {};
    for (const [w, d] of Object.entries(wards)) {
      const cfg = steady(weekConfig(d, start));
      without[w] = { cfg, ...timed(newE, cfg) };
    }
    for (const [name, w, change, measure] of KEY_RUNS) {
      const cfg = steady(weekConfig(change(wards[w]), start));
      const run = timed(newE, cfg), base = without[w];
      const t = tally[name] || (tally[name] = {
        measure, weeks: 0, refusedWithout: 0, refusedWith: 0, sameCells: 0, without: blank(), with: blank(),
      });
      t.weeks += 1;
      if (!base.out.ok) t.refusedWithout += 1;
      if (!run.out.ok) t.refusedWith += 1;
      if (!base.out.ok || !run.out.ok) continue;
      if (JSON.stringify(run.out.cells) === JSON.stringify(base.out.cells)) t.sameCells += 1;
      const a = keyMeasures(base.cfg, base.out), b = keyMeasures(cfg, run.out);
      for (const [side, m, ms] of [["without", a, base.ms], ["with", b, run.ms]]) {
        t[side].uncovered += m.uncovered; t[side].aboveMost += m.aboveMost; t[side].measure += m[measure];
        t[side].weekMs.push(ms);
      }
    }
  }
  save("keys", tally);
}, 7200000);

/* ── Whole months, measured ──
   Each month ward (wards.js) built by both engines and counted from the
   finished cells, with the duties before the month read from its history:
     longRuns    runs of nights longer than the ward's "In a row" allows
                 (crossWeek: those running over the start of a week)
     dayRuns     the same for other shifts, leaving out anyone kept to one shift
     pairsSplit  whole weeks where someone's nights came in more separate runs
                 than pairs needed (a run running on past either end of the
                 build is left open: it may carry on there)
     halfPairs   half a pair not finished where it crosses into the next week:
                 a lone night on a week's last day, the next day here and not a
                 night — including a lone night just before the build
     shortGaps   night blocks starting fewer clear days after the last night
                 than the ward's gap (3 where the ward sets none, to show it)
     spread      per person over the month (or the weeks built), for nights,
                 mornings, afternoons: most less fewest, and the standard
                 deviation — counted over people here every day with no shift
                 ticks and no rule of their own about that shift
     uncovered, aboveMost, and the milliseconds the builds took.
   Two wards are also built week after week, as Smart Roster builds them,
   each week on the rota the last one left. */
const monthWards = () => {
  const list = MONTHS.map((month, i) => {
    const { data } = seededWard(700 + i, { from: `${month}-01`, historyDays: 35, span: 28 });
    data.rosterRules.blockTogether = { night: 2 };
    return { name: `seeded ${month}`, month, data };
  });
  list.push({ name: "ER 2026-12", month: "2026-12", data: erWard() });
  list.push({ name: "ER real 2026-12", month: "2026-12", data: erRealWard() });
  const level = ["", "Protect most", "Protect", "Bend if needed", "Bend first"];
  return [
    ...list, ...list.map((w) => ({ ...w, name: `${w.name} gap 3`, data: withNightGap(w.data, 3) })),
    // In a row at each level: what pairs cost in cover, level by level.
    ...[2, 3, 4].map((p) => ({ name: `ER real ${level[p]}`, month: "2026-12", data: withInARowLevel(erRealWard(), p) })),
    // Wards without pairs, which must build exactly as before.
    { name: "ER real no pairs", month: "2026-12", data: withoutPairs(erRealWard()) },
    ...list.filter((w) => w.name.startsWith("seeded")).slice(0, 2)
      .map((w) => ({ ...w, name: `${w.name} no pairs`, data: withoutPairs(w.data) })),
    { name: "ER real weeks x4", weeks: { from: "2026-12-06", n: 4 }, data: erRealWard() },
    { name: "thoi weeks x4", weeks: { from: "2026-11-15", n: 4 }, data: thoiWard() },
    { name: "thoi weeks x4 Protect", weeks: { from: "2026-11-15", n: 4 }, data: withInARowLevel(thoiWard(), 2) },
    { name: "thoi 2026-12 Protect", month: "2026-12", data: withInARowLevel(thoiWard(), 2) },
  ];
};

function measureMonth(cfg, cells, month, range = { from: cfg.from, to: cfg.to }) {
  const cats = catOfCode(cfg);
  const histOf = (id, date) => cats[cfg.history?.cells?.[`${id}|${date}`]];
  const catAt = (id, date) => cells[`${id}|${date}`] ?? histOf(id, date);
  const length = Math.round((new Date(range.to) - new Date(range.from)) / 86400000) + 1;
  const span = days(addDays(range.from, -21), length + 21);
  const builtList = days(range.from, length);
  const built = new Set(builtList);
  const inMonth = month ? builtList.filter((d) => d.startsWith(month)) : builtList;
  const staff = cfg.staff.filter((s) => !(cfg.skipStaff || []).includes(s.id));
  const isWeekStart = (date) => {
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y, m - 1, d).getDay() === (cfg.weekStartsOn ?? 0);
  };
  const gapWanted = cfg.nightBlockGap || 3;
  const pairN = cfg.blockTogether?.night;
  let longRuns = 0, crossWeek = 0, shortGaps = 0, dayRuns = 0, pairsSplit = 0, halfPairs = 0;
  for (const s of staff) {
    for (const sh of SHIFTS) {
      const most = cfg.maxBlock?.[sh] ?? (sh === "night" ? 2 : 4);
      let run = 0, crossed = false, touchesBuilt = false;
      // Somebody kept to one shift has nothing else to break a run with: not counted.
      const single = (cfg.staffShifts?.[s.id] || []).length === 1;
      const close = () => {
        if (run <= most || !touchesBuilt) return;
        if (sh !== "night") { if (!single) dayRuns += 1; return; }
        longRuns += 1; if (crossed) crossWeek += 1;
      };
      for (const date of span) {
        if (catAt(s.id, date) === sh) {
          if (run > 0 && isWeekStart(date)) crossed = true;
          run += 1;
          if (built.has(date)) touchesBuilt = true;
        } else { close(); run = 0; crossed = false; touchesBuilt = false; }
      }
      close();
    }
    // Night blocks starting in the build, against the last night before them.
    let lastNight = null;
    span.forEach((date, i) => {
      const night = catAt(s.id, date) === "night";
      const startsBlock = night && catAt(s.id, span[i - 1]) !== "night";
      if (startsBlock && built.has(date) && lastNight != null && i - lastNight - 1 < gapWanted) shortGaps += 1;
      if (night) lastNight = i;
    });
    if (pairN > 1) {
      const N = (d) => catAt(s.id, d) === "night";
      // Whole weeks inside the build.
      builtList.filter(isWeekStart).forEach((wk) => {
        const week = days(wk, 7);
        if (!week.every((d) => built.has(d))) return;
        let count = 0, runs = 0;
        for (let i = 0; i < 7; i++) {
          if (!N(week[i])) continue;
          let j = i;
          while (j < 6 && N(week[j + 1])) j += 1;
          const next = addDays(week[6], 1);
          const open = (i === 0 && N(addDays(week[0], -1))) || (j === 6 && (!built.has(next) || N(next)));
          if (!open) { count += j - i + 1; runs += 1; }
          i = j;
        }
        if (runs > Math.ceil(count / pairN)) pairsSplit += runs - Math.ceil(count / pairN);
      });
      // A lone night on a week's last day (or just before the build), not carried on the next day although they are here.
      span.forEach((d) => {
        const next = addDays(d, 1);
        if (!isWeekStart(next) || !built.has(next) || cells[`${s.id}|${next}`] == null) return;
        if (N(d) && !N(addDays(d, -1)) && !N(next)) halfPairs += 1;
      });
    }
  }

  const own = new Set((cfg.personRules || []).filter(Boolean).map((r) => `${r.staffId}|${r.shift || "days"}`));
  const spread = {};
  for (const sh of ["night", "morning", "afternoon"]) {
    const counts = staff.filter((s) => !(cfg.staffShifts?.[s.id] || []).length
      && !own.has(`${s.id}|${sh}`) && !own.has(`${s.id}|days`)
      && inMonth.every((d) => cells[`${s.id}|${d}`] != null))
      .map((s) => inMonth.filter((d) => cells[`${s.id}|${d}`] === sh).length);
    if (counts.length < 2) { spread[sh] = { range: 0, sd: 0, people: counts.length }; continue; }
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const sd = Math.sqrt(counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length);
    spread[sh] = { range: Math.max(...counts) - Math.min(...counts), sd: Math.round(sd * 100) / 100, people: counts.length };
  }
  const { uncovered, aboveMost } = recount({ ...cfg, from: range.from, to: range.to }, { cells });
  return { longRuns, crossWeek, dayRuns, pairsSplit, halfPairs, shortGaps, spread, uncovered, aboveMost };
}

/* Weeks one after another, each built on the rota the last one left — as
   "Use this roster" leaves it. The first week's config holds the history. */
function buildWeeks(E, data, { from, n }) {
  let d = data, ms = 0;
  const cells = {};
  const first = steady(weekConfig(data, from));
  for (let k = 0; k < n; k++) {
    const cfg = steady(weekConfig(d, addDays(from, 7 * k)));
    const began = Date.now();
    const out = E.generateRoster(cfg);
    ms += Date.now() - began;
    if (!out.ok) return { refused: true, ms };
    Object.assign(cells, out.cells);
    d = withWeek(d, out.cells);
  }
  return { ...measureMonth(first, cells, null, { from, to: addDays(from, 7 * n - 1) }), ms, text: JSON.stringify(cells) };
}

only("month")("whole months: runs, pairs, gaps between night pairs, fairness, cover and time", () => {
  const rows = [];
  monthWards().forEach((w, i) => {
    if (i % OF !== PART) return;
    if (w.weeks) {
      const o = buildWeeks(oldE, w.data, w.weeks), n = buildWeeks(newE, w.data, w.weeks);
      rows.push({ name: w.name, same: o.text === n.text ? 1 : 0, old: { ...o, text: undefined }, new: { ...n, text: undefined } });
      return;
    }
    const cfg = steady(prepareMonth({ data: w.data, month: w.month, lookFrom: addDays(`${w.month}-01`, -28) }).config);
    const side = (E) => {
      const began = Date.now();
      const out = E.generateRoster(cfg);
      const ms = Date.now() - began;
      return out.ok ? { ...measureMonth(cfg, out.cells, w.month), ms, text: JSON.stringify(out.cells) } : { refused: true, ms };
    };
    const o = side(oldE), n = side(newE);
    rows.push({ name: w.name, same: o.text === n.text ? 1 : 0, old: { ...o, text: undefined }, new: { ...n, text: undefined } });
  });
  save("month", { rows });
}, 7200000);
