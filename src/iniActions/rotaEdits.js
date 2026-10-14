/* ─────────────── Ini's actions: changes to the rota ───────────────
   set_code         { staffId, start, end, codeId, code }
   clear_days       { staffId, start, end }
   swap_duties      { staffA, staffB, start, end }
   set_non_official { start, end, nonOfficial }

   Each works out a plan first — what every day becomes, and which days are
   skipped and why — and both the checklist warnings and the save come from
   that one plan, so what the manager reads is what gets written.

   Days a person is on recorded leave are skipped: the rota grid hides the
   cell under the leave band, so anything written there could not be seen.
   Days outside their employment are skipped too: the grid greys them out.

   A cell is a plain code id or a list of duties, each with an optional
   post. Writing a code does what tapping a cell does: the duty is
   replaced, the first duty's post stays, and a second duty goes. A swap
   moves the whole cell, posts and second duties included. Notes and
   "changed duty" marks (cellMeta) are left exactly as they are.

   Marking non-official days follows tapping a date header in
   DutyRotaOriginal.js (toggleNonOfficial): a Friday cannot be changed while
   the Friday rule is on, because every Friday already counts. */

import { entriesOf } from "../rotaCounts";
import { employedOn } from "../rosterConfig";
import { MAX_DAYS, daysIn } from "../monthBuild";
import {
  isISO, parseISO, rangeLabel, withWeekday, plural, listWords, staffOf, leaveOn, leaveName,
  REQUEST_LABEL, SHIFT_LABELS,
} from "./shared";

/* ── Reading the rota ── */
const pad2 = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const datesFrom = (start, end) => {
  const out = [];
  for (let d = parseISO(start); iso(d) <= end; d.setDate(d.getDate() + 1)) out.push(iso(d));
  return out;
};
const okRange = (a) => isISO(a.start) && isISO(a.end) && a.start <= a.end && daysIn(a.start, a.end) <= MAX_DAYS;

const rawCell = (data, date, sid) => (data.cells?.[date] || {})[sid];
const codeOf = (data, id) => (data.codes || []).find((c) => c.id === id) || null;
const codeText = (data, id) => codeOf(data, id)?.code || "a deleted code";
const postName = (data, id) => (data.posts || []).find((p) => p.id === id)?.name || "";
// "M", "M at Front Gate + E", or "empty".
const cellWords = (data, raw) => {
  const e = entriesOf(raw);
  if (!e.length) return "empty";
  return e.map((x) => {
    const post = x.post ? postName(data, x.post) : "";
    return post ? `${codeText(data, x.code)} at ${post}` : codeText(data, x.code);
  }).join(" + ");
};
const sameCell = (a, b) => JSON.stringify(entriesOf(a)) === JSON.stringify(entriesOf(b));
const copyCell = (raw) => (Array.isArray(raw) ? raw.map((e) => ({ ...e })) : raw);

// Why this person's day cannot be touched, or "".
const skipReason = (person, date) => {
  if (!employedOn(person, date)) return "not employed here then";
  const lp = leaveOn(person, date);
  return lp ? `on ${leaveName(lp).toLowerCase()}` : "";
};
const approvedOn = (data, sid, date) =>
  (data.dutyRequests || []).find((r) => r.approved && r.staffId === sid && r.date === date) || null;

// "Tue 3 Nov, Wed 4 Nov and 2 more"
const someDays = (dates) => {
  const words = dates.slice(0, 3).map(withWeekday);
  if (dates.length > 3) words.push(`${dates.length - 3} more`);
  return listWords(words);
};
// One warning per reason: "skips Wed 11 Nov and Thu 12 Nov — Ali is on annual leave"
const skipWarnings = (skipped) => {
  const by = {};
  skipped.forEach(({ date, why }) => { (by[why] = by[why] || []).push(date); });
  return Object.entries(by).map(([why, dates]) => `skips ${someDays(dates)} — ${why}, so ${dates.length === 1 ? "that day is" : "those days are"} left alone`);
};
// Days a ticked line above this one already changes for this person.
const changedAbove = (data, sim, sid, dates) =>
  dates.filter((d) => rawCell(data, d, sid) !== rawCell(sim, d, sid));

/* Writes into the draft without changing any object it was given:
   d.cells and each touched day are new objects. null empties the cell. */
const writeCells = (d, writes) => {
  if (!writes.length) return d;
  const cells = { ...(d.cells || {}) };
  const copied = new Set();
  writes.forEach(({ date, sid, value }) => {
    if (!copied.has(date)) { cells[date] = { ...(cells[date] || {}) }; copied.add(date); }
    if (value == null) delete cells[date][sid];
    else cells[date][sid] = value;
  });
  d.cells = cells;
  return d;
};

/* ── set_code ── */
const planSetCode = (l, data) => {
  const person = staffOf(data, l.staffId);
  const writes = [], skipped = [], same = [], replaced = [], dropped = [], requests = [];
  const code = codeOf(data, l.codeId);
  datesFrom(l.start, l.end).forEach((date) => {
    const why = skipReason(person, date);
    if (why) { skipped.push({ date, why: `${person.name} is ${why}` }); return; }
    const before = rawCell(data, date, l.staffId);
    const e = entriesOf(before);
    if (e.length === 1 && e[0].code === l.codeId) { same.push(date); return; }
    if (e.length) replaced.push({ date, was: cellWords(data, [e[0]]) });
    if (e.length > 1) dropped.push({ date, was: cellWords(data, e.slice(1)) });
    const post = e[0]?.post || "";
    writes.push({ date, sid: l.staffId, before, value: post ? [{ code: l.codeId, post }] : l.codeId });
    const r = approvedOn(data, l.staffId, date);
    if (r && r.category !== (code && code.counts)) requests.push({ date, r });
  });
  return { writes, skipped, same, replaced, dropped, requests };
};

export const setCode = {
  type: "set_code",
  group: "rota",
  people: ["staffId"],
  savedAs: "rota",
  saved: (n) => plural(n, "change to the rota", "changes to the rota"),

  fromServer: (a) => (okRange(a) && typeof a.codeId === "string" && a.codeId
    ? { staffId: a.staffId, start: a.start, end: a.end, codeId: a.codeId, code: String(a.code || "") }
    : null),
  span: (l) => [l.start, l.end],
  describe: (l, { sim }) => {
    const c = codeOf(sim, l.codeId);
    const what = c ? (c.label ? `${c.code} (${c.label})` : c.code) : (l.code || "A code");
    const p = staffOf(sim, l.staffId) ? planSetCode(l, sim) : null;
    return {
      what, when: rangeLabel(l.start, l.end), detailsLabel: "Show the days",
      details: p ? datesFrom(l.start, l.end).map((date) => {
        const sk = p.skipped.find((x) => x.date === date);
        if (sk) return `${withWeekday(date)}: skipped — ${sk.why}`;
        if (p.same.includes(date)) return `${withWeekday(date)}: already ${c ? c.code : l.code}`;
        return `${withWeekday(date)}: ${cellWords(sim, rawCell(sim, date, l.staffId))} → ${c ? c.code : l.code}`;
      }) : [],
    };
  },

  check: (l, { data, sim }) => {
    const code = codeOf(sim, l.codeId);
    if (!code) return { blocked: `${l.code || "This code"} is no longer one of this department's codes, so this cannot be added.` };
    const p = planSetCode(l, sim);
    const warnings = [];
    if (p.replaced.length) {
      warnings.push(`replaces what is already there on ${plural(p.replaced.length, "day")}: ${listWords(p.replaced.slice(0, 3).map((x) => `${x.was} (${withWeekday(x.date)})`))}${p.replaced.length > 3 ? ` and ${p.replaced.length - 3} more` : ""}`);
    }
    p.dropped.forEach((x) => warnings.push(`removes the second duty (${x.was}) on ${withWeekday(x.date)}`));
    p.requests.forEach(({ date, r }) => warnings.push(`has an approved request for ${(REQUEST_LABEL[r.category] || r.category).toLowerCase()} on ${withWeekday(date)}`));
    const only = (data.rosterRules?.staffShifts || {})[l.staffId];
    if (only?.length && SHIFT_LABELS[code.counts] && !only.includes(code.counts)) {
      warnings.push(`only set up for ${only.map((x) => SHIFT_LABELS[x]).join(" and ")} duties in Smart Roster`);
    }
    const above = changedAbove(data, sim, l.staffId, p.writes.map((w) => w.date));
    if (above.length) warnings.push(`a line above also changes ${someDays(above)}`);
    warnings.push(...skipWarnings(p.skipped));
    if (!p.writes.length) {
      return { blocked: p.skipped.length ? `Nothing to change: every day is skipped.` : `Already ${code.code} on every one of these days.`, warnings };
    }
    return { warnings };
  },

  apply: (d, l) => writeCells(d, codeOf(d, l.codeId) && staffOf(d, l.staffId) ? planSetCode(l, d).writes : []),
};

/* ── clear_days ── */
const LEAVE_CATS = ["sl", "frl", "ml", "leave"];
const planClear = (l, data) => {
  const person = staffOf(data, l.staffId);
  const writes = [], skipped = [], leaveCodes = [], requests = [];
  datesFrom(l.start, l.end).forEach((date) => {
    const why = skipReason(person, date);
    const before = rawCell(data, date, l.staffId);
    if (!entriesOf(before).length) return;            // already empty
    if (why) { skipped.push({ date, why: `${person.name} is ${why}` }); return; }
    writes.push({ date, sid: l.staffId, before, value: null });
    const kept = entriesOf(before).map((e) => codeOf(data, e.code)).find((c) => c && LEAVE_CATS.includes(c.counts));
    if (kept) leaveCodes.push({ date, code: kept });
    const r = approvedOn(data, l.staffId, date);
    if (r) requests.push({ date, r });
  });
  return { writes, skipped, leaveCodes, requests };
};

export const clearDays = {
  type: "clear_days",
  group: "rota",
  people: ["staffId"],
  savedAs: "rota",
  saved: setCode.saved,

  fromServer: (a) => (okRange(a) ? { staffId: a.staffId, start: a.start, end: a.end } : null),
  span: (l) => [l.start, l.end],
  describe: (l, { sim }) => {
    const p = staffOf(sim, l.staffId) ? planClear(l, sim) : null;
    return {
      what: "Clear days", when: rangeLabel(l.start, l.end), detailsLabel: "Show the days",
      details: p ? p.writes.map((w) => `${withWeekday(w.date)}: ${cellWords(sim, w.before)} → empty`)
        .concat(p.skipped.map((x) => `${withWeekday(x.date)}: skipped — ${x.why}`)) : [],
    };
  },

  check: (l, { data, sim }) => {
    const p = planClear(l, sim);
    const warnings = [];
    p.leaveCodes.forEach(({ date, code }) => warnings.push(`removes ${code.code}${code.label ? ` (${code.label.toLowerCase()})` : ""} on ${withWeekday(date)}`));
    p.requests.forEach(({ date, r }) => warnings.push(`has an approved request for ${(REQUEST_LABEL[r.category] || r.category).toLowerCase()} on ${withWeekday(date)}`));
    const above = changedAbove(data, sim, l.staffId, p.writes.map((w) => w.date));
    if (above.length) warnings.push(`a line above also changes ${someDays(above)}`);
    warnings.push(...skipWarnings(p.skipped));
    if (!p.writes.length) {
      return { blocked: p.skipped.length ? "Nothing to clear: the only filled days are skipped." : "There is nothing on these days to clear.", warnings };
    }
    return { warnings };
  },

  apply: (d, l) => writeCells(d, staffOf(d, l.staffId) ? planClear(l, d).writes : []),
};

/* ── swap_duties ── */
const planSwap = (l, data) => {
  const a = staffOf(data, l.staffA), b = staffOf(data, l.staffB);
  const writes = [], skipped = [], days = [], requests = [];
  datesFrom(l.start, l.end).forEach((date) => {
    const ca = rawCell(data, date, a.id), cb = rawCell(data, date, b.id);
    if (sameCell(ca, cb)) return;                      // nothing would change
    const why = skipReason(a, date) ? `${a.name} is ${skipReason(a, date)}`
      : skipReason(b, date) ? `${b.name} is ${skipReason(b, date)}` : "";
    if (why) { skipped.push({ date, why }); return; }
    writes.push({ date, sid: a.id, value: entriesOf(cb).length ? copyCell(cb) : null });
    writes.push({ date, sid: b.id, value: entriesOf(ca).length ? copyCell(ca) : null });
    days.push({ date, a: cellWords(data, ca), b: cellWords(data, cb) });
    [a, b].forEach((p) => {
      const r = approvedOn(data, p.id, date);
      if (r) requests.push({ date, who: p.name, r });
    });
  });
  return { writes, skipped, days, requests, a, b };
};

export const swapDuties = {
  type: "swap_duties",
  group: "rota",
  people: ["staffA", "staffB"],
  savedAs: "rota",
  saved: setCode.saved,

  fromServer: (a) => (okRange(a) ? { staffA: a.staffA, staffB: a.staffB, start: a.start, end: a.end } : null),
  span: (l) => [l.start, l.end],
  describe: (l, { sim }) => {
    const ok = staffOf(sim, l.staffA) && staffOf(sim, l.staffB) && l.staffA !== l.staffB;
    const p = ok ? planSwap(l, sim) : null;
    return {
      what: "Swap duties", when: rangeLabel(l.start, l.end), detailsLabel: "Show the days",
      details: p ? p.days.map((x) => `${withWeekday(x.date)}: ${p.a.name} ${x.a} ↔ ${p.b.name} ${x.b}`)
        .concat(p.skipped.map((x) => `${withWeekday(x.date)}: skipped — ${x.why}`)) : [],
    };
  },

  check: (l, { data, sim }) => {
    if (l.staffA === l.staffB) return { blocked: "Choose two different people to swap." };
    const p = planSwap(l, sim);
    const warnings = [];
    p.requests.forEach(({ date, who, r }) => warnings.push(`${who} has an approved request for ${(REQUEST_LABEL[r.category] || r.category).toLowerCase()} on ${withWeekday(date)}`));
    const dates = p.days.map((x) => x.date);
    const above = [...new Set([...changedAbove(data, sim, l.staffA, dates), ...changedAbove(data, sim, l.staffB, dates)])].sort();
    if (above.length) warnings.push(`a line above also changes ${someDays(above)}`);
    warnings.push(...skipWarnings(p.skipped));
    if (!p.writes.length) {
      return { blocked: p.skipped.length ? "Nothing to swap: every day that differs is skipped." : `${p.a.name} and ${p.b.name} have the same duties on these days, so there is nothing to swap.`, warnings };
    }
    return { warnings };
  },

  apply: (d, l) => writeCells(d, staffOf(d, l.staffA) && staffOf(d, l.staffB) && l.staffA !== l.staffB ? planSwap(l, d).writes : []),
};

/* ── set_non_official ── */
const FRIDAY = 5;
const planNonOfficial = (l, data) => {
  const list = new Set(data.nonOfficial || []);
  const change = [], fridays = [];
  datesFrom(l.start, l.end).forEach((date) => {
    if (data.fridayRule && parseISO(date).getDay() === FRIDAY) { fridays.push(date); return; }
    if (list.has(date) !== l.nonOfficial) change.push(date);
  });
  return { change, fridays };
};

export const setNonOfficial = {
  type: "set_non_official",
  group: "rota",
  savedAs: "rota",
  saved: setCode.saved,

  fromServer: (a) => (okRange(a) && typeof a.nonOfficial === "boolean"
    ? { start: a.start, end: a.end, nonOfficial: a.nonOfficial } : null),
  span: (l) => [l.start, l.end],
  describe: (l, { sim }) => {
    const n = datesFrom(l.start, l.end).length;
    const p = planNonOfficial(l, sim);
    return {
      what: l.nonOfficial ? `Mark as non-official ${n === 1 ? "day" : "days"}` : `No longer non-official`,
      when: rangeLabel(l.start, l.end),
      details: n > 1 ? p.change.map(withWeekday) : [],
    };
  },

  check: (l, { sim }) => {
    const p = planNonOfficial(l, sim);
    const warnings = ["changes how duty on these days is counted for non-official day payment"];
    if (p.fridays.length) {
      warnings.push(l.nonOfficial
        ? `${someDays(p.fridays)} already ${p.fridays.length === 1 ? "counts" : "count"}: every Friday is non-official while the Friday rule is on`
        : `${someDays(p.fridays)} stays non-official: every Friday is, while the Friday rule is on (Settings)`);
    }
    if (!p.change.length) {
      return { blocked: l.nonOfficial ? "These days are already non-official." : "None of these days is marked non-official.", warnings: p.fridays.length ? warnings.slice(1) : [] };
    }
    return { warnings };
  },

  apply: (d, l) => {
    const p = planNonOfficial(l, d);
    if (!p.change.length) return d;
    const set = new Set(d.nonOfficial || []);
    p.change.forEach((date) => (l.nonOfficial ? set.add(date) : set.delete(date)));
    d.nonOfficial = [...set].sort();
    return d;
  },
};
