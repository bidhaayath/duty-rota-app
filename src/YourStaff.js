/* ─────────────── Smart Roster: your staff ───────────────
   Step 2 of the redesign: every member of staff in one list. Each row has
   what is set for that person — the shifts they are kept to, whether they
   can take charge, Skip, their own rules, and their approved duty requests —
   and a panel under the row to add and change their rules.

   A new face on what was the Staff exceptions and Personal rules cards. The
   rules about rules are unchanged, moved here as they were: every refusal and
   every warning still applies, and every control writes the very keys the
   old ones wrote, through the same handlers.                             */

import React, { useState } from "react";
import { Plus, X, AlertTriangle } from "lucide-react";
import { SHIFTS, personRuleText } from "./rosterEngine";
import { prettyWeekday } from "./monthBuild";

const SHIFT_LABELS = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };
const CATEGORY_LABELS = { ...SHIFT_LABELS, off: "Off" };
const DAY_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/* Rules about days of the week: ticked days in place of a shift and a
   number. Just the seven days — weekends differ from ward to ward, so
   there is no shortcut for one, and a public holiday is not a day here. */
const DAY_TYPES = ["offOn", "onlyOn"];
/* What a new rule starts at, and how far its number can go. */
const RULE_COUNTS = {
  atMost: { start: 1, min: 0, max: 7 },
  atLeast: { start: 1, min: 1, max: 7 },
  apart: { start: 2, min: 1, max: 6 },
  together: { start: 2, min: 2, max: 2 },
};
const RULE_TYPES = [
  ["atMost", "At most … of a shift a week"],
  ["atLeast", "At least … of a shift a week"],
  ["apart", "Gap between shifts: at least … days"],
  ["together", "A shift in pairs (2 together)"],
  ["offOn", "Always off on … (days)"],
  ["onlyOn", "On … (days), only … (shifts)"],
];
const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const andList = (words) => (words.length < 2 ? words.join("")
  : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);
const ampList = (words) => (words.length < 2 ? words.join("")
  : `${words.slice(0, -1).join(", ")} & ${words[words.length - 1]}`);
const toggled = (list, x) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
// Approved requests shown on a row before "+N more".
const REQUESTS_SHOWN = 3;

/* Must or Try for one person's rule. No Ignore: a rule nobody wants is removed. */
function MustTry({ value, onChange, disabled, T, label }) {
  const hard = value === "hard";
  return (
    <span role="group" aria-label={label}
      style={{ display: "inline-flex", borderRadius: 9, overflow: "hidden", border: `1px solid ${T.line}`, flexShrink: 0 }}>
      {["hard", "soft"].map((v) => (
        <button key={v} type="button" disabled={disabled} onClick={() => onChange(v)} aria-pressed={(v === "hard") === hard}
          style={{ fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, border: "none", minHeight: 44, minWidth: 52,
            padding: "0 12px", cursor: disabled ? "not-allowed" : "pointer",
            background: (v === "hard") === hard ? (v === "hard" ? T.lagoon : T.sand) : "transparent",
            color: (v === "hard") === hard ? "#fff" : T.inkSoft }}>
          {v === "hard" ? "Must" : "Try"}
        </button>
      ))}
    </span>
  );
}

/* A small label under a name: grey for a person's own settings and rules,
   blue for an approved duty request. */
const TAG = {
  grey: { background: "#EEF4F3", color: "#3F5A63" },
  blue: { background: "#E2EEFB", color: "#0B4F8A" },
  purple: { background: "#EFE6FB", color: "#5B2D8A" },
};
const Tag = ({ tone, children }) => (
  <span style={{ fontSize: 12, borderRadius: 8, padding: "3px 8px", lineHeight: 1.4, ...TAG[tone] }}>{children}</span>
);

export default function YourStaff({
  rules, setRules, setPersonRules, editable, T, Card, Btn, Field, inputStyle, uid,
  data, allStaff, firstDay, termOne, termMany, today,
}) {
  /* Decided once, when the page opens: a ward with its own plural keeps the
     box for the whole visit, so clearing it to retype does not make it vanish. */
  const [showPlural] = useState(() => !!(rules.seniorTermPlural || "").trim());
  // One person's panel open at a time, and the rule being written in it, before Add.
  const blankDraft = (staffId) => ({ staffId, type: "atMost", count: 1, shift: "night", days: [], shifts: [] });
  const [draft, setDraft] = useState(blankDraft(""));
  const open = draft.staffId;
  const [allRequests, setAllRequests] = useState([]);   // rows showing every request

  /* ── The settings these write: the same as the old cards ── */
  const toggleSkip = (id) =>
    setRules({ skipStaff: rules.skipStaff.includes(id) ? rules.skipStaff.filter((x) => x !== id) : [...rules.skipStaff, id] });
  const toggleSenior = (id) =>
    setRules({ seniorStaff: rules.seniorStaff.includes(id) ? rules.seniorStaff.filter((x) => x !== id) : [...rules.seniorStaff, id] });
  const setStaffShifts = (id, list) => {
    const next = { ...(rules.staffShifts || {}) };
    if (list.length) next[id] = list; else delete next[id];
    setRules({ staffShifts: next });
  };

  /* ── One person's own rules ──
     Saved as one list beside the ward's settings (setPersonRules removes it
     when empty, so taking every rule away leaves nothing behind). */
  const ownRules = rules.personRules || [];
  const setOwnStrength = (id, strength) =>
    setPersonRules(ownRules.map((r) => (r.id === id ? { ...r, strength } : r)));
  const staffName = (id) => (data.staff || []).find((s) => String(s.id) === String(id))?.name;
  const rulesOf = (id) => ownRules.filter((r) => String(r.staffId) === String(id));
  // Rules saved for somebody no longer on the ward: kept in view so they can be taken away.
  const onWard = new Set(allStaff.map((s) => String(s.id)));
  const leftRules = ownRules.filter((r) => r && !onWard.has(String(r.staffId)));

  // Only shifts the ward runs can carry a rule.
  const runShifts = SHIFTS.filter((sh) => rules.coverage[sh]?.max !== 0);
  const draftShift = runShifts.includes(draft.shift) ? draft.shift : runShifts[0];
  const onDays = DAY_TYPES.includes(draft.type);
  // The week in the ward's own order, so a Monday ward reads Saturday and Sunday.
  const weekOrder = [...Array(7)].map((_, i) => (firstDay + i) % 7);
  const draftRule = onDays
    ? { type: draft.type, days: weekOrder.filter((d) => draft.days.includes(d)),
        ...(draft.type === "onlyOn" ? { shifts: runShifts.filter((sh) => draft.shifts.includes(sh)) } : {}) }
    : { type: draft.type, shift: draftShift, count: draft.type === "together" ? 2 : draft.count };
  const draftComplete = onDays
    ? draftRule.days.length > 0 && (draft.type === "offOn" || draftRule.shifts.length > 0)
    : !!draftShift;
  const draftPerson = allStaff.find((s) => String(s.id) === draft.staffId);

  // Somebody's rules about days, as saved and readable.
  const dayRulesOf = (staffId, list = ownRules) => list.filter((r) => String(r.staffId) === String(staffId)
    && DAY_TYPES.includes(r.type) && Array.isArray(r.days) && (r.type === "offOn" || Array.isArray(r.shifts)));
  // Days of the week those leave open for a shift: not off, and not kept to other shifts.
  const daysOpenFor = (dayRules, shift) => weekOrder.filter((d) => !dayRules.some((r) => r.days.includes(d)
    && (r.type === "offOn" || !r.shifts.includes(shift)))).length;
  const daysWord = (n) => `${n} day${n === 1 ? "" : "s"}`;

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
  const shortNow = shortDays(ownRules);

  /* Why the rule as written cannot be added, in the manager's words. Asked
     before saving, so a list never holds two rules that fight each other. */
  const draftProblem = (() => {
    if (!draftPerson || !draftComplete) return null;
    const who = draftPerson.name;
    const dayRules = dayRulesOf(draftPerson.id);
    if (onDays) {
      const clash = dayRules.find((r) => r.days.some((d) => draftRule.days.includes(d)));
      if (clash) {
        const day = DAY_LABEL[weekOrder.find((d) => clash.days.includes(d) && draftRule.days.includes(d))];
        return `${who} already has "${personRuleText(clash)}", which covers ${day}. Remove it first to change it.`;
      }
      if (draft.type === "offOn" && draftRule.days.length === 7) {
        return `That is every day of the week. To leave ${who} off the rota, use Skip above.`;
      }
      if (draft.type === "onlyOn") {
        const ticks = rules.staffShifts?.[draftPerson.id] || [];
        const works = ticks.length ? runShifts.filter((sh) => ticks.includes(sh)) : runShifts;
        if (!works.some((sh) => draftRule.shifts.includes(sh))) {
          return `${who} is set up above for ${andList(works.map((sh) => `${sh}s`))} only, so on those days ${who} `
            + `could only be off. Use "Always off on" for that.`;
        }
        if (works.every((sh) => draftRule.shifts.includes(sh))) {
          return `Those are all the shifts ${who} works, so this rule would change nothing.`;
        }
      }
      const after = [...dayRules, draftRule];
      const least = ownRules.find((r) => String(r.staffId) === String(draftPerson.id) && r.type === "atLeast"
        && r.count > daysOpenFor(after, r.shift));
      if (least) {
        return `${who} has "${personRuleText(least)}", and with this rule only ${daysWord(daysOpenFor(after, least.shift))} `
          + `a week would be left for ${least.shift}s.`;
      }
      return null;
    }
    const mine = ownRules.filter((r) => String(r.staffId) === String(draftPerson.id) && r.shift === draftShift);
    const has = (type) => mine.find((r) => r.type === type);
    if (draftRule.type === "atLeast" && draftRule.count > daysOpenFor(dayRules, draftShift)) {
      return `${who}'s rules about days leave ${daysWord(daysOpenFor(dayRules, draftShift))} a week for ${draftShift}s, `
        + `so at least ${draftRule.count} could never be met.`;
    }
    if (has(draftRule.type)) {
      return `${who} already has "${personRuleText(has(draftRule.type))}". Remove it first to change it.`;
    }
    const other = draftRule.type === "apart" ? has("together") : draftRule.type === "together" ? has("apart") : null;
    if (other) {
      return `${who} already has "${personRuleText(other)}". A gap between shifts and pairs cannot both apply to ${draftShift}s, so remove that one first.`;
    }
    const most = draftRule.type === "atLeast" ? has("atMost") : null;
    const least = draftRule.type === "atMost" ? has("atLeast") : null;
    if (most && draftRule.count > most.count) {
      return `${who} has "${personRuleText(most)}", so at least ${draftRule.count} could never be met.`;
    }
    if (least && draftRule.count < least.count) {
      return `${who} has "${personRuleText(least)}", so at most ${draftRule.count} could never be met.`;
    }
    return null;
  })();
  const addOwnRule = () => {
    if (!draftPerson || !draftComplete || draftProblem) return;
    /* A fixed day off starts as Must: it is usually a promise made to the
       person. Every other rule starts as Try: kept whenever the week allows. */
    setPersonRules([...ownRules, {
      id: uid(), staffId: draftPerson.id, ...draftRule, strength: draft.type === "offOn" ? "hard" : "soft",
    }]);
  };
  const startsAs = draft.type === "offOn" ? "Must" : "Try";
  // Said before Add, for a fixed day off as it would be saved.
  const draftAfter = draftPerson && draftComplete && !draftProblem && draft.type === "offOn"
    ? [...ownRules, { ...draftRule, staffId: draftPerson.id, strength: "hard" }] : null;
  const draftFixedNote = draftAfter && fixedOffNote(draftPerson.id, draftAfter);
  // Only a day this rule would newly leave short; one already short is said above the list.
  const draftShortNotes = draftAfter
    ? shortDays(draftAfter).filter((d) => draftRule.days.includes(d) && !shortNow.includes(d))
      .map((d) => shortDayText(d, draftAfter))
    : [];

  /* Approved duty requests, from today on: read here, changed in the Duty requests tab. */
  const requestsOf = (id) => (data.dutyRequests || [])
    .filter((r) => r.approved && String(r.staffId) === String(id) && r.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  /* ── How it looks ── */
  const field = { ...inputStyle, minHeight: 44, boxSizing: "border-box", maxWidth: "100%" };
  const chip = (on, colour, enabled = editable) => ({
    fontFamily: "inherit", fontSize: 13, fontWeight: 600, borderRadius: 999, minHeight: 44,
    padding: "0 14px", cursor: enabled ? "pointer" : "not-allowed",
    border: `1px solid ${on ? colour : T.line}`,
    background: on ? (colour === T.coral ? "#FBEAE7" : "#D8EEE9") : "#fff",
    color: on ? colour : T.inkSoft,
  });
  const warn = (text, key) => (
    <p key={key || text} style={{ fontSize: 12.5, color: "#8A5A0F", margin: "6px 0 0", display: "flex", gap: 6, alignItems: "flex-start" }}>
      <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 3 }} />
      <span>{text}</span>
    </p>
  );
  const hint = { fontSize: 12.5, color: T.inkSoft, lineHeight: 1.6 };
  const removeButton = (label, onClick) => (
    <button type="button" aria-label={label} disabled={!editable} onClick={onClick}
      style={{ width: 44, height: 44, background: "none", border: "none", color: T.inkSoft, flexShrink: 0,
               cursor: editable ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <X size={18} />
    </button>
  );
  // The shifts a person can be ticked for: those the ward runs, and any already ticked.
  const chipShifts = (only) => SHIFTS.filter((sh) => runShifts.includes(sh) || only.includes(sh));

  /* One rule as a line: the sentence, Must or Try, remove; and what it costs, where it costs something. */
  const ruleLine = (r) => {
    const text = upperFirst(personRuleText(r));
    return (
      <div key={r.id} style={{ borderTop: `1px solid ${T.line}`, padding: "4px 0" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, flex: "1 1 180px", minWidth: 0 }}>{text}</span>
          <MustTry value={r.strength} disabled={!editable} T={T} label={`${text}: Must or Try`}
            onChange={(v) => setOwnStrength(r.id, v)} />
          {removeButton(`Remove: ${text}`, () => setPersonRules(ownRules.filter((x) => x.id !== r.id)))}
        </div>
        {r.type === "atLeast" && r.strength === "hard" && warn(
          `A Must here can leave another shift uncovered so that ${staffName(r.staffId) || "they"} gets `
          + `${r.count} ${r.shift}${r.count === 1 ? "" : "s"}. Try is usually enough: it is met whenever the week allows.`)}
        {/* Said once per person, under their first fixed day off. */}
        {r.type === "offOn" && dayRulesOf(r.staffId).find((x) => x.type === "offOn") === r
          && fixedOffNote(r.staffId, ownRules) && (
          <p style={{ ...hint, fontSize: 12, margin: "5px 0 0" }}>{fixedOffNote(r.staffId, ownRules)}</p>
        )}
      </div>
    );
  };

  const panel = (s, mine, requests) => (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: "#F6FAFA", border: `1px solid ${T.line}`, display: "grid", gap: 6 }}>
      {mine.length > 0 ? mine.map(ruleLine)
        : <span style={{ ...hint }}>No rules of {s.name}'s own yet: the ward's settings apply.</span>}
      {requests.length > 0 && (
        <span style={{ ...hint, fontSize: 12 }}>
          Blue labels are approved duty requests. Change them in the Duty requests tab.
        </span>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", paddingTop: 8, borderTop: `1px solid ${T.line}` }}>
        <Field label="Add a rule">
          <select aria-label={`Add a rule for ${s.name}`} style={{ ...field, width: "auto" }} disabled={!editable} value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value, count: RULE_COUNTS[e.target.value]?.start ?? draft.count })}>
            {RULE_TYPES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </Field>
        {!onDays && draft.type !== "together" && (
          <Field label={draft.type === "apart" ? "Days" : "How many"}>
            <input type="number" style={{ ...field, width: 80 }} disabled={!editable}
              min={RULE_COUNTS[draft.type].min} max={RULE_COUNTS[draft.type].max} value={draft.count}
              onChange={(e) => {
                const { min, max } = RULE_COUNTS[draft.type];
                const n = Math.round(Number(e.target.value));
                setDraft({ ...draft, count: Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min });
              }} />
          </Field>
        )}
        {!onDays && (
          <Field label="Shift">
            <select style={{ ...field, width: "auto" }} disabled={!editable} value={draftShift}
              onChange={(e) => setDraft({ ...draft, shift: e.target.value })}>
              {runShifts.map((sh) => <option key={sh} value={sh}>{SHIFT_LABELS[sh]}</option>)}
            </select>
          </Field>
        )}
      </div>
      {onDays && (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: T.inkSoft, minWidth: 48 }}>Days</span>
            {weekOrder.map((d) => {
              const on = draft.days.includes(d);
              return (
                <button key={d} type="button" disabled={!editable} aria-pressed={on} aria-label={DAY_LABEL[d]}
                  onClick={() => setDraft({ ...draft, days: toggled(draft.days, d) })} style={chip(on, T.lagoon)}>
                  {on ? "✓ " : ""}{DAY_LABEL[d].slice(0, 3)}
                </button>
              );
            })}
          </div>
          {draft.type === "onlyOn" && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.inkSoft, minWidth: 48 }}>Only</span>
              {runShifts.map((sh) => {
                const on = draft.shifts.includes(sh);
                return (
                  <button key={sh} type="button" disabled={!editable} aria-pressed={on} aria-label={`Only ${sh}s`}
                    onClick={() => setDraft({ ...draft, shifts: toggled(draft.shifts, sh) })} style={chip(on, T.lagoon)}>
                    {on ? "✓ " : ""}{SHIFT_LABELS[sh]}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {draftComplete && (
        <p style={{ ...hint, margin: "4px 0 0" }}>{s.name}: {personRuleText(draftRule)} — starts as {startsAs}.</p>
      )}
      {draftFixedNote && <p style={{ ...hint, margin: 0 }}>{draftFixedNote}</p>}
      {draftShortNotes.map((text) => warn(text))}
      {draftProblem && warn(draftProblem)}
      <div>
        <Btn disabled={!editable || !draftComplete || !!draftProblem} onClick={addOwnRule} style={{ minHeight: 44 }}>
          <Plus size={15} /> Add rule
        </Btn>
      </div>
    </div>
  );

  return (
    <Card>
      <h3 style={{ fontFamily: "Sora, sans-serif", fontSize: 16, margin: 0 }}>Your staff</h3>
      <p style={{ ...hint, margin: "4px 0 12px" }}>
        Everything about each person in one row: the shifts they do, who can take charge, who to skip,
        their own rules, and their approved duty requests.
      </p>

      <div style={{ display: "flex", gap: "8px 12px", alignItems: "end", flexWrap: "wrap", background: "#F6FAFA",
                    borderRadius: 12, padding: "10px 12px", marginBottom: 10 }}>
        <Field label="This ward calls the person in charge">
          <input style={{ ...field, width: 190 }} disabled={!editable}
            value={rules.seniorTerm} placeholder="Senior"
            onChange={(e) => setRules({ seniorTerm: e.target.value })} />
        </Field>
        {/* Only for a ward that already saved its own plural, so it can still
            change or clear it. New wards get the word plus "s". Once cleared,
            the box is gone the next time the page opens. */}
        {showPlural && (
          <Field label="More than one of them">
            <input style={{ ...field, width: 190 }} disabled={!editable}
              value={rules.seniorTermPlural} placeholder={`${termOne}s`}
              onChange={(e) => setRules({ seniorTermPlural: e.target.value })} />
          </Field>
        )}
        <span style={{ ...hint, flex: "1 1 200px", paddingBottom: 10 }}>e.g. Shift Manager, In-charge, Sister</span>
      </div>

      <p style={{ ...hint, margin: "0 0 4px" }}>
        <strong>Ticked shifts</strong>: they only ever do those (no ticks = any shift).{" "}
        <strong>{termOne}</strong>: can take charge. <strong>Skip</strong>: left out; enter their duties by hand.{" "}
        <span style={{ ...TAG.blue, borderRadius: 6, padding: "0 5px" }}>Blue</span>: approved duty requests.
      </p>
      <p style={{ ...hint, margin: "0 0 8px" }}>Staff on recorded leave are skipped automatically for those days.</p>

      {/* Days a Must leaves too few people for: said once each, for the whole list. */}
      {shortNow.map((d) => warn(shortDayText(d, ownRules), `short-${d}`))}

      <div style={{ display: "grid" }}>
        {allStaff.map((s) => {
          const only = rules.staffShifts?.[s.id] || [];
          const skipped = rules.skipStaff.includes(s.id);
          const isSenior = rules.seniorStaff.includes(s.id);
          const mine = rulesOf(s.id);
          const requests = requestsOf(s.id);
          const showAll = allRequests.includes(String(s.id));
          const shownRequests = showAll ? requests : requests.slice(0, REQUESTS_SHOWN);
          const isOpen = open === String(s.id);
          return (
            <div key={s.id} role="group" aria-label={s.name}
              style={{ borderTop: `1px solid ${T.line}`, padding: "10px 0" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", opacity: skipped ? 0.55 : 1 }}>
                <div style={{ flex: "1 1 220px", minWidth: 0, display: "grid", gap: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{s.name}</span>
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {only.length > 0 && <Tag tone="grey">{ampList(SHIFTS.filter((sh) => only.includes(sh)).map((sh) => SHIFT_LABELS[sh]))} only</Tag>}
                    {mine.map((r) => <Tag key={r.id} tone="grey">{upperFirst(personRuleText(r))}{r.strength === "hard" ? " (Must)" : ""}</Tag>)}
                    {shownRequests.map((r) => (
                      <Tag key={r.id || `${r.date}|${r.category}`} tone="blue">
                        {CATEGORY_LABELS[r.category] || r.category} on {prettyWeekday(r.date)}
                      </Tag>
                    ))}
                    {requests.length > REQUESTS_SHOWN && (
                      <button type="button" aria-expanded={showAll}
                        onClick={() => setAllRequests(showAll ? allRequests.filter((x) => x !== String(s.id)) : [...allRequests, String(s.id)])}
                        style={{ fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, color: "#0B4F8A", background: "none",
                                 border: "none", padding: "0 8px", minHeight: 44, cursor: "pointer" }}>
                        {showAll ? "Show fewer" : `+${requests.length - REQUESTS_SHOWN} more`}
                      </button>
                    )}
                  </span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  {chipShifts(only).map((sh) => {
                    const on = only.includes(sh);
                    return (
                      <button key={sh} type="button" disabled={!editable || skipped} aria-pressed={on}
                        onClick={() => setStaffShifts(s.id, on ? only.filter((x) => x !== sh) : [...only, sh])}
                        style={chip(on, T.lagoon, editable && !skipped)}>
                        {on ? "✓ " : ""}{SHIFT_LABELS[sh]}
                      </button>
                    );
                  })}
                  <button type="button" disabled={!editable || skipped} aria-pressed={isSenior} onClick={() => toggleSenior(s.id)}
                    style={chip(isSenior, T.lagoon, editable && !skipped)}>
                    {isSenior ? "✓ " : ""}{termOne}
                  </button>
                  <button type="button" disabled={!editable} aria-pressed={skipped} onClick={() => toggleSkip(s.id)}
                    style={chip(skipped, T.coral)}>
                    {skipped ? "✓ Skipped" : "Skip"}
                  </button>
                </div>
                <button type="button" aria-expanded={isOpen}
                  onClick={() => setDraft(blankDraft(isOpen ? "" : String(s.id)))}
                  style={{ fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, minHeight: 44, padding: "0 14px",
                           borderRadius: 10, border: `1px solid ${T.line}`, background: "#fff", color: T.lagoon, cursor: "pointer" }}>
                  {isOpen ? "Close" : mine.length ? `Rules (${mine.length})` : "+ Rule"}
                </button>
              </div>
              {isOpen && panel(s, mine, requests)}
            </div>
          );
        })}
        {!allStaff.length && <p style={{ ...hint, margin: 0 }}>No staff yet.</p>}
      </div>

      {leftRules.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${T.line}`, display: "grid", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Rules for people no longer on this ward</span>
          {leftRules.map((r) => {
            const text = upperFirst(personRuleText(r));
            return (
              <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, flex: "1 1 200px", minWidth: 0 }}>
                  {staffName(r.staffId) || "Someone no longer on this ward"}: {text}
                </span>
                {removeButton(`Remove: ${text}`, () => setPersonRules(ownRules.filter((x) => x.id !== r.id)))}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
