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
import {
  SHIFT_LABELS, CATEGORY_LABELS, DAY_LABEL, DAY_TYPES, RULE_COUNTS, isISO, upperFirst, ampList,
  fixedText, startsAs, rulePreview, fixedPreview, atLeastMustText, personChecks,
} from "./personRuleChecks";

const RULE_TYPES = [
  ["atMost", "At most … of a shift a week"],
  ["atLeast", "At least … of a shift a week"],
  ["apart", "Gap between shifts: at least … days"],
  ["together", "A shift in pairs (2 together)"],
  ["offOn", "Always off on … (days)"],
  ["onlyOn", "On … (days), only … (shifts)"],
  ["fixed", "Fixed duty on a date (set by you)"],
];
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
  rules, setRules, setPersonRules, setFixedDuties, editable, T, Card, Btn, Field, inputStyle, uid,
  data, allStaff, firstDay, termOne, termMany, today,
}) {
  /* Decided once, when the page opens: a ward with its own plural keeps the
     box for the whole visit, so clearing it to retype does not make it vanish. */
  const [showPlural] = useState(() => !!(rules.seniorTermPlural || "").trim());
  // One person's panel open at a time, and the rule being written in it, before Add.
  const blankDraft = (staffId) => ({ staffId, type: "atMost", count: 1, shift: "night", days: [], shifts: [], date: "", duty: "morning" });
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

  /* ── Duties the manager fixed ──
     Saved as one list beside the ward's settings (setFixedDuties removes it
     when empty). Always kept, as an approved request is; one that has gone
     by does nothing and is shown greyed until it is cleared. */
  const fixedDuties = (rules.fixedDuties || []).filter(Boolean);
  const fixedOf = (id) => fixedDuties.filter((f) => String(f.staffId) === String(id))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const pastFixed = fixedDuties.filter((f) => isISO(f.date) && f.date < today);

  /* The checks, shared with Ini (personRuleChecks.js): what may be added,
     and what it costs. */
  const checks = personChecks({ rules, data, allStaff, firstDay });
  const { runShifts, weekOrder, dayRulesOf, fixedOffNote, shortDayText } = checks;
  const draftShift = runShifts.includes(draft.shift) ? draft.shift : runShifts[0];
  const onDays = DAY_TYPES.includes(draft.type);
  const isFixed = draft.type === "fixed";
  const draftRule = onDays
    ? { type: draft.type, days: weekOrder.filter((d) => draft.days.includes(d)),
        ...(draft.type === "onlyOn" ? { shifts: runShifts.filter((sh) => draft.shifts.includes(sh)) } : {}) }
    : { type: draft.type, shift: draftShift, count: draft.type === "together" ? 2 : draft.count };
  const fixedChoices = [...runShifts, "off"];
  const draftComplete = isFixed ? isISO(draft.date) && fixedChoices.includes(draft.duty)
    : onDays
      ? draftRule.days.length > 0 && (draft.type === "offOn" || draftRule.shifts.length > 0)
      : !!draftShift;
  const draftPerson = allStaff.find((s) => String(s.id) === draft.staffId);
  const shortNow = checks.shortDays(ownRules);

  // Why the rule as written cannot be added, in the manager's words.
  const draftProblem = !draftPerson || !draftComplete ? null
    : isFixed ? checks.fixedProblem(draftPerson, { date: draft.date, duty: draft.duty })
    : checks.ruleProblem(draftPerson, draftRule);
  const addOwnRule = () => {
    if (!draftPerson || !draftComplete || draftProblem) return;
    if (isFixed) {
      setFixedDuties([...fixedDuties, { id: uid(), staffId: draftPerson.id, date: draft.date, duty: draft.duty }]);
      return;
    }
    setPersonRules([...ownRules, { id: uid(), staffId: draftPerson.id, ...draftRule, strength: startsAs(draft.type) }]);
  };
  // What the rule being written says, before Add.
  const preview = (name) => (isFixed
    ? fixedPreview(name, { date: draft.date, duty: draft.duty })
    : rulePreview(name, draftRule));
  // Said before Add, for a fixed day off as it would be saved.
  const draftNotes = draftPerson && draftComplete && !draftProblem
    ? checks.offOnNotes(draftPerson, draftRule, startsAs(draft.type)) : { fixedNote: null, shortNotes: [] };
  const draftFixedNote = draftNotes.fixedNote;
  const draftShortNotes = draftNotes.shortNotes;

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
        {r.type === "atLeast" && r.strength === "hard" && warn(atLeastMustText(staffName(r.staffId), r))}
        {/* Said once per person, under their first fixed day off. */}
        {r.type === "offOn" && dayRulesOf(r.staffId).find((x) => x.type === "offOn") === r
          && fixedOffNote(r.staffId, ownRules) && (
          <p style={{ ...hint, fontSize: 12, margin: "5px 0 0" }}>{fixedOffNote(r.staffId, ownRules)}</p>
        )}
      </div>
    );
  };

  /* A fixed duty as a line: always kept, so no Must or Try; one gone by is greyed. */
  const fixedLine = (f) => {
    const past = isISO(f.date) && f.date < today;
    const text = fixedText(f);
    return (
      <div key={f.id} style={{ borderTop: `1px solid ${T.line}`, padding: "4px 0", display: "flex", gap: 8, alignItems: "center",
                               flexWrap: "wrap", opacity: past ? 0.55 : 1 }}>
        <span style={{ fontSize: 14, flex: "1 1 180px", minWidth: 0 }}>{text}{past ? " (gone by)" : ""}</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, borderRadius: 9, padding: "0 12px", minHeight: 44, display: "inline-flex",
                       alignItems: "center", ...TAG.purple }}>Always kept</span>
        {removeButton(`Remove: ${text}`, () => setFixedDuties(fixedDuties.filter((x) => x.id !== f.id)))}
      </div>
    );
  };

  const panel = (s, mine, requests, fixed) => (
    <div style={{ marginTop: 10, padding: 12, borderRadius: 12, background: "#F6FAFA", border: `1px solid ${T.line}`,
                  display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 6 }}>
      {mine.length > 0 && mine.map(ruleLine)}
      {fixed.length > 0 && fixed.map(fixedLine)}
      {!mine.length && !fixed.length && (
        <span style={{ ...hint }}>No rules of {s.name}'s own yet: the ward's settings apply.</span>
      )}
      {requests.length > 0 && (
        <span style={{ ...hint, fontSize: 12 }}>
          Blue labels are approved duty requests. Change them in the Duty requests tab.
        </span>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", paddingTop: 8, borderTop: `1px solid ${T.line}` }}>
        {/* Its own label, not Field, so the longest kind of rule can narrow to a small phone. */}
        <label style={{ display: "grid", gap: 5, flex: "1 1 240px", minWidth: 0, fontSize: 12.5, fontWeight: 600, color: T.inkSoft }}>
          Add a rule
          <select aria-label={`Add a rule for ${s.name}`} style={{ ...field, width: "100%", minWidth: 0 }} disabled={!editable} value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value, count: RULE_COUNTS[e.target.value]?.start ?? draft.count })}>
            {RULE_TYPES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        {isFixed && (
          <>
            <Field label="Date">
              <input type="date" style={{ ...field, width: "auto" }} disabled={!editable} value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            </Field>
            <Field label="Duty">
              <select style={{ ...field, width: "auto" }} disabled={!editable} value={draft.duty}
                onChange={(e) => setDraft({ ...draft, duty: e.target.value })}>
                {fixedChoices.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </Field>
          </>
        )}
        {!isFixed && !onDays && draft.type !== "together" && (
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
        {!isFixed && !onDays && (
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
      {draftComplete && <p style={{ ...hint, margin: "4px 0 0" }}>{preview(s.name)}</p>}
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
        <span style={{ ...TAG.blue, borderRadius: 6, padding: "0 5px" }}>Blue</span>: approved duty requests.{" "}
        <span style={{ ...TAG.purple, borderRadius: 6, padding: "0 5px" }}>Purple</span>: duties you fixed, always kept.
      </p>
      <p style={{ ...hint, margin: "0 0 8px" }}>Staff on recorded leave are skipped automatically for those days.</p>
      {/* Fixed duties that have gone by do nothing; one press clears them all, as one Undo step. */}
      {pastFixed.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <button type="button" disabled={!editable}
            onClick={() => setFixedDuties(fixedDuties.filter((f) => !(isISO(f.date) && f.date < today)))}
            style={{ fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, minHeight: 44, padding: "0 14px", borderRadius: 10,
                     border: `1px solid ${T.line}`, background: "#fff", color: T.lagoon, cursor: editable ? "pointer" : "not-allowed" }}>
            Clear past fixed duties ({pastFixed.length})
          </button>
        </div>
      )}

      {/* Days a Must leaves too few people for: said once each, for the whole list. */}
      {shortNow.map((d) => warn(shortDayText(d, ownRules), `short-${d}`))}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)" }}>
        {allStaff.map((s) => {
          const only = rules.staffShifts?.[s.id] || [];
          const skipped = rules.skipStaff.includes(s.id);
          const isSenior = rules.seniorStaff.includes(s.id);
          const mine = rulesOf(s.id);
          const fixed = fixedOf(s.id);
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
                    {fixed.map((f) => (
                      <span key={f.id} style={{ opacity: isISO(f.date) && f.date < today ? 0.55 : 1 }}>
                        <Tag tone="purple">{fixedText(f)}</Tag>
                      </span>
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
                  {isOpen ? "Close" : mine.length + fixed.length ? `Rules (${mine.length + fixed.length})` : "+ Rule"}
                </button>
              </div>
              {isOpen && panel(s, mine, requests, fixed)}
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
