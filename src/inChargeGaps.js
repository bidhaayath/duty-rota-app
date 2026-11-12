/* ─────────────── Why a shift has no in-charge ───────────────
   When a ward holds its in-charge as a Must and a shift still ends up with
   nobody in charge, the proposed week says so first, with the day, the
   shift, and why none of the people who can take charge was free — counted
   from the week as it was built, not guessed at.

   Every reason here is one the engine never breaks: the shift could not
   have been given to that person without breaking something else that is
   held as firmly. Pure functions only.                                   */

import { employedOn, shiftISO } from "./rosterConfig";

const LABEL = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };
const article = (word) => (/^[aeiou]/i.test(word) ? "an" : "a");
const onLeave = (person, date) => (person.leavePeriods || []).some((lp) => date >= lp.start && date <= lp.end);
const dowOf = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };

/* Each reason as said of one person and of several. */
const PHRASES = {
  skipped: () => ["is skipped", "are skipped"],
  leave: () => ["is on leave", "are on leave"],
  request: () => ["is on an approved duty request", "are on approved duty requests"],
  kept: () => ["has this day already set on the rota", "have this day already set on the rota"],
  working: (c) => [`is working the ${LABEL[c] || c}`, `are working the ${LABEL[c] || c}`],
  notTheirShift: (sh) => [`does not do ${LABEL[sh]}s`, `do not do ${LABEL[sh]}s`],
  ownRule: () => ["is off by their own rule", "are off by their own rule"],
  rest: (y) => [`is resting after ${article(y)} ${y}`, `are resting after ${article(y)} ${y}`],
  tomorrow: (t, sh) => [`is working the next day's ${LABEL[t] || t} (it can't follow ${article(sh)} ${sh})`,
    `are working the next day's ${LABEL[t] || t} (it can't follow ${article(sh)} ${sh})`],
  weekMax: (max) => [`has already worked ${max} days this week`, `have already worked ${max} days this week`],
  daysInRow: (n) => [`has already worked ${n} days in a row`, `have already worked ${n} days in a row`],
  off: () => ["is on a day off", "are on a day off"],
};

/* Why each person who can take charge was not on `shift` on `date`.
     cells     what was built, from..to: "staffId|date" -> category
     data      the rota as saved: staff, codes, cells, duty requests, week start
     rules     the ward's settings, laid over the defaults
     staff     everyone on the rota then (the screen's activeStaff, or the
               month build's staff with their leave)
     kept      for Ini's month: days kept as already set on the rota
   Returns one reason key per person, as [key, arg] pairs.               */
export function whyNoInCharge({ date, shift, cells, data, rules, staff, from, to, kept = {} }) {
  const catOf = {};
  (data.codes || []).forEach((c) => { catOf[c.id] = c.counts; });
  const saved = (id, d) => {
    const raw = (data.cells?.[d] || {})[id];
    const codeId = Array.isArray(raw) ? raw.find((e) => e && e.code)?.code : raw;
    return codeId ? catOf[codeId] : undefined;
  };
  // The week as built, and the saved rota either side of it.
  const at = (id, d) => (d >= from && d <= to ? cells[`${id}|${d}`] : saved(id, d));
  const seq = rules.sequenceRules || [];
  const never = (after, then) => seq.some((r) => r.enabled !== false && r.type === "never" && r.after === after && r.then === then);
  const restAfter = (after) => seq.some((r) => r.enabled !== false && r.type === "must" && r.after === after && r.then === "off");
  // The ward's own week around the day: a month is judged a week at a time, as the engine judges it.
  const back = (dowOf(date) - (data.weekStartsOn ?? 0) + 7) % 7;
  const week = [...Array(7)].map((_, i) => shiftISO(date, i - back));
  const own = (rules.personRules || []).filter(Boolean);

  const seniors = (staff || []).filter((s) => (rules.seniorStaff || []).some((id) => String(id) === String(s.id)));
  return seniors.map((s) => {
    const id = s.id;
    if ((rules.skipStaff || []).includes(id)) return ["skipped"];
    if (!employedOn(s, date) || onLeave(s, date)) return ["leave"];
    const asked = (data.dutyRequests || []).find((r) => r.approved && String(r.staffId) === String(id) && r.date === date);
    const today = cells[`${id}|${date}`];
    if (today == null) return ["leave"];                     // a day kept as it was: sick leave and the like
    if (asked && asked.category !== shift) return ["request"];
    if (kept[`${id}|${date}`]) return ["kept"];
    if (today !== "off") return ["working", today];

    const only = rules.staffShifts?.[id];
    if (only && only.length && !only.includes(shift)) return ["notTheirShift", shift];
    const mine = own.filter((r) => String(r.staffId) === String(id));
    const dow = dowOf(date);
    const dayRule = mine.find((r) => (r.type === "offOn" && (r.days || []).includes(dow))
      || (r.type === "onlyOn" && (r.days || []).includes(dow) && !(r.shifts || []).includes(shift)));
    const most = mine.find((r) => r.type === "atMost" && r.shift === shift);
    if (dayRule || (most && week.filter((d) => at(id, d) === shift).length >= most.count)) return ["ownRule"];

    const y = at(id, shiftISO(date, -1));
    if (y && y !== "off" && (never(y, shift) || restAfter(y))) return ["rest", y];
    const t = at(id, shiftISO(date, 1));
    if (t && t !== "off" && t !== shift && (never(shift, t) || restAfter(shift))) return ["tomorrow", t, shift];

    const max = rules.weeklyDuties?.max;
    if (max != null && week.filter((d) => d !== date && at(id, d) && at(id, d) !== "off").length >= max) return ["weekMax", max];
    let run = 0;
    for (let back = 1; back <= 7; back++) {
      const c = at(id, shiftISO(date, -back));
      if (c && c !== "off") run += 1; else break;
    }
    if (run >= 6) return ["daysInRow", run];
    return ["off"];
  });
}

/* The sentence. "Night on Tue 17 Nov has no Shift Manager: of your 8, 3
   are on leave, 3 are resting after a night and 2 are off by their own
   rule." — or "all 8 are on leave" where there is one reason. */
// `day` is the date as the screen says it, "Tue 17 Nov" (prettyWeekday).
export function noInChargeText({ day, shift, reasons, termOne }) {
  const head = `${LABEL[shift]} on ${day} has no ${termOne}`;
  if (!reasons.length) return `${head}: nobody on the rota this week can take charge.`;
  const groups = [];
  reasons.forEach(([key, ...args]) => {
    const name = [key, ...args].join("|");
    const g = groups.find((x) => x.name === name);
    if (g) g.count += 1; else groups.push({ name, key, args, count: 1 });
  });
  groups.sort((a, b) => b.count - a.count);
  const said = (g, n) => PHRASES[g.key](...g.args)[n === 1 ? 0 : 1];
  if (groups.length === 1) {
    const n = groups[0].count;
    return n === 1 ? `${head}: the only one ${said(groups[0], 1)}.` : `${head}: all ${n} ${said(groups[0], n)}.`;
  }
  const parts = groups.map((g) => `${g.count} ${said(g, g.count)}`);
  const list = `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `${head}: of your ${reasons.length}, ${list}.`;
}
