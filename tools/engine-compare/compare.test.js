/* The engine in src against an older copy of itself (old/rosterEngine.js,
   written by run.js from a git ref), over the seeded wards in wards.js.
   Not part of the app's tests: run it with `node tools/engine-compare/run.js`.

   Everything counted here is counted from the finished rota, not read from
   the engine's report — and then the report is checked against the count. */

import * as oldE from "./old/rosterEngine";
import * as newE from "../../src/rosterEngine";
import { weekConfig } from "../../src/rosterConfig";
import { prepareMonth } from "../../src/monthBuild";
import { seededWard, SAME, RULES, withRules, fitHistory, addDays, days } from "./wards";

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
