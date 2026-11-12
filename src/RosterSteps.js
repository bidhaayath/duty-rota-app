/* ─────────────── Smart Roster in three steps ───────────────
   1 Ward needs · 2 Your staff · 3 Make the roster. The buttons along the
   top, always clickable, each saying where that step stands; the ready
   checklist shown before a week is made; and the one line said first about
   a proposed week. Nothing here changes a setting or the engine. The step
   a ward was last on is remembered in this browser, per department.     */

import React from "react";
import { Check, AlertTriangle } from "lucide-react";
import { LOOK_BACK_ALL } from "./rosterConfig";
import { STRENGTH_SCALE, levelOf } from "./WardNeeds";

/* ── The step a ward was last on ──
   localStorage can be missing, full, or blocked (a private window): then the
   page simply starts on step 1 and forgets, rather than failing. */
export const stepKey = (deptId) => `smartRoster:step:${deptId}`;
export function loadStep(deptId) {
  try {
    const n = Number(window.localStorage.getItem(stepKey(deptId)));
    return n === 2 || n === 3 ? n : 1;
  } catch (e) {
    return 1;
  }
}
export function saveStep(deptId, n) {
  try { window.localStorage.setItem(stepKey(deptId), String(n)); } catch (e) { /* nothing to remember it in */ }
}

/* ── The three buttons ── */
export const STEPS = [
  { n: 1, title: "Ward needs" },
  { n: 2, title: "Your staff" },
  { n: 3, title: "Make the roster" },
];

export function StepNav({ step, onStep, status, T }) {
  return (
    <nav aria-label="Steps" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
      {STEPS.map(({ n, title }) => {
        const current = step === n;
        const done = n === 1 && status[1] === "Done";
        return (
          <button key={n} type="button" onClick={() => onStep(n)} aria-current={current ? "step" : undefined}
            aria-label={`Step ${n}, ${title}: ${status[n]}`}
            style={{ fontFamily: "inherit", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px", padding: "10px 10px", minHeight: 60,
                     borderRadius: 14, cursor: "pointer", textAlign: "left", color: T.ink, minWidth: 0,
                     background: "#fff", border: current ? `2px solid ${T.lagoon}` : `1px solid ${T.line}` }}>
            <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 999, flexShrink: 0, display: "flex",
                                             alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13.5,
                                             background: current ? T.lagoon : done ? "#D7ECEF" : "#EEF4F5",
                                             color: current ? "#fff" : done ? T.lagoon : T.inkSoft }}>
              {done && !current ? "✓" : n}
            </span>
            {/* On the narrowest phones the words go under the number, not past the edge. */}
            <span style={{ display: "grid", gap: 1, minWidth: 0, flex: "1 1 40px" }}>
              <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>{title}</span>
              <span style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.3 }}>{status[n]}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

/* "← Back" and "Next: … →" at the foot of a step. */
export function StepFoot({ step, onStep, T }) {
  const button = (primary) => ({
    fontFamily: "inherit", fontSize: 14.5, fontWeight: 700, minHeight: 48, padding: "0 18px", borderRadius: 10, cursor: "pointer",
    border: primary ? "none" : `1px solid ${T.line}`, background: primary ? T.lagoon : "#fff", color: primary ? "#fff" : T.ink,
  });
  const next = STEPS.find((s) => s.n === step + 1);
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
      {step > 1 ? <button type="button" style={button(false)} onClick={() => onStep(step - 1)}>← Back</button> : <span />}
      {next && (
        <button type="button" style={button(true)} onClick={() => onStep(next.n)}>
          Next: {next.title.toLowerCase()} →
        </button>
      )}
    </div>
  );
}

/* ── Before a week is made ──
   What the week will be built from, line by line, each a tick or a warning. */
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function readyLines({ fit, rules, staff, from, to, data, senior, terms }) {
  const lines = [];
  // 1. The settings.
  lines.push(fit.ok
    ? { ok: true, text: `Ward needs fit your ${plural(fit.count, "staff member", "staff")}` }
    : { ok: false, text: "Ward needs don't add up yet", toStep: 1 });
  // 2. Enough people who can take charge, for what is asked.
  const { seniorCount, seniorPerDay, perPerson, needed } = senior;
  if (!seniorPerDay) lines.push({ ok: true, text: `No ${terms.lower} asked for on any shift` });
  else if (seniorCount >= needed) {
    lines.push({ ok: true, text: `${seniorCount} ${seniorCount === 1 ? terms.termOne : terms.termMany} on the roster — enough for ${seniorPerDay} a day` });
  } else {
    lines.push({ ok: false, text: `Only ${seniorCount} ${seniorCount === 1 ? terms.termOne : terms.termMany} for ${seniorPerDay} a day: at ${perPerson} duties each that needs ${needed}, so some shifts may have none`, toStep: 2 });
  }
  // 3. Who is on the roster.
  const skipped = staff.filter((s) => (rules.skipStaff || []).includes(s.id)).length;
  lines.push({ ok: true, text: `${plural(staff.length - skipped, "person", "people")} on the roster${skipped ? `, ${skipped} skipped` : ""}` });
  // 4. What is already decided this week: always kept.
  const inWeek = (d) => d >= from && d <= to;
  const asked = (data.dutyRequests || []).filter((r) => r.approved && inWeek(r.date)).length;
  const fixed = (rules.fixedDuties || []).filter((f) => f && inWeek(f.date)).length;
  lines.push({
    ok: true,
    text: asked || fixed
      ? `${[asked ? plural(asked, "approved duty request") : null, fixed ? plural(fixed, "duty", "duties") + " you fixed" : null]
        .filter(Boolean).join(" and ")} this week — always kept (Must)`
      : "No approved duty requests or fixed duties this week",
  });
  // 5. What may follow what.
  const n = (rules.sequenceRules || []).length;
  const level = STRENGTH_SCALE.find((o) => o.id === levelOf(rules.ruleStates?.sequence)).short;
  lines.push({ ok: true, text: n ? `${plural(n, "rule")} for what may follow what (${level})` : "No rules for what may follow what" });
  // 6. How far back fairness looks.
  const back = rules.lookbackDays || 0;
  lines.push({
    ok: true,
    text: !back ? "Not looking back at past duties for fair shares (rest after last week is still checked)"
      : back >= LOOK_BACK_ALL ? "Looking back at the entire roster for fair shares"
        : `Looking back at the last ${back} days for fair shares`,
  });
  return lines;
}

export function ReadyList({ lines, onStep, T }) {
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Ready to make the roster?</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {lines.map((l) => (
          <li key={l.text} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, lineHeight: 1.45 }}>
            <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 999, flexShrink: 0, display: "flex", alignItems: "center",
                                             justifyContent: "center", background: l.ok ? "#D7ECEF" : "#FFF1DC", color: l.ok ? T.lagoon : "#7A3C00" }}>
              {l.ok ? <Check size={13} /> : <AlertTriangle size={12} />}
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
                {l.ok ? "Ready: " : "Check: "}
              </span>
              {l.text}
              {l.toStep && (
                <>
                  {" — "}
                  <button type="button" onClick={() => onStep(l.toStep)}
                    style={{ fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, color: T.lagoon, background: "none", border: "none",
                             padding: "0 2px", minHeight: 44, cursor: "pointer", textDecoration: "underline" }}>
                    go back to step {l.toStep}
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── The one line said first about a proposed week ── */
export function weekSummary({ report, mustMissed = 0, termOne }) {
  const uncovered = (report.shortfalls || []).reduce((n, s) => n + (s.needed || 1), 0);
  const noInCharge = (report.seniorGaps || []).length;
  const parts = [
    uncovered ? `${plural(uncovered, "shift")} not covered` : null,
    noInCharge ? `${plural(noInCharge, "shift")} with no ${termOne}` : null,
    mustMissed ? `${plural(mustMissed, "personal Must rule")} not met` : null,
  ].filter(Boolean);
  return parts.length
    ? { ok: false, text: parts.join(" · ") }
    : { ok: true, text: "All Must rules met, every shift covered." };
}
