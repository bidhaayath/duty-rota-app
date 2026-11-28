import React, { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Download, X } from "lucide-react";
import { LEAVE_STYLES, LEAVE_TYPE_OPTIONS, LEAVE_PALETTE, styleFor, textOnBg } from "./leaveTypes";
import { leaveOn, isEmployedOn, cellEntries, isNonOff } from "./rotaCounts";
import { exportLeaveToExcel } from "./leaveExcel";

/* ─────────────────── Leave tab ───────────────────
   Every kind of leave in the department, drawn as bars across the days it
   covers: leave periods (staff.leavePeriods, the same list the Staff tab and
   the rota use) and leave entered as a rota code (SL, FRL, ML…), which shows
   here too but is changed on the rota.

   Writes only through `update`, and only to:
     - a staff row's leavePeriods (add / edit / remove a period);
     - data.leaveColors (the colour picked for a type);
     - rota cells holding a LEAVE code (SL, FRL, ML, other leave codes), when
       a dashed bar is edited or removed here. Only leave cells are cleared,
       never a duty; a duty is only replaced after a warning that names it.
   A duty under a new leave PERIOD is never touched: it stays saved and
   simply stops counting while the person is on leave, as the rota does.

   Exported pictures and PDFs use LeaveChart with inline styles only (the
   image export copies inline styles, not classes). */

const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
const datesBetween = (a, b) => { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; };
const niceDate = (s) => parseD(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
// "9 Aug – 5 Sept", or with years when the leave crosses into another year.
const spanText = (a, b) => {
  if (a === b) return niceDate(a);
  if (a.slice(0, 4) !== b.slice(0, 4)) {
    const y = (s) => parseD(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    return `${y(a)} – ${y(b)}`;
  }
  return `${niceDate(a)} – ${niceDate(b)}`;
};
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// A date range can cover up to two years; past 62 days it is drawn month-wise like Year.
const MAX_RANGE = 731;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Which leave a rota code is (same rule as the rota's own leaveBucket).
const codeLeaveType = (code) => {
  if (!code) return null;
  if (["sl", "frl", "ml"].includes(code.counts)) return code.counts;
  if (code.counts !== "leave") return null;
  const c = (code.code || "").toUpperCase();
  return c === "SL" ? "sl" : c === "FRL" ? "frl" : c === "ML" ? "ml" : "other";
};

/* Everything on leave in [from, to]: one item per period (clipped to the
   range) and one per run of consecutive rota-code leave days. */
export const leaveItemsFor = (data, days) => {
  const from = days[0], to = days[days.length - 1];
  const codeById = (id) => (data.codes || []).find((c) => c.id === id);
  const rows = [];
  (data.staff || []).forEach((s) => {
    if (!days.some((d) => isEmployedOn(s, d))) return;
    const items = [];
    (s.leavePeriods || []).forEach((p, idx) => {
      if (!p || !p.start || !p.end || p.end < from || p.start > to) return;
      items.push({ kind: "period", staffId: s.id, idx, period: p, type: p.type, start: p.start < from ? from : p.start, end: p.end > to ? to : p.end });
    });
    let run = null;
    const close = () => { if (run) { items.push(run); run = null; } };
    days.forEach((d) => {
      const code = !leaveOn(s, d) && isEmployedOn(s, d)
        ? cellEntries(data, d, s.id).map((e) => codeById(e.code)).find((c) => codeLeaveType(c)) : null;
      if (!code) { close(); return; }
      if (run && run.code.id === code.id && addDays(run.end, 1) === d) { run.end = d; return; }
      close();
      run = { kind: "code", staffId: s.id, code, type: codeLeaveType(code), start: d, end: d };
    });
    close();
    rows.push({ staff: s, items });
  });
  return rows;
};

const itemLook = (item, colors) => {
  if (item.kind === "period") return styleFor(item.period, colors);
  const st = styleFor({ type: item.type }, colors);
  return { ...st, abbrev: item.code.code, label: item.code.label || item.code.code };
};

/* The chart: names down the left, the days across, leave as bars. Inline
   styles only, so the same component prints and saves as a picture. */
/* The Show filter is "all", or a list of the leave types picked (AL and MAT,
   say). A single type as a plain string still works. */
export const inFilter = (filter, type) =>
  filter === "all" || (Array.isArray(filter) ? filter.includes(type) : filter === type);

/* The NAME column's width on screen, dragged like the Rota's: the handle on
   the header's right edge, double-click for the standard width, arrow keys
   nudge it. Kept in this browser only, laptop and phone separately, under
   their own keys (never the password-reset keys). Exports keep their fixed
   width, so pictures and PDFs are unaffected. */
const LEAVE_NAMEW = { laptop: { key: "edr:leaveNameW", def: 160, min: 90, max: 380 }, phone: { key: "edr:leaveNameWPhone", def: 104, min: 60, max: 240 } };
const readLeaveNameW = (k) => {
  try { const v = Number(window.localStorage.getItem(LEAVE_NAMEW[k].key)); return v >= LEAVE_NAMEW[k].min && v <= LEAVE_NAMEW[k].max ? v : LEAVE_NAMEW[k].def; }
  catch (e) { return LEAVE_NAMEW[k].def; }
};
const saveLeaveNameW = (k, v) => { try { window.localStorage.setItem(LEAVE_NAMEW[k].key, String(v)); } catch (e) { /* private mode: just not remembered */ } };

export function LeaveChart({ data, days, rows, filter = "all", everyone = false, onPick = null, compact = false }) {
  const colors = data.leaveColors || null;
  // Narrower names on a phone; they stay frozen on the left while the days scroll.
  const phone = !compact && typeof window !== "undefined" && window.innerWidth < 640;
  const kind = phone ? "phone" : "laptop";
  const [nameWs, setNameWs] = useState(() => (typeof window === "undefined"
    ? { laptop: LEAVE_NAMEW.laptop.def, phone: LEAVE_NAMEW.phone.def }
    : { laptop: readLeaveNameW("laptop"), phone: readLeaveNameW("phone") }));
  const nameW = compact ? 120 : nameWs[kind];
  const setNameWidth = (v) => {
    const w = Math.round(Math.min(LEAVE_NAMEW[kind].max, Math.max(LEAVE_NAMEW[kind].min, v)));
    setNameWs((prev) => ({ ...prev, [kind]: w }));
    return w;
  };
  const startNameResize = (e) => {
    e.preventDefault();
    const x0 = e.clientX, w0 = nameW;
    let last = w0;
    const move = (ev) => { last = setNameWidth(w0 + ev.clientX - x0); };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.cursor = "";
      saveLeaveNameW(kind, last);
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const resetNameWidth = () => saveLeaveNameW(kind, setNameWidth(LEAVE_NAMEW[kind].def));
  const nudgeNameWidth = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    saveLeaveNameW(kind, setNameWidth(nameW + (e.key === "ArrowRight" ? 10 : -10)));
  };
  const frozen = compact ? {} : { position: "sticky", left: 0, zIndex: 3 };
  /* Year view: 365 thin day columns, labelled by month only, with a line at
     each month. Bars sit on the exact days; short ones show their code and
     the detail is in the hover text. */
  const yearMode = days.length > 62;
  // Month-wise: the days share about 800px, so a year or a long range fits a
  // laptop and a landscape page.
  /* On an export the day columns shrink to whatever the page allows, so a
     whole month always fits the sheet; on screen they keep a usable width. */
  const colMin = yearMode ? Math.max(1.1, Math.min(12, 800 / days.length))
    : compact ? (days.length > 14 ? 12 : 30)
    : days.length > 14 ? 26 : 44;
  const months = [];
  days.forEach((d, k) => {
    const key = d.slice(0, 7);
    if (!months.length || months[months.length - 1].key !== key) months.push({ key, start: k, len: 1, date: d });
    else months[months.length - 1].len++;
  });
  const grid = { display: "grid", gridTemplateColumns: `${nameW}px repeat(${days.length}, minmax(${colMin}px, 1fr))` };
  const shown = rows.map((r) => ({ ...r, items: r.items.filter((it) => inFilter(filter, it.type)) }))
    .filter((r) => filter === "all" || everyone || r.items.length);
  // On screen the bars open from left to right, one row after another. Exports
  // (compact) never animate, so a picture never catches a half-open bar.
  const animate = !compact;
  return (
    <div style={{ minWidth: compact ? 0 : nameW + days.length * colMin, width: compact ? "100%" : undefined, fontFamily: "Inter, system-ui, sans-serif", color: "#0E3A47" }}>
      {animate && (
        <style>{`@keyframes edrLeaveOpen { from { clip-path: inset(0 100% 0 0 round 999px); opacity: 0.4; } to { clip-path: inset(0 0 0 0 round 999px); opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .edr-leavebar { animation: none !important; } }`}</style>
      )}
      <div style={{ ...grid, borderBottom: "1px solid #D3E5EC", background: "#FFFFFF", position: "sticky", top: 0, zIndex: 2 }}>
        <div style={{ ...frozen, ...(compact ? { position: "relative" } : {}), background: "#FFFFFF", padding: "8px 12px", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", color: "#3A5F6B", display: "flex", alignItems: "center", boxShadow: compact ? "none" : "1px 0 0 #D3E5EC" }}>
          NAME
          {!compact && (
            <span className="rota-resize" role="separator" aria-orientation="vertical" tabIndex={0}
              aria-label="Name column width: drag, or use the arrow keys. Double-click for the standard width."
              title="Drag to change the width · double-click to reset"
              onPointerDown={startNameResize} onDoubleClick={resetNameWidth} onKeyDown={nudgeNameWidth} />
          )}
        </div>
        {yearMode && months.map((m) => (
          <div key={m.key} style={{ gridRow: 1, gridColumn: `${m.start + 2} / span ${m.len}`, textAlign: "center", padding: "8px 0", fontSize: 12, fontWeight: 700, borderLeft: "1px solid #D3E5EC", color: "#0E3A47" }}>
            {parseD(m.date).toLocaleDateString("en-GB", { month: "short" })}
          </div>
        ))}
        {!yearMode && days.map((d) => {
          const no = isNonOff(data, d);
          return (
            <div key={d} style={{ textAlign: "center", padding: "5px 0", background: no ? "#FBF1DC" : "#FFFFFF", borderLeft: "1px solid #EEF4F6" }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: no ? "#A5731B" : "#3A5F6B" }}>{days.length > 14 ? DOW[parseD(d).getDay()][0] : DOW[parseD(d).getDay()]}</div>
              <div style={{ fontSize: compact ? 10 : days.length > 14 ? 11 : 13, fontWeight: 700 }}>{parseD(d).getDate()}</div>
            </div>
          );
        })}
      </div>
      {shown.length === 0 && (
        <div style={{ padding: 18, fontSize: 13, color: "#3A5F6B" }}>No leave{filter === "all" ? "" : " of these types"} in these dates.</div>
      )}
      {shown.map(({ staff, items }, i) => (
        <div key={staff.id} style={{ ...grid, position: "relative", minHeight: compact ? 28 : 36, borderBottom: "1px solid #EEF4F6", background: i % 2 ? "#FAFCFD" : "#FFFFFF" }}>
          <div style={{ ...frozen, gridRow: 1, gridColumn: 1, display: "flex", alignItems: "center", gap: phone ? 4 : 8, padding: phone ? "0 6px" : "0 12px",
            fontSize: phone ? 11.5 : compact ? 11 : 12.5, fontWeight: 600, lineHeight: 1.2,
            // Long names wrap onto a second line rather than being cut off.
            whiteSpace: phone || compact ? "normal" : "nowrap", overflowWrap: "anywhere",
            overflow: phone || compact ? "visible" : "hidden", textOverflow: phone || compact ? "clip" : "ellipsis",
            paddingTop: compact ? 3 : 0, paddingBottom: compact ? 3 : 0,
            background: i % 2 ? "#FAFCFD" : "#FFFFFF", boxShadow: compact ? "none" : "1px 0 0 #D3E5EC" }}>
            <span style={{ flex: "none", width: phone ? 14 : 16, fontSize: 10.5, fontWeight: 500, color: "#3A5F6B" }}>{i + 1}</span><span title={staff.name} style={{ minWidth: 0, overflow: "hidden", textOverflow: phone || compact ? "clip" : "ellipsis" }}>{staff.name}</span>
          </div>
          {yearMode
            ? months.map((m) => (
                <div key={m.key} aria-hidden="true" style={{ gridRow: 1, gridColumn: `${m.start + 2} / span ${m.len}`, borderLeft: "1px solid #E3EDF1" }} />
              ))
            : days.map((d, k) => (
                <div key={d} aria-hidden="true" style={{ gridRow: 1, gridColumn: k + 2, borderLeft: "1px solid #EEF4F6", background: isNonOff(data, d) ? "rgba(251,241,220,0.55)" : "transparent" }} />
              ))}
          {items.map((it, k) => {
            const c0 = days.indexOf(it.start), c1 = days.indexOf(it.end);
            if (c0 < 0 || c1 < 0) return null;
            const span = c1 - c0 + 1;
            const st = itemLook(it, colors);
            const full = it.kind === "period" ? it.period : it;
            /* More than 3 days in a row — a leave period, or the same leave code
               on consecutive rota days joined into one bar — shows its dates:
               "FRL (3 Nov – 20 Nov)". */
            const long = (parseD(full.end) - parseD(full.start)) / 86400000 >= 3;
            // Other leave with its own name ("Study Leave") shows that name, not LV.
            const name = it.kind === "period" && it.period.type === "other" && it.period.label ? it.period.label : st.abbrev;
            const label = yearMode
              ? (span * colMin >= 120 ? `${name} (${spanText(full.start, full.end)})` : span * colMin >= 22 ? name : "")
              : (span >= 4 && long ? `${name} (${spanText(full.start, full.end)})` : name);
            const clickable = !!onPick;
            return (
              <div key={k} className={animate ? "edr-leavebar" : undefined} role={clickable ? "button" : "img"} tabIndex={clickable ? 0 : undefined}
                aria-label={`${staff.name}: ${st.label}, ${niceDate(it.start)} to ${niceDate(it.end)}${it.kind === "code" ? " (from the rota)" : ""}`}
                title={`${st.label}: ${spanText(full.start, full.end)}${it.kind === "code" ? " · entered on the rota" : ""}`}
                onClick={clickable ? () => onPick(it) : undefined}
                onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(it); } } : undefined}
                style={{
                  gridRow: 1, gridColumn: `${c0 + 2} / ${c1 + 3}`, alignSelf: "center", margin: "0 2px", zIndex: 1,
                  height: compact ? 20 : 24, borderRadius: 999, padding: yearMode ? "0 4px" : "0 8px", boxSizing: "border-box", minWidth: yearMode ? 4 : undefined,
                  display: "flex", alignItems: "center", justifyContent: span > 1 ? "flex-start" : "center",
                  background: st.bg, color: st.fg, fontSize: compact ? 9.5 : 11, fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  border: it.kind === "code" ? `1.5px dashed ${st.fg}` : "1px solid rgba(14,58,71,0.08)",
                  cursor: clickable ? "pointer" : "default",
                  animation: animate ? `edrLeaveOpen 650ms cubic-bezier(0.22, 1, 0.36, 1) ${Math.min(i, 12) * 45 + 80}ms both` : undefined,
                }}>{label}</div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

const card = { boxSizing: "border-box", borderRadius: 20, background: "rgba(255,255,255,0.74)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 8px 24px rgba(14,58,71,0.07)" };
const fieldLbl = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, fontWeight: 600, color: "#3A5F6B" };
const inp = { height: 38, padding: "0 10px", borderRadius: 10, border: "1px solid rgba(14,58,71,0.22)", background: "#FFFFFF", color: "#0E3A47", fontFamily: "inherit", fontSize: 13.5, boxSizing: "border-box" };
const pillBtn = (on) => ({
  height: 32, padding: "0 14px", borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600,
  background: on ? "linear-gradient(90deg, #0D4F61, #1F7F9F)" : "transparent", color: on ? "#FFFFFF" : "#0D4F61",
});
const softBtn = { display: "inline-flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", borderRadius: 999, border: "1px solid rgba(14,58,71,0.2)", background: "#FFFFFF", color: "#0D4F61", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const solidBtn = { ...softBtn, border: "none", background: "linear-gradient(90deg, #0D4F61, #1F7F9F)", color: "#FFFFFF", boxShadow: "0 4px 12px rgba(13,79,97,0.22)" };

export default function LeaveTab({ data, update, canEdit = false, staffEditable = () => true, onExport = null }) {
  const today = dstr(new Date());
  const weekStartsOn = data.weekStartsOn ?? 0;
  const startOfWeek = (s) => { const d = parseD(s); const back = (d.getDay() - weekStartsOn + 7) % 7; return addDays(s, -back); };
  const [view, setView] = useState("month");
  const [anchor, setAnchor] = useState(today);
  const [range, setRange] = useState({ from: today, to: addDays(today, 13) });
  const [filter, setFilter] = useState("all");
  // With one leave type picked: show only the staff who have it, or everyone.
  const [everyone, setEveryone] = useState(false);
  const [form, setForm] = useState(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The colours open toward whichever side has room, so none are cut off.
  const [paletteRight, setPaletteRight] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const days = useMemo(() => {
    if (view === "week") { const s = startOfWeek(anchor); return datesBetween(s, addDays(s, 6)); }
    if (view === "year") {
      const y = parseD(anchor).getFullYear();
      return datesBetween(`${y}-01-01`, `${y}-12-31`);
    }
    if (view === "month") {
      const d = parseD(anchor); const first = dstr(new Date(d.getFullYear(), d.getMonth(), 1));
      const last = dstr(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      return datesBetween(first, last);
    }
    const from = range.from, to = range.to >= range.from ? range.to : range.from;
    const capped = datesBetween(from, to).slice(0, MAX_RANGE);
    return capped;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, anchor, range, weekStartsOn]);

  const rows = useMemo(() => leaveItemsFor(data, days), [data, days]);
  const colors = data.leaveColors || null;
  const typesHere = [...new Set(rows.flatMap((r) => r.items.map((it) => it.type)))];
  const rangeLabel = view === "year" ? String(parseD(anchor).getFullYear())
    : view === "month"
    ? parseD(anchor).toLocaleDateString("en-GB", { month: "long", year: "numeric" })
    : `${niceDate(days[0])} – ${niceDate(days[days.length - 1])} ${parseD(days[days.length - 1]).getFullYear()}`;
  const step = (dir) => {
    if (view === "week") setAnchor(addDays(startOfWeek(anchor), dir * 7));
    else if (view === "month") { const d = parseD(anchor); setAnchor(dstr(new Date(d.getFullYear(), d.getMonth() + dir, 1))); }
    else if (view === "year") { const d = parseD(anchor); setAnchor(`${d.getFullYear() + dir}-01-01`); }
  };

  const activeStaff = (data.staff || []).filter((s) => !s.endDate || s.endDate >= today);
  const blankForm = () => ({ staffId: activeStaff[0]?.id || "", type: "annual", label: "", start: today, end: today, editing: null });
  const leaveCodes = (data.codes || []).filter((c) => codeLeaveType(c));
  const openEdit = (it) => {
    if (!canEdit) return;
    if (it.kind === "code") {
      setForm({ mode: "code", staffId: it.staffId, codeId: it.code.id, start: it.start, end: it.end,
        editing: { staffId: it.staffId, start: it.start, end: it.end } });
      setPaletteOpen(false);
      return;
    }
    setForm({ staffId: it.staffId, type: it.period.type, label: it.period.label || "", start: it.period.start, end: it.period.end, editing: { staffId: it.staffId, idx: it.idx, id: it.period.id || null } });
    setPaletteOpen(false);
  };
  const setTypeColor = (type, hex) => update((d) => { d.leaveColors = { ...(d.leaveColors || {}), [type]: hex }; return d; });
  const resetTypeColor = (type) => update((d) => { const c = { ...(d.leaveColors || {}) }; delete c[type]; d.leaveColors = c; return d; });

  const save = () => {
    if (!form || !form.staffId) return;
    if (!form.start || !form.end || form.end < form.start) { alert("Pick both dates, with To on or after From."); return; }
    if (!staffEditable(form.staffId)) { alert("This staff member is view-only on your current plan."); return; }
    const person = data.staff.find((s) => s.id === form.staffId);
    if (!person) return;
    const ed = form.editing && form.editing.staffId === form.staffId ? form.editing : null;
    const others = (person.leavePeriods || []).filter((p, i) => !(ed && (ed.id ? p.id === ed.id : i === ed.idx)));
    const clash = others.find((p) => p.start <= form.end && p.end >= form.start);
    if (clash) {
      alert(`${person.name} already has ${styleFor(clash, colors).label} on ${spanText(clash.start, clash.end)}.\n\nChange or remove that leave first.`);
      return;
    }
    const duties = datesBetween(form.start, form.end).filter((d) => cellEntries(data, d, person.id).length > 0).length;
    if (duties > 0 && !window.confirm(`${person.name} has ${duties} rota entr${duties === 1 ? "y" : "ies"} in these dates.\n\nThey stay saved, but are hidden and not counted while ${person.name} is on leave. Continue?`)) return;
    const period = { id: (ed && ed.id) || uid(), type: form.type, start: form.start, end: form.end };
    if (form.type === "other" && form.label.trim()) period.label = form.label.trim();
    update((d) => {
      // Moving a period to another person: take it off the first person.
      if (form.editing && form.editing.staffId !== form.staffId) {
        const old = d.staff.find((s) => s.id === form.editing.staffId);
        if (old) old.leavePeriods = (old.leavePeriods || []).filter((p, i) => !(form.editing.id ? p.id === form.editing.id : i === form.editing.idx));
      }
      const s = d.staff.find((x) => x.id === form.staffId);
      const list = [...(s.leavePeriods || [])];
      if (ed) {
        const at = ed.id ? list.findIndex((p) => p.id === ed.id) : ed.idx;
        if (at >= 0 && at < list.length) list[at] = period; else list.push(period);
      } else list.push(period);
      s.leavePeriods = list;
      return d;
    });
    setForm(null); setPaletteOpen(false);
  };
  /* Rota-code leave: set the chosen leave code on every day in the new dates
     and clear the old leave days that are no longer covered. */
  const isLeaveCell = (d, date, staffId) => {
    const cell = (d.cells?.[date] || {})[staffId];
    const ids = typeof cell === "string" ? [cell] : Array.isArray(cell) ? cell.map((e) => e && e.code) : [];
    return ids.length > 0 && ids.every((id) => codeLeaveType((d.codes || []).find((c) => c.id === id)));
  };
  const saveCode = () => {
    const person = data.staff.find((s) => s.id === form.staffId);
    if (!person || !form.codeId) return;
    if (!form.start || !form.end || form.end < form.start) { alert("Pick both dates, with To on or after From."); return; }
    if (!staffEditable(person.id)) { alert("This staff member is view-only on your current plan."); return; }
    const code = (data.codes || []).find((c) => c.id === form.codeId);
    const newDays = datesBetween(form.start, form.end).filter((d) => isEmployedOn(person, d) && !leaveOn(person, d));
    const duties = newDays.filter((d) => cellEntries(data, d, person.id).length > 0 && !isLeaveCell(data, d, person.id));
    if (duties.length && !window.confirm(`${person.name} has duties on ${duties.map(niceDate).join(", ")}.

They will be replaced by ${code.code}. Continue?`)) return;
    const old = form.editing ? datesBetween(form.editing.start, form.editing.end) : [];
    update((d) => {
      old.forEach((date) => {
        if (!newDays.includes(date) && isLeaveCell(d, date, person.id)) delete d.cells[date][person.id];
      });
      newDays.forEach((date) => {
        if (!d.cells[date]) d.cells[date] = {};
        d.cells[date][person.id] = form.codeId;
      });
      return d;
    });
    setForm(null);
  };
  const removeCode = (it) => {
    const person = data.staff.find((s) => s.id === it.staffId);
    if (!person || !staffEditable(person.id)) return;
    if (!window.confirm(`Clear ${person.name}'s ${it.code.code} on the rota (${spanText(it.start, it.end)})?

Those days become empty on the rota.`)) return;
    update((d) => {
      datesBetween(it.start, it.end).forEach((date) => { if (isLeaveCell(d, date, person.id)) delete d.cells[date][person.id]; });
      return d;
    });
    if (form && form.mode === "code" && form.editing && form.editing.staffId === it.staffId) setForm(null);
  };

  const remove = (it) => {
    const person = data.staff.find((s) => s.id === it.staffId);
    if (!person || !staffEditable(person.id)) return;
    const st = styleFor(it.period, colors);
    if (!window.confirm(`Remove ${person.name}'s ${st.label} (${spanText(it.period.start, it.period.end)})?\n\nTheir rota cells for those days are kept and count again.`)) return;
    update((d) => {
      const s = d.staff.find((x) => x.id === it.staffId);
      s.leavePeriods = (s.leavePeriods || []).filter((p, i) => !(it.period.id ? p.id === it.period.id : i === it.idx));
      return d;
    });
    if (form && form.editing && form.editing.idx === it.idx && form.editing.staffId === it.staffId) setForm(null);
  };

  const list = rows.flatMap((r) => r.items.map((it) => ({ ...it, staff: r.staff })))
    .filter((it) => inFilter(filter, it.type))
    .sort((a, b) => (a.kind === "period" ? a.period.start : a.start).localeCompare(b.kind === "period" ? b.period.start : b.start));
  const formLook = form ? styleFor({ type: form.type }, colors) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, fontFamily: "Inter, system-ui, sans-serif", color: "#0E3A47" }}>
      <style>{`
        /* The export menu opens towards the free side: left-aligned under the
           button on a phone (where Export sits at the left), right-aligned on
           a laptop (where it sits at the right). */
        .lv-exportmenu { right: 0; }
        @media (max-width: 899px) {
          .lv-exportmenu { right: auto; left: 0; }
          .lv-toolbar { gap: 8px !important; }
          .lv-form { padding: 12px !important; }
          .lv-form label, .lv-form .lv-colour { flex: 1 1 140px; }
          .lv-form input, .lv-form select { width: 100% !important; }
        }
      `}</style>

      {/* View, dates, export, add */}
      <div className="lv-toolbar" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, position: "relative", zIndex: 20 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <div role="group" aria-label="View" style={{ display: "inline-flex", padding: 3, borderRadius: 999, background: "rgba(13,79,97,0.08)" }}>
            {[["week", "Weekly"], ["month", "Monthly"], ["year", "Year"], ["range", "Date range"]].map(([v, l]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} style={pillBtn(view === v)}>{l}</button>
            ))}
          </div>
          {view === "range" ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="date" aria-label="From" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} style={{ ...inp, height: 34, borderRadius: 999 }} />
              <span>–</span>
              <input type="date" aria-label="To" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} style={{ ...inp, height: 34, borderRadius: 999 }} />
              {datesBetween(range.from, range.to >= range.from ? range.to : range.from).length > MAX_RANGE && (
                <span style={{ fontSize: 12, color: "#7A4F00" }}>Showing the first 2 years</span>
              )}
            </span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <button type="button" aria-label="Earlier" onClick={() => step(-1)} style={{ ...softBtn, width: 34, padding: 0, justifyContent: "center", border: "none", background: "rgba(13,79,97,0.08)" }}><ChevronLeft size={16} /></button>
              <span style={{ minWidth: 150, textAlign: "center", fontFamily: "'Plus Jakarta Sans', Inter, sans-serif", fontWeight: 700, fontSize: 15 }}>{rangeLabel}</span>
              <button type="button" aria-label="Later" onClick={() => step(1)} style={{ ...softBtn, width: 34, padding: 0, justifyContent: "center", border: "none", background: "rgba(13,79,97,0.08)" }}><ChevronRight size={16} /></button>
              <button type="button" onClick={() => setAnchor(today)} style={{ ...softBtn, border: "none", background: "rgba(13,79,97,0.08)" }}>Today</button>
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap" }}>
          {onExport && (
            <span style={{ position: "relative" }}>
              <button type="button" aria-expanded={exportOpen} onClick={() => setExportOpen((v) => !v)} style={softBtn}><Download size={15} /> Export</button>
              {exportOpen && (
                <div role="menu" className="lv-exportmenu" style={{ position: "absolute", top: "100%", marginTop: 6, zIndex: 40, minWidth: 190, padding: 6, borderRadius: 14,
                  background: "rgba(255,255,255,0.92)", WebkitBackdropFilter: "blur(20px) saturate(180%)", backdropFilter: "blur(20px) saturate(180%)",
                  border: "1px solid rgba(255,255,255,0.95)", boxShadow: "0 14px 34px rgba(14,58,71,0.2)" }}>
                  {[["both", "Chart and list"], ["chart", "Chart only"], ["list", "List only"]].map(([v, l]) => (
                    <button key={v} type="button" role="menuitem" onClick={() => { setExportOpen(false); onExport({ days, filter, everyone, title: rangeLabel, parts: v }); }}
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 12px", border: "none", borderRadius: 10, background: "transparent",
                        fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, color: "#0E3A47", cursor: "pointer" }}>{l}</button>
                  ))}
                </div>
              )}
            </span>
          )}
          {canEdit && !form && (
            <button type="button" onClick={() => { setForm(blankForm()); setPaletteOpen(false); }} style={solidBtn}><Plus size={15} /> Add leave</button>
          )}
        </div>
      </div>

      {/* Edit leave that was entered as rota codes */}
      {form && form.mode === "code" && (
        <div className="lv-form dr-anim-in" style={{ ...card, padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 10, position: "relative", zIndex: 5 }}>
          <span style={{ display: "flex", flexDirection: "column", gap: 2, alignSelf: "center", marginRight: 4 }}>
            <span style={{ fontFamily: "'Plus Jakarta Sans', Inter, sans-serif", fontWeight: 700, fontSize: 15 }}>Edit rota leave</span>
            <span style={{ fontSize: 11.5, color: "#3A5F6B" }}>Changes the rota cells for these days</span>
          </span>
          <label style={fieldLbl}>Staff
            <select value={form.staffId} disabled style={{ ...inp, width: 170, opacity: 0.8 }}>
              {(data.staff || []).filter((s) => s.id === form.staffId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          <label style={fieldLbl}>Leave code
            <select value={form.codeId} onChange={(e) => setForm({ ...form, codeId: e.target.value })} style={{ ...inp, width: 200 }}>
              {leaveCodes.map((c) => <option key={c.id} value={c.id}>{c.code}{c.label ? ` — ${c.label}` : ""}</option>)}
            </select></label>
          <label style={fieldLbl}>From
            <input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value, end: form.end < e.target.value ? e.target.value : form.end })} style={{ ...inp, width: 150 }} /></label>
          <label style={fieldLbl}>To
            <input type="date" value={form.end} min={form.start} onChange={(e) => setForm({ ...form, end: e.target.value })} style={{ ...inp, width: 150 }} /></label>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button type="button" onClick={() => setForm(null)} style={softBtn}><X size={14} /> Cancel</button>
            <button type="button" onClick={saveCode} style={solidBtn}><Pencil size={14} /> Save</button>
          </div>
        </div>
      )}

      {/* Add / edit a leave period */}
      {form && form.mode !== "code" && (
        <div className="lv-form dr-anim-in" style={{ ...card, padding: "14px 16px", display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 10, position: "relative", zIndex: 5 }}>
          <span style={{ fontFamily: "'Plus Jakarta Sans', Inter, sans-serif", fontWeight: 700, fontSize: 15, alignSelf: "center", marginRight: 4 }}>{form.editing ? "Edit leave" : "Add leave"}</span>
          <label style={fieldLbl}>Staff
            <select value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })} style={{ ...inp, width: 170 }}>
              {(data.staff || []).filter((s) => activeStaff.includes(s) || s.id === form.staffId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          <label style={fieldLbl}>Leave type
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} style={{ ...inp, width: 200 }}>
              {LEAVE_TYPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></label>
          {form.type === "other" && (
            <label style={fieldLbl}>Name
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Study leave" style={{ ...inp, width: 150 }} /></label>
          )}
          <label style={fieldLbl}>From
            <input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value, end: form.end < e.target.value ? e.target.value : form.end })} style={{ ...inp, width: 150 }} /></label>
          <label style={fieldLbl}>To
            <input type="date" value={form.end} min={form.start} onChange={(e) => setForm({ ...form, end: e.target.value })} style={{ ...inp, width: 150 }} /></label>
          <div className="lv-colour" style={{ ...fieldLbl, position: "relative" }}>
            <span>Colour for {form.type === "other" ? "other leave" : (LEAVE_STYLES[form.type]?.abbrev || "LV")}</span>
            <button type="button" aria-expanded={paletteOpen} onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setPaletteRight(r.left + 252 > window.innerWidth - 12);
              setPaletteOpen((v) => !v);
            }} style={{ ...inp, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", width: 130 }}>
              <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 6, background: formLook.bg, border: "1px solid rgba(14,58,71,0.15)" }} />
              <span style={{ fontSize: 13 }}>{formLook.abbrev}</span>
            </button>
            {paletteOpen && (
              <div role="group" aria-label="Pick a colour" style={{ position: "absolute", top: "100%", marginTop: 6, ...(paletteRight ? { right: 0 } : { left: 0 }), zIndex: 30, width: 252, boxSizing: "border-box", display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, padding: 10, borderRadius: 16,
                background: "rgba(255,255,255,0.92)", WebkitBackdropFilter: "blur(20px) saturate(180%)", backdropFilter: "blur(20px) saturate(180%)", border: "1px solid rgba(255,255,255,0.95)", boxShadow: "0 14px 34px rgba(14,58,71,0.2)" }}>
                {LEAVE_PALETTE.map((hex) => (
                  <button key={hex} type="button" aria-label={`Colour ${hex}`} aria-pressed={formLook.bg.toLowerCase() === hex.toLowerCase()}
                    onClick={() => { setTypeColor(form.type, hex); setPaletteOpen(false); }}
                    style={{ width: 26, height: 26, borderRadius: "50%", background: hex, cursor: "pointer",
                      border: formLook.bg.toLowerCase() === hex.toLowerCase() ? "2px solid #0D4F61" : "1px solid rgba(14,58,71,0.15)" }} />
                ))}
                <label title="Any colour" style={{ position: "relative", width: 26, height: 26, borderRadius: "50%", cursor: "pointer", border: "1.5px dashed rgba(14,58,71,0.45)",
                  background: "conic-gradient(#F28B82, #FFE08A, #7ED9B5, #8FD3F5, #B9C7FF, #F9A8C9, #F28B82)" }}>
                  <input type="color" aria-label="Any colour" value={formLook.bg} onChange={(e) => setTypeColor(form.type, e.target.value)}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }} />
                </label>
                {colors && colors[form.type] && (
                  <button type="button" onClick={() => { resetTypeColor(form.type); setPaletteOpen(false); }}
                    style={{ gridColumn: "1 / -1", marginTop: 2, border: "none", background: "none", color: "#0D4F61", fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Back to the standard colour</button>
                )}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
            <button type="button" onClick={() => { setForm(null); setPaletteOpen(false); }} style={softBtn}><X size={14} /> Cancel</button>
            <button type="button" onClick={save} style={solidBtn}>{form.editing ? <><Pencil size={14} /> Save</> : <><Plus size={14} /> Add leave</>}</button>
          </div>
        </div>
      )}

      {/* Filter by type */}
      <div role="group" aria-label="Show" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#3A5F6B" }}>Show</span>
        {["all", ...LEAVE_TYPE_OPTIONS.map(([v]) => v).filter((v) => typesHere.includes(v) || (Array.isArray(filter) && filter.includes(v)))].map((v) => {
          const st = v === "all" ? null : styleFor({ type: v }, colors);
          const on = v === "all" ? filter === "all" : Array.isArray(filter) && filter.includes(v);
          return (
            <button key={v} type="button" aria-pressed={on} onClick={() => setFilter((f) => {
              // "All leave" clears the picks; a type button adds or removes that type.
              if (v === "all") return "all";
              const picked = Array.isArray(f) ? f : [];
              const next = picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v];
              return next.length ? next : "all";
            })} style={{
              height: 28, padding: "0 12px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 700,
              border: on ? "2px solid #0D4F61" : "1px solid rgba(14,58,71,0.15)",
              background: st ? st.bg : (on ? "#0D4F61" : "#FFFFFF"), color: st ? st.fg : (on ? "#FFFFFF" : "#0D4F61") }}>
              {v === "all" ? "All leave" : st.abbrev}
            </button>
          );
        })}
        {filter !== "all" && (
          <button type="button" aria-pressed={everyone} onClick={() => setEveryone((e) => !e)} style={{
            marginLeft: 6, height: 28, padding: "0 12px", borderRadius: 999, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
            display: "inline-flex", alignItems: "center", gap: 6,
            border: "1px solid rgba(14,58,71,0.15)", background: everyone ? "#E4F2F8" : "#FFFFFF", color: "#0D4F61" }}>
            <span aria-hidden="true" style={{ width: 14, height: 14, borderRadius: 4, boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center",
              border: everyone ? "none" : "1.5px solid #3A5F6B", background: everyone ? "#0D4F61" : "transparent", color: "#FFFFFF", fontSize: 10, lineHeight: 1 }}>{everyone ? "\u2713" : ""}</span>
            Show all staff
          </button>
        )}
      </div>

      {/* The chart */}
      <section aria-label="Leave chart" style={{ ...card, padding: 0, overflow: "auto", maxHeight: "calc(100vh - 260px)" }}>
        <LeaveChart data={data} days={days} rows={rows} filter={filter} everyone={everyone} onPick={canEdit ? openEdit : null} />
      </section>
      <div style={{ fontSize: 12, color: "#3A5F6B" }}>
        Tap a bar to edit it. Dashed bars are leave entered as a rota code (SL, FRL, ML…), with the same code on
        days in a row joined into one bar; editing one changes those rota cells. Leave of 4 days or more shows its dates on the bar.
      </div>

      {/* The list */}
      <section aria-label="Leave in these dates" style={{ ...card, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ margin: 0, fontFamily: "'Plus Jakarta Sans', Inter, sans-serif", fontSize: 16, fontWeight: 700 }}>Leave in these dates</h2>
          <span style={{ fontSize: 12.5, color: "#3A5F6B" }}>{list.length} {list.length === 1 ? "entry" : "entries"}</span>
        </div>
        {list.length === 0 && <div style={{ fontSize: 13, color: "#3A5F6B" }}>No leave{filter === "all" ? "" : " of these types"} in these dates.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 340, overflowY: "auto" }}>
          {list.map((it, k) => {
            const st = itemLook(it, colors);
            const full = it.kind === "period" ? it.period : it;
            return (
              <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "8px 10px", borderRadius: 12, background: "rgba(255,255,255,0.8)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span style={{ minWidth: 42, height: 26, padding: "0 8px", borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 800, background: st.bg, color: st.fg }}>{st.abbrev}</span>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{it.staff.name} · {st.label}</span>
                    <span style={{ fontSize: 12, color: "#3A5F6B" }}>
                      {spanText(full.start, full.end)} · {it.kind === "period" ? "leave period" : "from the rota"}
                    </span>
                  </span>
                </span>
                {canEdit && staffEditable(it.staffId) && (
                  <span style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={() => openEdit(it)} aria-label={`Edit ${it.staff.name}'s ${st.label}`} style={softBtn}><Pencil size={13} /> Edit</button>
                    <button type="button" onClick={() => (it.kind === "code" ? removeCode(it) : remove(it))} aria-label={`Remove ${it.staff.name}'s ${st.label}`} style={{ ...softBtn, border: "none", background: "#FBE1DD", color: "#8A2A1E" }}><Trash2 size={13} /> Remove</button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* The export page: a heading and the chart, for Print / Save as PDF and
   Save image on the shared export screen. */
const generatedAt = () => {
  const n = new Date();
  return `Generated on ${n.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${n.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
};

/* The Excel file: the same leave as the export on screen (dates, Show
   filter, "Show all staff", chart and/or list), described plainly for
   leaveExcel.js. Only writes a file on this device. */
export async function saveLeaveExcel(data, cfg) {
  const days = cfg.days;
  const colors = data.leaveColors || null;
  const typeLabel = cfg.filter === "all" ? "All leave"
    : [].concat(cfg.filter).map((t) => styleFor({ type: t }, colors).label).join(", ");
  const all = leaveItemsFor(data, days);
  const rows = all
    .filter((r) => cfg.filter === "all" || cfg.everyone || r.items.some((it) => inFilter(cfg.filter, it.type)))
    .map((r) => {
      const cells = {};
      const bands = [];
      r.items.filter((it) => inFilter(cfg.filter, it.type)).forEach((it) => {
        const st = itemLook(it, colors);
        const a = days.indexOf(it.start), b = days.indexOf(it.end);
        if (a < 0 || b < 0) return;
        for (let i = a; i <= b; i++) cells[i] = { text: st.abbrev, bg: st.bg, fg: st.fg };
        // For the month-by-month sheet: the whole leave, "AL (7 Jul – 9 Aug)".
        const full = it.kind === "period" ? it.period : it;
        const name = it.kind === "period" && it.period.type === "other" && it.period.label ? it.period.label : st.abbrev;
        bands.push({ text: `${name} (${spanText(full.start, full.end)})`, bg: st.bg, fg: st.fg, from: a, to: b });
      });
      return { name: r.staff.name, cells, bands, total: Object.keys(cells).length };
    });
  const list = all.flatMap((r) => r.items.map((it) => ({ ...it, staff: r.staff })))
    .filter((it) => inFilter(cfg.filter, it.type))
    .sort((a, b) => (a.kind === "period" ? a.period.start : a.start).localeCompare(b.kind === "period" ? b.period.start : b.start)
      || a.staff.name.localeCompare(b.staff.name))
    .map((it) => {
      const full = it.kind === "period" ? it.period : it;
      const st = itemLook(it, colors);
      return {
        name: it.staff.name, abbrev: st.abbrev,
        type: it.kind === "period" && it.period.type === "other" && it.period.label ? it.period.label : st.label,
        start: full.start, end: full.end,
        days: Math.round((parseD(full.end) - parseD(full.start)) / 86400000) + 1,
        enteredAs: it.kind === "period" ? "Leave period" : "Rota", bg: st.bg, fg: st.fg,
      };
    });
  await exportLeaveToExcel({
    orgName: data.orgName || "", deptName: data.title || "Leave", rangeLabel: cfg.title || "", typeLabel,
    parts: cfg.parts || "both", rows, list,
    days: days.map((d) => ({
      date: d, dow: DOW[parseD(d).getDay()][0], day: parseD(d).getDate(), nonOff: isNonOff(data, d),
      month: parseD(d).toLocaleDateString("en-GB", { month: "short", year: "numeric" }),
    })),
  });
}

export function LeavePrint({ data, cfg }) {
  const days = cfg.days;
  const rows = leaveItemsFor(data, days);
  const typeLabel = cfg.filter === "all" ? "All leave"
    : [].concat(cfg.filter).map((t) => styleFor({ type: t }, data.leaveColors).label).join(", ");
  const staffShown = rows.filter((r) => cfg.filter === "all" || cfg.everyone || r.items.some((it) => inFilter(cfg.filter, it.type))).length;
  const parts = cfg.parts || "both";
  // The list: every leave in these dates, earliest first, with its full dates.
  const items = rows.flatMap((r) => r.items.map((it) => ({ ...it, staff: r.staff })))
    .filter((it) => inFilter(cfg.filter, it.type))
    .sort((a, b) => (a.kind === "period" ? a.period.start : a.start).localeCompare(b.kind === "period" ? b.period.start : b.start)
      || a.staff.name.localeCompare(b.staff.name));
  const longDate = (d) => parseD(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  // Laid out like the rota export: organisation and department centred, the
  // department logo on the right, the Easy Duty Rota mark small in the footer.
  // Inline styles throughout, because the image export copies only those.
  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", color: "#0E3A47", background: "#FFFFFF" }}>
      <style>{`@page { size: A4 ${days.length > 10 ? "landscape" : "portrait"}; margin: 10mm; }`}</style>
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 46, marginBottom: 2 }}>
        <div style={{ textAlign: "center" }}>
          {data.orgName && <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "#666", marginBottom: 2 }}>{data.orgName}</div>}
          <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 16 }}>{data.title}</div>
        </div>
        {data.logo && <img src={data.logo} alt="" style={{ position: "absolute", right: 0, height: 46, maxWidth: 180, objectFit: "contain" }} />}
      </div>
      <div style={{ textAlign: "center", fontSize: 12, color: "#555", marginBottom: 10 }}>
        Leave · {cfg.title} · {typeLabel} · {staffShown} staff
      </div>
      {parts !== "list" && (
        <div style={{ border: "1px solid #D3E5EC", borderRadius: 10, overflow: "hidden" }}>
          <LeaveChart data={data} days={days} rows={rows} filter={cfg.filter} everyone={!!cfg.everyone} compact />
        </div>
      )}
      {parts !== "chart" && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: parts === "list" ? 0 : 14, fontSize: 11.5 }}>
          <thead>
            <tr>
              {["#", "Name", "Leave", "From", "To", "Days", "Entered as"].map((h) => (
                <th key={h} style={{ textAlign: h === "Days" || h === "#" ? "center" : "left", padding: "6px 8px", borderBottom: "1.5px solid #0D4F61", fontSize: 10.5, color: "#3A5F6B", letterSpacing: 0.3 }}>{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr><td colSpan={7} style={{ padding: 10, color: "#3A5F6B" }}>No leave in these dates.</td></tr>
            )}
            {items.map((it, k) => {
              const full = it.kind === "period" ? it.period : it;
              const st = itemLook(it, data.leaveColors || null);
              const nDays = Math.round((parseD(full.end) - parseD(full.start)) / 86400000) + 1;
              return (
                <tr key={k} style={{ breakInside: "avoid" }}>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #E3EDF1", textAlign: "center", color: "#3A5F6B" }}>{k + 1}</td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #E3EDF1", fontWeight: 600 }}>{it.staff.name}</td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #E3EDF1" }}>
                    <span style={{ display: "inline-block", minWidth: 30, textAlign: "center", padding: "1px 6px", marginRight: 6, borderRadius: 999, fontSize: 10, fontWeight: 800, background: st.bg, color: st.fg }}>{st.abbrev}</span>
                    {it.kind === "period" && it.period.type === "other" && it.period.label ? it.period.label : st.label}
                  </td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #E3EDF1", whiteSpace: "nowrap" }}>{longDate(full.start)}</td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #E3EDF1", whiteSpace: "nowrap" }}>{longDate(full.end)}</td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #E3EDF1", textAlign: "center", fontWeight: 700 }}>{nDays}</td>
                  <td style={{ padding: "5px 8px", borderBottom: "1px solid #E3EDF1", color: "#3A5F6B" }}>{it.kind === "period" ? "Leave period" : "Rota"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {parts !== "list" && rows.some((r) => r.items.some((it) => it.kind === "code" && inFilter(cfg.filter, it.type))) && (
        <div style={{ marginTop: 6, fontSize: 9.5, color: "#888" }}>Dashed bars are leave entered as a rota code.</div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 8, fontSize: 10, color: "#666" }}>
        <span>{generatedAt()}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
          <img src="/favicon-192.png" alt="" style={{ height: 13, width: 13, objectFit: "contain" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }} />
          <span style={{ fontWeight: 600, color: "#888" }}>Easy Duty Rota</span>
          <span style={{ color: "#AAA" }}>easydutyrota.com</span>
        </span>
      </div>
    </div>
  );
}

export { textOnBg };
