/* ─────────────── The built period, before it is applied ───────────────
   Full screen, because a month does not fit in Ini's side panel: staff down
   the side, the days across, in the ward's own codes and colours, with the
   rota's own totals — per person at the end of each row, per shift along
   the bottom. Cells that Apply will change are outlined.

   The totals count the rota as it will be AFTER Apply (kept duties, leave
   and the new duties together), using the rota screen's own counting code
   (weekTotalsFor and dayCountFor in rotaCounts.js), so they match what the
   rota shows once applied.

   Apply uses the same careful write as Smart Roster (rosterConfig.js): the
   writes are planned, made in ONE update() — so Undo takes the whole period
   back in one step — then read back and compared cell by cell. Only cells
   inside the period are ever written, and only the ones that change.

   Before writing, the rota is compared with the one the period was built
   from. If anything it depended on has changed since, nothing is written
   and the manager is asked to build again.

   On a phone (narrower than 700px) the whole preview scrolls as one page,
   the grid shows every row and only scrolls sideways, the summary folds
   into one line, and Discard / Apply sit in a bar fixed to the bottom.

   Hidden from print, like the rest of Ini.                              */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { X, Check, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { codeTextById, writeCells, findMismatches, exchangeMarksIn, employedOn, mergeRules, seniorTermsOf } from "./rosterConfig";
import { weekTotalsFor, dayCountFor, isNonOff } from "./rotaCounts";
import { monthFingerprint, prettyDay, prettyWeekday } from "./monthBuild";

// The rota grid's own reading of a colour (DutyRotaOriginal.js textOn):
// dark text on light codes, white on dark ones.
const luminance = (hex) => {
  const c = String(hex || "#FFFFFF").replace("#", "");
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
const textOn = (bg) => (luminance(bg) > 0.6 ? "#142B33" : "#FFFFFF");
// The rota grid's leave styles (DutyRotaOriginal.js LEAVE_STYLES).
const LEAVE = {
  annual: { abbrev: "AL", bg: "#D8EEE9", fg: "#0B6A60" },
  maternity: { abbrev: "MAT", bg: "#E9E9E9", fg: "#5A6B72" },
  prematernity: { abbrev: "PML", bg: "#F6E0EC", fg: "#9C3D6E" },
  emergency: { abbrev: "EL", bg: "#FBE3DF", fg: "#B3532F" },
  other: { abbrev: "LV", bg: "#E6E4F5", fg: "#4E4A8C" },
};
const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const datesOf = (from, to) => {
  const out = [];
  for (let d = parseISO(from); ; d.setDate(d.getDate() + 1)) {
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (s > to) break;
    out.push(s);
  }
  return out;
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const listOf = (items, max = 6) =>
  items.slice(0, max).join(", ") + (items.length > max ? ` and ${items.length - max} more` : "");

const PHONE_CSS = `
  .mp-actions-bottom, .mp-summary-toggle { display: none; }
  @media (min-width: 900px) { .mp-sheet { margin: 24px; border-radius: 14px; overflow: hidden; } }
  /* Phones. Exactly the screen wide and never wider: every box is
     border-box, nothing may grow past its parent (a grid or flex child
     otherwise grows to fit its widest content), and only the grid itself
     scrolls sideways, inside its own box. */
  @media (max-width: 699px) {
    .mp-overlay, .mp-overlay * { box-sizing: border-box; }
    .mp-overlay {
      display: block !important; left: 0 !important; right: 0 !important;
      width: 100% !important; max-width: 100vw !important;
      overflow-x: hidden !important; overflow-y: auto; -webkit-overflow-scrolling: touch;
    }
    .mp-sheet {
      display: block !important; width: 100% !important; max-width: 100% !important;
      min-width: 0 !important; margin: 0 !important; border-radius: 0 !important;
      min-height: 100%; overflow-x: hidden;
    }
    .mp-head { padding: 12px !important; }
    .mp-head > div { flex: 1 1 100%; min-width: 0; }
    .mp-title { white-space: normal !important; overflow-wrap: anywhere; font-size: 16px !important; line-height: 1.3; }
    .mp-body {
      overflow: visible !important; width: 100%; min-width: 0;
      grid-template-columns: minmax(0, 1fr) !important;
      padding: 12px 12px calc(84px + env(safe-area-inset-bottom, 0px)) !important;
    }
    .mp-body > * { min-width: 0; max-width: 100%; }
    .mp-body { overflow-wrap: anywhere; }
    .mp-gridbox { overflow-wrap: normal; }
    .mp-actions-top { display: none !important; }
    .mp-actions-bottom {
      display: flex; gap: 8px; position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
      width: 100%; background: #fff; border-top: 1px solid #DCE8E6; box-shadow: 0 -4px 16px rgba(20,43,51,0.10);
      padding: 10px 12px calc(10px + env(safe-area-inset-bottom, 0px));
    }
    .mp-actions-bottom button { flex: 1 1 0; min-width: 0; justify-content: center; }
    .mp-summary-toggle { display: flex; width: 100%; white-space: normal; }
    .mp-summary-toggle span { overflow-wrap: anywhere; }
    .mp-details:not(.open) { display: none !important; }
    .mp-gridbox { width: 100%; max-width: 100%; max-height: none !important; overflow-x: auto !important; overflow-y: visible !important; }
    /* The grid cells keep their own size: the app shrinks every table on a
       phone, which is right for its other tabs but not for this grid. */
    .mp-overlay .mp-gridbox table.mp-grid td { padding: 0 !important; }
    .mp-overlay .mp-gridbox table.mp-grid th { padding: 6px 3px !important; }
    .mp-overlay .mp-gridbox table.mp-grid td.mp-name,
    .mp-overlay .mp-gridbox table.mp-grid th.mp-name { padding: 0 6px !important; }
    .mp-gridbox .mp-name-text { white-space: nowrap; }
    .mp-name { min-width: 0 !important; padding: 0 6px !important; }
    .mp-name-text { max-width: 88px; overflow: hidden; text-overflow: ellipsis; }
  }
  /* Touch screens cannot hover. Some Android phones still report that they
     can, so a finger-sized pointer or a phone-width screen hides it too. */
  @media (hover: none), (pointer: coarse), (any-pointer: coarse), (max-width: 699px) {
    .mp-hover-hint { display: none !important; }
  }
`;

export default function MonthPreview({ proposal, data, update, T, onDiscard, onApplied }) {
  const { writes, periodFrom, periodTo, label } = proposal;
  const [verify, setVerify] = useState(null);
  const [showDetails, setShowDetails] = useState(false);
  // Held in a ref so a parent re-render cannot restart the check below.
  const appliedRef = useRef(onApplied);
  appliedRef.current = onApplied;

  const codeById = useMemo(() => {
    const m = {}; (data.codes || []).forEach((c) => { m[c.id] = c; }); return m;
  }, [data.codes]);
  const writeAt = useMemo(() => {
    const m = {}; writes.forEach((w) => { m[`${w.sid}|${w.date}`] = w; }); return m;
  }, [writes]);
  const dates = useMemo(() => datesOf(periodFrom, periodTo), [periodFrom, periodTo]);
  const rows = useMemo(() => (data.staff || []).filter((s) =>
    (s.name || "").trim() && !(s.startDate && s.startDate > periodTo) && !(s.endDate && s.endDate < periodFrom)),
  [data.staff, periodFrom, periodTo]);
  const skipped = new Set(proposal.skipStaff || []);
  const locked = new Set(proposal.lockedStaffIds || []);

  /* The rota as it will be after Apply — the same trick the rota screen
     uses for "see original": a copy with only the changed days replaced,
     counted with the rota's own functions. */
  const after = useMemo(() => {
    const cells = { ...(data.cells || {}) };
    writes.forEach((w) => { cells[w.date] = { ...(cells[w.date] || {}), [w.sid]: w.id }; });
    return { ...data, cells, staff: data.staff || [], codes: data.codes || [], nonOfficial: data.nonOfficial || [] };
  }, [data, writes]);
  const nonOff = (date) => isNonOff(after, date);
  // The same columns and rows the rota shows, in the same order.
  const totalCols = [
    ["M", "morning", "#FEF7E8"], ["A", "afternoon", "#F0F7EA"],
    ...(data.eveningEnabled ? [["E", "evening", "#FBEEE9"]] : []),
    ["N", "night", "#EBF3FB"], ["OD", "other", "#F0EBF8"], ["RD", "release", "#F7EFE7"], ["OFF", "off", "#fff"],
  ];
  const footRows = [
    ["MORNING", "morning", "#F4B860"], ["AFTERNOON", "afternoon", "#8FBF6B"],
    ...(data.eveningEnabled ? [["EVENING", "evening", "#E58E77"]] : []), ["NIGHT", "night", "#6FA8DC"],
    ...((data.codes || []).some((c) => c.counts === "other") ? [["OTHER DUTY", "other", "#8E7CC3"]] : []),
  ];
  const totals = useMemo(() => {
    const m = {}; rows.forEach((s) => { m[s.id] = weekTotalsFor(after, s, dates); }); return m;
  }, [after, rows, dates]);

  /* ── The read-back check, as Smart Roster does it ──
     A successful write always arrives as a new rota object. If none
     arrives the write was refused, and that is said plainly. */
  useEffect(() => {
    if (!verify) return undefined;
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
    const wrong = findMismatches(data, verify.writes, codeTextById(data.codes));
    const total = verify.writes.length;
    setVerify(null);
    if (wrong.length) {
      console.warn("Ini: applied roster does not match the preview", wrong);
      window.alert(
        `Applied, but ${wrong.length} of ${total} cells did not land as previewed:\n\n` +
        wrong.slice(0, 10).join("\n") +
        (wrong.length > 10 ? `\n…and ${wrong.length - 10} more` : "") +
        `\n\nThe full list is in the browser console. Please send it over — this should not happen.`
      );
    } else {
      window.alert(
        `${label} applied — all ${total} changed cells match the preview.\n\n` +
        `You can still edit any cell by hand, and Undo will put the whole roster back in one step.`
      );
    }
    appliedRef.current(periodFrom, periodTo);
    return undefined;
  }, [data, verify, label, periodFrom, periodTo]);

  const apply = () => {
    if (proposal.missing.length) {
      window.alert(
        `Cannot apply: no duty code is set up for ${proposal.missing.join(", ")}.\n\n` +
        `Add ${proposal.missing.length === 1 ? "it" : "them"} under Settings, then build again. Nothing has been changed.`
      );
      return;
    }
    if (monthFingerprint(data, proposal.buildFrom, proposal.buildTo) !== proposal.fingerprint) {
      window.alert(
        "The rota has changed since this roster was built, so it has not been applied.\n\n" +
        "Discard this and build again — it only takes a few seconds."
      );
      return;
    }
    const marks = exchangeMarksIn(data, writes);
    const { replaced, replacedSplit } = proposal;
    if (!window.confirm(
      `Apply the roster for ${label}?\n\n` +
      `${plural(writes.length, "cell")} will be written between ${prettyDay(periodFrom)} and ${prettyDay(periodTo)}. Nothing outside these dates changes.\n\n` +
      (proposal.keepExisting
        ? `Duties already on the rota are kept exactly as they are; only empty days are filled.`
        : replaced
          ? `${plural(replaced, "existing duty", "existing duties")} will be replaced` +
            (replacedSplit ? ` — ${replacedSplit} of them split duties or duties with a post, which become a single duty` : "") + `.`
          : `No existing duties are replaced.`) +
      `\n\nRecorded leave, sick, family and medical leave, release duties and notes on the cells are kept.` +
      (marks ? `\n\n${plural(marks, `"changed duty" mark`)} will be cleared, because the duty ${marks === 1 ? "it remembers" : "they remember"} is being replaced.` : "") +
      `\n\nUndo will put the whole roster back in one step.`
    )) return;
    update((d) => writeCells(d, writes));
    setVerify({ writes, before: data });
  };

  /* ── The summary, in plain words ── */
  const f = proposal.fairness;
  const fairLine = (name, s) => (s ? { name, range: s.min === s.max ? `${s.min} each` : `${s.min} to ${s.max}`, s } : null);
  const fairness = [
    fairLine("Nights", f.nights), fairLine("Friday offs", f.fridayOff),
    fairLine("Duties on non-official days", f.nonOfficial), fairLine("Total duties", f.duties),
  ].filter(Boolean);
  const nameOf = (id) => (data.staff || []).find((s) => s.id === id)?.name;
  const lockedNames = [...locked].map(nameOf).filter(Boolean);
  const skippedNames = rows.filter((s) => skipped.has(s.id)).map((s) => s.name);
  const clean = !proposal.shortfalls.length && !proposal.seniorGaps.length && !proposal.bent.length;
  // The ward's own word for the person in charge, as Smart Roster uses it.
  const seniorWord = seniorTermsOf(mergeRules(data.rosterRules || {})).lower;
  // The one-line version for phones.
  const summaryLine = [
    proposal.shortfalls.length ? `${plural(proposal.shortfalls.length, "shift")} not filled` : "Every shift covered",
    proposal.seniorGaps.length ? `${proposal.seniorGaps.length} with no ${seniorWord}` : null,
    proposal.bent.length ? `${plural(proposal.bent.length, "setting")} bent` : null,
  ].filter(Boolean).join(" · ");

  const box = (bg, border, color) => ({
    background: bg, border: `1px solid ${border}`, borderRadius: 10,
    padding: "10px 12px", fontSize: 13, color, lineHeight: 1.6,
  });
  const btn = (kind, disabled) => ({
    fontFamily: "inherit", fontSize: 13.5, fontWeight: 700, borderRadius: 9, padding: "9px 15px",
    display: "inline-flex", alignItems: "center", gap: 6,
    border: kind === "ghost" ? `1px solid ${T.line}` : "none",
    background: kind === "ghost" ? "#fff" : T.lagoon, color: kind === "ghost" ? T.ink : "#fff",
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1,
  });
  const cellBox = { minWidth: 38, height: 30, borderRadius: 6, fontSize: 11.5, fontWeight: 700,
    display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "0 3px" };
  const actionButtons = (
    <>
      <button type="button" style={btn("ghost", !!verify)} disabled={!!verify} onClick={onDiscard}>
        <X size={15} /> Discard
      </button>
      <button type="button" style={btn("primary", !!verify || !writes.length)}
        disabled={!!verify || !writes.length} onClick={apply}>
        <Check size={15} /> {verify ? "Applying…" : writes.length ? "Apply to rota" : "Nothing to change"}
      </button>
    </>
  );

  const renderCell = (s, date) => {
    const key = `${s.id}|${date}`;
    if (!employedOn(s, date)) return <div style={{ ...cellBox, background: "#F1F4F4", color: "#B9C6C4" }}>·</div>;
    const lp = (s.leavePeriods || []).find((p) => date >= p.start && date <= p.end);
    if (lp) {
      const st = LEAVE[lp.type] || LEAVE.other;
      return <div title={lp.label || "Leave"} style={{ ...cellBox, background: st.bg, color: st.fg }}>{st.abbrev}</div>;
    }
    const w = writeAt[key];
    const raw = w ? w.id : (data.cells?.[date] || {})[s.id];
    const ids = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw.filter((e) => e && e.code).map((e) => e.code) : [];
    const code = codeById[ids[0]];
    const before = w ? (w.before ? (typeof w.before === "string" ? [w.before] : w.before.map((e) => e && e.code)) : []) : null;
    const beforeText = before ? (before.map((id) => codeById[id]?.code).filter(Boolean).join(" + ") || "empty") : "";
    return (
      <div
        title={w ? `${s.name}, ${prettyWeekday(date)}: now ${beforeText}, will be ${w.code}` : undefined}
        style={{
          ...cellBox,
          background: code ? code.color : "#fff",
          color: code ? textOn(code.color) : "#B9C6C4",
          border: code ? "1px solid rgba(20,43,51,0.12)" : `1px dashed ${T.line}`,
          boxShadow: w ? `inset 0 0 0 2px ${T.ink}` : "none",
        }}
      >
        {code ? code.code : ids.length ? "?" : "—"}
        {ids.length > 1 && <span style={{ fontSize: 9, marginLeft: 2 }}>+{ids.length - 1}</span>}
        {w && <span aria-hidden="true" style={{ position: "absolute", top: 2, right: 2, width: 5, height: 5,
          borderRadius: 3, background: T.coral }} />}
      </div>
    );
  };

  const th = { padding: "6px 3px", fontSize: 11, fontWeight: 700, color: T.inkSoft, textAlign: "center",
    borderBottom: `1px solid ${T.line}`, background: "#fff", position: "sticky", top: 0, zIndex: 1 };
  const sum = { textAlign: "center", fontWeight: 700, fontSize: 12, padding: "0 6px", minWidth: 30, borderRadius: 4 };
  const nameCell = { position: "sticky", left: 0, zIndex: 2, background: "#fff", padding: "0 10px",
    fontWeight: 600, whiteSpace: "nowrap", fontSize: 12.5, minWidth: 120 };

  return (
    <div className="no-print ini-root mp-overlay" role="dialog" aria-modal="true" aria-label={`Roster preview for ${label}`}
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(20,43,51,0.35)",
        display: "flex", justifyContent: "center", fontFamily: "Inter, system-ui, sans-serif", color: T.ink }}>
      <style>{PHONE_CSS}</style>
      <div className="mp-sheet" style={{ background: "#fff", width: "100%", maxWidth: 1400, display: "flex",
        flexDirection: "column", boxShadow: "0 10px 40px rgba(20,43,51,0.25)" }}>

        <header className="mp-head" style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", padding: "14px 18px", borderBottom: `1px solid ${T.line}` }}>
          <div style={{ minWidth: 0 }}>
            <h2 className="mp-title" style={{ fontFamily: "Sora, sans-serif", fontSize: 17, margin: 0 }}>Roster for {label} · not applied yet</h2>
            <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 3 }}>
              {proposal.ms != null && `Built in ${(proposal.ms / 1000).toFixed(1)} seconds · `}
              {plural(writes.length, "cell")} will change
              {proposal.keptCount ? ` · ${plural(proposal.keptCount, "cell")} kept as they are` : ""}
            </div>
          </div>
          <div className="mp-actions-top" style={{ display: "flex", gap: 8 }}>{actionButtons}</div>
        </header>

        <div className="mp-body" style={{ flex: 1, overflowY: "auto", padding: "14px 18px 22px", display: "grid", gap: 12, alignContent: "start" }}>
          {/* On a phone the summary is one line until tapped. */}
          <button type="button" className="mp-summary-toggle" aria-expanded={showDetails}
            onClick={() => setShowDetails((v) => !v)}
            style={{ ...box(clean ? "#E3F3EF" : "#FBF1DC", clean ? "#BFE3DA" : "#E7D9B8", clean ? "#0B6A60" : "#8A5A0F"),
              fontFamily: "inherit", textAlign: "left", cursor: "pointer", alignItems: "center", gap: 8, width: "100%" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              {summaryLine} · <strong style={{ textDecoration: "underline" }}>{showDetails ? "Hide details" : "Show details"}</strong>
            </span>
            {showDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          <div className={`mp-details${showDetails ? " open" : ""}`} style={{ display: "grid", gap: 12 }}>
            {clean && (
              <div style={box("#E3F3EF", "#BFE3DA", "#0B6A60")}>
                Every shift is covered, and none of your Smart Roster settings had to bend.
              </div>
            )}
            {proposal.shortfalls.length > 0 && (
              <div style={box("#FBEAE7", "#F1B8AE", "#8A2E1E")}>
                <strong>{plural(proposal.shortfalls.length, "shift")} could not be filled:</strong>{" "}
                {listOf(proposal.shortfalls.map((s) => `${prettyWeekday(s.date)} ${s.shift}`), 10)}.
                {proposal.shortWeeks.map((w) => (
                  <div key={w.week}>
                    The week of {prettyDay(w.week)} needs {w.needed} duties and your staff can work {w.available} between
                    them. Raise the weekly duty maximum, lower a shift minimum, or add someone.
                  </div>
                ))}
                {!proposal.shortWeeks.length && " There were enough duties on paper, but the rest rules left nobody free at those times."}
                {" "}You can apply this and fill them by hand.
              </div>
            )}
            {proposal.seniorGaps.length > 0 && (
              <div style={box("#FBF1DC", "#E7D9B8", "#8A5A0F")}>
                <strong>{plural(proposal.seniorGaps.length, "shift")} with no {seniorWord}:</strong>{" "}
                {listOf(proposal.seniorGaps.map((s) => `${prettyWeekday(s.date)} ${s.shift}`), 10)}.
              </div>
            )}
            {proposal.bent.length > 0 && (
              <div style={box("#FBF1DC", "#E7D9B8", "#8A5A0F")}>
                <strong>Settings it had to bend:</strong>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {proposal.bent.map((b) => (
                    <li key={b.rule}><strong>{b.rule}</strong> ({b.places.length}): {listOf(b.places)}</li>
                  ))}
                </ul>
              </div>
            )}
            {fairness.length > 0 && (
              <div style={box("#F4F8F7", T.line, T.ink)}>
                <strong>How evenly it is shared</strong> (these dates, per person):
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {fairness.map((x) => (
                    <li key={x.name}>
                      {x.name}: <strong>{x.range}</strong>
                      {x.s.min !== x.s.max && (
                        <span style={{ color: T.inkSoft }}>
                          {" "}— fewest {listOf(x.s.fewest, 3)}; most {listOf(x.s.most, 3)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* How it was built */}
            <div style={{ fontSize: 12.5, color: T.inkSoft, lineHeight: 1.65 }}>
              {proposal.keepExisting
                ? "Duties already on the rota are kept exactly as they are; only empty days were filled. "
                : proposal.replaced
                  ? `${plural(proposal.replaced, "existing duty", "existing duties")} will be replaced. `
                  : ""}
              {proposal.padded && "The weeks at the start and end were planned as whole weeks, so the duties already on the rota either side count toward their limits. "}
              {proposal.fellBack && (
                <span style={{ color: "#8A5A0F" }}>
                  The days just before the first day could not be counted toward the first week (a day there was short
                  of staff), so the first and last weeks were planned on their own — check the weekly limits there. {" "}
                </span>
              )}
              {lockedNames.length > 0 && `View-only on your plan, so kept as they are: ${listOf(lockedNames)}. `}
              {skippedNames.length > 0 && `Skipped in Smart Roster, so left alone: ${listOf(skippedNames)}. `}
            </div>
          </div>

          {/* The grid */}
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12, color: T.inkSoft, alignItems: "center" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ ...cellBox, minWidth: 22, height: 18, boxShadow: `inset 0 0 0 2px ${T.ink}`, background: "#fff" }} />
              will change
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ ...cellBox, minWidth: 22, height: 18, border: `1px dashed ${T.line}` }} />
              stays empty
            </span>
            <span className="mp-hover-hint">On a computer, hover over a changed cell to see what it holds now.</span>
          </div>
          <div className="mp-gridbox" style={{ overflow: "auto", border: `1px solid ${T.line}`, borderRadius: 10, maxHeight: "70vh" }}>
            <table className="mp-grid" style={{ borderCollapse: "separate", borderSpacing: 2, fontSize: 12 }}>
              <thead>
                <tr>
                  <th className="mp-name" style={{ ...th, left: 0, zIndex: 3, textAlign: "left", padding: "6px 10px", minWidth: 120 }}>Staff</th>
                  {dates.map((d) => (
                    <th key={d} style={{ ...th, background: nonOff(d) ? "#FBF1DC" : "#fff", color: nonOff(d) ? "#A5731B" : T.inkSoft }}>
                      <div style={{ fontSize: 9.5 }}>{DAY_LETTER[parseISO(d).getDay()]}</div>
                      <div style={{ color: T.ink }}>{parseISO(d).getDate()}</div>
                    </th>
                  ))}
                  {totalCols.map(([h]) => <th key={h} style={{ ...th, background: "#F4F8F7" }}>{h}</th>)}
                  <th style={{ ...th, background: "#FBF1DC", color: "#A5731B", whiteSpace: "nowrap", padding: "6px 6px" }}>NON-OFF DUTY</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="mp-name" title={s.name} style={nameCell}>
                      <div className="mp-name-text">
                        {s.name}
                        {skipped.has(s.id) && <span style={{ marginLeft: 6, fontSize: 10, color: T.inkSoft }}>skipped</span>}
                        {locked.has(s.id) && <span style={{ marginLeft: 6, fontSize: 10, color: T.inkSoft }}>view-only</span>}
                      </div>
                    </td>
                    {dates.map((d) => <td key={d} style={{ padding: 0 }}>{renderCell(s, d)}</td>)}
                    {totalCols.map(([h, cat, bg]) => (
                      <td key={h} style={{ ...sum, background: bg }}>{totals[s.id][cat]}</td>
                    ))}
                    <td style={{ ...sum, fontWeight: 800, background: "#FBF1DC", color: "#A5731B" }}>{totals[s.id].nonOfficialDuty}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                {footRows.map(([lab, cat, color]) => (
                  <tr key={cat}>
                    <td className="mp-name" title={lab} style={{ ...nameCell, background: color, color: textOn(color), fontWeight: 800, fontSize: 11.5 }}>
                      <div className="mp-name-text">{lab}</div>
                    </td>
                    {dates.map((d) => (
                      <td key={d} style={{ ...sum, height: 26, background: color + "33" }}>{dayCountFor(after, d, cat)}</td>
                    ))}
                    <td colSpan={totalCols.length + 1} />
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>
          <div style={{ fontSize: 12, color: T.inkSoft, lineHeight: 1.6 }}>
            Totals count these dates as they will be after Apply — kept duties, leave and the new duties together —
            the same way the rota counts them.
          </div>
          {proposal.missing.length > 0 && (
            <div style={{ ...box("#FBEAE7", "#F1B8AE", "#8A2E1E"), display: "flex", gap: 8 }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 3 }} />
              <span>No duty code is set up for {proposal.missing.join(", ")}, so this cannot be applied. Add it under Settings and build again.</span>
            </div>
          )}
        </div>

        {/* Phones: always reachable at the bottom of the screen. */}
        <div className="mp-actions-bottom">{actionButtons}</div>
      </div>
    </div>
  );
}
