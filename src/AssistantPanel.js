/* ─────────────── Ini, the rota assistant ───────────────
   A round button in the corner of every department screen. Tapping it opens
   a panel where the manager writes a note in their own words ("Fathimath on
   annual leave 10th to 15th, Mariyam off on the 20th") and Ini turns it into
   leave periods and duty requests.

   Ini only SUGGESTS. The server function (api/ai/parse.js) reads the note and
   sends back a list; nothing is saved until the manager has looked at every
   line and pressed Add. That save goes through the same update() as every
   other edit, so the plan and department locks apply, and Undo takes the
   whole lot back in one step.

   The checks on each duty request repeat the ones in RequestsTab.js
   (issuesFor and the clash check in add). They are copied rather than shared
   so that tab did not have to change. If one set of checks changes, change
   the other to match.

   Hidden from print, PDF and image exports: those screens replace the page
   this sits on, and the no-print class covers printing the page itself.  */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, X, AlertTriangle, Check } from "lucide-react";
import supabase from "./supabaseClient";

const MAX_TEXT = 1000;

// The leave types the Staff tab offers, with the labels it shows.
const LEAVE_TYPES = [
  ["annual", "Annual leave"],
  ["maternity", "Maternity"],
  ["prematernity", "Pre-maternity"],
  ["emergency", "Emergency leave"],
  ["other", "Other extended leave"],
];
const LEAVE_LABEL = Object.fromEntries(LEAVE_TYPES);
const REQUEST_LABEL = {
  morning: "Morning duty", afternoon: "Afternoon duty", evening: "Evening duty",
  night: "Night duty", off: "Off day",
};
const SHIFT_LABELS = { morning: "morning", afternoon: "afternoon", evening: "evening", night: "night" };

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
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad2 = (n) => String(n).padStart(2, "0");
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const dayMonth = (s) => { const d = parseISO(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
const withWeekday = (s) => `${WEEKDAYS[parseISO(s).getDay()]} ${dayMonth(s)}`;
// "10–15 Nov", "28 Nov – 3 Dec", or one day on its own.
const rangeLabel = (a, b) => {
  if (a === b) return dayMonth(a);
  const x = parseISO(a), y = parseISO(b);
  if (x.getFullYear() !== y.getFullYear()) {
    return `${dayMonth(a)} ${x.getFullYear()} – ${dayMonth(b)} ${y.getFullYear()}`;
  }
  if (x.getMonth() === y.getMonth()) return `${x.getDate()}–${dayMonth(b)}`;
  return `${dayMonth(a)} – ${dayMonth(b)}`;
};
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

// The server's answer, turned into checklist lines. Anything outside the
// chosen month is kept but starts unticked, so it is never added by accident.
const buildResult = (body, sent, from, to) => {
  const known = new Set(sent.map((s) => s.id));
  const lines = [];
  (Array.isArray(body.leave) ? body.leave : []).forEach((l, i) => {
    if (!known.has(l.staffId)) return;
    const outside = l.end < from || l.start > to;
    lines.push({ key: `l${i}`, kind: "leave", staffId: l.staffId, type: l.type,
      start: l.start, end: l.end, outside, checked: !outside });
  });
  (Array.isArray(body.requests) ? body.requests : []).forEach((r, i) => {
    if (!known.has(r.staffId)) return;
    const outside = r.date < from || r.date > to;
    lines.push({ key: `r${i}`, kind: "request", staffId: r.staffId, date: r.date,
      category: r.category, outside, checked: !outside });
  });
  const unclear = (Array.isArray(body.unclear) ? body.unclear : []).map((u) => String(u || "").trim()).filter(Boolean);
  return { staff: sent, lines, unclear };
};

export default function AssistantPanel({
  visible, deptId, data, update, staffEditable = () => true, currentTab,
  onOpenBilling, onOpenRequests, T, uid, dstr,
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

  // A different department is a fresh start: its own allowance, staff and note.
  useEffect(() => {
    seq.current += 1;
    setOpen(false); setStatus(null); setText(""); setBusy(false);
    setError(""); setResult(null); setSaved(null); setMonth(nextMonthKey());
  }, [deptId]);

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

  const { from, to } = monthBounds(month);
  const staffForMonth = useMemo(
    () => ((data && data.staff) || []).filter((s) => (s.name || "").trim() && employedInRange(s, from, to)),
    [data, from, to],
  );

  /* ── The checks on each line ──
     Worked out afresh on every render, so changing the person on a line, or
     ticking a leave line, updates the warnings straight away. */
  const lines = useMemo(() => {
    if (!result || !data) return [];
    const byId = {};
    (data.staff || []).forEach((s) => { byId[s.id] = s; });
    const existing = data.dutyRequests || [];

    // Smart Roster settings, read only — the same reading as RequestsTab.js.
    const rules = data.rosterRules || {};
    const coverage = rules.coverage || null;
    const skipStaff = rules.skipStaff || [];
    const staffShifts = rules.staffShifts || {};
    const wardRuns = (sh) => !coverage || (coverage[sh]?.min || 0) > 0 || (coverage[sh]?.max || 0) > 0;
    const onLeave = (s, date) => (s?.leavePeriods || []).some((lp) => date >= lp.start && date <= lp.end);

    const leaveInNote = result.lines.filter((l) => l.kind === "leave" && l.checked && staffEditable(l.staffId));
    const taken = new Set();

    return result.lines.map((l) => {
      const who = byId[l.staffId];
      const warnings = [];
      let blocked = "";
      if (!who) blocked = "This person is no longer on the rota, so this cannot be added.";
      else if (!staffEditable(l.staffId)) blocked = `${who.name} is view-only on your current plan, so this cannot be added.`;

      if (l.kind === "leave") {
        if (who) {
          (who.leavePeriods || [])
            .filter((p) => p.start <= l.end && p.end >= l.start)
            .forEach((p) => {
              const name = p.type === "other" && p.label ? p.label : (LEAVE_LABEL[p.type] || "leave");
              warnings.push(`overlaps ${name.toLowerCase()} already recorded (${rangeLabel(p.start, p.end)})`);
            });
        }
      } else {
        // The clash check from RequestsTab.add: one request per person per date.
        const key = `${l.staffId}|${l.date}`;
        if (!blocked && existing.some((r) => r.staffId === l.staffId && r.date === l.date)) {
          blocked = `${who.name} already has a request on this date, so this one cannot be added. Delete that one on the Duty Requests tab first if you want to change it.`;
        } else if (!blocked && taken.has(key)) {
          blocked = "A line above already asks for this person on this date.";
        }
        if (!blocked && l.checked) taken.add(key);

        // issuesFor, from RequestsTab.js.
        if (who) {
          if (skipStaff.includes(l.staffId)) {
            warnings.push("skipped in Smart Roster, so the generator will not touch this week for them");
          }
          if (onLeave(who, l.date)) {
            warnings.push("on recorded leave that day — leave is left alone, so this cannot be honoured");
          } else if (leaveInNote.some((x) => x.staffId === l.staffId && l.date >= x.start && l.date <= x.end)) {
            warnings.push("on leave you are adding in this note — leave is left alone, so this cannot be honoured");
          }
          if (l.category !== "off" && !wardRuns(l.category)) {
            warnings.push(`the ward does not run ${SHIFT_LABELS[l.category]} shifts`);
          }
          const only = staffShifts[l.staffId];
          if (l.category !== "off" && only?.length && !only.includes(l.category)) {
            warnings.push(`only set up for ${only.map((x) => SHIFT_LABELS[x]).join(" and ")} duties`);
          }
        }
      }
      if (l.outside) warnings.unshift("outside the month you chose");
      return { ...l, who, blocked, warnings, on: l.checked && !blocked };
    });
  }, [result, data, staffEditable]);

  if (!visible || !deptId) return null;

  const read = async () => {
    const note = text.trim();
    if (!note || busy) return;
    if (!staffForMonth.length) {
      setError(`Nobody on this rota is employed in ${monthOptions().find(([k]) => k === month)?.[1] || "that month"}.`);
      return;
    }
    const mine = ++seq.current;
    const sent = staffForMonth.map((s) => ({ id: s.id, name: s.name.trim() }));
    setBusy(true); setError("");

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

    if (res.ok && body.ok) { setResult(buildResult(body, sent, from, to)); return; }

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

  // One update(), so it is one step for Undo and passes the same locks as
  // every other edit. Shapes match the Staff tab and RequestsTab.add exactly.
  const confirm = () => {
    if (!picked.length) return;
    const today = dstr(new Date());
    const leave = picked.filter((l) => l.kind === "leave");
    const reqs = picked.filter((l) => l.kind === "request");
    update((d) => {
      leave.forEach((l) => {
        const i = (d.staff || []).findIndex((s) => s.id === l.staffId);
        if (i < 0) return;
        d.staff[i] = {
          ...d.staff[i],
          leavePeriods: [...(d.staff[i].leavePeriods || []),
            { type: l.type, start: l.start, end: l.end, id: uid() }],
        };
      });
      if (reqs.length) {
        const list = [...(d.dutyRequests || [])];
        reqs.forEach((r) => {
          // Checked again against the rota as it is now, in case it changed.
          if (list.some((x) => x.staffId === r.staffId && x.date === r.date)) return;
          list.push({
            id: uid(),
            staffId: r.staffId,
            date: r.date,
            category: r.category,
            approved: true,           // the manager confirming is the approval
            enteredBy: "assistant",
            enteredOn: today,
          });
        });
        d.dutyRequests = list;
      }
      return d;
    });
    setSaved({ leave: leave.length, requests: reqs.length });
    setResult(null);
  };

  const startAgain = () => { setSaved(null); setResult(null); setText(""); setError(""); };

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

  /* ── What the panel shows ── */
  let body;
  if (status === null) {
    body = <p style={{ fontSize: 13.5, color: T.inkSoft }}>Checking your allowance…</p>;
  } else if (status.ok === false) {
    if (status.reason === "not_on_plan") {
      body = (
        <div style={{ ...note("#FBF1DC", "#E7D9B8", "#6B4A0C"), padding: "16px 16px" }}>
          <div style={{ fontFamily: "Sora, sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
            Ini is on the Plus and Pro plans
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
      body = <div style={note(T.mist, T.line, T.inkSoft)}>{msg}</div>;
    }
  } else if (saved) {
    const parts = [];
    if (saved.leave) parts.push(plural(saved.leave, "leave period"));
    if (saved.requests) parts.push(plural(saved.requests, "duty request"));
    body = (
      <div style={{ display: "grid", gap: 14 }}>
        <div style={{ ...note("#E3F3EF", "#BFE3DA", "#0B6A60"), display: "flex", gap: 9, alignItems: "flex-start" }}>
          <Check size={17} style={{ flexShrink: 0, marginTop: 2 }} />
          <span><strong>Added {parts.join(" and ")}.</strong> You can take it all back with Undo at the top.</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {saved.requests > 0 && onOpenRequests && (
            <button type="button" style={button()} onClick={() => { setOpen(false); onOpenRequests(); }}>
              Open Duty Requests
            </button>
          )}
          <button type="button" style={button("ghost")} onClick={startAgain}>Write another note</button>
        </div>
      </div>
    );
  } else if (result) {
    const leaveLines = lines.filter((l) => l.kind === "leave");
    const requestLines = lines.filter((l) => l.kind === "request");
    const staffOptions = result.staff;

    const renderLine = (l) => {
      const what = l.kind === "leave" ? (LEAVE_LABEL[l.type] || "Leave") : (REQUEST_LABEL[l.category] || l.category);
      const when = l.kind === "leave" ? rangeLabel(l.start, l.end) : withWeekday(l.date);
      const name = l.who ? l.who.name : "Unknown";
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
              aria-label={`${what} · ${name} · ${when}`}
              style={{ width: 17, height: 17, marginTop: 2, accentColor: T.lagoon, flexShrink: 0,
                cursor: l.blocked ? "not-allowed" : "pointer" }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: l.blocked ? T.inkSoft : T.ink, lineHeight: 1.45 }}>
                {what} · {name} · {when}
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12, color: T.inkSoft }}>
                Person
                <select
                  value={l.staffId}
                  onChange={(e) => setLine(l.key, { staffId: e.target.value })}
                  style={{ fontFamily: "inherit", fontSize: 12.5, padding: "4px 6px", borderRadius: 7,
                    border: `1px solid ${T.line}`, background: "#fff", color: T.ink, maxWidth: "100%", minWidth: 0 }}
                >
                  {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
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

    body = (
      <div style={{ display: "grid", gap: 16 }}>
        {!lines.length && (
          <div style={note(T.mist, T.line, T.inkSoft)}>
            Ini didn't find any leave or duty requests in your note.
          </div>
        )}
        {leaveLines.length > 0 && (
          <section>
            <h3 style={sectionTitle}>Leave</h3>
            <div style={{ display: "grid", gap: 8 }}>{leaveLines.map(renderLine)}</div>
          </section>
        )}
        {requestLines.length > 0 && (
          <section>
            <h3 style={sectionTitle}>Duty requests</h3>
            <div style={{ display: "grid", gap: 8 }}>{requestLines.map(renderLine)}</div>
            <p style={{ fontSize: 12, color: T.inkSoft, margin: "8px 0 0", lineHeight: 1.5 }}>
              Requests you add here are marked approved, so Smart Roster will honour them.
            </p>
          </section>
        )}
        {result.unclear.length > 0 && (
          <section>
            <h3 style={sectionTitle}>Not added</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: T.inkSoft, lineHeight: 1.6 }}>
              {result.unclear.map((u, i) => <li key={i} style={{ marginBottom: 4 }}>{u}</li>)}
            </ul>
          </section>
        )}
        {currentTab === "staff" && leaveLines.length > 0 && (
          <div style={note("#FBF1DC", "#E7D9B8", "#6B4A0C")}>
            If a staff member's details are open on the Staff tab, close that form without saving first.
            Saving it afterwards would remove the leave Ini adds.
          </div>
        )}
        <div style={{
          position: "sticky", bottom: 0, background: "#fff", padding: "12px 0 4px",
          borderTop: `1px solid ${T.line}`, display: "flex", gap: 8, flexWrap: "wrap",
        }}>
          {lines.length > 0 && (
            <button type="button" style={button("primary", !picked.length)} disabled={!picked.length} onClick={confirm}>
              Add {plural(picked.length, "item")}
            </button>
          )}
          <button type="button" style={button("ghost")} onClick={() => setResult(null)}>Change my note</button>
        </div>
      </div>
    );
  } else if (status.remaining === 0) {
    body = <div style={note(T.mist, T.line, T.inkSoft)}>{MSG.limit}</div>;
  } else {
    body = (
      <div style={{ display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 5, fontSize: 12.5, fontWeight: 600, color: T.inkSoft }}>
          Planning for
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            disabled={busy}
            style={{ fontFamily: "inherit", fontSize: 14, padding: "9px 10px", borderRadius: 9,
              border: `1px solid ${T.line}`, background: "#fff", color: T.ink, cursor: "pointer" }}
          >
            {monthOptions().map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
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
        @media (prefers-reduced-motion: reduce) { .ini-panel, .ini-backdrop { animation: none; } }
        @media print { .ini-root { display: none !important; } }
      `}</style>

      {!open && (
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
    </div>
  );
}
