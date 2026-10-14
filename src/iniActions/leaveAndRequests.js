/* ─────────────── Ini's actions: leave and duty requests ───────────────
   add_leave   { staffId, leaveType, start, end }
   add_request { staffId, date, duty }     saved approved

   The shapes they save match the Staff tab and RequestsTab.add exactly.
   The checks on a duty request repeat the ones in RequestsTab.js
   (issuesFor and the clash check in add). They are copied rather than
   shared so that tab did not have to change. If one set of checks
   changes, change the other to match. */

import {
  isISO, rangeLabel, withWeekday, plural, staffOf, leaveOn, leaveName,
  LEAVE_LABEL, DUTIES, REQUEST_LABEL, SHIFT_LABELS,
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
