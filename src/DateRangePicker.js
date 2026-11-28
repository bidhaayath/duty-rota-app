import React, { useEffect, useMemo, useState } from "react";

/* ─────────────── Date range picker (Reports) ───────────────
   One button that shows the chosen dates. It opens a panel with quick
   picks and a calendar: tap a first day, then a last day, then "Show".
   Non-official days are gold so a manager can see them while choosing.
   On a laptop the panel drops down under the button; on a phone it slides
   up from the bottom with bigger targets.

   It only changes which dates Reports looks at. Nothing is saved.

   range is { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }, the same shape the
   old From / To boxes used, so nothing else had to change.            */

const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const INK = "#0E3A47", SOFT = "#3A5F6B", GOLD = "#9A6A00";

const dayCount = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000) + 1;
export const rangeLabel = (from, to) => {
  if (!from || !to) return "Choose dates";
  const A = parseD(from), B = parseD(to);
  if (from === to) return `${A.getDate()} ${MONTHS[A.getMonth()]} ${A.getFullYear()}`;
  if (A.getFullYear() !== B.getFullYear()) return `${A.getDate()} ${MONTHS[A.getMonth()]} ${A.getFullYear()} – ${B.getDate()} ${MONTHS[B.getMonth()]} ${B.getFullYear()}`;
  if (A.getMonth() !== B.getMonth()) return `${A.getDate()} ${MONTHS[A.getMonth()]} – ${B.getDate()} ${MONTHS[B.getMonth()]} ${B.getFullYear()}`;
  return `${A.getDate()} – ${B.getDate()} ${MONTHS[B.getMonth()]} ${B.getFullYear()}`;
};

const ordinal = (n) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
// Quick picks, worked out from today.
export const presetsFor = (today, weekStartsOn = 0) => {
  const y = today.getFullYear(), m = today.getMonth();
  const month = (k) => [dstr(new Date(y, m + k, 1)), dstr(new Date(y, m + k + 1, 0))];
  const back = (today.getDay() - weekStartsOn + 7) % 7;
  const ws = new Date(y, m, today.getDate() - back);
  return [
    { id: "this", name: "This month", range: month(0) },
    { id: "last", name: "Last month", range: month(-1) },
    { id: "next", name: "Next month", range: month(1) },
    { id: "week", name: "This week", range: [dstr(ws), dstr(new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6))] },
    { id: "first", name: "1st – 15th", range: [dstr(new Date(y, m, 1)), dstr(new Date(y, m, 15))] },
    { id: "second", name: `16th – ${ordinal(new Date(y, m + 1, 0).getDate())}`, range: [dstr(new Date(y, m, 16)), dstr(new Date(y, m + 1, 0))] },
  ];
};

const CSS = `
.drp-btn{font:inherit;cursor:pointer;transition:transform .15s,background .2s,box-shadow .2s}.drp-btn:active{transform:scale(.97)}
.drp-btn:focus-visible,.drp-day:focus-visible{outline:3px solid #1F7F9F;outline-offset:2px}
.drp-day{font:inherit;cursor:pointer;transition:background .15s,color .15s}
.drp-day:hover{background:rgba(31,127,159,.14)}
@keyframes drp-drop{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:none}}
@keyframes drp-up{from{transform:translateY(100%)}to{transform:none}}
@keyframes drp-fade{from{opacity:0}to{opacity:1}}
.drp-pop{animation:drp-drop .28s cubic-bezier(.22,1,.36,1) both;transform-origin:top left}
.drp-back{position:fixed;inset:0;z-index:60;background:transparent}
@media (max-width:720px){
  .drp-back{background:rgba(14,58,71,.28);animation:drp-fade .25s ease both}
  .drp-pop{position:fixed!important;left:0!important;right:0!important;bottom:0!important;top:auto!important;width:auto!important;
    border-radius:26px 26px 0 0!important;padding:10px 16px 22px!important;animation:drp-up .44s cubic-bezier(.32,.72,0,1) both;max-height:92vh;overflow-y:auto}
  .drp-grab{display:block!important}
  .drp-body{flex-direction:column!important}
  .drp-presets{flex-direction:row!important;overflow-x:auto;width:auto!important;border-right:0!important;padding-right:0!important;margin:0 -16px;padding:0 16px 4px!important;scrollbar-width:none}
  .drp-presets .drp-ptitle{display:none}
  .drp-presets button{flex:none;border:1px solid #D3E5EC!important;border-radius:999px!important;min-height:38px!important}
  .drp-day{height:42px!important;font-size:14px!important}
  .drp-show{min-height:50px!important;flex:1}
}
@media (prefers-reduced-motion:reduce){.drp-pop,.drp-back{animation:none!important}}
`;

export default function DateRangePicker({ range, setRange, isNonOff = () => false, weekStartsOn = 0 }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from: range.from, to: range.to });
  const [picking, setPicking] = useState("start");
  const [hover, setHover] = useState(null);
  const [view, setView] = useState(() => { const d = parseD(range.from || dstr(new Date())); return { y: d.getFullYear(), m: d.getMonth() }; });
  const presets = useMemo(() => presetsFor(new Date(), weekStartsOn), [weekStartsOn]);
  const today = dstr(new Date());

  const openPanel = () => {
    setDraft({ from: range.from, to: range.to }); setPicking("start"); setHover(null);
    const d = parseD(range.from || today); setView({ y: d.getFullYear(), m: d.getMonth() });
    setOpen(true);
  };
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const end = picking === "end" && hover ? hover : (draft.to || draft.from);
  const lo = draft.from && end && end < draft.from ? end : draft.from;
  const hi = draft.from && end && end < draft.from ? draft.from : end;
  const pick = (d) => {
    if (picking === "start") { setDraft({ from: d, to: null }); setPicking("end"); return; }
    const a = d < draft.from ? d : draft.from, b = d < draft.from ? draft.from : d;
    setDraft({ from: a, to: b }); setPicking("start"); setHover(null);
  };
  const apply = () => { const to = draft.to || draft.from; setRange({ from: draft.from, to }); setOpen(false); };
  const activePreset = presets.find((p) => p.range[0] === draft.from && p.range[1] === (draft.to || draft.from));

  // The month grid, starting on the department's first day of the week.
  const first = new Date(view.y, view.m, 1);
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const daysIn = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysIn; d++) cells.push(dstr(new Date(view.y, view.m, d)));
  while (cells.length % 7) cells.push(null);
  const heads = Array.from({ length: 7 }, (_, i) => DOW[(i + weekStartsOn) % 7]);
  const step = (k) => setView((v) => { const d = new Date(v.y, v.m + k, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const count = lo && hi ? dayCount(lo, hi) : 0;

  return (
    <div style={{ position: "relative" }}>
      <style>{CSS}</style>
      <button className="drp-btn" onClick={() => (open ? close() : openPanel())} aria-haspopup="dialog" aria-expanded={open}
        style={{ display: "flex", alignItems: "center", gap: 8, borderRadius: 999, padding: "9px 16px", minHeight: 44, color: INK, fontWeight: 600, fontSize: 13.5,
          background: "rgba(255,255,255,0.7)", border: "1px solid rgba(255,255,255,0.9)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 6px 18px rgba(14,58,71,0.08)", backdropFilter: "blur(20px)" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
        {rangeLabel(range.from, range.to)}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" style={{ transition: "transform .25s", transform: open ? "rotate(180deg)" : "none" }}><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && <>
        <div className="drp-back" onClick={close} />
        <div className="drp-pop" role="dialog" aria-label="Choose dates"
          style={{ position: "absolute", left: 0, top: 52, zIndex: 61, width: 540, padding: 16, boxSizing: "border-box", color: INK,
            background: "rgba(255,255,255,0.9)", backdropFilter: "blur(24px) saturate(180%)", WebkitBackdropFilter: "blur(24px) saturate(180%)",
            border: "1px solid #fff", borderRadius: 20, boxShadow: "0 18px 44px rgba(14,58,71,0.2)" }}>
          <div className="drp-grab" style={{ display: "none", width: 40, height: 5, borderRadius: 999, background: "rgba(14,58,71,0.18)", margin: "0 auto 10px" }} />
          <div className="drp-body" style={{ display: "flex", gap: 16 }}>
            <div className="drp-presets" style={{ width: 150, flex: "none", display: "flex", flexDirection: "column", gap: 4, borderRight: "1px solid rgba(14,58,71,0.08)", paddingRight: 12 }}>
              <div className="drp-ptitle" style={{ fontSize: 11, fontWeight: 700, color: SOFT, letterSpacing: ".04em", margin: "2px 0 4px" }}>QUICK PICK</div>
              {presets.map((p) => {
                const on = activePreset && activePreset.id === p.id;
                return (
                  <button key={p.id} className="drp-btn" onClick={() => { setDraft({ from: p.range[0], to: p.range[1] }); setPicking("start"); const d = parseD(p.range[0]); setView({ y: d.getFullYear(), m: d.getMonth() }); }}
                    style={{ textAlign: "left", border: 0, borderRadius: 10, padding: "0 12px", minHeight: 36, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap",
                      background: on ? "#0E3A47" : "transparent", color: on ? "#fff" : SOFT }}>{p.name}</button>
                );
              })}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <button className="drp-btn" aria-label="Previous month" onClick={() => step(-1)} style={{ border: 0, background: "rgba(14,58,71,0.06)", borderRadius: "50%", width: 36, height: 36, color: INK, fontSize: 18 }}>‹</button>
                <strong style={{ fontSize: 14 }}>{MONTHS_LONG[view.m]} {view.y}</strong>
                <button className="drp-btn" aria-label="Next month" onClick={() => step(1)} style={{ border: 0, background: "rgba(14,58,71,0.06)", borderRadius: "50%", width: 36, height: 36, color: INK, fontSize: 18 }}>›</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", textAlign: "center", fontSize: 10.5, fontWeight: 600, color: SOFT }}>
                {heads.map((h) => <span key={h}>{h}</span>)}
              </div>
              <div onMouseLeave={() => setHover(null)} style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", rowGap: 3 }}>
                {cells.map((d, i) => {
                  if (!d) return <div key={i} />;
                  const inR = lo && hi && d >= lo && d <= hi;
                  const edge = d === lo || d === hi;
                  const nod = isNonOff(d);
                  const band = inR && lo !== hi;
                  return (
                    <div key={d} style={{ background: band ? "rgba(31,127,159,0.13)" : "transparent", borderRadius: band ? (d === lo ? "12px 0 0 12px" : d === hi ? "0 12px 12px 0" : 0) : 0 }}>
                      <button className="drp-day" onClick={() => pick(d)} onMouseEnter={() => picking === "end" && setHover(d)}
                        aria-label={`${Number(d.slice(8))} ${MONTHS_LONG[view.m]}${nod ? ", non-official day" : ""}`} aria-pressed={!!edge}
                        style={{ width: "100%", height: 36, border: 0, borderRadius: 11, fontSize: 12.5,
                          fontWeight: edge || nod ? 700 : 500, background: edge ? "#0E3A47" : "transparent",
                          color: edge ? "#fff" : nod ? GOLD : INK, boxShadow: d === today && !edge ? "inset 0 0 0 1.5px #1F7F9F" : "none" }}>
                        {Number(d.slice(8))}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 11.5, color: SOFT }}>
                {picking === "end" ? "Now tap the last day." : "Tap a first day, then a last day."} <span style={{ color: GOLD }}>Gold dates are non-official days.</span>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 }}>
                <button className="drp-btn" onClick={close} style={{ border: "1px solid #D3E5EC", background: "#fff", borderRadius: 999, padding: "0 16px", minHeight: 40, fontSize: 13, fontWeight: 600, color: SOFT }}>Cancel</button>
                <button className="drp-btn drp-show" onClick={apply} disabled={!draft.from}
                  style={{ border: 0, background: "#0E3A47", borderRadius: 999, padding: "0 18px", minHeight: 40, fontSize: 13, fontWeight: 700, color: "#fff" }}>
                  Show {count} day{count === 1 ? "" : "s"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </>}
    </div>
  );
}
