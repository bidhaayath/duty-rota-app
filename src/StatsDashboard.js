import React, { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { SHIFT_COLOURS, dayMonth } from "./statsModel";

/* ─────────────── The Statistics screen (redesign) ───────────────
   Drawing only. Every number arrives ready-made from Stats() in
   DutyRotaOriginal.js (its existing counts) and from buildStatsModel()
   in statsModel.js. Nothing here reads or writes the rota.

   Two rules from the image export ("Save page" / "Save chart"):
   - Its copy keeps inline styles but loses class names, so every card's
     look is inline. Classes here only add motion and hover, and the
     inline style is always the finished state.
   - Blur does not survive it, so each glass card also has a solid enough
     white of its own to read on a plain white picture.                */

const INK = "#0E3A47", SOFT = "#3A5F6B", LINE = "rgba(14,58,71,0.10)", GOLD = "#7A4F00";
const HEAD = "'Plus Jakarta Sans', Inter, sans-serif";
const glass = {
  background: "rgba(255,255,255,0.62)", backdropFilter: "blur(22px) saturate(170%)", WebkitBackdropFilter: "blur(22px) saturate(170%)",
  border: "1px solid rgba(255,255,255,0.8)", borderRadius: 24,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 10px 30px rgba(14,58,71,0.07)",
  padding: "18px 20px", minWidth: 0, boxSizing: "border-box",
};
/* The PDF export draws this same screen for paper: solid white cards, a
   thin border, no motion, no hover, two columns to fit A4. */
const PrintCtx = createContext(false);
const paper = {
  background: "#fff", border: "1px solid #D3E5EC", borderRadius: 16, padding: "12px 14px",
  minWidth: 0, boxSizing: "border-box", breakInside: "avoid", pageBreakInside: "avoid",
};
const h2 = { margin: 0, fontFamily: HEAD, fontSize: 15, fontWeight: 700, color: INK };
const sub = { fontSize: 11.5, color: SOFT };
const delay = (ms) => ({ animationDelay: `${Math.min(ms, 900)}ms` });

const CSS = `
.sd-bento{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.sd-s2{grid-column:span 2}
.sd-s3{grid-column:span 3}
@media (max-width:1180px){.sd-bento{grid-template-columns:repeat(2,minmax(0,1fr))}.sd-s3{grid-column:span 2}}
@media (max-width:1180px){.sd-pop{right:auto!important;left:0;top:100%!important}}
@media (max-width:720px){.sd-bento{grid-template-columns:minmax(0,1fr)}.sd-s2,.sd-s3{grid-column:auto}.sd-two{grid-template-columns:minmax(0,1fr)!important}.sd-pop{position:static!important;width:auto!important;margin-top:6px}}
@keyframes sd-rise{from{opacity:0;transform:translateY(14px) scale(.985);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
@keyframes sd-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes sd-sweep{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
@keyframes sd-ring{from{stroke-dasharray:0 100}}
@keyframes sd-pop{from{opacity:0;transform:scale(.2)}to{opacity:1;transform:none}}
@keyframes sd-fly{from{transform:translate(-190px,46px) rotate(-10deg);opacity:0}60%{opacity:1}to{transform:none}}
@keyframes sd-bob{from{transform:translateY(0)}to{transform:translateY(-4px)}}
@keyframes sd-open{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:none}}
.sd-rise{animation:sd-rise .7s cubic-bezier(.22,1,.36,1) both}
.sd-grow{transform-origin:left center;animation:sd-grow .9s cubic-bezier(.34,1.4,.64,1) both}
.sd-sweep{animation:sd-sweep 1.3s cubic-bezier(.65,0,.35,1) both}
.sd-ring{animation:sd-ring 1.4s cubic-bezier(.22,1,.36,1) both}
.sd-popin{animation:sd-pop .5s cubic-bezier(.34,1.5,.64,1) both}
.sd-fly{transform-box:fill-box;animation:sd-fly 1.8s cubic-bezier(.22,1,.36,1) .25s both}
.sd-bob{transform-box:fill-box;animation:sd-bob 3.2s ease-in-out 2s infinite alternate}
.sd-plane{transform-box:view-box;transform-origin:0 0}
@media (max-width:720px){.sd-headright:has(.sd-tog){width:100%}.sd-tog{flex:1 1 auto;min-width:0;flex-wrap:nowrap!important;overflow-x:auto;scrollbar-width:none}.sd-tog::-webkit-scrollbar{display:none}.sd-tog button{flex:none}.sd-mouse{display:none}}
@media (hover:none){.sd-mouse{display:none}}
@media (max-width:720px){.sd-plane{transform:translate(150px,-14px) scale(.68)}}
.sd-open{animation:sd-open .28s cubic-bezier(.22,1,.36,1) both}
.sd-cell{transition:transform .2s cubic-bezier(.34,1.5,.64,1)}.sd-cell:hover{transform:scale(1.5);position:relative;z-index:2;box-shadow:0 3px 10px rgba(14,58,71,.25)}
.sd-row{transition:background .2s}.sd-row:hover{background:rgba(255,255,255,.75)}
.sd-glide{transition:left .28s cubic-bezier(.22,1,.36,1),top .28s cubic-bezier(.22,1,.36,1),opacity .2s}
.sd-fade{transition:opacity .35s ease}
.sd-w{transition:width .6s cubic-bezier(.22,1,.36,1)}
.sd-btn{font:inherit;cursor:pointer;transition:transform .15s,background .2s,color .2s}.sd-btn:active{transform:scale(.97)}
.sd-btn:focus-visible{outline:3px solid #1F7F9F;outline-offset:2px}
.dr-shooting .sd-pop{display:none!important}
.sd-print.sd-bento{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px}
.sd-print .sd-s2,.sd-print .sd-s3{grid-column:span 2!important}
.sd-print *{animation:none!important;transition:none!important}
.sd-print .sd-plane{transform:none!important}
@media (prefers-reduced-motion:reduce){.sd-root *{animation:none!important;transition:none!important}}
@media (prefers-reduced-transparency:reduce){.sd-root .sd-card{background:rgba(255,255,255,.94)!important;backdrop-filter:none!important}}
`;

const initials = (name) => (name || "").replace(/^(dr|prof|mr|mrs|ms|sr|srn|rn|en)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/* Smooth line through points (Catmull-Rom as cubic Béziers). */
const smooth = (p) => {
  if (!p.length) return "";
  if (p.length === 1) return `M${p[0][0]} ${p[0][1]}`;
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i - 1] || p[i], b = p[i], c = p[i + 1], e = p[i + 2] || c;
    d += ` C${(b[0] + (c[0] - a[0]) / 6).toFixed(1)} ${(b[1] + (c[1] - a[1]) / 6).toFixed(1)} ${(c[0] - (e[0] - b[0]) / 6).toFixed(1)} ${(c[1] - (e[1] - b[1]) / 6).toFixed(1)} ${c[0].toFixed(1)} ${c[1].toFixed(1)}`;
  }
  return d;
};

/* Hover with a mouse, tap on a phone. A tap fires a mouse-enter as well,
   so the enter/leave handlers only act for a real mouse. */
function useHoverOrTap() {
  const [open, setOpen] = useState(null);
  const bind = (key) => ({
    onPointerEnter: (e) => { if (e.pointerType === "mouse") setOpen(key); },
    onPointerLeave: (e) => { if (e.pointerType === "mouse") setOpen(null); },
    onClick: () => setOpen((o) => (o === key ? null : key)),
  });
  return [open, bind];
}

const Card = ({ children, className = "", style, delayMs = 0, cardRef }) => {
  const print = useContext(PrintCtx);
  return <div ref={cardRef} className={`sd-card sd-rise ${className}`} style={{ ...(print ? paper : glass), ...delay(delayMs), ...style }}>{children}</div>;
};
const CardHead = ({ title, right, save }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
    <h2 style={h2}>{title}</h2>
    <div className="sd-headright" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>{right}{save}</div>
  </div>
);
const Empty = ({ children }) => <div style={{ fontSize: 13, color: SOFT, padding: "28px 0", textAlign: "center" }}>{children}</div>;

/* ── The annual leave tile: a seaplane over a lagoon ── */
function LeaveHero({ onAnnual, staffCount, annualDays, away, CountUp }) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, "");
  const sky = `sky${raw}`, sea = `sea${raw}`;
  const shown = away.slice(0, 3);
  return (
    <div className="sd-rise sd-s2" style={{ breakInside: "avoid", pageBreakInside: "avoid", position: "relative", overflow: "hidden", borderRadius: 24, minHeight: 172, color: "#fff", background: "#0D4F61", boxShadow: "0 14px 34px rgba(13,79,97,.22)" }}>
      <svg viewBox="0 0 460 172" preserveAspectRatio="xMaxYMid slice" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden="true">
        <defs>
          <linearGradient id={sky} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0B4555" /><stop offset="1" stopColor="#3B93AA" /></linearGradient>
          <linearGradient id={sea} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6FC7C3" /><stop offset="1" stopColor="#2F8FA0" /></linearGradient>
        </defs>
        <rect width="460" height="172" fill={`url(#${sky})`} />
        <circle cx="392" cy="40" r="20" fill="rgba(255,236,190,0.55)" /><circle cx="392" cy="40" r="36" fill="rgba(255,236,190,0.12)" />
        <g fill="rgba(255,255,255,0.22)"><ellipse cx="300" cy="34" rx="34" ry="8" /><ellipse cx="322" cy="29" rx="20" ry="8" /><ellipse cx="425" cy="82" rx="28" ry="6" /></g>
        <path d="M0 144 C 80 136, 140 150, 230 142 S 380 134, 460 142 L460 172 L0 172 Z" fill={`url(#${sea})`} opacity=".9" />
        <path d="M0 154 C 90 148, 170 160, 250 153 S 390 146, 460 154" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
        <ellipse cx="378" cy="143" rx="38" ry="5.5" fill="#EBD9A8" />
        <path d="M378 142 C 377 128, 380 117, 386 108" fill="none" stroke="#5B4A2E" strokeWidth="2.5" strokeLinecap="round" />
        <g fill="#2F6E4E">
          <path d="M386 108 c -12 -2 -20 4 -24 10 c 8 -5 16 -6 24 -10z" /><path d="M386 108 c 10 -6 20 -4 26 2 c -9 -2 -18 -2 -26 -2z" />
          <path d="M386 108 c -2 -10 4 -18 10 -20 c -4 7 -6 13 -10 20z" /><path d="M386 108 c 4 8 4 16 0 22 c -1 -8 -1 -14 0 -22z" />
        </g>
        <g className="sd-plane"><path d="M150 104 C 200 82, 240 72, 282 68" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" strokeDasharray="2 6" strokeLinecap="round" />
        <g className="sd-fly"><g className="sd-bob">
          <path d="M282 68 l 52 -4 c 8 0 14 3 14 6 c 0 3 -6 5 -14 5 l -52 2 c -4 0 -6 -2 -6 -4.5 c 0 -2.5 2 -4.5 6 -4.5z" fill="#F6FAFB" />
          <path d="M276 68 l -6 -13 l 7 0 l 9 12z" fill="#E7EFF2" /><path d="M306 67 l 14 -16 l 7 0 l -6 16z" fill="#E7EFF2" />
          <rect x="326" y="66" width="10" height="3.5" rx="1.5" fill="#1F7F9F" />
          <path d="M296 76 l 0 9 M 326 76 l 0 9" stroke="#C9D8DE" strokeWidth="1.5" />
          <rect x="288" y="84" width="46" height="4" rx="2" fill="#E7EFF2" /><circle cx="347" cy="69" r="2" fill="#0E3A47" />
        </g></g></g>
      </svg>
      <div style={{ position: "relative", padding: "18px 22px", display: "flex", flexDirection: "column", gap: 5, maxWidth: 340 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.92 }}>On annual leave</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <CountUp value={onAnnual} style={{ fontFamily: HEAD, fontSize: 42, fontWeight: 800, lineHeight: 1, color: "#fff" }} />
          <span style={{ fontSize: 13, opacity: 0.92 }}>of {staffCount} staff · {annualDays} day{annualDays === 1 ? "" : "s"}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
          {shown.map((w) => (
            <div key={w.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.28)", borderRadius: 999, padding: "4px 12px 4px 5px", fontSize: 12, width: "max-content", maxWidth: "100%", boxSizing: "border-box" }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(255,255,255,0.9)", color: "#0D4F61", fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{initials(w.name)}</span>
              <strong style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{w.name}</strong>
              <span style={{ opacity: 0.85, whiteSpace: "nowrap" }}>{w.when}</span>
            </div>
          ))}
          {away.length > shown.length && <div style={{ fontSize: 12, opacity: 0.85 }}>+ {away.length - shown.length} more</div>}
          {!away.length && <div style={{ fontSize: 12.5, opacity: 0.85 }}>Nobody is on annual leave in this range.</div>}
        </div>
      </div>
    </div>
  );
}

/* ── Daily coverage: smooth lines, a gliding tooltip, focus on one shift ── */
function Coverage({ coverage, shifts, saveBtn, cardRef }) {
  const print = useContext(PrintCtx);
  const [hi, setHi] = useState(-1);
  /* The chart grows to fill its card, so when the cards beside it are taller
     there is a bigger chart rather than an empty band under it. */
  const boxRef = useRef(null);
  const [boxH, setBoxH] = useState(196);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => { const h = Math.round(entries[0].contentRect.height); setBoxH((o) => (Math.abs(o - h) > 1 ? Math.max(196, h) : o)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const CH = boxH - 26;
  const last = useRef(0);
  const [focus, setFocus] = useState("all");
  const n = coverage.length;
  const max = Math.max(1, ...coverage.flatMap((d) => shifts.map((s) => d[s.name] || 0))) + 1;
  const Y = (v) => 195 - (v / max) * 185;
  const X = (i) => (n > 1 ? (i / (n - 1)) * 1000 : 500);
  const lines = shifts.map((s) => {
    const d = smooth(coverage.map((row, i) => [X(i), Y(row[s.name] || 0)]));
    return { ...s, d, area: `${d} L${X(n - 1)} 200 L${X(0)} 200 Z` };
  });
  if (hi >= 0) last.current = hi;
  const h = hi >= 0 ? hi : last.current;
  const row = coverage[Math.min(h, n - 1)] || {};
  const x = n > 1 ? (h / (n - 1)) * 100 : 50;
  const opts = [{ key: "all", name: "All", colour: INK }, ...shifts];
  const ticks = n > 1 ? [0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(((n - 1) * 3) / 4), n - 1] : [0];
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <Card className="sd-s2" delayMs={200} cardRef={cardRef} style={{ display: "flex", flexDirection: "column" }}>
      <CardHead title="Daily coverage" save={saveBtn} right={print ? (
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: SOFT }}>
          {shifts.map((s) => <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 3, borderRadius: 2, background: s.colour }} />{s.name}</span>)}
        </div>
      ) : (
        <div className="sd-tog" style={{ display: "flex", padding: 3, borderRadius: 999, background: "rgba(14,58,71,0.06)", flexWrap: "wrap" }}>
          {opts.map((o) => (
            <button key={o.key} className="sd-btn" onClick={() => setFocus(o.key)} aria-pressed={focus === o.key}
              style={{ border: 0, borderRadius: 999, minHeight: 32, padding: "0 12px", fontSize: 11.5, fontWeight: 600, display: "flex", alignItems: "center", gap: 5,
                background: focus === o.key ? "#fff" : "transparent", color: focus === o.key ? INK : SOFT, boxShadow: focus === o.key ? "0 2px 8px rgba(14,58,71,.12)" : "none" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: o.colour }} />{o.name}
            </button>
          ))}
        </div>
      )} />
      <div ref={boxRef} onMouseLeave={() => setHi(-1)} style={{ position: "relative", flex: "1 1 auto", minHeight: 196 }}>
        {[8, Math.round(CH / 2)].map((t) => <div key={t} style={{ position: "absolute", left: 0, right: 0, top: t, borderTop: `1px dashed ${LINE}` }} />)}
        <div style={{ position: "absolute", left: 0, right: 0, top: CH, borderTop: "1px solid rgba(14,58,71,0.14)" }} />
        <div className="sd-sweep" style={{ position: "absolute", left: 0, right: 0, top: 0, height: CH, animationDelay: "350ms" }}>
          <svg viewBox="0 0 1000 200" preserveAspectRatio="none" style={{ width: "100%", height: CH, display: "block" }} aria-hidden="true">
            <defs>{lines.map((l) => (
              <linearGradient key={l.key} id={`${gid}${l.key}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={l.colour} stopOpacity=".34" /><stop offset="1" stopColor={l.colour} stopOpacity="0" /></linearGradient>
            ))}</defs>
            {lines.map((l) => {
              const on = focus === "all" || focus === l.key, only = focus === l.key;
              return (
                <g key={l.key}>
                  <path className="sd-fade" d={l.area} fill={`url(#${gid}${l.key})`} style={{ opacity: only ? 1 : 0 }} />
                  <path className="sd-fade" d={l.d} fill="none" stroke={l.colour} vectorEffect="non-scaling-stroke" strokeLinecap="round" style={{ strokeWidth: only ? 3 : 2.2, opacity: on ? 1 : 0.15 }} />
                </g>
              );
            })}
          </svg>
        </div>
        {!print && <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: CH, display: "flex" }}>
          {coverage.map((d, i) => <div key={i} onMouseEnter={() => setHi(i)} onClick={() => setHi(i)} style={{ flex: 1, height: "100%" }} />)}
        </div>}
        <div className="sd-glide" style={{ position: "absolute", top: 0, height: CH, left: `${x}%`, borderLeft: "1.5px dashed rgba(14,58,71,0.35)", opacity: hi >= 0 ? 1 : 0, pointerEvents: "none" }} />
        {shifts.filter((s) => focus === "all" || focus === s.key).map((s) => (
          <div key={s.key} className="sd-glide" style={{ position: "absolute", left: `${x}%`, top: Y(row[s.name] || 0) * (CH / 200), width: 11, height: 11, margin: "-5.5px 0 0 -5.5px", borderRadius: "50%", background: "#fff", border: `2.5px solid ${s.colour}`, boxSizing: "border-box", opacity: hi >= 0 ? 1 : 0, pointerEvents: "none" }} />
        ))}
        <div className="sd-glide sd-tip" style={{ position: "absolute", top: 8, left: `${x}%`, transform: x > 66 ? "translateX(calc(-100% - 14px))" : "translateX(14px)", opacity: hi >= 0 ? 1 : 0, pointerEvents: "none",
          background: "rgba(255,255,255,0.9)", backdropFilter: "blur(20px)", border: "1px solid #fff", boxShadow: "0 18px 44px rgba(14,58,71,.2)", borderRadius: 16, padding: "10px 12px", fontSize: 12.5, minWidth: 150, color: INK }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{row.date}</div>
          {shifts.map((s) => (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.colour }} /><span style={{ flex: 1, color: SOFT }}>{s.name}</span><strong>{row[s.name] || 0}</strong>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${LINE}`, marginTop: 6, paddingTop: 6, display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: SOFT }}>On duty</span><strong>{shifts.reduce((a, s) => a + (row[s.name] || 0), 0)}</strong>
          </div>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: CH + 8, height: 14, fontSize: 11, color: SOFT }}>
          {ticks.map((t, i) => (
            <span key={i} style={{ position: "absolute", left: `${n > 1 ? (t / (n - 1)) * 100 : 50}%`, transform: i === 0 ? "none" : i === ticks.length - 1 ? "translateX(-100%)" : "translateX(-50%)", whiteSpace: "nowrap" }}>{coverage[t]?.date}</span>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ── Shift mix: one ring per shift, drawn round in turn ── */
function ShiftMix({ mix, saveBtn, cardRef }) {
  const items = mix.items.slice(0, 6);
  return (
    <Card delayMs={240} cardRef={cardRef} style={{ display: "flex", flexDirection: "column" }}>
      <CardHead title="Shift mix" save={saveBtn} />
      {!mix.total ? <Empty>No duties in this range.</Empty> : <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", justifyContent: "space-evenly", gap: 12 }}>
        <div style={{ position: "relative", width: 150, height: 150, alignSelf: "center" }}>
          <svg viewBox="0 0 176 176" style={{ width: 150, height: 150, transform: "rotate(-90deg)" }} aria-hidden="true">
            {items.map((m, i) => {
              const r = 80 - i * (items.length > 4 ? 11 : 15);
              return (
                <g key={m.key}>
                  <circle cx="88" cy="88" r={r} fill="none" stroke="rgba(14,58,71,0.07)" strokeWidth={items.length > 4 ? 8 : 10} />
                  <circle className="sd-ring" cx="88" cy="88" r={r} pathLength="100" fill="none" stroke={m.colour} strokeWidth={items.length > 4 ? 8 : 10} strokeLinecap="round"
                    style={{ strokeDasharray: `${Math.max(m.pct, 1)} 100`, animationDelay: `${300 + i * 110}ms` }} />
                </g>
              );
            })}
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: HEAD, fontSize: 20, fontWeight: 800, color: INK }}>{mix.total}</span><span style={{ fontSize: 10.5, color: SOFT }}>shifts</span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "6px 12px", marginTop: 0 }}>
          {items.map((m) => (
            <div key={m.key} title={`${m.name}: ${m.n} duties`} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: INK }}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: m.colour, flex: "none" }} /><span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span><strong>{m.pct}%</strong>
            </div>
          ))}
        </div>
      </div>}
    </Card>
  );
}

const Segs = ({ segs, w, ms, h = 12, grow = true }) => (
  <div style={{ flex: grow ? "1 1 auto" : "none", width: grow ? undefined : "100%", height: h }}>
    <div className="sd-grow sd-w" style={{ ...delay(ms), display: "flex", gap: 2, width: `${w}%`, height: "100%" }}>
      {segs.map((s) => <div key={s.key} title={s.label} style={{ flex: `${s.n} 1 0`, background: s.colour, borderRadius: 3 }} />)}
    </div>
  </div>
);
const MEDALS = [["#E9CF8F", "#5E4300"], ["#D9E1E5", "#33505A"], ["#E6C1A0", "#5A3518"]];

function MostDuties({ ranked, fewest, saveBtn, cardRef }) {
  const top = ranked.slice(0, 3);
  return (
    <Card delayMs={280} cardRef={cardRef} style={{ display: "flex", flexDirection: "column" }}>
      <CardHead title="Most duties" save={saveBtn} />
      {!top.length ? <Empty>No staff in this range.</Empty> : top.map((p, i) => (
        <div key={p.id} className="sd-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 6px", borderRadius: 12 }}>
          <span style={{ width: 24, height: 24, borderRadius: "50%", background: MEDALS[i] ? MEDALS[i][0] : "rgba(14,58,71,0.07)", color: MEDALS[i] ? MEDALS[i][1] : SOFT, fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{i + 1}</span>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, color: INK }}><span style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span><strong>{p.total}</strong></div>
            <Segs segs={p.segs} w={p.w} ms={320 + i * 50} h={6} grow={false} />
          </div>
        </div>
      ))}
      {fewest && (
        <div style={{ marginTop: "auto", paddingTop: 8, borderTop: `1px solid ${LINE}`, fontSize: 11.5, color: SOFT }}>
          Fewest: <strong style={{ color: INK }}>{fewest.name}</strong> · {fewest.total} dut{fewest.total === 1 ? "y" : "ies"}{fewest.why ? ` (${fewest.why})` : ""}
        </div>
      )}
    </Card>
  );
}

function RotaGlance({ heat, saveBtn, cardRef, wide = false }) {
  const [tapped, setTapped] = useState(null); // a tapped square, for phones where there is no hover
  return (
    <Card className={wide ? "sd-s2 sd-s3" : "sd-s2"} delayMs={300} cardRef={cardRef} style={{ alignSelf: "start" }}>
      <CardHead title="Rota at a glance" save={saveBtn} right={
        <div style={{ display: "flex", gap: 10, fontSize: 11, color: SOFT, flexWrap: "wrap" }}>
          {heat.legend.map((g) => <span key={g.name} style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: g.colour, border: g.colour === "#E2EBEE" ? `1px solid ${LINE}` : "none", boxSizing: "border-box" }} />{g.name}</span>)}
        </div>
      } />
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 120 + heat.days.length * 15, display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
            <div style={{ width: 112, flex: "none" }} />
            <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${heat.days.length}, minmax(0, 1fr))`, gap: 2 }}>
              {heat.days.map((d) => (
                <div key={d.date} title={d.nod ? "Non-official day" : undefined} style={{ textAlign: "center", fontSize: 9.5, lineHeight: 1.2, borderRadius: 5, padding: "1px 0", background: d.nod ? "rgba(230,194,122,0.4)" : "transparent", color: d.nod ? GOLD : SOFT, fontWeight: d.nod ? 700 : 500 }}>{d.dow}<br />{d.n}</div>
              ))}
            </div>
          </div>
          {heat.people.map((p, r) => (
            <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div title={p.name} style={{ width: 112, flex: "none", fontSize: 11.5, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
              <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${heat.days.length}, minmax(0, 1fr))`, gap: 2 }}>
                {p.cells.map((c, i) => (
                  <div key={i} className={c.cat === "none" ? undefined : "sd-cell sd-popin"} title={c.tip} onClick={() => setTapped(c.cat === "none" ? null : c.tip)}
                    style={{ height: 14, borderRadius: 4, background: c.colour, boxSizing: "border-box", border: c.empty ? `1px dashed ${LINE}` : c.cat === "off" ? `1px solid ${LINE}` : "none", animationDelay: `${Math.min(300 + r * 20 + i * 10, 1400)}ms` }} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      {tapped && <div style={{ marginTop: 10, fontSize: 12.5, color: INK, background: "rgba(14,58,71,0.05)", borderRadius: 12, padding: "8px 12px" }}>{tapped}</div>}
    </Card>
  );
}

/* A row you can hover (mouse) or tap (phone) to see who is behind it. */
function PeopleRows({ items, renderRow, renderPop, renderPrint }) {
  const print = useContext(PrintCtx);
  const [open, bind] = useHoverOrTap();
  if (print) {
    return items.map((it) => (
      <div key={it.key} style={{ padding: "5px 2px", breakInside: "avoid", pageBreakInside: "avoid" }}>
        {renderRow(it)}
        <div style={{ marginTop: 4, fontSize: 10.5, color: SOFT, lineHeight: 1.45 }}>{renderPrint(it)}</div>
      </div>
    ));
  }
  return items.map((it) => (
    <div key={it.key} className="sd-row" {...bind(it.key)} role="button" tabIndex={0} aria-expanded={open === it.key}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); bind(it.key).onClick(); } }}
      style={{ position: "relative", padding: "6px 8px", borderRadius: 12, cursor: "default", outline: "none" }}>
      {renderRow(it)}
      {open === it.key && (
        <div className="sd-pop sd-open" style={{ position: "absolute", zIndex: 30, right: "calc(100% + 8px)", top: -6, width: 240, padding: 12, fontSize: 12.5, color: INK,
          background: "rgba(255,255,255,0.94)", backdropFilter: "blur(24px)", border: "1px solid #fff", boxShadow: "0 18px 44px rgba(14,58,71,.2)", borderRadius: 18 }}>
          {renderPop(it)}
        </div>
      )}
    </div>
  ));
}

function Posts({ posts, saveBtn, cardRef }) {
  return (
    <Card delayMs={320} cardRef={cardRef} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <CardHead title="Posts" save={saveBtn} right={<span style={sub}>where staff worked</span>} />
      <div style={{ display: "flex", height: 10, gap: 2, borderRadius: 999, overflow: "hidden", marginBottom: 6 }}>
        {posts.map((p, i) => <div key={p.id} className="sd-grow" title={`${p.name}: ${p.n}`} style={{ ...delay(420 + i * 60), flex: `${p.n} 1 0`, background: p.colour }} />)}
      </div>
      <PeopleRows items={posts.map((p) => ({ ...p, key: p.id }))}
        renderRow={(p) => (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: p.colour, flex: "none" }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: INK }}><span style={{ fontWeight: 600 }}>{p.name}</span><strong>{p.n}</strong></div>
              <div style={{ fontSize: 11, color: SOFT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.people.length} staff · most: {p.people[0].name} ({p.people[0].n})</div>
            </div>
          </div>
        )}
        renderPrint={(p) => p.people.map((x) => `${x.name} ${x.n}`).join(" · ")}
        renderPop={(p) => <>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{p.name} · who worked here</div>
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {p.people.map((x) => <div key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "2px 0" }}><span style={{ color: SOFT }}>{x.name}</span><strong>{x.n}</strong></div>)}
          </div>
        </>} />
    </Card>
  );
}

function Leave({ leave, totals, saveBtn, cardRef }) {
  const print = useContext(PrintCtx);
  return (
    <Card delayMs={340} cardRef={cardRef} style={{ alignSelf: "start", display: "flex", flexDirection: "column", gap: 2 }}>
      <CardHead title="Leave" save={saveBtn} right={leave.length && !print ? <span style={sub}><span className="sd-mouse">hover or </span>tap for names</span> : null} />
      {!leave.length ? <Empty>No leave in this range.</Empty> : (
        <PeopleRows items={leave.map((g) => ({ ...g, key: g.key }))}
          renderRow={(g) => <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: INK }}>
              <span style={{ fontWeight: 600 }}>{g.label}</span>
              <span style={{ color: SOFT, whiteSpace: "nowrap" }}><strong style={{ color: INK }}>{g.staff}</strong> staff · <strong style={{ color: INK }}>{g.days}</strong> d</span>
            </div>
            <div style={{ height: 8, background: "rgba(14,58,71,0.06)", borderRadius: 999, overflow: "hidden", marginTop: 6 }}>
              <div className="sd-grow sd-w" style={{ ...delay(480), width: `${g.w}%`, height: "100%", background: g.colour, borderRadius: 999 }} />
            </div>
          </>}
          renderPrint={(g) => g.people.map((p) => <div key={p.id}><strong style={{ color: INK, fontWeight: 600 }}>{p.name}</strong> · {p.days} d · {p.when}</div>)}
          renderPop={(g) => <>
            <div style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, marginBottom: 6 }}><span style={{ width: 9, height: 9, borderRadius: 3, background: g.colour }} />{g.label}</div>
            <div style={{ maxHeight: 240, overflowY: "auto" }}>
              {g.people.map((p) => (
                <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0" }}>
                  <span>{p.name}<br /><span style={{ fontSize: 11, color: SOFT }}>{p.when}</span></span><strong style={{ whiteSpace: "nowrap" }}>{p.days} d</strong>
                </div>
              ))}
            </div>
          </>} />
      )}
      <div style={{ marginTop: "auto", paddingTop: 8, borderTop: `1px solid ${LINE}`, display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: SOFT, flexWrap: "wrap" }}>
        <span>Leave days <strong style={{ color: INK }}>{totals.leave}</strong></span><span>Off days <strong style={{ color: INK }}>{totals.off}</strong></span>
      </div>
    </Card>
  );
}

/* ── Staff: the headcount, and who joined or left ──
   A manager reporting upward is asked this first, so the two movements get
   their own coloured counters and every name is listed with its date. */
function StaffCard({ summary, people, CountUp, saveBtn, cardRef }) {
  const print = useContext(PrintCtx);
  const cap = print ? 99 : 3;
  const Move = ({ n, word, colour, bg, sign }) => (
    <div style={{ flex: 1, minWidth: 0, borderRadius: 14, background: bg, padding: "8px 10px", display: "flex", alignItems: "center", gap: 8 }}>
      <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: "50%", background: colour, color: "#fff", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{sign}</span>
      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
        <strong style={{ fontFamily: HEAD, fontSize: 18, color: INK }}>{n}</strong>
        <span style={{ fontSize: 11, color: SOFT }}>{word}</span>
      </span>
    </div>
  );
  const names = (list, colour, word) => list.slice(0, cap).map((x) => (
    <div key={word + x.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: INK, minWidth: 0 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: colour, flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</span>
      <span style={{ color: SOFT, whiteSpace: "nowrap" }}>{word} {x.when}</span>
    </div>
  ));
  const more = Math.max(0, people.joined.length - cap) + Math.max(0, people.left.length - cap);
  return (
    <Card delayMs={60} cardRef={cardRef} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: SOFT }}>Staff</div>{saveBtn}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: -4 }}>
        <CountUp value={summary.staffCount} style={{ fontFamily: HEAD, fontSize: 32, fontWeight: 800, lineHeight: 1, color: INK }} />
        <span style={{ fontSize: 12.5, color: SOFT }}>on this rota</span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Move n={summary.joined} word="joined" colour="#3E9A82" bg="rgba(62,154,130,0.12)" sign="+" />
        <Move n={summary.left} word="left" colour="#C0705E" bg="rgba(192,112,94,0.12)" sign="−" />
      </div>
      {(people.joined.length > 0 || people.left.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {names(people.joined, "#3E9A82", "joined")}
          {names(people.left, "#C0705E", "left")}
          {more > 0 && <div style={{ fontSize: 11.5, color: SOFT }}>+ {more} more</div>}
        </div>
      )}
    </Card>
  );
}

function TwoColBars({ title, right, items, renderBar, delayMs, saveBtn, cardRef, emptyText, narrow = false }) {
  return (
    <Card className={narrow ? "" : "sd-s2"} delayMs={delayMs} cardRef={cardRef}>
      <CardHead title={title} right={right} save={saveBtn} />
      {!items.length ? <Empty>{emptyText}</Empty> : (
        <div className="sd-two" style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0, 1fr)" : "repeat(2, minmax(0, 1fr))", gap: "7px 24px" }}>
          {items.map((it, i) => (
            <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div title={it.name} style={{ width: 116, flex: "none", fontSize: 12, color: INK, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</div>
              {renderBar(it, i)}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const noSave = () => null;
const noRef = () => undefined;
const Plain = ({ value, style }) => <span style={style}>{value}</span>;

export default function StatsDashboard({ data, model, summary, totals, coverage, CountUp = Plain, saveBtn = noSave, cardRef = noRef, print = false }) {
  const shifts = useMemo(() => [
    { key: "morning", name: "Morning" }, { key: "afternoon", name: "Afternoon" },
    ...(data.eveningEnabled ? [{ key: "evening", name: "Evening" }] : []), { key: "night", name: "Night" },
  ].map((s) => ({ ...s, colour: SHIFT_COLOURS[s.key] })), [data.eveningEnabled]);

  // Staff on duty per day: the same four shifts the coverage chart draws.
  const daily = coverage ? coverage.map((d) => shifts.reduce((a, s) => a + (d[s.name] || 0), 0)) : [];
  const lo = daily.length ? Math.min(...daily) : 0, hiV = daily.length ? Math.max(...daily) : 0;
  const spark = daily.length > 1 ? smooth(daily.map((v, i) => [(i / (daily.length - 1)) * 300, 42 - ((v - lo + 1) / (hiV - lo + 2)) * 38])) : "";
  const sparkId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const nod = model.nodDates;
  const hasPosts = !!(model.posts && model.posts.length);

  return (
    <PrintCtx.Provider value={print}>
    <div className={`sd-root sd-bento${print ? " sd-print" : ""}`} style={{ color: INK }}>
      <style>{CSS}</style>

      <LeaveHero onAnnual={summary.onAnnual} staffCount={summary.staffCount} annualDays={summary.annualDays} away={model.away} CountUp={CountUp} />

      <StaffCard summary={summary} people={model.people} CountUp={CountUp} saveBtn={saveBtn("staff", "staff")} cardRef={cardRef("staff")} />

      <Card delayMs={160} style={{ background: "rgba(255,244,220,0.7)" }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: GOLD }}>Non-official days</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
          <CountUp value={summary.nonOffDays} style={{ fontFamily: HEAD, fontSize: 32, fontWeight: 800, lineHeight: 1, color: GOLD }} />
          <span style={{ fontSize: 12.5, color: GOLD }}>days in range</span>
        </div>
        {nod.length > 0 && nod.length <= 16 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 12 }}>
            {nod.map((d, i) => <span key={d} className="sd-popin" title={dayMonth(d)} style={{ ...delay(400 + i * 50), minWidth: 26, textAlign: "center", fontSize: 11, fontWeight: 700, color: GOLD, background: "rgba(230,194,122,0.35)", borderRadius: 8, padding: "4px 5px" }}>{Number(d.slice(8))}</span>)}
          </div>
        )}
        <div style={{ fontSize: 12, color: GOLD, marginTop: 10 }}><strong>{totals.nonOff}</strong> paid duties on these days</div>
      </Card>

      {coverage === null ? (
        <Card className="sd-s2" delayMs={200}><CardHead title="Daily coverage" /><Empty>Range too long for a daily chart — pick 3 months or less.</Empty></Card>
      ) : coverage.length ? (
        <Coverage coverage={coverage} shifts={shifts} saveBtn={saveBtn("coverage", "daily_coverage")} cardRef={cardRef("coverage")} />
      ) : null}

      <ShiftMix mix={model.mix} saveBtn={saveBtn("mix", "shift_mix")} cardRef={cardRef("mix")} />

      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <MostDuties ranked={model.ranked} fewest={model.fewest} saveBtn={saveBtn("most", "most_duties")} cardRef={cardRef("most")} />
        <Card delayMs={80}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: SOFT }}>Staff on duty</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
            <CountUp value={summary.avgPerDay} decimals={String(summary.avgPerDay).includes(".") ? 1 : 0} style={{ fontFamily: HEAD, fontSize: 32, fontWeight: 800, lineHeight: 1, color: INK }} />
            <span style={{ fontSize: 12.5, color: SOFT }}>a day on average</span>
          </div>
          {spark && (
            <div className="sd-sweep" style={{ animationDelay: "300ms" }}>
              <svg viewBox="0 0 300 48" preserveAspectRatio="none" style={{ width: "100%", height: 34, marginTop: 8, display: "block" }} aria-hidden="true">
                <defs><linearGradient id={sparkId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1F7F9F" stopOpacity=".28" /><stop offset="1" stopColor="#1F7F9F" stopOpacity="0" /></linearGradient></defs>
                <path d={`${spark} L300 48 L0 48 Z`} fill={`url(#${sparkId})`} />
                <path d={spark} fill="none" stroke="#1F7F9F" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
          )}
          {daily.length > 0 && <div style={{ fontSize: 11.5, color: SOFT, marginTop: 4 }}>Lowest {lo} on {coverage[daily.indexOf(lo)].date} · highest {hiV}</div>}
        </Card>
      </div>

      {model.heat ? <RotaGlance heat={model.heat} wide={!hasPosts} saveBtn={saveBtn("glance", "rota_at_a_glance")} cardRef={cardRef("glance")} />
        : <Card className="sd-s2" delayMs={300}><CardHead title="Rota at a glance" /><Empty>Pick two months or less to see the rota as squares.</Empty></Card>}

      {hasPosts && <Posts posts={model.posts} saveBtn={saveBtn("posts", "posts")} cardRef={cardRef("posts")} />}

      <Leave leave={model.leave} totals={totals} saveBtn={saveBtn("leave", "leave")} cardRef={cardRef("leave")} />

      <TwoColBars title="Duties per staff" right={<span style={sub}>most first{print ? "" : <span className="sd-mouse"> · hover a bar for the split</span>}</span>} items={model.ranked}
        delayMs={360} saveBtn={saveBtn("duties", "duties_per_staff")} cardRef={cardRef("duties")} emptyText="No staff in this range."
        renderBar={(p, i) => <>
          <Segs segs={p.segs} w={p.w} ms={420 + Math.min(i, 12) * 25} />
          <div style={{ width: 24, textAlign: "right", fontSize: 12, fontWeight: 700 }}>{p.total}</div>
        </>} />

      <TwoColBars title={<>Non-official duties <span style={{ fontSize: 12, color: GOLD, fontWeight: 600 }}>(paid days)</span></>} right={<span style={sub}>most first</span>} items={model.nodPer}
        delayMs={380} saveBtn={saveBtn("nonoff", "non_official_duties")} cardRef={cardRef("nonoff")} emptyText="No staff in this range."
        renderBar={(q, i) => <>
          <div style={{ flex: 1, height: 10 }}><div className="sd-grow sd-w" style={{ ...delay(440 + Math.min(i, 12) * 25), width: `${q.w}%`, height: "100%", background: "linear-gradient(90deg, #E9D3A0, #C99A45)", borderRadius: 999 }} /></div>
          <div style={{ width: 20, textAlign: "right", fontSize: 12, fontWeight: 700, color: GOLD }}>{q.n}</div>
        </>} />

      <div className="sd-s2 sd-rise" style={{ ...delay(400), gridColumn: "1 / -1", display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: SOFT, padding: "4px 6px" }}>
        <span>Duty shifts <strong style={{ color: INK }}>{totals.duty}</strong> <span style={{ opacity: 0.8 }}>(a double-duty day counts twice)</span></span>
      </div>
    </div>
    </PrintCtx.Provider>
  );
}
