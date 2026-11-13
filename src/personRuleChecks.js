/* ─────────────── One person's own rules: the checks ───────────────
   What the Your staff panel (YourStaff.js) says before a rule or a fixed
   duty is added — every refusal and every warning — and what Ini says about
   one it read in a note (iniActions/people.js). One copy, so the two can
   never disagree. Pure: everything comes from the rules and the rota given.

   A rule here is as saved, without its id, person and strength:
     { type: atMost|atLeast|apart|together, shift, count }
     { type: offOn, days }            days: 0 Sunday … 6 Saturday
     { type: onlyOn, days, shifts }
   A fixed duty: { date, duty }      duty: a shift or "off".            */

import { SHIFTS, personRuleText } from "./rosterEngine";
import { prettyWeekday } from "./monthBuild";
import { employedOn } from "./rosterConfig";

export const SHIFT_LABELS = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };
export const CATEGORY_LABELS = { ...SHIFT_LABELS, off: "Off" };
export const DAY_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/* Rules about days of the week: ticked days in place of a shift and a
   number. Just the seven days — weekends differ from ward to ward, so
   there is no shortcut for one, and a public holiday is not a day here. */
export const DAY_TYPES = ["offOn", "onlyOn"];
/* What a new rule starts at, and how far its number can go. */
export const RULE_COUNTS = {
  atMost: { start: 1, min: 0, max: 7 },
  atLeast: { start: 1, min: 1, max: 7 },
  apart: { start: 2, min: 1, max: 6 },
  together: { start: 2, min: 2, max: 2 },
};
export const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");
export const weekdayOf = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).getDay(); };
export const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const andList = (words) => (words.length < 2 ? words.join("")
  : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);
export const ampList = (words) => (words.length < 2 ? words.join("")
  : `${words.slice(0, -1).join(", ")} & ${words[words.length - 1]}`);

// Only shifts the ward runs can carry a rule.
export const runShiftsOf = (rules) => SHIFTS.filter((sh) => rules.coverage[sh]?.max !== 0);
// The week in the ward's own order, so a Monday ward reads Saturday and Sunday.
export const weekOrderOf = (firstDay) => [...Array(7)].map((_, i) => (firstDay + i) % 7);
/* A fixed day off starts as Must: it is usually a promise made to the
   person. Every other rule starts as Try: kept whenever the week allows. */
export const startsAs = (type) => (type === "offOn" ? "hard" : "soft");
export const strengthWord = (strength) => (strength === "hard" ? "Must" : "Try");

// A duty the manager fixed, as the row and the panel say it.
export const fixedText = (f) => `Fixed: ${CATEGORY_LABELS[f.duty] || f.duty} on ${isISO(f.date) ? prettyWeekday(f.date) : f.date}`;
// What a rule or a fixed duty being written says, before it is added.
export const rulePreview = (name, rule, strength = startsAs(rule.type)) =>
  `${name}: ${personRuleText(rule)} — starts as ${strengthWord(strength)}.`;
export const fixedPreview = (name, f) =>
  `${name}: ${CATEGORY_LABELS[f.duty]} on ${prettyWeekday(f.date)}, fixed by you — always kept.`;
// Said under an "at least" kept as a Must.
export const atLeastMustText = (name, r) =>
  `A Must here can leave another shift uncovered so that ${name || "they"} gets `
  + `${r.count} ${r.shift}${r.count === 1 ? "" : "s"}. Try is usually enough: it is met whenever the week allows.`;

const daysWord = (n) => `${n} day${n === 1 ? "" : "s"}`;

/* The checks, for one ward as it is: `rules` merged (mergeRules), `data`
   the rota, `allStaff` everyone still with the ward, `firstDay` the
   ward's first day of the week. */
export function personChecks({ rules, data, allStaff, firstDay }) {
  const ownRules = rules.personRules || [];
  const fixedDuties = (rules.fixedDuties || []).filter(Boolean);
  const fixedOf = (id) => fixedDuties.filter((f) => String(f.staffId) === String(id));
  const staffName = (id) => (data.staff || []).find((s) => String(s.id) === String(id))?.name;
  const runShifts = runShiftsOf(rules);
  const weekOrder = weekOrderOf(firstDay);

  // Somebody's rules about days, as saved and readable.
  const dayRulesOf = (staffId, list = ownRules) => list.filter((r) => String(r.staffId) === String(staffId)
    && DAY_TYPES.includes(r.type) && Array.isArray(r.days) && (r.type === "offOn" || Array.isArray(r.shifts)));
  // Days of the week those leave open for a shift: not off, and not kept to other shifts.
  const daysOpenFor = (dayRules, shift) => weekOrder.filter((d) => !dayRules.some((r) => r.days.includes(d)
    && (r.type === "offOn" || !r.shifts.includes(shift)))).length;

  /* More days fixed off than the ward's most: theirs is the number for
     them, as the engine does it, and the screen says so. */
  const wardMostOff = rules.weeklyMax?.off;
  const wardFewest = rules.weeklyDuties?.min;
  const fixedOffNote = (staffId, list) => {
    const fixed = new Set(dayRulesOf(staffId, list).filter((r) => r.type === "offOn").flatMap((r) => r.days)).size;
    if (wardMostOff == null || fixed <= wardMostOff) return null;
    const name = staffName(staffId) || "this person";
    return `That is ${daysWord(fixed)} off a week, more than the ward's most of ${wardMostOff}, so for ${name} the most off days is ${fixed}`
      + (wardFewest != null && wardFewest > 7 - fixed ? ` and the fewest duties ${7 - fixed}.` : ".");
  };
  /* Days so many people are always off by a Must that everyone else
     together could not fill the places the ward needs. Only where the
     ward could fill them without those rules: a ward short every day is
     short whatever anyone's rule says. */
  const placesPerDay = runShifts.reduce((n, sh) => n + (rules.coverage[sh]?.min || 0), 0);
  const onRota = allStaff.filter((s) => !rules.skipStaff.includes(s.id));
  const peopleLeftOn = (d, list) => {
    const off = new Set(list.filter((r) => r.type === "offOn" && r.strength === "hard" && Array.isArray(r.days)
      && r.days.includes(d)).map((r) => String(r.staffId)));
    return onRota.filter((s) => !off.has(String(s.id))).length;
  };
  const shortDays = (list) => (onRota.length < placesPerDay ? []
    : weekOrder.filter((d) => peopleLeftOn(d, list) < placesPerDay));
  // One line per day, said once above the list rather than under each rule.
  const shortDayText = (d, list) => {
    const left = peopleLeftOn(d, list);
    return `On ${DAY_LABEL[d]} only ${left} ${left === 1 ? "person is" : "people are"} left `
      + `for the ${placesPerDay} places the ward fills each day, so a shift will be left uncovered every week.`;
  };

  /* A fixed duty that could never be kept, said before it is saved: the
     day is someone else's to decide, or the person cannot work it. */
  const fixedProblem = (person, { date, duty }) => {
    const who = person.name, id = person.id;
    const day = prettyWeekday(date);
    const asked = (data.dutyRequests || []).find((r) => r.approved && String(r.staffId) === String(id) && r.date === date);
    if (fixedOf(id).some((f) => f.date === date)) return `${who} already has a fixed duty on ${day}. Remove it first to change it.`;
    if (asked) {
      return `${who} has an approved duty request on ${day} (${CATEGORY_LABELS[asked.category] || asked.category}). `
        + `Change it in the Duty requests tab instead.`;
    }
    if (!employedOn(person, date)) return `${who} is not on the rota on ${day}.`;
    if ((person.leavePeriods || []).some((lp) => date >= lp.start && date <= lp.end)) return `${who} is on leave on ${day}.`;
    if (rules.skipStaff.includes(person.id)) return `${who} is skipped, so Smart Roster does not roster them. Untick Skip first.`;
    if (duty !== "off") {
      const ticks = rules.staffShifts?.[id] || [];
      if (ticks.length && !ticks.includes(duty)) {
        return `${who} is set up for ${ampList(SHIFTS.filter((sh) => ticks.includes(sh)).map((sh) => SHIFT_LABELS[sh]))} only.`;
      }
      const offRule = dayRulesOf(id).find((r) => r.type === "offOn" && r.strength === "hard" && r.days.includes(weekdayOf(date)));
      if (offRule) return `${who} has "${personRuleText(offRule)}" as a Must, which covers ${day}.`;
    }
    return null;
  };

  /* Why the rule as written cannot be added, in the manager's words. Asked
     before saving, so a list never holds two rules that fight each other. */
  const ruleProblem = (person, rule) => {
    const who = person.name;
    const dayRules = dayRulesOf(person.id);
    if (DAY_TYPES.includes(rule.type)) {
      const clash = dayRules.find((r) => r.days.some((d) => rule.days.includes(d)));
      if (clash) {
        const day = DAY_LABEL[weekOrder.find((d) => clash.days.includes(d) && rule.days.includes(d))];
        return `${who} already has "${personRuleText(clash)}", which covers ${day}. Remove it first to change it.`;
      }
      if (rule.type === "offOn" && rule.days.length === 7) {
        return `That is every day of the week. To leave ${who} off the rota, use Skip above.`;
      }
      if (rule.type === "onlyOn") {
        const ticks = rules.staffShifts?.[person.id] || [];
        const works = ticks.length ? runShifts.filter((sh) => ticks.includes(sh)) : runShifts;
        if (!works.some((sh) => rule.shifts.includes(sh))) {
          return `${who} is set up above for ${andList(works.map((sh) => `${sh}s`))} only, so on those days ${who} `
            + `could only be off. Use "Always off on" for that.`;
        }
        if (works.every((sh) => rule.shifts.includes(sh))) {
          return `Those are all the shifts ${who} works, so this rule would change nothing.`;
        }
      }
      const after = [...dayRules, rule];
      const least = ownRules.find((r) => String(r.staffId) === String(person.id) && r.type === "atLeast"
        && r.count > daysOpenFor(after, r.shift));
      if (least) {
        return `${who} has "${personRuleText(least)}", and with this rule only ${daysWord(daysOpenFor(after, least.shift))} `
          + `a week would be left for ${least.shift}s.`;
      }
      return null;
    }
    const mine = ownRules.filter((r) => String(r.staffId) === String(person.id) && r.shift === rule.shift);
    const has = (type) => mine.find((r) => r.type === type);
    if (rule.type === "atLeast" && rule.count > daysOpenFor(dayRules, rule.shift)) {
      return `${who}'s rules about days leave ${daysWord(daysOpenFor(dayRules, rule.shift))} a week for ${rule.shift}s, `
        + `so at least ${rule.count} could never be met.`;
    }
    if (has(rule.type)) {
      return `${who} already has "${personRuleText(has(rule.type))}". Remove it first to change it.`;
    }
    const other = rule.type === "apart" ? has("together") : rule.type === "together" ? has("apart") : null;
    if (other) {
      return `${who} already has "${personRuleText(other)}". A gap between shifts and pairs cannot both apply to ${rule.shift}s, so remove that one first.`;
    }
    const most = rule.type === "atLeast" ? has("atMost") : null;
    const least = rule.type === "atMost" ? has("atLeast") : null;
    if (most && rule.count > most.count) {
      return `${who} has "${personRuleText(most)}", so at least ${rule.count} could never be met.`;
    }
    if (least && rule.count < least.count) {
      return `${who} has "${personRuleText(least)}", so at most ${rule.count} could never be met.`;
    }
    return null;
  };

  /* What adding a fixed day off would newly cost, said before Add: the
     note about more days off than the ward's most, and each day it would
     newly leave short (a day already short is said above the list). */
  const offOnNotes = (person, rule, strength) => {
    if (rule.type !== "offOn") return { fixedNote: null, shortNotes: [] };
    const after = [...ownRules, { ...rule, staffId: person.id, strength }];
    const shortNow = shortDays(ownRules);
    return {
      fixedNote: fixedOffNote(person.id, after),
      shortNotes: shortDays(after).filter((d) => rule.days.includes(d) && !shortNow.includes(d))
        .map((d) => shortDayText(d, after)),
    };
  };

  return {
    runShifts, weekOrder, dayRulesOf, fixedOffNote, shortDays, shortDayText,
    fixedProblem, ruleProblem, offOnNotes,
  };
}
