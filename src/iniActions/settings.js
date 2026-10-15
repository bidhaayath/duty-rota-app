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
   entry. They apply from now on, to every week Smart Roster or Ini builds.

   set_senior_cover  { cover: { morning, afternoon, evening, night } }
                     0–10 each, or null to leave that shift as it is
   set_seniors       { add: [{ staffId, staffName }], remove: [...] }
     rosterRules.seniorCover[shift]     how many must be able to take charge
     rosterRules.seniorStaff            who can take charge
   Written as setSeniorCover and toggleSenior write them. Every line uses
   the ward's own word ("In-charge", "Sister"), never "senior". */

import { mergeRules, seniorTermsOf, seniorNeedOf } from "../rosterConfig";
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

/* ── Seniors: the ward's word, and whether there are enough ──
   Both senior lines share one check, run once on the result of every
   senior line in the note together: Smart Roster's sum under "How many
   staff on each shift" (seniorNeedOf), counting everyone still with the
   ward and not skipped — the list Smart Roster's tick boxes show. */
const termsIn = (data) => {
  const t = seniorTermsOf(mergeRules(data.rosterRules || {}));
  return { ...t, many: t.termMany.toLowerCase(), a: /^[aeiou]/i.test(t.termOne) ? "an" : "a" };
};

const seniorsTogether = (final, { today }) => {
  const rules = mergeRules(final.rosterRules || {});
  const { lower, many } = termsIn(final);
  const staff = (final.staff || []).filter((s) => !(s.endDate && s.endDate < today));
  const n = seniorNeedOf(rules, staff);
  if (!n.seniorPerDay) return [];
  const perDay = `${n.seniorPerDay} ${n.seniorPerDay === 1 ? lower : many}`;
  if (!n.seniorCount) {
    return [`asks for ${perDay} on duty every day, but nobody can take charge. Name them in a note, or tick them in Smart Roster`];
  }
  if (n.needed > n.seniorCount) {
    return [
      `${perDay} on duty every day comes to ${n.seniorPerDay * 7} ${lower} duties a week. At ${n.perPerson} duties ` +
      `each that needs at least ${n.needed} ${many}, and only ${n.seniorCount} can take charge`,
    ];
  }
  return [];
};

/* ── set_senior_cover ──
   Smart Roster only lets this be set on a shift with a minimum above 0
   (the box is greyed out otherwise), and only counts it there. */
const COVER_MAX = 10;
const planCover = (l, data) => {
  const rules = mergeRules(data.rosterRules || {});
  const cur = rules.seniorCover;
  const asked = SHIFTS.filter((s) => l.cover[s] != null);
  const staffed = (s) => (rules.coverage[s]?.min || 0) > 0;
  const use = asked.filter(staffed);
  const next = { ...cur };
  use.forEach((s) => { next[s] = Math.max(0, Number(l.cover[s]) || 0); });
  return { cur, next, asked, use, notRun: asked.filter((s) => !staffed(s)), changed: use.filter((s) => next[s] !== cur[s]) };
};

export const setSeniorCover = {
  type: "set_senior_cover",
  group: "settings",
  savedAs: "settings",
  saved: setShifts.saved,
  together: seniorsTogether,

  fromServer: (a) => {
    const raw = a.cover && typeof a.cover === "object" ? a.cover : {};
    const cover = {};
    SHIFTS.forEach((s) => {
      const v = raw[s];
      cover[s] = Number.isInteger(v) && v >= 0 && v <= COVER_MAX ? v : null;
    });
    return SHIFTS.some((s) => cover[s] !== null) ? { cover } : null;
  },
  describe: (l, { sim }) => {
    const p = planCover(l, sim);
    // Only what changes; a line that changes nothing still says what it asked.
    const shown = p.changed.length ? p.changed : p.use.length ? p.use : p.asked;
    return {
      what: `${termsIn(sim).termMany} per shift`,
      when: shown.map((s) => `${SHIFT_LABELS[s]} ${p.cur[s] || 0} → ${l.cover[s]}`).join(", "),
    };
  },

  check: (l, { sim }) => {
    const p = planCover(l, sim);
    const { termMany } = termsIn(sim);
    const warnings = [];
    if (p.notRun.length) {
      const words = `${listWords(p.notRun.map((s) => SHIFT_LABELS[s]))} ${p.notRun.length === 1 ? "has" : "have"} no staff set in Smart Roster`;
      if (!p.use.length) {
        return { blocked: `${words[0].toUpperCase()}${words.slice(1)}, so there is nothing to set. Write the note again with shifts the ward runs, or change it in Smart Roster.` };
      }
      warnings.push(`${words}, so ${p.notRun.length === 1 ? "that one is" : "those are"} left out`);
    }
    if (!p.changed.length) return { blocked: `${termMany} per shift are already set like this.`, warnings };
    warnings.push("applies to the whole ward, every week");
    return { warnings };
  },

  apply: (d, l) => {
    const p = planCover(l, d);
    if (!p.use.length) return d;
    d.rosterRules = { ...(d.rosterRules || {}), seniorCover: p.next };
    return d;
  },
};

/* ── set_seniors ──
   Added at the end and removed where they are, as ticking and unticking
   in Smart Roster does. Anyone already in, already out, gone from the rota
   or view-only is left out, and the line says so. */
const planSeniors = (l, data, staffEditable = () => true) => {
  const current = mergeRules(data.rosterRules || {}).seniorStaff;
  const out = { add: [], remove: [], already: [], notIn: [], gone: [], locked: [] };
  const sort = (list, side) => list.forEach((x) => {
    const who = staffOf(data, x.staffId);
    const p = { id: x.staffId, name: who ? who.name : x.staffName };
    if (!who) out.gone.push(p);
    else if (!staffEditable(p.id)) out.locked.push(p);
    else if (side === "add" && current.includes(p.id)) out.already.push(p);
    else if (side === "remove" && !current.includes(p.id)) out.notIn.push(p);
    else out[side].push(p);
  });
  sort(l.add, "add");
  sort(l.remove, "remove");
  const drop = out.remove.map((p) => p.id);
  out.next = [...current.filter((id) => !drop.includes(id)), ...out.add.map((p) => p.id)];
  return out;
};
const namesOf = (list) => list.map((p) => p.name);
const isAre = (list) => (list.length === 1 ? "is" : "are");

export const setSeniors = {
  type: "set_seniors",
  group: "settings",
  savedAs: "settings",
  saved: setShifts.saved,
  together: seniorsTogether,

  fromServer: (a) => {
    const pick = (list) => {
      const seen = new Set();
      return (Array.isArray(list) ? list : [])
        .filter((x) => x && typeof x.staffId === "string" && !seen.has(x.staffId) && seen.add(x.staffId))
        .map((x) => ({ staffId: x.staffId, staffName: String(x.staffName || "") }));
    };
    const add = pick(a.add), remove = pick(a.remove);
    return add.length || remove.length ? { add, remove } : null;
  },
  describe: (l, { sim, staffEditable }) => {
    const p = planSeniors(l, sim, staffEditable);
    // A line that changes nothing still says what it asked for.
    const plus = p.add.length || p.remove.length ? p.add : l.add.map((x) => ({ name: x.staffName }));
    const minus = p.add.length || p.remove.length ? p.remove : l.remove.map((x) => ({ name: x.staffName }));
    return {
      what: "Can take charge",
      when: [plus.length && `+ ${namesOf(plus).join(", ")}`, minus.length && `− ${namesOf(minus).join(", ")}`]
        .filter(Boolean).join(" · "),
    };
  },

  check: (l, { sim, staffEditable }) => {
    const p = planSeniors(l, sim, staffEditable);
    const { lower, many, a } = termsIn(sim);
    const role = (list) => (list.length === 1 ? `${a} ${lower}` : many);
    const left = [];
    if (p.already.length) left.push(`${listWords(namesOf(p.already))} ${isAre(p.already)} already ${role(p.already)}`);
    if (p.notIn.length) left.push(`${listWords(namesOf(p.notIn))} ${isAre(p.notIn)} not ${role(p.notIn)}`);
    if (p.gone.length) left.push(`${listWords(namesOf(p.gone))} ${isAre(p.gone)} no longer on the rota`);
    if (p.locked.length) left.push(`${listWords(namesOf(p.locked))} ${isAre(p.locked)} view-only on your current plan`);
    if (!p.add.length && !p.remove.length) {
      return { blocked: `Nothing to change: ${left.join("; ")}.` };
    }
    const warnings = left.map((w) => `${w}, so left out`);
    const skip = mergeRules(sim.rosterRules || {}).skipStaff;
    const skipped = p.add.filter((x) => skip.includes(x.id));
    if (skipped.length) {
      warnings.push(`${listWords(namesOf(skipped))} ${isAre(skipped)} skipped in Smart Roster, so this makes no difference until they are no longer skipped`);
    }
    return { warnings };
  },

  apply: (d, l, { staffEditable } = {}) => {
    const p = planSeniors(l, d, staffEditable);
    if (!p.add.length && !p.remove.length) return d;
    d.rosterRules = { ...(d.rosterRules || {}), seniorStaff: p.next };
    return d;
  },
};
