/* ─────────────── Ini's actions: standing settings ───────────────
   set_shifts        { staffId, shifts }   shifts: morning|afternoon|evening|night
   set_offs_per_week { min, max }          0–7, or null to leave that side as it is

   Smart Roster's own settings, stored where Smart Roster keeps them, so its
   screen shows the new values as soon as they are saved and the old ones
   again after Undo:
     rosterRules.staffShifts[staffId]   only these shifts; no entry = any shift
     rosterRules.weeklyMin.off          fewest off days a week
     rosterRules.weeklyMax.off          most off days a week (null = no limit)
   Written the way SmartRosterTab.js writes them (setStaffShifts, and the
   Off days column of the weekly table): an empty shift list deletes the
   entry. They apply from now on, to every week Smart Roster or Ini builds. */

import { mergeRules } from "../rosterConfig";
import { SHIFTS } from "../rosterEngine";
import { plural, listWords, staffOf, wardShifts, SHIFT_LABELS } from "./shared";

const shiftsWords = (list) => (list.length ? `${listWords(list.map((s) => SHIFT_LABELS[s]))} only` : "any shift");
const sameList = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/* ── set_shifts ── */
const planShifts = (l, data) => {
  const runs = wardShifts(data);
  const asked = SHIFTS.filter((s) => l.shifts.includes(s));
  return {
    current: SHIFTS.filter((s) => ((mergeRules(data.rosterRules || {}).staffShifts || {})[l.staffId] || []).includes(s)),
    next: asked.filter((s) => runs.includes(s)),
    notRun: asked.filter((s) => !runs.includes(s)),
  };
};

export const setShifts = {
  type: "set_shifts",
  group: "settings",
  people: ["staffId"],
  savedAs: "settings",
  saved: (n) => plural(n, "standing setting"),

  fromServer: (a) => (Array.isArray(a.shifts)
    ? { staffId: a.staffId, shifts: SHIFTS.filter((s) => a.shifts.includes(s)) } : null),
  describe: (l, { sim }) => {
    const p = planShifts(l, sim);
    // A line asking only for shifts the ward does not run is blocked; it
    // still says what it asked for.
    const shown = !p.next.length && p.notRun.length ? p.notRun : p.next;
    return { what: "Shifts", when: `${shiftsWords(p.current)} → ${shiftsWords(shown)}` };
  },

  check: (l, { sim }) => {
    const who = staffOf(sim, l.staffId);
    const p = planShifts(l, sim);
    const warnings = [];
    if (p.notRun.length) {
      const words = `the ward does not run ${listWords(p.notRun.map((s) => SHIFT_LABELS[s]))} shifts`;
      if (!p.next.length) {
        return { blocked: `${words[0].toUpperCase()}${words.slice(1)}, so ${who.name} would be left with no shifts. Write the note again with shifts the ward runs, or change it in Smart Roster.` };
      }
      warnings.push(`${words}, so ${p.notRun.length === 1 ? "that one is" : "those are"} left out`);
    }
    if (sameList(p.current, p.next)) return { blocked: `${who.name} is already set up for ${shiftsWords(p.next)}.`, warnings };
    if ((mergeRules(sim.rosterRules || {}).skipStaff || []).includes(l.staffId)) {
      warnings.push("skipped in Smart Roster, so this makes no difference until they are no longer skipped");
    }
    if (p.next.length) {
      warnings.push("Smart Roster leaves them out of the fair share of shifts, since they cannot rotate");
    }
    return { warnings };
  },

  apply: (d, l) => {
    const p = planShifts(l, d);
    if (p.notRun.length && !p.next.length) return d;
    const rules = d.rosterRules || {};
    const next = { ...(rules.staffShifts || {}) };
    if (p.next.length) next[l.staffId] = p.next; else delete next[l.staffId];
    d.rosterRules = { ...rules, staffShifts: next };
    return d;
  },
};

/* ── set_offs_per_week ── */
const offWords = (min, max) => `${min ?? 0}–${max ?? "no limit"}`;
const planOffs = (l, data) => {
  const rules = mergeRules(data.rosterRules || {});
  const cur = { min: rules.weeklyMin?.off ?? null, max: rules.weeklyMax?.off ?? null };
  return { rules, cur, next: { min: l.min ?? cur.min, max: l.max ?? cur.max } };
};
const fix = (v) => (Number.isInteger(v) && v >= 0 && v <= 7 ? v : null);

export const setOffsPerWeek = {
  type: "set_offs_per_week",
  group: "settings",
  savedAs: "settings",
  saved: setShifts.saved,

  fromServer: (a) => {
    const min = fix(a.min), max = fix(a.max);
    return min === null && max === null ? null : { min, max };
  },
  describe: (l, { sim }) => {
    const { cur, next } = planOffs(l, sim);
    return { what: "Off days per week", when: `${offWords(cur.min, cur.max)} → ${offWords(next.min, next.max)}` };
  },

  check: (l, { sim }) => {
    const { rules, cur, next } = planOffs(l, sim);
    if (next.min != null && next.max != null && next.min > next.max) {
      return {
        blocked: `The fewest off days (${next.min}) would be more than the most (${next.max}), so Smart Roster could not keep to both. ` +
          "Write the note again with both numbers, or change them in Smart Roster.",
      };
    }
    if (next.min === cur.min && next.max === cur.max) return { blocked: "Off days per week are already set like this." };
    const warnings = ["applies to everyone on the ward, every week"];
    const duties = rules.weeklyDuties?.min;
    if (next.min != null && duties != null && next.min + duties > 7) {
      warnings.push(`with at least ${plural(duties, "duty", "duties")} a week as well, that comes to more than 7 days`);
    }
    return { warnings };
  },

  apply: (d, l) => {
    const { rules, next } = planOffs(l, d);
    if (next.min != null && next.max != null && next.min > next.max) return d;
    d.rosterRules = {
      ...(d.rosterRules || {}),
      weeklyMin: { ...rules.weeklyMin, off: next.min },
      weeklyMax: { ...rules.weeklyMax, off: next.max },
    };
    return d;
  },
};
