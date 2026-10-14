/* ─────────────── Ini, the rota assistant ───────────────
   A round button in the corner of every department screen. Tapping it opens
   a panel where the manager writes a note in their own words ("Fathimath on
   annual leave 10th to 15th, Mariyam off on the 20th") and Ini turns it into
   leave periods and duty requests.

   Ini only SUGGESTS. The server function (api/ai/parse.js) reads the note and
   sends back a list of actions; nothing is saved until the manager has
   looked at every line and pressed Add. That save goes through the same
   update() as every other edit, so the plan and department locks apply, and
   Undo takes the whole lot back in one step.

   What each action means — its words, its checks, how it is saved — lives
   in the catalogue (src/iniActions/). This panel only shows the lines, lets
   the manager tick and correct them, and saves them. Adding an action means
   adding a catalogue entry, not changing this file.

   Hidden from print, PDF and image exports: those screens replace the page
   this sits on, and the no-print class covers printing the page itself.

   Building a whole month is the one action this panel carries out itself,
   after everything else is saved: monthBuild.js prepares it with the same
   configuration Smart Roster uses, monthBuildRunner.js runs the engine in
   the background, and MonthPreview.js shows the month and applies it.
   Building runs entirely in the browser and never uses a note from the
   month's allowance.                                                      */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, X, AlertTriangle, Check, Wand2 } from "lucide-react";
import supabase from "./supabaseClient";
import {
  prepareBuild, finishMonth, plainProblems, lookbackOptions, lookbackIdFor, lookbackSentence,
  periodProblem, periodWords, periodLabel, isWholeMonth,
} from "./monthBuild";
import { startMonthBuild } from "./monthBuildRunner";
import MonthPreview from "./MonthPreview";
import { mergeRules } from "./rosterConfig";
import { SHIFTS } from "./rosterEngine";
import { GROUPS, LEAVE_TYPES, entryFor, readReply, checkLines, applyLines, savedWords } from "./iniActions";

const MAX_TEXT = 1000;

const MSG = {
  retry: "The assistant couldn't read your note just now. Please try again in a minute.",
  limit: "You've used this month's notes. They reset on the 1st.",
  notConfigured: "The assistant isn't switched on yet.",
  signIn: "Please sign in again.",
  notAllowed: "Only the owner and managers of this department can use Ini.",
  noDept: "Ini couldn't find this department. Please refresh the page.",
  tooManyStaff: "This rota has more staff in that month than Ini can read at once (the limit is 300).",
};

/* ── Dates ── */
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const pad2 = (n) => String(n).padStart(2, "0");
const monthKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const nextMonthKey = () => { const n = new Date(); return monthKey(new Date(n.getFullYear(), n.getMonth() + 1, 1)); };
const monthBounds = (key) => {
  const [y, m] = key.split("-").map(Number);
  return { from: `${key}-01`, to: `${key}-${pad2(new Date(y, m, 0).getDate())}` };
};
// Last month through twelve months ahead.
const monthOptions = () => {
  const n = new Date();
  const out = [];
  for (let i = -1; i <= 12; i++) {
    const d = new Date(n.getFullYear(), n.getMonth() + i, 1);
    out.push([monthKey(d), `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`]);
  }
  return out;
};
// The same employment rule Smart Roster uses: start and end dates inclusive,
// either one may be empty.
const employedInRange = (s, from, to) => {
  if (s.startDate && s.startDate > to) return false;
  if (s.endDate && s.endDate < from) return false;
  return true;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* What the server is told about the department, besides the staff: its
   own duty codes (Ini may only use those) and the shifts the ward runs —
   the shifts with a minimum or maximum in Smart Roster's coverage, the
   same settings the generator works from. */
const codesFor = (data) => ((data && data.codes) || [])
  .filter((c) => c && c.id && (c.code || "").trim())
  .map((c) => ({ id: c.id, code: c.code.trim(), label: c.label || "", counts: c.counts || "" }));
const shiftsFor = (data) => {
  const cov = mergeRules((data && data.rosterRules) || {}).coverage;
  return SHIFTS.filter((sh) => (cov[sh]?.min || 0) > 0 || (cov[sh]?.max || 0) > 0);
};

export default function AssistantPanel({
  visible, deptId, data, update, staffEditable = () => true, currentTab,
  onOpenBilling, onOpenRequests, T, uid, dstr,
  canBuild = false, onMonthApplied,
}) {
  const [open, setOpen] = useState(false);
  // null while checking; { ok: true, cap, used, remaining } or { ok: false, reason }
  const [status, setStatus] = useState(null);
  const [month, setMonth] = useState(nextMonthKey);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(null);
  // Bumped whenever an answer would no longer belong on screen (a different
  // department), so a reply that arrives late is ignored.
  const seq = useRef(0);

  /* ── The period: a calendar month, or dates the manager chooses ── */
  const [periodMode, setPeriodMode] = useState("month");   // "month" | "dates"
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  /* ── Building ── */
  const [lookChoice, setLookChoice] = useState("usual");
  const [noteFrom, setNoteFrom] = useState(null);       // look-back date from the last note
  const [keepExisting, setKeepExisting] = useState(true);
  const [buildOn, setBuildOn] = useState(true);         // the "Build the … roster" checklist line
  const [building, setBuilding] = useState(false);
  const [buildProblems, setBuildProblems] = useState(null);
  // Waiting for the ticked lines to land: { before, words, requests, build }
  const [pendingSave, setPendingSave] = useState(null);
  const [saveProblem, setSaveProblem] = useState("");
  const [preview, setPreview] = useState(null);
  const buildSeq = useRef(0);
  const job = useRef(null);
  const stopBuild = () => {
    buildSeq.current += 1;
    if (job.current) { job.current.cancel(); job.current = null; }
  };

  // A different department is a fresh start: its own allowance, staff and note.
  useEffect(() => {
    seq.current += 1;
    stopBuild();
    setOpen(false); setStatus(null); setText(""); setBusy(false);
    setError(""); setResult(null); setSaved(null); setMonth(nextMonthKey());
    setPeriodMode("month"); setRangeFrom(""); setRangeTo("");
    setLookChoice("usual"); setNoteFrom(null); setKeepExisting(true); setBuildOn(true);
    setBuilding(false); setBuildProblems(null); setPendingSave(null); setSaveProblem(""); setPreview(null);
    // stopBuild only touches refs, so it does not need to be listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stopBuild(), []);

  useEffect(() => { if (!visible) setOpen(false); }, [visible]);

  // The allowance, checked every time the panel opens. Uses nothing up.
  useEffect(() => {
    if (!open || !deptId) return undefined;
    let cancelled = false;
    setStatus(null);
    supabase.rpc("ai_status", { p_dept: deptId }).then(
      ({ data: s, error: e }) => {
        if (cancelled) return;
        // If the check itself fails, let the manager try anyway: the server
        // makes the same check again before anything is spent.
        setStatus(e || !s || typeof s !== "object" ? { ok: true, unknown: true } : s);
      },
      () => { if (!cancelled) setStatus({ ok: true, unknown: true }); },
    );
    return () => { cancelled = true; };
  }, [open, deptId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* The period everything works on: the note is read against it, and it is
     what gets built. Chosen dates must be in order and at most 92 days. */
  const periodErr = periodMode === "dates" ? periodProblem(rangeFrom, rangeTo) : "";
  const { from, to } = periodMode === "dates" && !periodErr ? { from: rangeFrom, to: rangeTo } : monthBounds(month);
  // While the chosen dates cannot be built, the buttons do not pretend they can.
  const words = periodErr
    ? { the: "the roster for these dates", name: "these dates", build: "roster for these dates" }
    : periodWords(from, to);
  const staffForMonth = useMemo(
    () => ((data && data.staff) || []).filter((s) => (s.name || "").trim() && employedInRange(s, from, to)),
    [data, from, to],
  );

  /* ── Building ──
     The look-back choices follow the period. A date from the note is only
     offered while it is still before the period starts. */
  const lookOpts = useMemo(
    () => lookbackOptions(from, data && data.rosterRules, noteFrom),
    [from, data, noteFrom],
  );
  const lookOpt = lookOpts.find((o) => o.id === lookChoice) || lookOpts[0];

  // Builds from `d`: the rota as it is now, or as it is once a note's items
  // have been saved. Nothing is written here; the preview does that.
  const startBuild = (d) => {
    if (!d) return;
    setBuildProblems(null);
    if (periodErr) { setBuildProblems([periodErr]); return; }
    if (!staffForMonth.length) {
      setBuildProblems([`Nobody on this rota is employed in ${periodLabel(from, to)}.`]);
      return;
    }
    let prep;
    try {
      prep = prepareBuild({
        data: d, from, to, lookFrom: lookOpt ? lookOpt.from : null, keepExisting,
        // View-only staff cannot have their cells changed, so they are
        // planned around exactly as they stand.
        lockedStaffIds: (d.staff || []).filter((s) => !staffEditable(s.id)).map((s) => s.id),
      });
    } catch (e) {
      console.error("Ini: could not prepare the month", e);
      setBuildProblems(["Something went wrong while getting the month ready. Nothing has been changed."]);
      return;
    }
    stopBuild();
    const mine = buildSeq.current;
    setBuilding(true);
    job.current = startMonthBuild(prep.config, prep.chosenCodes);
    job.current.promise.then(
      (out) => {
        if (mine !== buildSeq.current) return;
        job.current = null;
        setBuilding(false);
        if (!out.ok) { setBuildProblems(plainProblems(prep, out.problems)); return; }
        setPreview({ ...finishMonth(prep, out, d), ms: out.ms });
        setOpen(false);
      },
      (e) => {
        if (mine !== buildSeq.current) return;
        console.error("Ini: month build failed", e);
        job.current = null;
        setBuilding(false);
        setBuildProblems(["Something went wrong while building. Nothing has been changed."]);
      },
    );
  };

  /* After Add: the lines are saved through update(), which hands back a NEW
     rota object once it has landed. Only then does Ini say they were added
     — and, when the build line is ticked, build from that rota, so the
     month includes them. If nothing arrives the save was refused (update()
     says why), and the checklist stays as it was. */
  useEffect(() => {
    if (!pendingSave) return undefined;
    if (data === pendingSave.before) {
      const timer = setTimeout(() => {
        setPendingSave(null);
        setSaveProblem(pendingSave.build ? "Nothing was saved, so the month was not built." : "Nothing was saved.");
      }, 1500);
      return () => clearTimeout(timer);
    }
    setPendingSave(null);
    setResult(null);
    setSaved({ words: pendingSave.words, requests: pendingSave.requests });
    if (pendingSave.build) startBuild(data);
    return undefined;
    // startBuild reads the current choices; only a new rota should trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, pendingSave]);

  /* ── The checks on each line ──
     Worked out afresh on every render, so changing the person on a line, or
     ticking one, updates the warnings straight away. */
  const lines = useMemo(
    () => (result && data ? checkLines(result.lines, { data, staffEditable }) : []),
    [result, data, staffEditable],
  );

  if (!visible || !deptId) return null;

  const read = async () => {
    const note = text.trim();
    if (!note || busy) return;
    if (periodErr) { setError(periodErr); return; }
    if (!staffForMonth.length) {
      setError(`Nobody on this rota is employed in ${periodLabel(from, to)}.`);
      return;
    }
    const mine = ++seq.current;
    const sent = staffForMonth.map((s) => ({ id: s.id, name: s.name.trim() }));
    setBusy(true); setError(""); setSaveProblem("");

    let res, body;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess && sess.session && sess.session.access_token;
      if (!token) {
        if (mine === seq.current) { setBusy(false); setError(MSG.signIn); }
        return;
      }
      res = await fetch("/api/ai/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          departmentId: deptId, text: note, from, to, staff: sent,
          leaveTypes: LEAVE_TYPES.map(([id]) => id),
          codes: codesFor(data), shifts: shiftsFor(data), fridayRule: !!(data && data.fridayRule),
        }),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) {
      if (mine === seq.current) { setBusy(false); setError(MSG.retry); }
      return;
    }
    if (mine !== seq.current) return;
    setBusy(false);
    body = body || {};

    // Every reply that says how much is left updates the count on screen.
    const usage = body.usage || (body.cap != null ? { cap: body.cap, used: body.used, remaining: body.remaining } : null);
    if (usage && usage.cap != null) {
      setStatus({ ok: true, cap: usage.cap, used: usage.used, remaining: usage.remaining });
    }

    if (res.ok && body.ok) {
      const r = readReply(body, { staffIds: sent.map((s) => s.id), from, to });
      setResult({ ...r, staff: sent });
      setBuildOn(true);
      const b = r.build;
      // Dates the note asked to build become the period: a calendar month
      // the picker offers as that month, anything else as chosen dates.
      if (b && (b.from !== from || b.to !== to)) {
        const key = b.from.slice(0, 7);
        if (isWholeMonth(b.from, b.to) && monthOptions().some(([k]) => k === key)) {
          setPeriodMode("month"); setMonth(key);
        } else {
          setPeriodMode("dates"); setRangeFrom(b.from); setRangeTo(b.to);
        }
      }
      // A look-back the note asked for is preselected; it can still be changed.
      if (b && b.historyFrom) {
        setNoteFrom(b.historyFrom);
        setLookChoice(lookbackIdFor(lookbackOptions(b.from, data && data.rosterRules, b.historyFrom), b.historyFrom));
      }
      return;
    }

    const code = body.error;
    if (res.status === 429 || code === "limit_reached") {
      setStatus((s) => ({ ...(s && s.ok ? s : {}), ok: true, remaining: 0 }));
    } else if (code === "not_on_plan" || code === "not_allowed" || code === "no_department") {
      setStatus({ ok: false, reason: code });
    } else if (res.status === 401) setError(MSG.signIn);
    else if (res.status === 503) setError(MSG.notConfigured);
    else if (code === "too_many_staff") setError(MSG.tooManyStaff);
    else setError(MSG.retry);
  };

  const setLine = (key, change) =>
    setResult((r) => ({ ...r, lines: r.lines.map((l) => (l.key === key ? { ...l, ...change } : l)) }));

  const picked = lines.filter((l) => l.on);
  // The note asked for the month to be built, and the line is still ticked.
  const willBuild = !!(result && result.build && canBuild && buildOn && !periodErr);

  // One update(), so it is one step for Undo and passes the same locks as
  // every other edit. Each line is checked again inside it, against the rota
  // as it is at that moment. With the build line ticked, the month is built
  // afterwards from the rota that includes what was just saved.
  const confirm = () => {
    setSaveProblem("");
    if (!picked.length) {
      if (willBuild) { setResult(null); startBuild(data); }
      return;
    }
    const today = dstr(new Date());
    setPendingSave({
      before: data, build: willBuild, words: savedWords(picked),
      requests: picked.some((l) => entryFor(l.type)?.opensRequests),
    });
    update((d) => applyLines(d, picked, { staffEditable, uid, today }));
  };

  const startAgain = () => { setSaved(null); setResult(null); setText(""); setError(""); setSaveProblem(""); };

  /* ── Styles ── */
  const button = (kind = "primary", disabled = false) => ({
    fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, borderRadius: 9,
    padding: "10px 16px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
    border: kind === "ghost" ? `1px solid ${T.line}` : "none",
    background: kind === "ghost" ? "#fff" : T.lagoon,
    color: kind === "ghost" ? T.ink : "#fff",
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1,
  });
  const note = (bg, border, color) => ({
    background: bg, border: `1px solid ${border}`, borderRadius: 10,
    padding: "11px 13px", fontSize: 13, color, lineHeight: 1.6,
  });
  const sectionTitle = {
    fontFamily: "Sora, sans-serif", fontSize: 14, fontWeight: 700, margin: "4px 0 8px", color: T.ink,
  };

  const allowance = status && status.ok && !status.unknown && status.cap != null
    ? `${status.remaining} of ${status.cap} notes left this month`
    : "";

  /* ── The build controls, shared by the note form and the checklist ── */
  const lookControl = (
    <label style={{ display: "grid", gap: 5, fontSize: 12.5, color: T.inkSoft, lineHeight: 1.5 }}>
      <span>{lookbackSentence(lookOpt, from)}</span>
      <select
        value={lookOpt ? lookOpt.id : "usual"}
        onChange={(e) => setLookChoice(e.target.value)}
        disabled={building}
        aria-label="How far back fairness looks"
        style={{ fontFamily: "inherit", fontSize: 13, padding: "7px 9px", borderRadius: 8,
          border: `1px solid ${T.line}`, background: "#fff", color: T.ink, cursor: "pointer" }}
      >
        {lookOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
  const keepControl = (
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, color: T.ink, lineHeight: 1.45, cursor: "pointer" }}>
      <input
        type="checkbox"
        checked={keepExisting}
        disabled={building}
        onChange={(e) => setKeepExisting(e.target.checked)}
        style={{ width: 16, height: 16, marginTop: 2, accentColor: T.lagoon, flexShrink: 0 }}
      />
      <span>
        Keep duties already on the rota (only fill empty days)
        {!keepExisting && (
          <span style={{ display: "block", fontSize: 12, color: "#8A5A0F", marginTop: 2 }}>
            Duties already on these dates will be replaced. You will see how many before anything is written.
          </span>
        )}
      </span>
    </label>
  );
  const problemsBox = buildProblems && buildProblems.length > 0 && (
    <div role="alert" style={note("#FBEAE7", "#F1B8AE", "#8A2E1E")}>
      <strong>{words.the.charAt(0).toUpperCase() + words.the.slice(1)} could not be built. Nothing has been changed.</strong>
      <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
        {buildProblems.map((p, i) => <li key={i} style={{ marginBottom: 3 }}>{p}</li>)}
      </ul>
    </div>
  );
  const buildSection = canBuild && (
    <section style={{ borderTop: `1px solid ${T.line}`, paddingTop: 14, display: "grid", gap: 10 }}>
      <h3 style={{ ...sectionTitle, margin: 0 }}>{periodMode === "dates" ? "Build these dates" : "Build the whole month"}</h3>
      <p style={{ fontSize: 12.5, color: T.inkSoft, margin: 0, lineHeight: 1.55 }}>
        Ini builds {words.the} with your Smart Roster settings. This does not use a note. Nothing changes on
        the rota until you have checked it and pressed Apply.
      </p>
      {lookControl}
      {keepControl}
      <div>
        <button type="button" style={button("primary", building || !!periodErr)} disabled={building || !!periodErr}
          onClick={() => startBuild(data)}>
          <Wand2 size={15} /> Build {words.build}
        </button>
      </div>
      {problemsBox}
    </section>
  );

  /* ── What the panel shows ── */
  let body;
  if (building || (pendingSave && pendingSave.build)) {
    body = (
      <div style={{ display: "grid", gap: 12 }}>
        <div role="status" style={{ ...note("#E3F3EF", "#BFE3DA", "#0B6A60"), display: "flex", gap: 9, alignItems: "flex-start" }}>
          <Wand2 size={17} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            <strong>{pendingSave ? "Saving your items…" : `Building ${words.the}… this can take a few seconds.`}</strong>
            {" "}The month opens here when it is ready.
          </span>
        </div>
        <p style={{ fontSize: 12, color: T.inkSoft, margin: 0, lineHeight: 1.55 }}>
          You can close this panel and keep using the rota while Ini works.
        </p>
      </div>
    );
  } else if (pendingSave) {
    body = (
      <div role="status" style={note("#E3F3EF", "#BFE3DA", "#0B6A60")}>
        <strong>Saving your items…</strong>
      </div>
    );
  } else if (saved) {
    body = (
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ ...note("#E3F3EF", "#BFE3DA", "#0B6A60"), display: "flex", gap: 9, alignItems: "flex-start" }}>
          <Check size={17} style={{ flexShrink: 0, marginTop: 2 }} />
          <span><strong>Added {saved.words}.</strong> You can take it all back with Undo at the top.</span>
        </div>
        {problemsBox}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {saved.requests && onOpenRequests && (
            <button type="button" style={button()} onClick={() => { setOpen(false); onOpenRequests(); }}>
              Open Duty Requests
            </button>
          )}
          <button type="button" style={button("ghost")} onClick={startAgain}>Write another note</button>
        </div>
      </div>
    );
  } else if (result) {
    const staffOptions = result.staff;

    // One checklist line, whatever the action: its words from the catalogue,
    // a person picker for each person in it, its problems and warnings.
    const renderLine = (l) => {
      const entry = entryFor(l.type);
      const fields = entry.people || [];
      const { what, when, details, detailsLabel } = l.words;
      const names = fields.map((f) => (l.people[f] ? l.people[f].name : "Unknown"));
      const title = [what, names.join(" & "), when].filter(Boolean).join(" · ");
      return (
        <div key={l.key} style={{
          border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 12px",
          background: l.blocked ? T.mist : "#fff",
        }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={l.on}
              disabled={!!l.blocked}
              onChange={(e) => setLine(l.key, { checked: e.target.checked })}
              aria-label={title}
              style={{ width: 17, height: 17, marginTop: 2, accentColor: T.lagoon, flexShrink: 0,
                cursor: l.blocked ? "not-allowed" : "pointer" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: l.blocked ? T.inkSoft : T.ink, lineHeight: 1.45 }}>
                {title}
              </div>
              {fields.map((f, i) => (
                <label key={f} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12, color: T.inkSoft }}>
                  {fields.length > 1 ? `Person ${i + 1}` : "Person"}
                  <select
                    value={l[f]}
                    onChange={(e) => setLine(l.key, { [f]: e.target.value })}
                    style={{ fontFamily: "inherit", fontSize: 12.5, padding: "4px 6px", borderRadius: 7,
                      border: `1px solid ${T.line}`, background: "#fff", color: T.ink, maxWidth: "100%", minWidth: 0 }}
                  >
                    {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              ))}
              {details && details.length > 0 && (
                <details style={{ marginTop: 6, fontSize: 12, color: T.inkSoft, lineHeight: 1.5 }}>
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}>{detailsLabel || `Show ${plural(details.length, "date")}`}</summary>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {details.map((x, i) => <li key={i}>{x}</li>)}
                  </ul>
                </details>
              )}
              {l.blocked && (
                <div style={{ fontSize: 12, color: "#8A2E1E", lineHeight: 1.5, marginTop: 6 }}>{l.blocked}</div>
              )}
              {l.warnings.length > 0 && (
                <div style={{ fontSize: 11.5, color: "#8A5A0F", lineHeight: 1.5, marginTop: 6 }}>
                  {l.warnings.map((w, i) => (
                    <div key={i} style={{ display: "flex", gap: 5, alignItems: "flex-start" }}>
                      <AlertTriangle size={11} color="#8A5A0F" style={{ flexShrink: 0, marginTop: 3 }} />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    };

    /* The note asked for the month to be built: one more ticked line, with
       the look-back and the keep choice under it. */
    const buildLine = result.build && (canBuild ? (
      <section>
        <h3 style={sectionTitle}>Build</h3>
        <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 12px", display: "grid", gap: 10 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={buildOn}
              onChange={(e) => setBuildOn(e.target.checked)}
              style={{ width: 17, height: 17, marginTop: 2, accentColor: T.lagoon, flexShrink: 0 }}
            />
            <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.45 }}>Build {words.the}</span>
          </label>
          {buildOn && <div style={{ display: "grid", gap: 10, paddingLeft: 27 }}>{lookControl}{keepControl}</div>}
        </div>
      </section>
    ) : (
      <div style={note(T.mist, T.line, T.inkSoft)}>
        Your note asks for the roster to be built. Building a whole month uses Smart Roster, which is not on
        this department's plan.
      </div>
    ));
    const confirmLabel = picked.length
      ? (willBuild ? `Add ${plural(picked.length, "item")} and build ${words.name}` : `Add ${plural(picked.length, "item")}`)
      : (willBuild ? `Build ${words.name}` : "Add 0 items");
    const canConfirm = picked.length > 0 || willBuild;

    body = (
      <div style={{ display: "grid", gap: 16 }}>
        {!lines.length && !result.build && (
          <div style={note(T.mist, T.line, T.inkSoft)}>
            Ini didn't find anything to add from your note.
          </div>
        )}
        {GROUPS.map((g) => {
          const inGroup = lines.filter((l) => entryFor(l.type).group === g.id);
          if (!inGroup.length) return null;
          const footnotes = [...new Set(inGroup.map((l) => entryFor(l.type).footnote).filter(Boolean))];
          return (
            <section key={g.id}>
              <h3 style={sectionTitle}>{g.title}</h3>
              {g.note && <p style={{ fontSize: 12, color: T.inkSoft, margin: "-4px 0 8px", lineHeight: 1.5 }}>{g.note}</p>}
              <div style={{ display: "grid", gap: 8 }}>{inGroup.map(renderLine)}</div>
              {footnotes.map((f) => (
                <p key={f} style={{ fontSize: 12, color: T.inkSoft, margin: "8px 0 0", lineHeight: 1.5 }}>{f}</p>
              ))}
            </section>
          );
        })}
        {buildLine}
        {result.unclear.length > 0 && (
          <section>
            <h3 style={sectionTitle}>Not added</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: T.inkSoft, lineHeight: 1.6 }}>
              {result.unclear.map((u, i) => <li key={i} style={{ marginBottom: 4 }}>{u}</li>)}
            </ul>
          </section>
        )}
        {[...new Set(lines.map((l) => entryFor(l.type).tabNote?.[currentTab]).filter(Boolean))].map((t) => (
          <div key={t} style={note("#FBF1DC", "#E7D9B8", "#6B4A0C")}>{t}</div>
        ))}
        {saveProblem && (
          <div role="alert" style={note("#FBEAE7", "#F1B8AE", "#8A2E1E")}>{saveProblem}</div>
        )}
        <div style={{
          position: "sticky", bottom: 0, background: "#fff", padding: "12px 0 4px",
          borderTop: `1px solid ${T.line}`, display: "flex", gap: 8, flexWrap: "wrap",
        }}>
          {(lines.length > 0 || willBuild) && (
            <button type="button" style={button("primary", !canConfirm)} disabled={!canConfirm} onClick={confirm}>
              {willBuild && <Wand2 size={15} />} {confirmLabel}
            </button>
          )}
          <button type="button" style={button("ghost")} onClick={() => { setResult(null); setSaveProblem(""); }}>Change my note</button>
        </div>
      </div>
    );
  } else {
    /* The note form, with the month build under it. Building does not need
       the note allowance, so it stays available when the notes are used up
       or while the allowance is still being checked. */
    let noteArea;
    if (status === null) {
      noteArea = <p style={{ fontSize: 13.5, color: T.inkSoft, margin: 0 }}>Checking your note allowance…</p>;
    } else if (status.ok === false) {
      if (status.reason === "not_on_plan") {
        noteArea = (
          <div style={{ ...note("#FBF1DC", "#E7D9B8", "#6B4A0C"), padding: "16px 16px" }}>
            <div style={{ fontFamily: "Sora, sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
              Ini is on the Plus, Pro and Custom plans
            </div>
            <p style={{ margin: "0 0 14px" }}>
              Write a note in your own words, like "Fathimath is on annual leave 10th to 15th", and Ini
              fills in the leave and duty requests for you to check. Upgrade this department's plan to use it.
            </p>
            {onOpenBilling && (
              <button type="button" style={button()} onClick={() => { setOpen(false); onOpenBilling(); }}>
                See plans
              </button>
            )}
          </div>
        );
      } else {
        const msg = status.reason === "not_allowed" ? MSG.notAllowed
          : status.reason === "no_department" ? MSG.noDept
            : status.reason === "not_signed_in" ? MSG.signIn
              : MSG.retry;
        noteArea = <div style={note(T.mist, T.line, T.inkSoft)}>{msg}</div>;
      }
    } else if (status.remaining === 0) {
      noteArea = <div style={note(T.mist, T.line, T.inkSoft)}>{MSG.limit}</div>;
    } else {
      noteArea = (
        <>
          <label style={{ display: "grid", gap: 5, fontSize: 12.5, fontWeight: 600, color: T.inkSoft }}>
            Your note
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_TEXT))}
              maxLength={MAX_TEXT}
              rows={7}
              disabled={busy}
              placeholder="Fathimath Easa is on annual leave 10th to 15th. Mariyam needs the 20th off. Ali wants nights on the 3rd and 4th."
              style={{ fontFamily: "inherit", fontSize: 14, lineHeight: 1.55, padding: "10px 11px",
                borderRadius: 9, border: `1px solid ${T.line}`, color: T.ink, resize: "vertical", minHeight: 130 }}
            />
            <span style={{ justifySelf: "end", fontWeight: 500, fontSize: 11.5 }}>{text.length}/{MAX_TEXT}</span>
          </label>
          {error && (
            <div role="alert" style={{ ...note("#FBEAE7", "#F1B8AE", "#8A2E1E"), display: "flex", gap: 8, alignItems: "flex-start" }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{error}</span>
            </div>
          )}
          <div>
            <button type="button" style={button("primary", busy || !text.trim())} disabled={busy || !text.trim()} onClick={read}>
              <Sparkles size={15} /> {busy ? "Reading your note…" : "Read my note"}
            </button>
          </div>
          <p style={{ fontSize: 12, color: T.inkSoft, margin: 0, lineHeight: 1.55 }}>
            Nothing is saved until you check the list Ini makes and press Add.
          </p>
        </>
      );
    }
    const showMonth = canBuild || (status !== null && status.ok !== false && status.remaining !== 0);
    /* "Planning for": a calendar month as before, or any dates up to about
       three months. The note is read against this period, and it is what
       gets built. */
    const field = { fontFamily: "inherit", fontSize: 14, padding: "9px 10px", borderRadius: 9,
      border: `1px solid ${T.line}`, background: "#fff", color: T.ink, cursor: "pointer", minWidth: 0 };
    const modeButton = (mode, text) => (
      <button type="button" aria-pressed={periodMode === mode} disabled={busy || building}
        onClick={() => {
          setBuildProblems(null); setError("");
          if (mode === "dates" && !rangeFrom && !rangeTo) {
            const b = monthBounds(month); setRangeFrom(b.from); setRangeTo(b.to);
          }
          setPeriodMode(mode);
        }}
        style={{ flex: 1, fontFamily: "inherit", fontSize: 13, fontWeight: 700, padding: "7px 10px", border: "none",
          cursor: busy || building ? "not-allowed" : "pointer",
          background: periodMode === mode ? T.lagoon : "#fff", color: periodMode === mode ? "#fff" : T.inkSoft }}>
        {text}
      </button>
    );
    const periodPicker = (
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: T.inkSoft }}>Planning for</div>
        <div role="group" aria-label="Planning for" style={{ display: "flex", borderRadius: 9, overflow: "hidden", border: `1px solid ${T.line}` }}>
          {modeButton("month", "A month")}
          {modeButton("dates", "Choose dates")}
        </div>
        {periodMode === "month" ? (
          <select
            aria-label="Month"
            value={month}
            onChange={(e) => { setMonth(e.target.value); setBuildProblems(null); }}
            disabled={busy || building}
            style={field}
          >
            {monthOptions().map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: T.inkSoft, flex: "1 1 140px" }}>
                From
                <input type="date" value={rangeFrom} disabled={busy || building} style={field}
                  onChange={(e) => { setRangeFrom(e.target.value); setBuildProblems(null); setError(""); }} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12, fontWeight: 600, color: T.inkSoft, flex: "1 1 140px" }}>
                To
                <input type="date" value={rangeTo} disabled={busy || building} style={field}
                  onChange={(e) => { setRangeTo(e.target.value); setBuildProblems(null); setError(""); }} />
              </label>
            </div>
            {periodErr
              ? <div role="alert" style={{ fontSize: 12.5, color: "#8A2E1E" }}>{periodErr}</div>
              : <div style={{ fontSize: 12, color: T.inkSoft }}>{periodLabel(from, to)} · up to 3 months at a time</div>}
          </>
        )}
      </div>
    );
    body = (
      <div style={{ display: "grid", gap: 12 }}>
        {showMonth && periodPicker}
        {noteArea}
        {buildSection}
      </div>
    );
  }

  return (
    <div className="no-print ini-root">
      <style>{`
        .ini-panel { width: 400px; max-width: 100vw; animation: ini-in 240ms cubic-bezier(0.22, 1, 0.36, 1); }
        .ini-backdrop { animation: ini-fade 200ms ease-out; }
        @keyframes ini-in { from { transform: translateX(100%); } to { transform: none; } }
        @keyframes ini-fade { from { opacity: 0; } to { opacity: 1; } }
        @media (max-width: 640px) { .ini-panel { width: 100vw; } }
        /* iPhones zoom the whole page in when a text box smaller than 16px
           is tapped, and stay zoomed — so the month preview then opened
           off the edges of the screen. The app makes every box 12px on a
           phone; Ini's own boxes stay at 16px so nothing zooms. */
        @media (max-width: 900px) {
          .ini-root .ini-panel textarea, .ini-root .ini-panel select, .ini-root .ini-panel input {
            font-size: 16px !important;
          }
        }
        @media (prefers-reduced-motion: reduce) { .ini-panel, .ini-backdrop { animation: none; } }
        @media print { .ini-root { display: none !important; } }
      `}</style>

      {!open && !preview && (
        <button
          type="button"
          aria-label="Ask Ini"
          title="Ask Ini"
          onClick={() => setOpen(true)}
          style={{
            position: "fixed", right: 16, bottom: 16, zIndex: 900,
            width: 50, height: 50, borderRadius: "50%", border: "none", cursor: "pointer",
            background: T.lagoon, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 6px 18px rgba(20,43,51,0.25)",
          }}
        >
          <Sparkles size={22} />
        </button>
      )}

      {open && (
        <>
          <div
            className="ini-backdrop"
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(20,43,51,0.28)", zIndex: 999 }}
          />
          <aside
            className="ini-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Ini · your rota assistant"
            style={{
              position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 1000,
              background: "#fff", color: T.ink, fontFamily: "Inter, system-ui, sans-serif",
              boxShadow: "-8px 0 30px rgba(20,43,51,0.18)",
              display: "flex", flexDirection: "column",
            }}
          >
            <header style={{
              display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10,
              padding: "16px 18px 12px", borderBottom: `1px solid ${T.line}`,
            }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontFamily: "Sora, sans-serif", fontSize: 17, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  <Sparkles size={17} color={T.lagoon} /> Ini · your rota assistant
                </h2>
                {allowance && (
                  <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 4 }}>{allowance}</div>
                )}
              </div>
              <button
                type="button"
                aria-label="Close Ini"
                onClick={() => setOpen(false)}
                style={{ border: "none", background: T.mist, color: T.ink, borderRadius: 999,
                  width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", flexShrink: 0 }}
              >
                <X size={18} />
              </button>
            </header>
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 18px 18px" }}>
              {body}
            </div>
          </aside>
        </>
      )}

      {/* The built month, full screen. Discard goes back to the panel;
          Apply writes it and then shows the month on the rota. */}
      {preview && data && (
        <MonthPreview
          proposal={preview}
          data={data}
          update={update}
          T={T}
          onDiscard={() => { setPreview(null); setOpen(true); }}
          onApplied={(f, t) => {
            setPreview(null); setOpen(false); setSaved(null);
            if (onMonthApplied) onMonthApplied(f, t);
          }}
        />
      )}
    </div>
  );
}
