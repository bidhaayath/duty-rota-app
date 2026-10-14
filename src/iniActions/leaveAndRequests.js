/* ─────────────── Ini's actions: leave and duty requests ───────────────
   add_leave   { staffId, leaveType, start, end }
   add_request { staffId, date, duty }     saved approved
   weekly_off  { staffId, weekdays, start, end }
               one line; saved as an approved off request on every matching
               date (0 = Sunday). Dates that already have a request, that the
               person is on leave, or outside their employment, are skipped.

   The shapes they save match the Staff tab and RequestsTab.add exactly.
   The checks on a duty request repeat the ones in RequestsTab.js
   (issuesFor and the clash check in add). They are copied rather than
   shared so that tab did not have to change. If one set of checks
   changes, change the other to match. */

import { entriesOf } from "../rotaCounts";
import { employedOn } from "../rosterConfig";
import { MAX_DAYS, daysIn } from "../monthBuild";
import { datesFrom } from "./rotaEdits";
import {
  isISO, parseISO, rangeLabel, withWeekday, plural, listWords, staffOf, leaveOn, leaveName,
  LEAVE_LABEL, DUTIES, REQUEST_LABEL, SHIFT_LABELS, WEEKDAYS,
} from "./shared";

export const addLeave = {
  type: "add_leave",
  group: "leave",
  order: 1,
  people: ["staffId"],
  // Saving the Staff tab's form afterwards would remove the leave.
  tabNote: {
    staff: "If a staff member's details are open on the Staff tab, close that form without saving first. " +
      "Saving it afterwards would remove the leave Ini adds.",
  },
  saved: (n) => plural(n, "leave period"),

  fromServer: (a) => {
    if (!isISO(a.start) || !isISO(a.end) || a.end < a.start) return null;
    return { staffId: a.staffId, leaveType: LEAVE_LABEL[a.leaveType] ? a.leaveType : "other", start: a.start, end: a.end };
  },
  span: (l) => [l.start, l.end],
  describe: (l) => ({ what: LEAVE_LABEL[l.leaveType] || "Leave", when: rangeLabel(l.start, l.end) }),

  check: (l, { data, sim }) => {
    const warnings = [];
    const recorded = staffOf(data, l.staffId)?.leavePeriods || [];
    const ids = new Set(recorded.map((p) => p.id));
    const overlaps = (p) => p.start <= l.end && p.end >= l.start;
    recorded.filter(overlaps).forEach((p) => {
      warnings.push(`overlaps ${leaveName(p).toLowerCase()} already recorded (${rangeLabel(p.start, p.end)})`);
    });
    if ((staffOf(sim, l.staffId)?.leavePeriods || []).some((p) => !ids.has(p.id) && overlaps(p))) {
      warnings.push("overlaps leave in a line above");
    }
    return { warnings };
  },

  apply: (d, l, { uid }) => {
    d.staff = (d.staff || []).map((s) => (s.id === l.staffId
      ? { ...s, leavePeriods: [...(s.leavePeriods || []), { type: l.leaveType, start: l.start, end: l.end, id: uid() }] }
      : s));
    return d;
  },
};

export const addRequest = {
  type: "add_request",
  group: "leave",
  order: 2,
  people: ["staffId"],
  footnote: "Requests you add here are marked approved, so Smart Roster will honour them.",
  opensRequests: true,
  saved: (n) => plural(n, "duty request"),

  fromServer: (a) => {
    if (!isISO(a.date) || !DUTIES.includes(a.duty)) return null;
    return { staffId: a.staffId, date: a.date, category: a.duty };
  },
  span: (l) => [l.date, l.date],
  describe: (l) => ({ what: REQUEST_LABEL[l.category] || l.category, when: withWeekday(l.date) }),

  check: (l, { data, sim }) => {
    const who = staffOf(sim, l.staffId);
    const same = (r) => r.staffId === l.staffId && r.date === l.date;
    // The clash check from RequestsTab.add: one request per person per date.
    if ((data.dutyRequests || []).some(same)) {
      return { blocked: `${who.name} already has a request on this date, so this one cannot be added. Delete that one on the Duty Requests tab first if you want to change it.` };
    }
    if ((sim.dutyRequests || []).some(same)) return { blocked: "A line above already asks for this person on this date." };

    // issuesFor, from RequestsTab.js. Smart Roster settings, read only.
    const rules = data.rosterRules || {};
    const coverage = rules.coverage || null;
    const wardRuns = (sh) => !coverage || (coverage[sh]?.min || 0) > 0 || (coverage[sh]?.max || 0) > 0;
    const warnings = [];
    if ((rules.skipStaff || []).includes(l.staffId)) {
      warnings.push("skipped in Smart Roster, so the generator will not touch this week for them");
    }
    if (leaveOn(staffOf(data, l.staffId), l.date)) {
      warnings.push("on recorded leave that day — leave is left alone, so this cannot be honoured");
    } else if (leaveOn(who, l.date)) {
      warnings.push("on leave you are adding in this note — leave is left alone, so this cannot be honoured");
    }
    if (l.category !== "off" && !wardRuns(l.category)) {
      warnings.push(`the ward does not run ${SHIFT_LABELS[l.category]} shifts`);
    }
    const only = (rules.staffShifts || {})[l.staffId];
    if (l.category !== "off" && only?.length && !only.includes(l.category)) {
      warnings.push(`only set up for ${only.map((x) => SHIFT_LABELS[x]).join(" and ")} duties`);
    }
    return { warnings };
  },

  apply: (d, l, { uid, today }) => {
    const list = d.dutyRequests || [];
    if (list.some((x) => x.staffId === l.staffId && x.date === l.date)) return d;
    d.dutyRequests = [...list, {
      id: uid(),
      staffId: l.staffId,
      date: l.date,
      category: l.category,
      approved: true,           // the manager confirming is the approval
      enteredBy: "assistant",
      enteredOn: today,
    }];
    return d;
  },
};

/* ── weekly_off ── */
const OFF_CATS = ["off"];
const planWeeklyOff = (l, data) => {
  const person = staffOf(data, l.staffId);
  const add = [], hasRequest = [], onLeave = [], notEmployed = [], filled = [];
  datesFrom(l.start, l.end)
    .filter((date) => l.weekdays.includes(parseISO(date).getDay()))
    .forEach((date) => {
      if (!employedOn(person, date)) { notEmployed.push(date); return; }
      const lp = leaveOn(person, date);
      if (lp) { onLeave.push({ date, lp }); return; }
      if ((data.dutyRequests || []).some((r) => r.staffId === l.staffId && r.date === date)) { hasRequest.push(date); return; }
      add.push(date);
      // A duty already on the rota wins over a request when building with
      // "Keep duties already on the rota", so that day will not change.
      const first = entriesOf((data.cells?.[date] || {})[l.staffId])[0];
      const code = first && (data.codes || []).find((c) => c.id === first.code);
      if (first && !(code && OFF_CATS.includes(code.counts))) filled.push(date);
    });
  return { add, hasRequest, onLeave, notEmployed, filled };
};
const daysWords = (dates) => {
  const words = dates.slice(0, 3).map(withWeekday);
  if (dates.length > 3) words.push(`${dates.length - 3} more`);
  return listWords(words);
};

export const weeklyOff = {
  type: "weekly_off",
  group: "leave",
  order: 3,
  people: ["staffId"],
  footnote: addRequest.footnote,
  opensRequests: true,
  saved: (n) => plural(n, "set of weekly days off", "sets of weekly days off"),

  fromServer: (a) => {
    const weekdays = [...new Set((Array.isArray(a.weekdays) ? a.weekdays : [])
      .filter((x) => Number.isInteger(x) && x >= 0 && x <= 6))].sort();
    if (!weekdays.length || !isISO(a.start) || !isISO(a.end) || a.start > a.end || daysIn(a.start, a.end) > MAX_DAYS) return null;
    return { staffId: a.staffId, weekdays, start: a.start, end: a.end };
  },
  span: (l) => [l.start, l.end],
  describe: (l, { sim }) => {
    const p = planWeeklyOff(l, sim);
    const why = {};
    p.hasRequest.forEach((d) => { why[d] = "skipped — already has a request"; });
    p.onLeave.forEach(({ date, lp }) => { why[date] = `skipped — on ${leaveName(lp).toLowerCase()}`; });
    p.notEmployed.forEach((d) => { why[d] = "skipped — not employed here then"; });
    return {
      what: `Off every ${listWords(l.weekdays.map((d) => WEEKDAYS[d]))}`,
      when: `${plural(p.add.length, "day")}, ${rangeLabel(l.start, l.end)}`,
      detailsLabel: "Show the days",
      details: datesFrom(l.start, l.end)
        .filter((date) => l.weekdays.includes(parseISO(date).getDay()))
        .map((date) => (why[date] ? `${withWeekday(date)}: ${why[date]}` : withWeekday(date))),
    };
  },

  check: (l, { data, sim }) => {
    const who = staffOf(sim, l.staffId);
    const p = planWeeklyOff(l, sim);
    const warnings = [];
    if (p.hasRequest.length) {
      warnings.push(`skips ${plural(p.hasRequest.length, "day")} that already ${p.hasRequest.length === 1 ? "has" : "have"} a request (${daysWords(p.hasRequest)})`);
    }
    const byLeave = {};
    p.onLeave.forEach(({ date, lp }) => { const k = leaveName(lp).toLowerCase(); (byLeave[k] = byLeave[k] || []).push(date); });
    Object.entries(byLeave).forEach(([name, dates]) => {
      warnings.push(`skips ${plural(dates.length, "day")} — ${who.name} is on ${name} (${daysWords(dates)})`);
    });
    if (p.notEmployed.length) {
      warnings.push(`skips ${plural(p.notEmployed.length, "day")} — not employed here then (${daysWords(p.notEmployed)})`);
    }
    if (p.filled.length) {
      warnings.push(`${p.filled.length} of these days already ${p.filled.length === 1 ? "has a duty" : "have duties"} on the rota, so the rota will not change on ${p.filled.length === 1 ? "it" : "them"} unless you build without "Keep duties already on the rota" (${daysWords(p.filled)})`);
    }
    if ((data.rosterRules?.skipStaff || []).includes(l.staffId)) {
      warnings.push("skipped in Smart Roster, so the generator will not touch this week for them");
    }
    if (!p.add.length) return { blocked: "Nothing to add: every matching day is skipped.", warnings };
    return { warnings };
  },

  apply: (d, l, { uid, today }) => {
    const p = planWeeklyOff(l, d);
    if (!p.add.length) return d;
    d.dutyRequests = [...(d.dutyRequests || []), ...p.add.map((date) => ({
      id: uid(),
      staffId: l.staffId,
      date,
      category: "off",
      approved: true,           // the manager confirming is the approval
      enteredBy: "assistant",
      enteredOn: today,
    }))];
    return d;
  },
};
