/* ─────────────── Ini action: build a whole month ───────────────
   One of Ini's actions. It prepares the engine configuration for a month,
   and turns the engine's answer into a list of cell writes plus a plain
   summary. Pure functions only: no React, nothing saved. Running the engine
   (in a background worker) lives in monthBuildRunner.js, and showing and
   applying the result in MonthPreview.js.

   The configuration is the one Smart Roster builds for a week
   (buildRosterConfig in rosterConfig.js), stretched over the month, with
   three additions — all expressed with things the engine already
   understands, so the engine itself is unchanged:

   1. Whole weeks. The engine only judges a weekly limit over a whole week,
      and does not count days before its first date toward that week. So a
      month starting on a Thursday is built from the start of that week to
      the end of the week holding the last day. The duties already on the
      rota on those extra days are LOCKED, so they count toward the week;
      empty extra days are planned and thrown away. Only the month itself is
      ever written. If last month's locked days make the engine refuse (a
      past day that was short of staff, say), the month is built on its own
      instead, and the summary says so.

   2. Keeping what is already there. With "keep duties already on the rota"
      ticked, every filled cell inside the month is locked too, and only
      empty days are filled.

   3. View-only staff (beyond the plan's staff limit) are locked for the
      whole month: their cells cannot be changed, so they are planned around
      exactly as they stand.

   How a cell is locked:
   - A duty or off day becomes an approved request for that category. The
     engine treats it as fixed, counts it toward the week, and the cell is
     never written — so its exact code, its post and any second duty stay.
   - Sick leave, family leave, medical leave, other leave and release duty
     are already left alone by the engine.
   - Anything the engine has no category for — an "Other duty" code, a code
     that has since been deleted, or an empty day for a view-only person —
     becomes a one-day absence. The engine leaves it alone and does not
     count it as a working day toward the weekly limits.                 */

import { SHIFTS, PRESERVE, checkFeasible, datesBetween, generateRoster, toRotaCells } from "./rosterEngine";
import {
  mergeRules, buildRosterConfig, activeStaffFor, employedOn, shiftISO, firstCodeIdOf,
  codeIdByText, chosenCodesFor,
} from "./rosterConfig";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad2 = (n) => String(n).padStart(2, "0");
const parseISO = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
export const prettyDay = (s) => { const d = parseISO(s); return `${d.getDate()} ${SHORT[d.getMonth()]}`; };
export const prettyWeekday = (s) => `${WEEKDAYS[parseISO(s).getDay()]} ${prettyDay(s)}`;

export const monthName = (month) => MONTHS[Number(month.split("-")[1]) - 1];
export const monthBounds = (month) => {
  const [y, m] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${pad2(new Date(y, m, 0).getDate())}` };
};
const monthStartBefore = (month, n) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 - n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
};
// How far `iso` is past the start of the ward's week (0–6).
const intoWeek = (iso, firstDay) => (((parseISO(iso).getDay() - firstDay) % 7) + 7) % 7;

/* ── How far back fairness looks ──
   "Usual" is Smart Roster's own setting, counted back from the 1st. The
   rest are fixed starting points. The look-back always ends on the last
   day before the month. */
export const lookbackOptions = (month, rosterRules, historyFrom) => {
  const { from } = monthBounds(month);
  const rules = mergeRules(rosterRules || {});
  const days = rules.lookbackDays || 0;
  const year = month.slice(0, 4);
  const out = [{
    id: "usual",
    label: days ? `Usual (last ${days} days)` : "Usual (no look-back)",
    from: days ? shiftISO(from, -days) : null,
  }];
  // Since 1 January means nothing when planning January itself.
  if (!month.endsWith("-01")) out.push({ id: "year", label: "Since 1 January", from: `${year}-01-01` });
  out.push({ id: "3m", label: "Last 3 months", from: monthStartBefore(month, 3) });
  out.push({ id: "6m", label: "Last 6 months", from: monthStartBefore(month, 6) });
  if (historyFrom && historyFrom < from && !out.some((o) => o.from === historyFrom)) {
    out.push({ id: "note", label: `From ${prettyDay(historyFrom)} ${historyFrom.slice(0, 4)} (your note)`, from: historyFrom });
  }
  return out;
};
// The option a note's look-back date selects: an existing one if it matches.
export const lookbackIdFor = (options, historyFrom) =>
  (historyFrom && options.find((o) => o.from === historyFrom)?.id) || "usual";

export const lookbackSentence = (option, month) => {
  if (!option || !option.from) return "Fairness does not look back at earlier rosters.";
  const lastDay = shiftISO(monthBounds(month).from, -1);
  const y1 = option.from.slice(0, 4), y2 = lastDay.slice(0, 4);
  return `Fairness based on rosters from ${prettyDay(option.from)}${y1 !== y2 ? ` ${y1}` : ""} to ${prettyDay(lastDay)}${y1 !== y2 ? ` ${y2}` : ""}.`;
};

/* ── The configuration ── */
const categoryOf = (data, raw) => {
  const id = firstCodeIdOf(raw);
  if (!id) return { empty: true };
  const code = (data.codes || []).find((c) => c.id === id);
  if (!code) return { cat: null };                    // a code since deleted
  return { cat: code.counts || null };
};
const onLeave = (person, date) =>
  (person.leavePeriods || []).some((lp) => date >= lp.start && date <= lp.end);

function configFor({ data, rules, from, to, monthFrom, monthTo, lookFrom, keepExisting, lockedStaff }) {
  const staff = activeStaffFor(data.staff, datesBetween(from, to));
  // History ends the day before the first day built; with no look-back it
  // is simply empty.
  const cfg = buildRosterConfig({
    data, rules, from, to, staff, lookFrom: lookFrom || from, lookTo: shiftISO(from, -1),
  });
  if (!lookFrom) cfg.history = { cells: {}, nonOfficialDates: [] };

  const skipped = new Set(rules.skipStaff || []);
  const pinned = {};              // "sid|date" -> category, fixed for the engine
  const blocked = new Set();      // "sid|date" kept by making the day an absence
  const blockDays = {};           // sid -> [dates]
  const rotaCells = data.cells || {};

  cfg.staff.forEach((s) => {
    if (skipped.has(s.id)) return;                     // the engine leaves them out anyway
    const lockAll = lockedStaff.has(s.id);
    for (const date of datesBetween(from, to)) {
      const inMonth = date >= monthFrom && date <= monthTo;
      if (inMonth && !keepExisting && !lockAll) continue;
      if (!employedOn(s, date) || onLeave(s, date)) continue;
      const key = `${s.id}|${date}`;
      const { empty, cat } = categoryOf(data, (rotaCells[date] || {})[s.id]);
      if (empty) {
        // An empty day is only locked for someone whose cells cannot change.
        if (lockAll && inMonth) { blocked.add(key); (blockDays[s.id] = blockDays[s.id] || []).push(date); }
        continue;
      }
      if (PRESERVE.includes(cat)) continue;           // already left alone by the engine
      if (cat === "off" || SHIFTS.includes(cat)) { pinned[key] = cat; continue; }
      blocked.add(key); (blockDays[s.id] = blockDays[s.id] || []).push(date);
    }
  });

  // Locked days the engine has no category for become one-day absences.
  cfg.staff = cfg.staff.map((s) => (blockDays[s.id]
    ? { ...s, leavePeriods: [...(s.leavePeriods || []),
      ...blockDays[s.id].map((d) => ({ id: `lock-${s.id}-${d}`, type: "other", start: d, end: d }))] }
    : s));

  // One request per person per day: a locked cell wins over an approved
  // request, because it is what is actually on the rota.
  const byKey = {};
  cfg.requests.forEach((r) => { byKey[`${r.staffId}|${r.date}`] = r; });
  Object.entries(pinned).forEach(([key, category]) => {
    const cut = key.lastIndexOf("|");
    byKey[key] = { staffId: key.slice(0, cut), date: key.slice(cut + 1), category };
  });
  cfg.requests = Object.values(byKey);
  return { cfg, pinned, blocked };
}

/* Everything the engine needs for one month, and what the result has to be
   checked against. `lockedStaffIds` are the view-only staff. */
export function prepareMonth({ data, month, lookFrom, keepExisting = true, lockedStaffIds = [] }) {
  const { from: monthFrom, to: monthTo } = monthBounds(month);
  const savedRules = mergeRules(data.rosterRules || {});
  const lockedStaff = new Set(lockedStaffIds);
  const firstDay = data.weekStartsOn ?? 0;
  const padFrom = shiftISO(monthFrom, -intoWeek(monthFrom, firstDay));
  const padTo = shiftISO(monthTo, 6 - intoWeek(monthTo, firstDay));

  const make = (from, to) => ({
    from, to,
    ...configFor({ data, rules: savedRules, from, to, monthFrom, monthTo, lookFrom, keepExisting, lockedStaff }),
  });

  let built = make(padFrom, padTo);
  let fellBack = false;
  const padded = padFrom !== monthFrom || padTo !== monthTo;
  if (padded) {
    // Only a refusal caused by the extra days outside the month falls back.
    const check = checkFeasible(built.cfg);
    const dated = (p) => /^\d{4}-\d{2}-\d{2}:/.test(p) ? p.slice(0, 10) : null;
    if (!check.ok && check.problems.every((p) => dated(p) && (dated(p) < monthFrom || dated(p) > monthTo))) {
      built = make(monthFrom, monthTo);
      fellBack = true;
    }
  }

  return {
    month, monthFrom, monthTo,
    buildFrom: built.from, buildTo: built.to,
    padded: padded && !fellBack, fellBack, keepExisting,
    config: built.cfg, pinned: built.pinned, blocked: built.blocked,
    lockedStaffIds: [...lockedStaff],
    chosenCodes: chosenCodesFor(savedRules, data.codes),
    fingerprint: monthFingerprint(data, built.from, built.to),
  };
}

/* What the build depended on. Compared again before Apply, so a rota that
   changed in the meantime is never overwritten with a month planned for a
   different one. */
export function monthFingerprint(data, from, to) {
  const cells = {};
  Object.keys(data.cells || {}).filter((d) => d >= from && d <= to).sort()
    .forEach((d) => { cells[d] = data.cells[d]; });
  return JSON.stringify({
    cells, staff: data.staff, codes: data.codes, rules: data.rosterRules,
    requests: data.dutyRequests, nonOfficial: data.nonOfficial,
    fridayRule: data.fridayRule, weekStartsOn: data.weekStartsOn,
  });
}

/* The engine run itself, the same in the background worker and in the
   fallback on the main page: the result, plus the cells in the ward's own
   codes, plus how long it took. */
export function runEngine(config, chosenCodes) {
  const began = Date.now();
  const res = generateRoster(config);
  if (!res.ok) return { ok: false, problems: res.problems, ms: Date.now() - began };
  return {
    ok: true,
    cells: res.cells,
    report: res.report,
    rotaCells: toRotaCells(res.cells, config.codes || [], res.nightRest, chosenCodes),
    ms: Date.now() - began,
  };
}

/* Plain words for the engine's refusal. Its messages about a crowded day
   talk about approved requests; inside this build, locked duties are
   requests too, so that is said. */
export const plainProblems = (prep, problems) => (problems || []).map((p) => {
  const m = /^(\d{4}-\d{2}-\d{2}): /.exec(p);
  if (!m) return p;
  const day = prettyWeekday(m[1]);
  return `${day}: the duties already on the rota${prep.keepExisting ? " (which you asked to keep)" : ""} and the ` +
    `approved requests leave too few people free to cover the day. ` +
    (prep.keepExisting ? `Untick "Keep duties already on the rota", or change that day by hand.` : `Change that day by hand, or lower the minimums.`);
});

/* ── The engine's answer, turned into writes and a summary ── */
const RULE_SORT = ["weekly duty maximum", "duty rule", "days in a row", "working pattern",
  "maximum off days", "minimum off days", "weekly duty minimum", "two off days together"];

export function finishMonth(prep, result, data) {
  const { monthFrom, monthTo, pinned, blocked, config } = prep;
  const inMonth = (d) => d >= monthFrom && d <= monthTo;
  const idByCode = codeIdByText(data.codes);
  const nameOf = {};
  (data.staff || []).forEach((s) => { nameOf[s.id] = s.name; });

  // Cells the engine owns inside the month, written only where they change.
  const writes = [];
  const missing = new Set();
  let replaced = 0, replacedSplit = 0;
  for (const [key, code] of Object.entries(result.rotaCells || {})) {
    const cut = key.lastIndexOf("|");
    const sid = key.slice(0, cut), date = key.slice(cut + 1);
    if (!inMonth(date) || pinned[key] || blocked.has(key)) continue;
    const id = idByCode[code];
    if (!id) { missing.add(code); continue; }
    const before = (data.cells?.[date] || {})[sid];
    if (typeof before === "string" && before === id) continue;
    if (firstCodeIdOf(before)) {
      replaced += 1;
      if (Array.isArray(before) && (before.length > 1 || before.some((e) => e && e.post))) replacedSplit += 1;
    }
    writes.push({ sid, date, id, code, before: before ?? null });
  }

  const report = result.report;
  const weekTouches = (wk) => wk <= monthTo && shiftISO(wk, 6) >= monthFrom;
  const shortfalls = report.shortfalls.filter((s) => inMonth(s.date));
  const seniorGaps = (report.seniorGaps || []).filter((s) => inMonth(s.date));

  // Rules bent, grouped, with where. Weekly ones name the person and week.
  const groups = {};
  report.relaxations.forEach((r) => {
    const weekly = r.staffId != null;
    if (weekly ? !weekTouches(r.date) : !inMonth(r.date)) return;
    const where = weekly
      ? `${nameOf[r.staffId] || "someone"} (week of ${prettyDay(r.date)})`
      : `${prettyWeekday(r.date)}${r.shift && r.shift !== "off" ? ` ${r.shift}` : ""}`;
    (groups[r.rule] = groups[r.rule] || []).push(where);
  });
  const bent = Object.entries(groups)
    .map(([rule, places]) => ({ rule, places: [...new Set(places)] }))
    .sort((a, b) => {
      const ia = RULE_SORT.indexOf(a.rule), ib = RULE_SORT.indexOf(b.rule);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || b.places.length - a.places.length;
    });

  // Weeks inside the month that are short of duties on paper.
  const shortWeeks = (report.budget || []).filter((w) => w.spare < 0 && weekTouches(w.week))
    .map((w) => ({ week: w.week, needed: w.dutiesNeeded, available: w.dutiesAvailable }));

  /* Fairness over the month alone — not the extra days, and not history —
     for everyone the engine rostered on at least one day of it. */
  const nonOff = new Set(config.nonOfficialDates || []);
  const tally = {};
  for (const [key, cat] of Object.entries(result.cells || {})) {
    const cut = key.lastIndexOf("|");
    const sid = key.slice(0, cut), date = key.slice(cut + 1);
    if (!inMonth(date)) continue;
    const t = tally[sid] || (tally[sid] = { night: 0, fridayOff: 0, nonOfficial: 0, duties: 0 });
    if (cat === "night") t.night += 1;
    if (cat === "off" && parseISO(date).getDay() === 5) t.fridayOff += 1;
    if (cat !== "off") { t.duties += 1; if (nonOff.has(date)) t.nonOfficial += 1; }
  }
  const spread = (key) => {
    const rows = Object.entries(tally);
    if (!rows.length) return null;
    const vals = rows.map(([, t]) => t[key]);
    const min = Math.min(...vals), max = Math.max(...vals);
    return {
      min, max,
      fewest: rows.filter(([, t]) => t[key] === min).map(([id]) => nameOf[id]).filter(Boolean),
      most: rows.filter(([, t]) => t[key] === max).map(([id]) => nameOf[id]).filter(Boolean),
    };
  };

  return {
    month: prep.month, monthFrom, monthTo,
    padded: prep.padded, fellBack: prep.fellBack, keepExisting: prep.keepExisting,
    lockedStaffIds: prep.lockedStaffIds, skipStaff: config.skipStaff || [],
    writes, missing: [...missing], replaced, replacedSplit,
    keptCount: Object.keys(pinned).filter((k) => inMonth(k.slice(-10))).length
      + [...blocked].filter((k) => inMonth(k.slice(-10))).length,
    shortfalls, seniorGaps, bent, shortWeeks,
    fairness: {
      nights: spread("night"), fridayOff: spread("fridayOff"),
      nonOfficial: spread("nonOfficial"), duties: spread("duties"),
    },
    fingerprint: prep.fingerprint, buildFrom: prep.buildFrom, buildTo: prep.buildTo,
  };
}
