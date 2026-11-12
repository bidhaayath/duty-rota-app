/* ─────────────── Smart Roster ───────────────
   One week at a time. The settings that matter are on the page — what the
   ward needs is in WardNeeds.js — and everything else has a sensible
   default and sits folded away for the rare occasion someone needs it.

   What it is trying to do, in order:
     1. Cover every shift with the number of staff you asked for, and with
        somebody on it who can take charge.
     2. Give everyone a fair mix — not five afternoons in a row while
        somebody else does all the nights.
     3. Respect the rest rules: at most two off days, no morning straight
        after a night or an afternoon.

   Nothing is written to the rota until Apply is pressed.                */

import React, { useState, useMemo, useEffect } from "react";
import { Wand2, AlertTriangle, Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { generateRoster, checkFeasible, toRotaCells, SHIFTS, mustCauseText } from "./rosterEngine";
import { prettyWeekday } from "./monthBuild";
/* The settings, the engine configuration and the Apply helpers live in
   rosterConfig.js, shared with Ini's month builder so the two never drift
   apart. Moved there unchanged; rosterConfig.test.js proves it. */
import {
  mergeRules, seniorTermsOf, seniorNeedOf,addDays, shiftISO, employedOn,
  weekDatesFrom, activeStaffFor, codeTextById, codeIdByText, flattenCells,
  chosenCodesFor, weekConfig, planWrites, exchangeMarksIn, writeCells, findMismatches,
} from "./rosterConfig";
import { checkSettings, settingsKey } from "./settingsCheck";
import { ShiftNeeds, PersonWeek, GivesWay, FollowRules } from "./WardNeeds";
import { whyNoInCharge, noInChargeText } from "./inChargeGaps";
import YourStaff from "./YourStaff";
import { StepNav, StepFoot, ReadyList, readyLines, loadStep, saveStep, weekSummary } from "./RosterSteps";

const SHIFT_LABELS = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };

/* Back to the start of whatever the ward calls a week — Sunday in the
   Maldives, Monday across much of Europe. 0 is Sunday, matching JavaScript's
   own day numbering, so nothing has to be translated on the way through. */
const weekStartOf = (d, firstDay = 0) => {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - (((x.getDay() - firstDay) % 7) + 7) % 7);
  return x;
};
const DAY_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// People's rules about days of the week; how they are added and changed is in YourStaff.js.
const DAY_TYPES = ["offOn", "onlyOn"];

export default function SmartRosterTab({
  data, update, staffEditable, T, Card, Btn, Field, inputStyle, th, td, uid, dstr,
  onApplied, deptId,
}) {
  const rules = mergeRules(data.rosterRules || {});

  /* The word this ward uses. Everything on the page and every message the
     engine produces follows it, so a ward that says "in-charge" never sees
     the word "senior" anywhere. */
  const { termOne, termMany, lower } = seniorTermsOf(rules);

  /* Which day a week begins on, as set in Settings. Sunday unless the ward
     says otherwise, which is what every existing rota has always assumed. */
  const firstDay = data.weekStartsOn ?? 0;

  // Next week, since that is almost always the one being planned.
  const [weekStart, setWeekStart] = useState(() => dstr(weekStartOf(addDays(new Date(), 7), data.weekStartsOn ?? 0)));

  /* Changing the setting in the middle of planning would otherwise leave the
     picker on a date that is no longer the start of a week. */
  useEffect(() => {
    setWeekStart((w) => dstr(weekStartOf(new Date(w), firstDay)));
    // dstr is listed because React asks for it, not because it moves — it is
    // defined once at the top of the app and handed down unchanged.
  }, [firstDay, dstr]);
  const [proposal, setProposal] = useState(null);
  /* A week belongs to the department it was generated for. Normally the tab
     starts afresh on a new department (it is keyed on it), but this does not
     rely on that: a week from elsewhere is never shown as appliable. */
  const proposalElsewhere = !!proposal && proposal.deptId !== deptId;
  const [busy, setBusy] = useState(false);
  const [showMore, setShowMore] = useState(false);

  /* ── Which of the three steps is showing ──
     The one this department was last on, as remembered in this browser. */
  const [step, setStep] = useState(() => loadStep(deptId));
  useEffect(() => { setStep(loadStep(deptId)); }, [deptId]);
  const goStep = (n) => {
    setStep(n);
    saveStep(deptId, n);
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (e) { /* not in every browser */ }
  };

  const setRules = (patch) => update((d) => { d.rosterRules = { ...rules, ...patch }; return d; });

  const weekEnd = dstr(addDays(new Date(weekStart), 6));
  const today = dstr(new Date());

  /* ── Who is actually on the rota this week ──
     Employment dates are inclusive, and the rota grid only shows somebody on
     the days between their joining date and their last working day. The
     generator uses the same rule (employedOn, in rosterConfig.js). */
  const weekDates = useMemo(() => weekDatesFrom(weekStart), [weekStart]);

  /* Everyone still with the ward — the list the settings below apply to. It
     deliberately does NOT change with the week being planned: a "skip" or a
     shift restriction is a fact about the person, not about seven days. */
  const allStaff = useMemo(
    () => (data.staff || []).filter((s) => !(s.endDate && s.endDate < today)),
    [data.staff, today]
  );
  // Everyone employed on at least one day of THIS week — the ones to roster.
  const activeStaff = useMemo(
    () => activeStaffFor(data.staff, weekDates),
    [data.staff, weekDates]
  );
  /* Left out of this week, and why. Drawn from EVERY staff member, not just
     the current ones — the whole point is the person a manager expects to
     see and does not, and somebody who left last month is exactly that.

     Bounded at both ends by eight weeks, so it names the nurse who left in
     July while planning August, and stays quiet about a porter who left in
     2019 or a joiner starting next year. */
  const notThisWeek = useMemo(() => {
    const longGone = shiftISO(weekStart, -56);
    const farOff = shiftISO(weekEnd, 56);
    return (data.staff || [])
      .filter((s) => !weekDates.some((d) => employedOn(s, d)))
      .map((s) => {
        if (s.endDate && s.endDate < weekStart && s.endDate >= longGone) {
          return { name: s.name, why: `left ${s.endDate}` };
        }
        if (s.startDate && s.startDate > weekEnd && s.startDate <= farOff) {
          return { name: s.name, why: `joins ${s.startDate}` };
        }
        return null;
      })
      .filter(Boolean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.staff, weekDates, weekStart, weekEnd]);
  const weekLabel = `${new Date(weekStart).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} – ` +
                    `${new Date(weekEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;

  /* The rota stores cells as cells[date][staffId] = codeId; the engine works
     in flat "staffId|date" keys holding the code itself. The translation,
     and the configuration built from it, live in rosterConfig.js. */
  const codeById = useMemo(() => codeTextById(data.codes), [data.codes]);
  const idByCode = useMemo(() => codeIdByText(data.codes), [data.codes]);

  const buildConfig = () => weekConfig(data, weekStart);

  const feasibility = useMemo(() => {
    if (!activeStaff.length) return null;
    try { return checkFeasible(buildConfig()); } catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rules, weekStart, activeStaff]);

  /* ── Do the settings fit ──
     Worked out afresh from the settings as they are now, so it follows
     every change. It only ever says: Generate is never held back by it.
     The engine's own messages further down are left out where this is
     already saying the same thing. */
  const fit = checkSettings(rules, activeStaff);
  const warningsShown = (feasibility?.warnings || []).filter((w) => !fit.hides(w));
  const problemsShown = (feasibility?.problems || []).filter((p) => !fit.hides(p));
  /* "Fix it for me" saves at once, like any other setting, so what it
     changed is said until the settings next change. */
  const [fixNote, setFixNote] = useState(null);
  const rulesKey = settingsKey(rules);
  useEffect(() => {
    if (fixNote && fixNote.key !== rulesKey) setFixNote(null);
  }, [fixNote, rulesKey]);
  const fixIt = () => {
    const { shift, to, text } = fit.fix;
    const coverage = { ...rules.coverage, [shift]: { ...rules.coverage[shift], max: to } };
    setFixNote({ text, key: settingsKey({ ...rules, coverage }) });
    setRules({ coverage });
  };
  const fixed = fixNote && fixNote.key === rulesKey && (
    <span><strong>Changed — {fixNote.text}.</strong> Undo puts it back.</span>
  );

  const chosenCodes = useMemo(
    () => chosenCodesFor(rules, data.codes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rules.codeFor, data.codes]
  );

  const generate = () => {
    setBusy(true);
    // The pause lets the button repaint as "Generating…" before the work
    // begins. Building the week takes about a second: it is built quickly
    // several times over, then improved by rearrangement, which is where
    // the last uncovered shifts get resolved.
    setTimeout(() => {
      try {
        const res = generateRoster(buildConfig());
        if (!res.ok) { setProposal({ failed: true, problems: res.problems, deptId }); return; }
        const yearStart = `${weekStart.slice(0, 4)}-01-01`;
        setProposal({
          deptId,
          cells: res.cells, report: res.report,
          yearToDate: flattenCells(data.cells, codeById, yearStart, weekEnd),
          yearStart,
          rotaCells: toRotaCells(res.cells, data.codes || [], res.nightRest, chosenCodes),
          from: weekStart, to: weekEnd,
        });
      } catch (e) {
        console.error("Roster generation failed:", e);
        setProposal({ failed: true, problems: ["Something went wrong. Nothing has been changed."], deptId });
      } finally { setBusy(false); }
    }, 30);
  };

  /* ── Applying, and checking that it landed ──
     Writing the week and trusting that it worked is how a rota that looks
     nothing like the preview goes unnoticed. So the write is planned first,
     performed, and then read back and compared cell by cell. If anything
     differs, it says exactly which cells and what they became, rather than
     leaving it to be discovered on the printed rota. */
  const [verify, setVerify] = useState(null);

  useEffect(() => {
    if (!verify) return undefined;
    /* The department changed before the check ran. The week went to the
       department it was applied in; comparing it against this one would
       report every cell as missing, which is not true. */
    if (verify.deptId !== deptId) { setVerify(null); return undefined; }
    /* update() hands the change to the parent, which clones the rota and
       sets it again — so a successful write always arrives as a NEW data
       object. Until it does there is nothing to compare against, and
       comparing early would report a mismatch that is only impatience.

       If it never arrives, the write was refused: the trial has ended, or
       this department is view-only. Worth saying plainly, since the old
       behaviour was to announce success either way. */
    if (data === verify.before) {
      const timer = setTimeout(() => {
        setVerify(null);
        window.alert(
          "Nothing was written — the rota is unchanged.\n\n" +
          "Editing is usually paused for one of two reasons: the free trial has ended, " +
          "or this department is view-only on your plan."
        );
      }, 1500);
      return () => clearTimeout(timer);
    }
    // Compared duty by duty, whichever shape the cell is in.
    const wrong = findMismatches(data, verify.writes, codeById);
    const total = verify.writes.length;
    setVerify(null);
    if (wrong.length) {
      console.warn("Smart Roster: applied week does not match the preview", wrong);
      window.alert(
        `Applied, but ${wrong.length} of ${total} cells did not land as previewed:\n\n` +
        wrong.slice(0, 10).join("\n") +
        (wrong.length > 10 ? `\n…and ${wrong.length - 10} more` : "") +
        `\n\nThe full list is in the browser console. Please send it over — this should not happen.`
      );
    } else {
      window.alert(
        `Week applied — all ${total} duties match the preview.\n\n` +
        `You can still edit any cell by hand, and Undo will put it back as it was.`
      );
      /* Straight to the week that was just written. The Weekly Rota tab
         opens on the CURRENT week, and this one is usually next week — so
         without this the manager arrives at a different seven days and
         reasonably concludes the wrong rota was applied. */
      if (onApplied) onApplied(verify.week);
    }
    return undefined;
  }, [data, verify, codeById, onApplied, deptId]);

  const apply = () => {
    // Checked again here, not only in what is shown: a week is only ever
    // written into the department it was generated for.
    if (proposal.deptId !== deptId) {
      setProposal(null);
      window.alert("Not applied: this week was generated for a different department. Nothing was written.");
      return;
    }
    // Plan the write before touching anything, so a code that cannot be
    // resolved stops the whole thing rather than leaving half a week behind.
    const { writes, missing } = planWrites(proposal.rotaCells, idByCode);
    if (missing.size) {
      window.alert(
        `Cannot apply: no duty code is set up for ${[...missing].join(", ")}.\n\n` +
        `Add ${missing.size === 1 ? "it" : "them"} under Settings, then generate again. ` +
        `Nothing has been changed.`
      );
      return;
    }
    /* A "changed duty" mark remembers the duty a cell held before it was
       exchanged. Once the cell is rewritten that memory points at a duty
       nobody worked, so applying clears it — which is the only thing here
       that removes anything the manager entered by hand. It is counted and
       said out loud beforehand rather than discovered later in Insights. */
    const marksCleared = exchangeMarksIn(data, writes);
    if (!window.confirm(
      `Apply this week?\n\n${writes.length} duties will be written for ${weekLabel}.\n\n` +
      `Existing duties that week will be replaced. Recorded leave is kept as it is, ` +
      `and so are any notes on the cells.` +
      (marksCleared
        ? `\n\n${marksCleared} "changed duty" mark${marksCleared === 1 ? "" : "s"} on that week ` +
          `will be cleared, because the duty ${marksCleared === 1 ? "it remembers" : "they remember"} ` +
          `is being replaced.`
        : "") +
      `\n\nUndo will put everything back if you change your mind.`
    )) return;

    // Writes every cell and clears the "changed duty" marks it replaces;
    // notes on the cells stay.
    update((d) => writeCells(d, writes));
    setProposal(null);
    setVerify({ writes, before: data, week: weekStart, deptId });
  };

  /* One person's own rules, saved as one list beside the ward's settings.
     An empty list is removed rather than saved, so taking every rule away
     leaves nothing behind. The list and its rules are in YourStaff.js. */
  const setPersonRules = (list) => update((d) => {
    const next = { ...rules, personRules: list };
    if (!list.length) delete next.personRules;
    d.rosterRules = next;
    return d;
  });
  // Duties the manager fixed: the same, so clearing the last one leaves nothing behind.
  const setFixedDuties = (list) => update((d) => {
    const next = { ...rules, fixedDuties: list };
    if (!list.length) delete next.fixedDuties;
    d.rosterRules = next;
    return d;
  });

  const sel = { ...inputStyle, width: "auto", minWidth: 118, cursor: "pointer", padding: "7px 9px" };
  const hint = { fontSize: 12.5, color: T.inkSoft, lineHeight: 1.6, margin: "0 0 14px" };
  /* Taking a setting away rather than writing it: what a choice that means
     "as before" does, so nothing is left behind. One Undo step, as any write. */
  const dropRule = (key) => update((d) => {
    const next = { ...rules };
    delete next[key];
    d.rosterRules = next;
    return d;
  });
  // What every part of the ward's needs is handed: the settings, and the ways to write them.
  const needs = { rules, setRules, dropRule, editable: staffEditable, T };

  // The sum lives in rosterConfig.js so Ini warns with the same numbers.
  const senior = seniorNeedOf(rules, activeStaff);
  const { seniorCount, seniorPerDay, perPerson: seniorPerPerson, needed: seniorsNeeded } = senior;

  // What each step's button says about it.
  const weekReady = !!proposal && !proposal.failed && !proposalElsewhere;
  const stepStatus = {
    1: fit.ok ? "Done" : "Needs a fix",
    2: `${fit.count} on the roster`,
    3: weekReady ? "Week ready" : "Pick a week",
  };
  // Before a week is made: what it will be made from.
  const ready = readyLines({
    fit, rules, staff: activeStaff, from: weekStart, to: weekEnd, data, senior, terms: { termOne, termMany, lower },
  });

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card>
        <h2 style={{ fontFamily: "Sora, sans-serif", fontSize: 17, margin: "0 0 4px",
                     display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          Smart Roster
          <span style={{ fontSize: 11, fontWeight: 700, background: "#E6E4F5",
            color: "#4E4A8C", border: "1px solid #C4C0E8",
            borderRadius: 999, padding: "2px 9px", letterSpacing: 0.3 }}>
            BETA
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, background: "#FBF1DC",
            color: "#8A5A0F", border: "1px solid #E7D9B8",
            borderRadius: 999, padding: "2px 9px", letterSpacing: 0.3 }}>
            Plus
          </span>
        </h2>
        <p style={{ ...hint, marginBottom: 0 }}>
          Generates one week at a time. It covers every shift first, then shares the shift types out
          evenly so nobody ends up with a whole week of afternoons. Nothing is written to your rota
          until you press Use this roster.{" "}
          <strong>This feature is in beta</strong> — it works well for most wards, but check the
          result before applying, and use the Undo button if anything looks wrong.
        </p>
        {!staffEditable && (
          <div style={{ background: "#FBEAE7", border: "1px solid #F1B8AE", borderRadius: 10, padding: "10px 12px", fontSize: 13, color: "#8A2E1E", marginTop: 12 }}>
            Editing is paused on this plan, so a rota cannot be generated.
          </div>
        )}
      </Card>

      {/* ── The three steps ── */}
      <StepNav step={step} onStep={goStep} status={stepStatus} T={T} />

      {/* ── Step 1: what the ward needs ── */}
      {step === 1 && (<>
      {/* ── Do the settings fit ──
          A slim line while they do, so the amber card stands out when they
          do not. */}
      {fit.ok ? (
        <div role="status" style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap",
                                    fontSize: 12.5, color: "#0B6B61", padding: "0 6px", lineHeight: 1.6 }}>
          <Check size={14} style={{ flexShrink: 0 }} />
          <span>These settings fit your {fit.count} staff{fit.count === 1 ? " member" : ""}.</span>
          {fixed}
        </div>
      ) : (
        <Card style={{ background: "#FBF1DC", borderColor: "#E7D9B8" }}>
          <div role="status" style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13, color: "#8A5A0F", lineHeight: 1.6 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 3 }} />
            <div style={{ minWidth: 0 }}>
              <strong>These settings do not add up yet.</strong> {fit.text}
              {fit.stops && " Generate cannot make a week until this is changed."}
              {fixed && <div style={{ marginTop: 6 }}>{fixed}</div>}
              {fit.fix && (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                  <Btn kind="ghost" disabled={!staffEditable} onClick={fixIt} style={{ minHeight: 44, background: "#fff" }}>
                    <Wand2 size={15} /> Fix it for me
                  </Btn>
                  <span>Changes {fit.fix.text}, and saves it.</span>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ── Who's needed on each shift ── */}
      <ShiftNeeds {...needs} Card={Card} codes={data.codes} termMany={termMany} lower={lower}>
        {seniorPerDay > 0 && (
          <p style={{ ...hint, margin: "12px 0 0" }}>
            That is <strong>{seniorPerDay} {seniorPerDay === 1 ? lower : termMany.toLowerCase()} on duty every day</strong>,
            or {seniorPerDay * 7} {lower} duties across the week. At {seniorPerPerson} duties
            each that needs at least <strong>{seniorsNeeded}</strong>{" "}
            {termMany.toLowerCase()}; you have ticked {seniorCount}.
          </p>
        )}
      </ShiftNeeds>

      {/* ── Each person, each week ── */}
      <PersonWeek {...needs} Card={Card} codes={data.codes} />

      {/* ── What usually gives way first ── */}
      <GivesWay rules={rules} T={T} Card={Card} termMany={termMany} />

      {/* ── What may follow what ── */}
      <FollowRules {...needs} Card={Card} Btn={Btn} uid={uid} />

      {/* ── Which code gets written ── */}
      <Card style={{ padding: showMore ? 18 : "6px 18px" }}>
        <button type="button" aria-expanded={showMore} onClick={() => setShowMore(!showMore)}
          style={{ background: "none", border: "none", padding: 0, minHeight: 44, cursor: "pointer", fontFamily: "inherit",
                   fontSize: 15, fontWeight: 700, color: T.ink, display: "flex", alignItems: "center", gap: 6 }}>
          {showMore ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Which code to write
        </button>
        {showMore && (
          <div style={{ marginTop: 8 }}>
          <p style={{ ...hint, marginBottom: 12 }}>
            Several of your codes can count as the same thing — M and M(R) are both mornings,
            and you may have more than one kind of off day. <strong>Work it out</strong> uses the
            first code set to count as that type, which is right for most wards. Choose
            explicitly if it is picking the wrong one.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[
              ["morning", "Morning", "morning"],
              ["afternoon", "Afternoon", "afternoon"],
              ["evening", "Evening", "evening"],
              ["night", "Night", "night"],
              ["off", "Off day", "off"],
              ["nightOff", "Rest day after nights", "off"],
            ].filter(([slot]) => {
              // Only offer shifts the ward actually runs; off days always.
              if (slot === "off" || slot === "nightOff") return true;
              return (rules.coverage[slot]?.min || 0) > 0 || (rules.coverage[slot]?.max || 0) > 0;
            }).map(([slot, label, cat]) => {
              const options = (data.codes || []).filter((c) => c.counts === cat);
              const auto = options[0]?.code;
              const autoNightOff = options.find((c) => /\(N\)/i.test(c.code))?.code;
              const fallback = slot === "nightOff" ? (autoNightOff || auto) : auto;
              return (
                <Field key={slot} label={label}>
                  <select style={{ ...sel, minWidth: 150 }} disabled={!staffEditable}
                    value={rules.codeFor?.[slot] || ""}
                    onChange={(e) => setRules({ codeFor: { ...rules.codeFor, [slot]: e.target.value } })}>
                    <option value="">Work it out{fallback ? ` — ${fallback}` : ""}</option>
                    {options.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.label}</option>)}
                  </select>
                </Field>
              );
            })}
          </div>
          {/* The rest day after nights is the one wards name most variously,
              and the one most likely to be guessed wrong in silence. */}
          {(() => {
            const offs = (data.codes || []).filter((c) => c.counts === "off");
            const bracketed = offs.filter((c) => /\(N\)/i.test(c.code));
            if (rules.codeFor?.nightOff) return null;
            if (bracketed.length > 1) {
              return (
                <p style={{ ...hint, margin: "12px 0 0", color: "#8A5A0F" }}>
                  You have more than one off code with (N) in it — {bracketed.map((c) => c.code).join(", ")} —
                  so <strong>{bracketed[0].code}</strong> is being used for the rest day after nights.
                  Choose above if that is the wrong one.
                </p>
              );
            }
            if (bracketed.length === 0 && offs.length > 0) {
              return (
                <p style={{ ...hint, margin: "12px 0 0" }}>
                  No off code has (N) in its name, so the rest day after nights is written as{" "}
                  <strong>{offs[0].code}</strong> like any other off day. If you have a separate
                  code for it — N/OFF, NOFF, or whatever your ward calls it — choose it above.
                </p>
              );
            }
            return null;
          })()}
          </div>
        )}
      </Card>

      <StepFoot step={1} onStep={goStep} T={T} />
      </>)}

      {/* ── Step 2: your staff ── */}
      {step === 2 && (<>
      {/* ── Your staff ── */}
      <YourStaff rules={rules} setRules={setRules} setPersonRules={setPersonRules} setFixedDuties={setFixedDuties}
        editable={staffEditable}
        T={T} Card={Card} Btn={Btn} Field={Field} inputStyle={inputStyle} uid={uid} data={data}
        allStaff={allStaff} firstDay={firstDay} termOne={termOne} termMany={termMany} today={today} />

      <StepFoot step={2} onStep={goStep} T={T} />
      </>)}

      {/* ── Step 3: make the roster ── */}
      {step === 3 && (<>
      {/* ── Generate ── */}
      <Card>
        {/* Before a week is made, and again after Discard. */}
        {!weekReady && (
          <div style={{ marginBottom: 16, paddingBottom: 14, borderBottom: `1px solid ${T.line}` }}>
            <ReadyList lines={ready} onStep={goStep} T={T} />
          </div>
        )}
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "end" }}>
          <Field label={`Week beginning (${DAY_LABEL[firstDay]})`}>
            <input type="date" value={weekStart} disabled={!staffEditable}
              onChange={(e) => { setWeekStart(dstr(weekStartOf(e.target.value, firstDay))); setProposal(null); }}
              style={{ ...inputStyle, width: "auto" }} />
          </Field>
          <div style={{ fontSize: 12.5, color: T.inkSoft, paddingBottom: 9 }}>{weekLabel}</div>
          <Btn onClick={generate} disabled={!staffEditable || busy}>
            <Wand2 size={15} /> {busy ? "Generating…" : "Generate this week"}
          </Btn>
          {busy && (
            <div style={{ fontSize: 12, color: T.inkSoft, paddingBottom: 9 }}>
              Building the week, then improving it — about a second.
            </div>
          )}
        </div>

        {/* Somebody who has left, or has not started, is not on the rota for
            this week — so they are not rostered either. Said here because the
            alternative is noticing a missing row after applying. */}
        {notThisWeek.length > 0 && (
          <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 10, lineHeight: 1.6 }}>
            Not on the rota this week, so left out:{" "}
            {notThisWeek.map((x) => `${x.name} (${x.why})`).join(", ")}. Employment dates are set
            on the <strong>Staff</strong> tab.
          </div>
        )}

        {warningsShown.length > 0 && feasibility.ok && (
          <div style={{ background: "#FBF1DC", border: "1px solid #E7D9B8", borderRadius: 10, padding: "11px 13px", marginTop: 14 }}>
            <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <AlertTriangle size={15} color="#8A5A0F" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12.5, color: "#8A5A0F", lineHeight: 1.7, minWidth: 0 }}>
                <strong>Worth knowing before you generate:</strong>
                <ul style={{ margin: "5px 0 0", paddingLeft: 17 }}>
                  {warningsShown.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}

        {feasibility && !feasibility.ok && problemsShown.length > 0 && (
          <div style={{ background: "#FBF1DC", border: "1px solid #E7D9B8", borderRadius: 10, padding: "11px 13px", marginTop: 14 }}>
            <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
              <AlertTriangle size={15} color="#8A5A0F" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12.5, color: "#8A5A0F", lineHeight: 1.7, minWidth: 0 }}>
                <strong>These settings cannot produce a week yet:</strong>
                <ul style={{ margin: "5px 0 0", paddingLeft: 17 }}>
                  {problemsShown.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            </div>
          </div>
        )}
      </Card>

      {proposalElsewhere && (
        <Card style={{ background: "#FBF1DC", borderColor: "#E7D9B8" }}>
          <div style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13, color: "#8A5A0F", lineHeight: 1.6 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              This week was generated for a different department, so it has been set aside.
              Nothing was written here. Press <strong>Generate this week</strong> to build one for
              this department.
            </span>
          </div>
        </Card>
      )}

      {proposal?.failed && !proposalElsewhere && (
        <Card style={{ background: "#FBEAE7", borderColor: "#F1B8AE" }}>
          <strong style={{ fontSize: 14, color: "#8A2E1E" }}>Could not generate</strong>
          <ul style={{ margin: "7px 0 0", paddingLeft: 18, fontSize: 13, color: "#8A2E1E", lineHeight: 1.7 }}>
            {proposal.problems.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </Card>
      )}

      {proposal && !proposal.failed && !proposalElsewhere && (
        <Week proposal={proposal} data={data} activeStaff={activeStaff} weekLabel={weekLabel}
          codeById={codeById} termOne={termOne} termMany={termMany}
          onApply={apply} onDiscard={() => setProposal(null)}
          T={T} Card={Card} Btn={Btn} Field={Field} inputStyle={inputStyle}
          th={th} td={td} dstr={dstr} rules={rules} />
      )}

      {/* Said here rather than discovered later. A manager whose department
          uses tasks or split shifts needs to know what the engine will and
          will not do with them before applying a week over their work. */}
      <p style={{
        margin: 0, fontSize: 12, color: T.inkSoft, lineHeight: 1.65,
        background: "#F4F8F7", border: `1px solid ${T.line}`,
        borderRadius: 10, padding: "11px 13px",
      }}>
        <strong style={{ color: T.ink }}>What Smart Roster does not do yet.</strong>{" "}
        It writes one duty per person per day, so it does not create split or
        double duties, and it does not choose posts. If a day already holds two
        duties, it counts that person as having worked when sharing the week out
        fairly, using the first duty of the two. Applying a week replaces the
        duties in it, and a replaced duty does not keep its post — set those
        again afterwards on the days that need them.
      </p>
      <StepFoot step={3} onStep={goStep} T={T} />
      </>)}
    </div>
  );
}

/* The proposed week, with the counts underneath. Coverage is shown per day
   so a short shift is obvious at a glance, and each person's mix of duties
   is shown so an unfair week cannot hide behind a tidy-looking grid. */
function Week({ proposal, data, activeStaff, weekLabel, onApply, onDiscard, T, Card, Btn, Field, inputStyle, th, td, dstr, rules, codeById, termOne, termMany }) {
  const { report, rotaCells, cells, from } = proposal;
  const dates = useMemo(() => [...Array(7)].map((_, i) => dstr(addDays(new Date(from), i))), [from, dstr]);
  const colorOf = useMemo(() => {
    const m = {}; (data.codes || []).forEach((c) => { m[c.code] = c.color; }); return m;
  }, [data.codes]);

  const lower = termOne.toLowerCase();
  const isSenior = (id) => (rules.seniorStaff || []).includes(id);
  const countOn = (date, sh) => activeStaff.reduce((n, s) => n + (cells[`${s.id}|${date}`] === sh ? 1 : 0), 0);
  const seniorsOn = (date, sh) =>
    activeStaff.reduce((n, s) => n + (cells[`${s.id}|${date}`] === sh && isSenior(s.id) ? 1 : 0), 0);
  const usedShifts = SHIFTS.filter((sh) => (rules.coverage[sh]?.min || 0) > 0 || (rules.coverage[sh]?.max || 0) > 0);
  // Totals sit beside the grid, as they do on the printed rota, so a
  // lopsided week is visible on the same row as the duties that caused it.
  const totalsFor = useMemo(() => {
    const m = {};
    report.perStaff.forEach((p) => { m[p.id] = p; });
    return m;
  }, [report.perStaff]);
  const totalCols = [...usedShifts, "off"];
  const COL_LABEL = { morning: "M", afternoon: "A", evening: "E", night: "N", off: "OFF" };

  const week = report.budget?.[0];
  const dayOf = (d) => new Date(d).getDate();
  const note = { background: "#FBF1DC", border: "1px solid #E7D9B8", borderRadius: 10,
                 padding: "10px 12px", marginTop: 12, fontSize: 12.5, color: "#8A5A0F", lineHeight: 1.6 };
  const urgent = { ...note, background: "#FBEAE7", border: "1px solid #F1B8AE", color: "#8A2E1E" };

  /* People's own rules, kept apart from the ward's settings so each can be
     said with the person's name. One line per person and rule; Days between
     and the rules about days are missed on a day, so they list the days —
     a rule about days with the shift worked. A Must comes first. */
  const nameOf = (id) => (data.staff || []).find((s) => String(s.id) === String(id))?.name || "Someone";
  const wardBent = (report.relaxations || []).filter((r) => !r.personal);
  const ownBent = Object.values((report.relaxations || []).filter((r) => r.personal).reduce((m, r) => {
    const key = `${r.staffId}|${r.rule}`;
    const g = m[key] || (m[key] = { name: nameOf(r.staffId), rule: r.rule, must: r.strength === "hard", days: [] });
    if (r.ruleType === "apart") g.days.push(prettyWeekday(r.date));
    if (DAY_TYPES.includes(r.ruleType)) g.days.push(`${prettyWeekday(r.date)} ${r.shift}`);
    return m;
  }, {})).sort((a, b) => (b.must ? 1 : 0) - (a.must ? 1 : 0));
  const mustGaps = report.shortfalls.filter((s) => s.because);
  // The rest: a gap already named with its Must is not blamed on the rest rules too.
  const otherGaps = report.shortfalls.filter((s) => !s.because);
  /* In-charge held as a Must and still missing somewhere: said at the top,
     each with why nobody who can take charge was free, and not again below. */
  const inChargeMust = rules.ruleStates?.seniors?.state === "hard";
  const noInCharge = inChargeMust ? (report.seniorGaps || []).map((g) => noInChargeText({
    ...g, termOne, day: prettyWeekday(g.date),
    reasons: whyNoInCharge({ ...g, cells: proposal.cells, data, rules, staff: activeStaff, from: proposal.from, to: proposal.to }),
  })) : [];
  const summary = weekSummary({ report, mustMissed: ownBent.filter((g) => g.must).length, termOne });

  return (
    <>
      <Card style={{ borderColor: T.lagoon, borderWidth: 2 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h3 style={{ fontFamily: "Sora, sans-serif", fontSize: 16, margin: "0 0 3px" }}>Proposed week</h3>
            <span style={{ fontSize: 12.5, color: T.inkSoft }}>{weekLabel} · {report.rosteredCount} staff</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn kind="ghost" onClick={onDiscard} style={{ minHeight: 44 }}><X size={15} /> Discard</Btn>
            <Btn onClick={onApply} style={{ minHeight: 44 }}><Check size={15} /> Use this roster</Btn>
          </div>
        </div>

        {/* The week in one line, before anything else. */}
        <div role="status" style={{ display: "flex", gap: 7, alignItems: "flex-start", marginTop: 10, fontSize: 14, fontWeight: 700,
                                    color: summary.ok ? "#0B6B61" : "#8A5A0F", lineHeight: 1.5 }}>
          {summary.ok ? <Check size={16} style={{ flexShrink: 0, marginTop: 2 }} /> : <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 3 }} />}
          <span>{summary.text}</span>
        </div>

        {/* A gap one person's own Must caused is said first, with the rule,
            so it is the first thing read before Apply. */}
        {mustGaps.length > 0 && (
          <div style={urgent}>
            <strong>Left uncovered by a personal Must rule:</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {mustGaps.map((s) => (
                <li key={`${s.date}|${s.shift}`}>
                  {SHIFT_LABELS[s.shift]} on {prettyWeekday(s.date)} uncovered. {mustCauseText(s.because)}.
                </li>
              ))}
            </ul>
            {/* Said here too: the amber box below may not appear at all. */}
            <div style={{ marginTop: 4 }}>You can apply this and fill them by hand.</div>
          </div>
        )}

        {noInCharge.length > 0 && (
          <div style={urgent}>
            <strong>No {termOne} where one is a Must:</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {noInCharge.map((line) => <li key={line}>{line}</li>)}
            </ul>
            <div style={{ marginTop: 4 }}>You can apply this and change it by hand.</div>
          </div>
        )}

        {otherGaps.length > 0 && (
          <div style={note}>
            <strong>{otherGaps.length} {mustGaps.length ? "other " : ""}shift{otherGaps.length === 1 ? "" : "s"} could not be filled:</strong>{" "}
            {otherGaps.map((s) => `${dayOf(s.date)} ${s.shift}`).join(", ")}.{" "}
            {/* The numbers, not "there were not enough staff free" — two duties
                short and five duties short need different answers. */}
            {week && week.spare < 0
              ? `This week needs ${week.dutiesNeeded} duties and your staff can work ${week.dutiesAvailable} between them, so you are ${-week.spare} short. Raise the weekly duty maximum by one, lower a shift minimum, or add someone.`
              : `There were enough duties available (${week ? `${week.dutiesAvailable} for ${week.dutiesNeeded} needed` : "on paper"}), but the rest rules left nobody free at those moments. Loosening a limit under "More rules" would usually fix it.`}
            {" "}You can apply this and fill them by hand.
          </div>
        )}

        {!inChargeMust && report.seniorGaps?.length > 0 && (
          <div style={note}>
            <strong>{report.seniorGaps.length} shift{report.seniorGaps.length === 1 ? " has" : "s have"} no {lower} on duty:</strong>{" "}
            {report.seniorGaps.map((s) => `${dayOf(s.date)} ${s.shift}`).join(", ")}.{" "}
            {week && week.seniorSpare < 0
              ? `${week.seniorDutiesNeeded} ${lower} duties are needed this week and your ${week.seniorCount} ${week.seniorCount === 1 ? lower : termMany.toLowerCase()} can work ${week.seniorDutiesAvailable}. Tick another, or ask for one on fewer shifts.`
              : `The shift is staffed — just not by anyone ticked as a ${lower}.`}
          </div>
        )}

        {ownBent.length > 0 && (
          <div style={ownBent.some((g) => g.must) ? urgent : note}>
            <strong>Personal rules not met:</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {ownBent.map((g) => (
                <li key={`${g.name}|${g.rule}`}>
                  {g.name}: {g.rule}{g.days.length ? ` (${g.days.join(", ")})` : ""} —{" "}
                  {g.must ? <strong>Must, could not be met</strong> : "Try"}
                </li>
              ))}
            </ul>
          </div>
        )}

        {wardBent.length > 0 && (
          <div style={note}>
            {/* This lists what the FINISHED week does, not what the generator
                bent along the way — those are different things, and only the
                first is worth your attention. */}
            <strong>The week works, but {wardBent.length} of your
              setting{wardBent.length === 1 ? " is" : "s are"} not fully met:</strong>{" "}
            {Object.entries(wardBent.reduce((m, r) => { m[r.rule] = (m[r.rule] || 0) + 1; return m; }, {}))
              .sort((a, b) => b[1] - a[1])
              .map(([r, n]) => `${r} (${n})`).join(", ")}.
          </div>
        )}
      </Card>

      <Card style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...th, position: "sticky", left: 0, background: "#fff", zIndex: 2 }}>Staff</th>
              {dates.map((d) => {
                const dd = new Date(d);
                return (
                  <th key={d} style={{ ...th, textAlign: "center", padding: "7px 5px", minWidth: 54 }}>
                    <div style={{ fontSize: 9.5, color: T.inkSoft }}>{["SUN","MON","TUE","WED","THU","FRI","SAT"][dd.getDay()]}</div>
                    <div>{dd.getDate()}</div>
                  </th>
                );
              })}
              {totalCols.map((c) => (
                <th key={c} style={{ ...th, textAlign: "center", padding: "7px 6px", background: "#F1F5F4", minWidth: 34 }}>
                  {COL_LABEL[c]}
                </th>
              ))}
              <th style={{ ...th, textAlign: "center", padding: "7px 8px", background: "#FBF1DC", whiteSpace: "nowrap" }}>
                Non-off
              </th>
            </tr>
          </thead>
          <tbody>
            {activeStaff.map((s) => (
              <tr key={s.id}>
                <td style={{ ...td, position: "sticky", left: 0, background: "#fff", fontWeight: 600, zIndex: 1 }}>
                  {s.name}
                  {isSenior(s.id) && (
                    <span title={termOne} style={{ marginLeft: 5, fontSize: 9.5, fontWeight: 700, color: T.lagoon,
                      border: `1px solid ${T.lagoon}`, borderRadius: 4, padding: "1px 4px" }}>
                      {termOne.slice(0, 3).toUpperCase()}
                    </span>
                  )}
                </td>
                {dates.map((d) => {
                  const code = rotaCells[`${s.id}|${d}`];
                  return (
                    <td key={d} style={{ ...td, textAlign: "center", padding: "6px 4px",
                      background: code && colorOf[code] ? colorOf[code] + "33" : code ? "transparent" : "#F7FAFA" }}>
                      {code || <span style={{ color: "#C7D6D3" }}>—</span>}
                    </td>
                  );
                })}
                {totalCols.map((c) => (
                  <td key={c} style={{ ...td, textAlign: "center", background: "#F1F5F4", fontWeight: 600 }}>
                    {totalsFor[s.id]?.[c] ?? 0}
                  </td>
                ))}
                <td style={{ ...td, textAlign: "center", background: "#FBF1DC", fontWeight: 700 }}>
                  {totalsFor[s.id]?.nonOfficial ?? 0}
                </td>
              </tr>
            ))}
            {usedShifts.map((sh) => {
              const needSenior = rules.seniorCover?.[sh] || 0;
              return (
                <tr key={sh} style={{ background: "#F7FAFA" }}>
                  <td style={{ ...td, position: "sticky", left: 0, background: "#F7FAFA", fontWeight: 700, fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.3, color: T.inkSoft }}>
                    {SHIFT_LABELS[sh]}
                  </td>
                  {dates.map((d) => {
                    const c = countOn(d, sh);
                    const min = rules.coverage[sh]?.min || 0;
                    const led = needSenior ? seniorsOn(d, sh) : 0;
                    return (
                      <td key={d} style={{ ...td, textAlign: "center", fontWeight: 700, color: c < min ? T.coral : T.ink }}>
                        {c}
                        {needSenior > 0 && (
                          <div style={{ fontSize: 9.5, fontWeight: 700, marginTop: 1,
                            color: led < needSenior ? T.coral : T.inkSoft }}>
                            {led}/{needSenior}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  {totalCols.map((c) => <td key={c} style={{ ...td, background: "#F1F5F4" }} />)}
                  <td style={{ ...td, background: "#FBF1DC" }} />
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ fontSize: 11.5, color: T.inkSoft, margin: 0, padding: "10px 14px 14px", lineHeight: 1.6 }}>
          The grey columns are each person's totals for the week, and the last one counts duties on
          non-official days. A fair week shows a mix along each row, not one duty type repeated —
          except for staff tied to a single shift, who will only ever show that one. The rows at the
          bottom are how many staff are on each shift that day; red means below your minimum. Where
          you have asked for a {lower}, the small figure underneath is how many are on that shift
          against how many you asked for.
        </p>
      </Card>

      <YearToDate proposal={proposal} activeStaff={activeStaff} rules={rules}
        T={T} Card={Card} Btn={Btn} Field={Field} inputStyle={inputStyle}
        th={th} td={td} codeById={codeById} data={data} />
    </>
  );
}

/* Totals since 1 January, with this proposed week folded in. Non-official
   days carry extra pay, so they are the numbers people compare across the
   year rather than the week — a gap that looks small in seven days can be
   twenty duties by December. Shown after the week so the effect of applying
   it is visible before deciding. */
/* Totals over a date range, with this proposed week folded in. Non-official
   days carry extra pay, so they are the numbers people compare across the
   year rather than the week — a gap that looks small in seven days can be
   twenty duties by December.

   The range is the manager's to choose. "Since January" answers one question;
   "since the last roster meeting", "this month", "the last quarter" answer
   others, and those are usually the ones being argued about. The proposed
   week is counted in whenever it falls inside the range, and the heading
   says plainly when it does not.                                          */
function YearToDate({ proposal, activeStaff, rules, T, Card, Btn, Field, inputStyle, th, td, codeById, data }) {
  const { rotaCells, yearStart, from: weekFrom, to: weekTo } = proposal;

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const pretty = (v) => {
    const [y, m, d] = String(v).split("-").map(Number);
    if (!y) return v;
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };

  /* Starts where it always did — 1 January to the end of the proposed week —
     so nobody who liked the old behaviour has to do anything. */
  const [span, setSpan] = useState({ from: yearStart, to: weekTo });
  const valid = span.from && span.to && span.from <= span.to;
  // Whether the week being proposed actually falls inside the chosen range.
  const weekCounted = valid && weekFrom <= span.to && weekTo >= span.from;

  const preset = (kind) => {
    const now = new Date();
    if (kind === "year") return setSpan({ from: yearStart, to: weekTo });
    if (kind === "month") {
      return setSpan({
        from: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      });
    }
    if (kind === "quarter") {
      return setSpan({ from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: weekTo });
    }
  };

  const catOf = useMemo(() => {
    const m = {}; (data.codes || []).forEach((c) => { m[c.code] = c.counts; }); return m;
  }, [data.codes]);

  const isNonOfficial = (date) => {
    if ((data.nonOfficial || []).includes(date)) return true;
    if (!data.fridayRule) return false;
    const [y, m, d] = date.split("-").map(Number);
    return new Date(y, m - 1, d).getDay() === 5;
  };

  /* ── Who belongs in this table ──
     Whoever was employed at some point inside the range. Somebody who left
     in March has no business in a table covering May onwards, and somebody
     starting in August has none either — their empty row is just a question
     the manager has to stop and answer.

     Employment dates are inclusive at both ends, and blank means "always" —
     the same reading the Staff tab and the rota grid use. */
  const employedInRange = (s, from, to) => {
    if (s.startDate && s.startDate > to) return false;
    if (s.endDate && s.endDate < from) return false;
    return true;
  };
  const employedOnDate = (s, date) => {
    if (s.startDate && date < s.startDate) return false;
    if (s.endDate && date > s.endDate) return false;
    return true;
  };

  /* Read straight from the rota for whatever range is chosen, rather than
     from a slice prepared in advance — otherwise changing the dates could
     only ever narrow what was already fetched. */
  const totals = useMemo(() => {
    const t = {};
    const byId = {};
    (data.staff || []).forEach((s) => {
      byId[s.id] = s;
      t[s.id] = { morning: 0, afternoon: 0, evening: 0, night: 0, off: 0, nonOfficial: 0, any: 0 };
    });
    if (!valid) return t;

    const add = (sid, code, date) => {
      const cat = catOf[code];
      if (!t[sid] || !cat || t[sid][cat] === undefined) return;
      /* A duty on a day somebody was not employed is not a duty they worked.
         Such cells can exist — an earlier version of this page rostered
         staff the rota itself does not show — and counting them would put
         duties against a nurse who had already left. The Staff Records tab
         has always skipped them; this now agrees with it. */
      if (!employedOnDate(byId[sid] || {}, date)) return;
      t[sid][cat] += 1;
      t[sid].any += 1;
      if (cat !== "off" && isNonOfficial(date)) t[sid].nonOfficial += 1;
    };

    for (const [date, row] of Object.entries(data.cells || {})) {
      if (date < span.from || date > span.to) continue;
      // The proposed week replaces whatever is currently on those dates.
      if (weekCounted && date >= weekFrom && date <= weekTo) continue;
      for (const [sid, codeId] of Object.entries(row || {})) {
        const code = codeById[codeId];
        if (code) add(sid, code, date);
      }
    }
    if (weekCounted) {
      for (const [key, code] of Object.entries(rotaCells || {})) {
        const cut = key.lastIndexOf("|");
        const sid = key.slice(0, cut), date = key.slice(cut + 1);
        if (date < span.from || date > span.to) continue;
        add(sid, code, date);
      }
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.cells, data.staff, catOf, codeById, rotaCells, span, valid, weekCounted, weekFrom, weekTo]);

  /* A range covering March shows March's team, not today's — so this is
     employment, not "has duties". Somebody employed the whole range with an
     empty rota still belongs here, and their row of zeros is the point. */
  const rows = useMemo(
    () => (valid ? (data.staff || []).filter((s) => employedInRange(s, span.from, span.to)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.staff, span, valid]
  );

  const used = SHIFTS.filter((sh) => (rules.coverage[sh]?.max || 0) > 0 || (rules.coverage[sh]?.min || 0) > 0);
  const LABEL = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Night" };
  const dateBox = { ...inputStyle, width: "auto" };

  return (
    <Card>
      <h3 style={{ fontFamily: "Sora, sans-serif", fontSize: 15, margin: "0 0 4px" }}>
        Totals for {valid ? `${pretty(span.from)} – ${pretty(span.to)}` : "the chosen range"}
        {weekCounted ? ", including this week" : ""}
      </h3>
      <p style={{ fontSize: 12, color: T.inkSoft, margin: "0 0 12px", lineHeight: 1.6 }}>
        {weekCounted
          ? `The proposed week (${pretty(weekFrom)} – ${pretty(weekTo)}) is inside this range and counted in, replacing whatever is currently on those dates. `
          : `The proposed week (${pretty(weekFrom)} – ${pretty(weekTo)}) is outside this range, so it is not counted. `}
        Only staff employed during the range are listed. 
        Non-official duties carry extra pay, so these are the numbers worth keeping level — a small
        gap in one week becomes a large one by December.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
        <Field label="From">
          <input type="date" style={dateBox} value={span.from}
            onChange={(e) => setSpan({ ...span, from: e.target.value })} />
        </Field>
        <Field label="To">
          <input type="date" style={dateBox} value={span.to}
            onChange={(e) => setSpan({ ...span, to: e.target.value })} />
        </Field>
        <Btn kind="ghost" small onClick={() => preset("year")}>This year</Btn>
        <Btn kind="ghost" small onClick={() => preset("quarter")}>Last 3 months</Btn>
        <Btn kind="ghost" small onClick={() => preset("month")}>This month</Btn>
      </div>

      {!valid ? (
        <div style={{ fontSize: 13, color: T.coral }}>
          Pick a valid range — "From" must be on or before "To".
        </div>
      ) : !rows.length ? (
        <div style={{ fontSize: 13, color: T.inkSoft, padding: "16px 0", textAlign: "center" }}>
          No duties recorded in this range.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 460 }}>
            <thead>
              <tr>
                <th style={th}>Staff</th>
                {used.map((sh) => <th key={sh} style={{ ...th, textAlign: "center" }}>{LABEL[sh]}</th>)}
                <th style={{ ...th, textAlign: "center" }}>Off</th>
                <th style={{ ...th, textAlign: "center", background: "#FBF1DC" }}>Non-official</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {s.name}
                    {!activeStaff.some((a) => a.id === s.id) && (
                      <span style={{ marginLeft: 7, fontSize: 11, color: T.inkSoft, fontWeight: 500 }}>
                        not on this week
                      </span>
                    )}
                  </td>
                  {used.map((sh) => (
                    <td key={sh} style={{ ...td, textAlign: "center" }}>{totals[s.id]?.[sh] ?? 0}</td>
                  ))}
                  <td style={{ ...td, textAlign: "center" }}>{totals[s.id]?.off ?? 0}</td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, background: "#FBF1DC" }}>
                    {totals[s.id]?.nonOfficial ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}