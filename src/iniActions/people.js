/* ─────────────── Ini's actions: one person at a time ───────────────
   set_skip     { staffId, skip }               Skip in Smart Roster, or not
   person_rule  { staffId, rule, strength }     one of the six rules of a
                person's own (personRuleChecks.js says their shape)
   fixed_duty   { staffId, date, duty }         a duty fixed by the manager

   The same things the Your staff panel makes, saved where it saves them —
     rosterRules.skipStaff, rosterRules.personRules, rosterRules.fixedDuties
   — and checked by the very same code (personRuleChecks.js), so a rule the
   panel would refuse, Ini refuses with the same words. None of them ever
   touches a setting of the whole ward.

   Asking instead of guessing. The manager cannot answer Ini, so a line Ini
   could not finish carries its question, and the panel shows the question
   with a control to answer it: a number, the days, the year, or which of
   two people. Until it is answered the line cannot be ticked. Asking costs
   nothing: no second request is made.
     ask: { kind: "count" | "days" | "year" | "person", question, ... }  */

import { mergeRules } from "../rosterConfig";
import { SHIFTS, personRuleText } from "../rosterEngine";
import { prettyWeekday } from "../monthBuild";
import {
  CATEGORY_LABELS, DAY_TYPES, RULE_COUNTS, isISO, upperFirst, startsAs, strengthWord,
  atLeastMustText, personChecks, weekOrderOf,
} from "../personRuleChecks";
import { plural, staffOf, parseISO, dayMonth } from "./shared";

const RULE_KINDS = ["atMost", "atLeast", "apart", "together", ...DAY_TYPES];
const DUTIES = [...SHIFTS, "off"];

// The checks for the rota as it is at this point of the checklist.
const checksFor = (data, today) => {
  const rules = mergeRules(data.rosterRules || {});
  const allStaff = (data.staff || []).filter((s) => !(s.endDate && s.endDate < today));
  return { rules, checks: personChecks({ rules, data, allStaff, firstDay: data.weekStartsOn ?? 0 }) };
};
const skippedWarning = (rules, id) => (rules.skipStaff.includes(id)
  ? ["skipped in Smart Roster, so this makes no difference until they are no longer skipped"] : []);

/* ── set_skip ── */
export const setSkip = {
  type: "set_skip",
  group: "people",
  people: ["staffId"],
  savedAs: "settings",
  saved: (n) => plural(n, "standing setting"),

  fromServer: (a) => (typeof a.skip === "boolean" ? { staffId: a.staffId, skip: a.skip } : null),
  describe: (l) => ({ what: "Skip", when: l.skip ? "on the rota → skipped" : "skipped → on the rota" }),

  check: (l, { sim }) => {
    const who = staffOf(sim, l.staffId);
    const now = mergeRules(sim.rosterRules || {}).skipStaff.includes(l.staffId);
    if (now === l.skip) return { blocked: l.skip ? `${who.name} is already skipped.` : `${who.name} is not skipped.` };
    return { warnings: l.skip ? ["left out of Smart Roster; enter their duties by hand"] : [] };
  },

  apply: (d, l) => {
    const cur = mergeRules(d.rosterRules || {}).skipStaff;
    if (cur.includes(l.staffId) === l.skip) return d;
    d.rosterRules = { ...(d.rosterRules || {}), skipStaff: l.skip ? [...cur, l.staffId] : cur.filter((x) => x !== l.staffId) };
    return d;
  },
};

/* ── person_rule ── */
const ruleOk = (r) => {
  if (!r || !RULE_KINDS.includes(r.type)) return null;
  if (DAY_TYPES.includes(r.type)) {
    const days = Array.isArray(r.days)
      ? [...new Set(r.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : null;
    const shifts = SHIFTS.filter((sh) => Array.isArray(r.shifts) && r.shifts.includes(sh));
    if (r.type === "onlyOn" && !shifts.length) return null;
    return { type: r.type, days: days && days.length ? days : null, ...(r.type === "onlyOn" ? { shifts } : {}) };
  }
  if (!SHIFTS.includes(r.shift)) return null;
  const { min, max } = RULE_COUNTS[r.type];
  const count = r.type === "together" ? 2
    : Number.isInteger(r.count) && r.count >= min && r.count <= max ? r.count : null;
  return { type: r.type, shift: r.shift, count };
};
// The rule as the panel saves it: days in the ward's week order, shifts in the ward's.
const savedRule = (rule, checks) => (DAY_TYPES.includes(rule.type)
  ? { type: rule.type, days: checks.weekOrder.filter((d) => rule.days.includes(d)),
      ...(rule.type === "onlyOn" ? { shifts: checks.runShifts.filter((sh) => rule.shifts.includes(sh)) } : {}) }
  : { type: rule.type, shift: rule.shift, count: rule.count });

export const personRule = {
  type: "person_rule",
  group: "people",
  order: 1,
  people: ["staffId"],
  saved: (n) => plural(n, "rule of their own", "rules of their own"),

  fromServer: (a) => {
    const rule = ruleOk(a.rule);
    if (!rule) return null;
    // As the panel starts it, unless the note itself says Must.
    return { staffId: a.staffId, rule, strength: a.must === true ? "hard" : startsAs(rule.type), weekend: a.weekend === true };
  },
  asks: (l) => {
    const r = l.rule;
    if (DAY_TYPES.includes(r.type) && !r.days) {
      return { kind: "days", question: l.weekend ? "Which days are your weekend?" : "Which days?" };
    }
    if (!DAY_TYPES.includes(r.type) && r.count == null) {
      const { min, max } = RULE_COUNTS[r.type];
      return {
        kind: "count", min, max,
        question: r.type === "apart" ? `How many days between ${l.named ? `${l.named}'s` : "their"} ${r.shift}s?`
          : `How many ${r.shift}s a week${l.named ? ` for ${l.named}` : ""}?`,
      };
    }
    return null;
  },
  missing: (l) => (DAY_TYPES.includes(l.rule.type) ? !(l.rule.days && l.rule.days.length) : l.rule.count == null),
  describe: (l, { sim }) => {
    const r = l.rule;
    // Days in the ward's week order, as they will be saved.
    const order = weekOrderOf(sim.weekStartsOn ?? 0);
    const text = DAY_TYPES.includes(r.type) && !(r.days && r.days.length)
      ? (r.type === "offOn" ? "always off on ?" : `on ? only ${r.shifts.map((sh) => `${sh}s`).join(" and ")}`)
      : personRuleText({ ...r, count: r.count ?? "?", ...(r.days ? { days: order.filter((d) => r.days.includes(d)) } : {}) });
    return { what: "Rule", when: `${upperFirst(text)} — starts as ${strengthWord(l.strength)}` };
  },

  check: (l, { sim, today }) => {
    const { rules, checks } = checksFor(sim, today);
    const who = staffOf(sim, l.staffId);
    const r = l.rule;
    if (!DAY_TYPES.includes(r.type) && !checks.runShifts.includes(r.shift)) {
      return { blocked: `The ward does not run ${r.shift} shifts, so this rule cannot be added.` };
    }
    if (r.type === "onlyOn" && !r.shifts.some((sh) => checks.runShifts.includes(sh))) {
      return { blocked: `The ward does not run ${r.shifts.map((sh) => `${sh}`).join(" or ")} shifts, so this rule cannot be added.` };
    }
    const rule = savedRule(r, checks);
    const problem = checks.ruleProblem(who, rule);
    if (problem) return { blocked: problem };
    const notes = checks.offOnNotes(who, rule, l.strength);
    const warnings = [...skippedWarning(rules, who.id)];
    if (notes.fixedNote) warnings.push(notes.fixedNote);
    warnings.push(...notes.shortNotes);
    if (rule.type === "atLeast" && l.strength === "hard") warnings.push(atLeastMustText(who.name, rule));
    return { warnings };
  },

  apply: (d, l, { uid, today }) => {
    const { checks } = checksFor(d, today || "");
    d.rosterRules = {
      ...(d.rosterRules || {}),
      personRules: [...(d.rosterRules?.personRules || []),
        { id: uid(), staffId: l.staffId, ...savedRule(l.rule, checks), strength: l.strength }],
    };
    return d;
  },
};

/* ── fixed_duty ──
   Applied after leave and requests, so it sees leave or a request added
   by the same note, as the panel would once they were saved. */
const nextYear = (iso) => `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;

export const fixedDuty = {
  type: "fixed_duty",
  group: "people",
  order: 2,
  applyOrder: 2.5,
  people: ["staffId"],
  saved: (n) => plural(n, "fixed duty", "fixed duties"),

  fromServer: (a) => (isISO(a.date) && DUTIES.includes(a.duty) ? { staffId: a.staffId, date: a.date, duty: a.duty } : null),
  // A date gone by: Ini read a year into a note that gave none, so it asks.
  asks: (l, { today }) => (l.date < today
    ? { kind: "year", question: `${dayMonth(l.date)} ${parseISO(l.date).getFullYear()} has gone by. Which year did you mean?`,
        options: [l.date, nextYear(l.date)] }
    : null),
  missing: (l) => !!l.ask && l.ask.kind === "year" && !l.yearChosen,
  describe: (l) => ({
    what: "Fixed duty",
    when: `${CATEGORY_LABELS[l.duty]} on ${prettyWeekday(l.date)} ${parseISO(l.date).getFullYear()}, fixed by you — always kept`,
  }),

  check: (l, { sim, today }) => {
    const { checks } = checksFor(sim, today);
    if (l.duty !== "off" && !checks.runShifts.includes(l.duty)) {
      return { blocked: `The ward does not run ${l.duty} shifts, so this cannot be fixed.` };
    }
    const problem = checks.fixedProblem(staffOf(sim, l.staffId), { date: l.date, duty: l.duty });
    if (problem) return { blocked: problem };
    return { warnings: l.date < today ? ["this date has gone by, so it makes no difference"] : [] };
  },

  apply: (d, l, { uid }) => {
    d.rosterRules = {
      ...(d.rosterRules || {}),
      fixedDuties: [...(d.rosterRules?.fixedDuties || []), { id: uid(), staffId: l.staffId, date: l.date, duty: l.duty }],
    };
    return d;
  },
};
