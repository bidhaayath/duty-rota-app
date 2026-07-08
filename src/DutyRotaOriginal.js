import React, { useState, useEffect, useMemo } from "react";
import {
  Users, LayoutDashboard, Settings, CalendarRange, Plus, Trash2,
  ChevronLeft, ChevronRight, Check, X, Pencil, Coins, Baby, Plane, Printer, BarChart3,
  AlertTriangle, MoreHorizontal
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  PieChart, Pie, Cell, CartesianGrid, LineChart, Line
} from "recharts";
import supabase from "./supabaseClient";

// Load this user's saved rota. Tries Supabase first, then a local backup,
// and finally falls back to a fresh empty rota so the app ALWAYS loads.
const loadUserRota = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: row } = await supabase
        .from("rotas")
        .select("rota_data")
        .eq("user_id", user.id)
        .maybeSingle();
      if (row && row.rota_data) return row.rota_data;
    }
  } catch (e) {
    console.error("Supabase load failed, using local backup:", e);
  }
  try {
    const local = localStorage.getItem("rota:v2");
    if (local) return JSON.parse(local);
  } catch (e) { /* ignore */ }
  return null;
};

// Save the rota to a local backup (instant) and Supabase (cross-device).
// Both are wrapped so a failure never breaks the app.
const saveUserRota = async (rotaData) => {
  try {
    localStorage.setItem("rota:v2", JSON.stringify(rotaData));
  } catch (e) { /* ignore */ }
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("rotas")
      .upsert(
        { user_id: user.id, title: rotaData.title || "Duty Rota", rota_data: rotaData },
        { onConflict: "user_id" }
      );
  } catch (e) {
    console.error("Supabase save failed (local backup kept):", e);
  }
};

/* ─────────────────── Design tokens ─────────────────── */
const T = {
  ink: "#142B33", inkSoft: "#4A6570", mist: "#EEF4F3", card: "#FFFFFF",
  line: "#DCE8E6", lagoon: "#0F8B7E", coral: "#E4604E", leaf: "#3FA46A",
  sand: "#F4B860", dusk: "#6C7BD9", night: "#2E3358",
};

const FRIDAY = 5, SATURDAY = 6;
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const LEAVE_STYLES = {
  annual:       { label: "Annual Leave",     abbrev: "AL",  bg: "#D8EEE9", fg: "#0B6A60", icon: Plane },
  maternity:    { label: "Maternity",        abbrev: "MAT", bg: "#E9E9E9", fg: "#5A6B72", icon: Baby },
  prematernity: { label: "Pre-Maternity",    abbrev: "PML", bg: "#F6E0EC", fg: "#9C3D6E", icon: Baby },
  emergency:    { label: "Emergency Leave",  abbrev: "EL",  bg: "#FBE3DF", fg: "#B3532F", icon: AlertTriangle },
  other:        { label: "Other Leave",      abbrev: "LV",  bg: "#E6E4F5", fg: "#4E4A8C", icon: MoreHorizontal },
};
// Resolve a period's display style (custom "other" labels keep the generic style)
const styleFor = (period) => {
  const base = LEAVE_STYLES[period.type] || LEAVE_STYLES.other;
  return period.type === "other" && period.label ? { ...base, label: period.label } : base;
};
const DUTY_CATS = ["morning", "afternoon", "night", "other", "release"];

/* ─────────────────── Date helpers ─────────────────── */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
const startOfWeek = (s) => { const d = parseD(s); return addDays(s, -d.getDay()); };
const niceDate = (s) => parseD(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const shortDate = (s) => parseD(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const spanDays = (a, b) => Math.round((parseD(b) - parseD(a)) / 86400000) + 1;
const datesBetween = (from, to) => {
  const out = []; let d = from;
  while (d <= to) { out.push(d); d = addDays(d, 1); }
  return out;
};
const monthStart = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-01`; };
const monthEnd = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate())}`; };
const luminance = (hex) => {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
const textOn = (bg) => (luminance(bg) > 0.6 ? "#142B33" : "#FFFFFF");
const shortName = (name) => name.replace(/^(SRN|RN|EN)\s+/i, "").split(" ")[0];

/* ─────────────────── Data helpers ─────────────────── */
const isNonOff = (data, date) =>
  (data.fridayRule && parseD(date).getDay() === FRIDAY) || data.nonOfficial.includes(date);
// Annual leave days only count on normal working days: Fridays, Saturdays,
// and non-official days inside the period are NOT deducted.
const countsAsALDay = (data, date) => {
  const dow = parseD(date).getDay();
  return dow !== FRIDAY && dow !== SATURDAY && !data.nonOfficial.includes(date);
};
const alWorkingDays = (data, period, from, to) => {
  const s = period.start > from ? period.start : from;
  const e = period.end < to ? period.end : to;
  if (s > e) return 0;
  return datesBetween(s, e).filter((d) => countsAsALDay(data, d)).length;
};
const leaveOn = (staff, date) => (staff.leavePeriods || []).find((p) => date >= p.start && date <= p.end) || null;
const codeByIdOf = (data) => (id) => data.codes.find((c) => c.id === id);

const weekTotalsFor = (data, staff, days) => {
  const codeById = codeByIdOf(data);
  const t = { morning: 0, afternoon: 0, night: 0, other: 0, release: 0, off: 0, nonOfficialDuty: 0 };
  days.forEach((date) => {
    if (leaveOn(staff, date)) return;
    const code = codeById((data.cells[date] || {})[staff.id]);
    if (!code) return;
    if (code.counts in t) t[code.counts]++;
    if (DUTY_CATS.includes(code.counts) && isNonOff(data, date)) t.nonOfficialDuty++;
  });
  return t;
};
// Unit coverage counts exclude release duty (staff is on duty elsewhere)
const dayCountFor = (data, date, cat) => {
  const codeById = codeByIdOf(data);
  return data.staff.reduce((a, s) => {
    if (leaveOn(s, date)) return a;
    const code = codeById((data.cells[date] || {})[s.id]);
    return a + (code?.counts === cat ? 1 : 0);
  }, 0);
};
const recordsFor = (data, from, to) => {
  const codeById = codeByIdOf(data);
  const dates = datesBetween(from, to);
  return data.staff.map((s) => {
    const t = { morning: 0, afternoon: 0, night: 0, other: 0, release: 0, off: 0, fridayOff: 0, nonOfficialDuty: 0, nonOfficialDates: [], leaveByCode: {} };
    dates.forEach((date) => {
      if (leaveOn(s, date)) return;
      const code = codeById((data.cells[date] || {})[s.id]);
      if (!code) return;
      if (code.counts in t) t[code.counts]++;
      if (code.counts === "leave") t.leaveByCode[code.code.toUpperCase()] = (t.leaveByCode[code.code.toUpperCase()] || 0) + 1;
      if (code.counts === "off" && parseD(date).getDay() === FRIDAY) t.fridayOff++;
      if (DUTY_CATS.includes(code.counts) && isNonOff(data, date)) {
        t.nonOfficialDuty++; t.nonOfficialDates.push({ date, code: code.code });
      }
    });
    const annualDays = (s.leavePeriods || []).filter((p) => p.type === "annual")
      .reduce((a, p) => a + alWorkingDays(data, p, from, to), 0);
    const rawOverlap = (p) => {
      const st = p.start > from ? p.start : from, e = p.end < to ? p.end : to;
      return st > e ? 0 : spanDays(st, e);
    };
    const maternityDays = (s.leavePeriods || []).filter((p) => p.type === "maternity")
      .reduce((a, p) => a + rawOverlap(p), 0);
    // Pre-maternity, emergency, and custom periods count as calendar days
    const otherPeriodDays = (s.leavePeriods || [])
      .filter((p) => !["annual", "maternity"].includes(p.type))
      .reduce((a, p) => a + rawOverlap(p), 0);
    const sl = t.leaveByCode["SL"] || 0, frl = t.leaveByCode["FRL"] || 0, ml = t.leaveByCode["ML"] || 0;
    const otherLeave = Object.entries(t.leaveByCode)
      .filter(([k]) => !["SL", "FRL", "ML"].includes(k))
      .reduce((a, [, v]) => a + v, 0) + otherPeriodDays;
    return {
      staff: s, ...t, annualDays, maternityDays, otherPeriodDays, sl, frl, ml, otherLeave,
      totalDuty: t.morning + t.afternoon + t.night + t.other + t.release,
    };
  });
};

const DEFAULT_CODES = [
  { id: "M",    code: "M",      label: "Morning duty",         color: "#F4B860", counts: "morning" },
  { id: "MR",   code: "M(R)",   label: "Morning request",      color: "#E8A33D", counts: "morning" },
  { id: "A",    code: "A",      label: "Afternoon duty",       color: "#8FBF6B", counts: "afternoon" },
  { id: "AR",   code: "A(R)",   label: "Afternoon request",    color: "#6E9E4C", counts: "afternoon" },
  { id: "N",    code: "N",      label: "Night duty",           color: "#6FA8DC", counts: "night" },
  { id: "NR",   code: "N(R)",   label: "Night request",        color: "#4A82BC", counts: "night" },
  { id: "E",    code: "E",      label: "Evening duty",         color: "#8E7CC3", counts: "other" },
  { id: "RD",   code: "RD",     label: "Release duty (other unit)", color: "#C08552", counts: "release" },
  { id: "OFF",  code: "OFF",    label: "Off day",              color: "#FFFFFF", counts: "off" },
  { id: "NOFF", code: "(N)OFF", label: "Off after night",      color: "#E8EEF2", counts: "off" },
  { id: "SL",   code: "SL",     label: "Sick leave",           color: "#F0A090", counts: "leave" },
  { id: "FRL",  code: "FRL",    label: "Family related leave", color: "#D98BD3", counts: "leave" },
  { id: "ML",   code: "ML",     label: "Medical leave",        color: "#5E3A87", counts: "leave" },
];

const seed = () => ({
  staff: [],
  codes: DEFAULT_CODES,
  cells: {},
  nonOfficial: [],
  fridayRule: true,
  title: "DUTY NURSE MANAGER",
});

// The sample staff that earlier versions seeded — removed on load if untouched
const SAMPLE_STAFF = {
  s1: "RN SHAUSAN NASHID", s2: "RN BIDHAAYATH THOIBA", s3: "RN SAIDHA RASHEED",
  s4: "SRN AISHATH EENA", s5: "SRN AISHATH SOLIH", s6: "RN RIUYA HASHIM",
};

const migrate = (d) => {
  const yr = new Date().getFullYear();
  // Remove earlier seeded sample staff (only exact id+name matches, so renamed/real entries are kept)
  const sampleIds = d.staff.filter((s) => SAMPLE_STAFF[s.id] === s.name).map((s) => s.id);
  if (sampleIds.length) {
    d.staff = d.staff.filter((s) => !sampleIds.includes(s.id));
    Object.values(d.cells).forEach((day) => sampleIds.forEach((id) => delete day[id]));
  }
  d.staff.forEach((s) => {
    if (!Array.isArray(s.leavePeriods)) s.leavePeriods = [];
    if (s.maternity) s.leavePeriods.push({ id: uid(), type: "maternity", start: `${yr}-01-01`, end: `${yr}-12-31` });
    delete s.maternity;
  });
  if (!Array.isArray(d.nonOfficial)) d.nonOfficial = [];
  if (d.fridayRule === undefined) d.fridayRule = true;
  // add newer default codes if missing (match by code string)
  const have = new Set(d.codes.map((c) => c.code.toUpperCase()));
  DEFAULT_CODES.forEach((c) => { if (!have.has(c.code.toUpperCase())) d.codes.push({ ...c }); });
  const mr = d.codes.find((c) => c.code.toUpperCase() === "M(R)");
  if (mr && /relief/i.test(mr.label)) mr.label = "Morning request";
  return d;
};

/* ─────────────────── Shared UI ─────────────────── */
const Card = ({ children, style }) => (
  <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 18, ...style }}>{children}</div>
);
const Btn = ({ children, onClick, kind = "primary", small, style, disabled }) => {
  const kinds = {
    primary: { background: T.lagoon, color: "#fff" },
    ghost: { background: "transparent", color: T.ink, border: `1px solid ${T.line}` },
    danger: { background: "#FBEAE7", color: T.coral },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontFamily: "inherit", cursor: disabled ? "not-allowed" : "pointer", border: "none",
      borderRadius: 10, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 6,
      padding: small ? "6px 12px" : "10px 16px", fontSize: small ? 13 : 14,
      opacity: disabled ? 0.5 : 1, ...kinds[kind], ...style,
    }}>{children}</button>
  );
};
const Field = ({ label, children }) => (
  <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12.5, fontWeight: 600, color: T.inkSoft }}>
    {label}{children}
  </label>
);
const inputStyle = {
  fontFamily: "inherit", fontSize: 14, padding: "9px 11px", borderRadius: 9,
  border: `1px solid ${T.line}`, background: "#fff", color: T.ink, outline: "none",
  width: "100%", boxSizing: "border-box",
};
const th = { padding: "9px 10px", borderBottom: `1px solid ${T.line}`, fontSize: 11.5, textAlign: "left", color: T.inkSoft, whiteSpace: "nowrap" };
const td = { padding: "8px 10px", borderBottom: `1px solid ${T.line}`, fontSize: 13, whiteSpace: "nowrap" };

const LeaveChip = ({ type, period }) => {
  const s = period ? styleFor(period) : LEAVE_STYLES[type]; const Icon = s.icon;
  return (
    <span style={{ fontSize: 11.5, background: s.bg, color: s.fg, borderRadius: 999, padding: "3px 9px", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
      <Icon size={11} /> {s.label}
    </span>
  );
};

const RangePicker = ({ range, setRange }) => {
  const preset = (n) => {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + n, 1);
    setRange({ from: dstr(d), to: dstr(new Date(d.getFullYear(), d.getMonth() + 1, 0)) });
  };
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap" }}>
      <Field label="From"><input type="date" style={{ ...inputStyle, width: "auto" }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
      <Field label="To"><input type="date" style={{ ...inputStyle, width: "auto" }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
      <Btn kind="ghost" small onClick={() => preset(0)}>This month</Btn>
      <Btn kind="ghost" small onClick={() => preset(-1)}>Last month</Btn>
    </div>
  );
};

// Group consecutive leave days in a week into merged segments
const weekSegments = (staff, days) => {
  const segs = [];
  let i = 0;
  while (i < days.length) {
    const p = leaveOn(staff, days[i]);
    if (!p) { segs.push({ kind: "cell", date: days[i], span: 1 }); i++; continue; }
    let j = i;
    while (j + 1 < days.length) {
      const q = leaveOn(staff, days[j + 1]);
      if (q && q.id === p.id) j++; else break;
    }
    segs.push({ kind: "leave", period: p, span: j - i + 1 });
    i = j + 1;
  }
  return segs;
};

/* ─────────────────── App ─────────────────── */
export default function DutyRota() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("rota");
  const [weekStart, setWeekStart] = useState(startOfWeek(dstr(new Date())));
  const [range, setRange] = useState({ from: monthStart(), to: monthEnd() });
  const [statRange, setStatRange] = useState({ from: monthStart(), to: monthEnd() });
  const [printView, setPrintView] = useState(null);

  useEffect(() => {
    (async () => {
      const saved = await loadUserRota();
      setData(saved ? migrate(saved) : seed());
    })();
  }, []);

  useEffect(() => {
    if (!data) return;
    saveUserRota(data);
  }, [data]);

  useEffect(() => {
    if (!printView) return;
    const timer = setTimeout(() => { try { window.print(); } catch (e) { console.error(e); } }, 400);
    const done = () => setPrintView(null);
    window.addEventListener("afterprint", done);
    return () => { clearTimeout(timer); window.removeEventListener("afterprint", done); };
  }, [printView]);

  const update = (fn) => setData((d) => fn(structuredClone(d)));

  if (!data) return <div style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 60, textAlign: "center", color: T.inkSoft }}>Loading rota…</div>;

  const globalCss = `
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700&family=Inter:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; }
    select:focus, input:focus { border-color: ${T.lagoon} !important; }
    ::-webkit-scrollbar { height: 8px; width: 8px; }
    ::-webkit-scrollbar-thumb { background: ${T.line}; border-radius: 4px; }
    @media print {
      .no-print { display: none !important; }
      body { background: #fff !important; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    @page { size: A4 landscape; margin: 10mm; }
  `;

  if (printView) {
    return (
      <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: "#fff", minHeight: "100vh", color: T.ink, padding: 16 }}>
        <style>{globalCss}</style>
        <div className="no-print" style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <Btn small onClick={() => window.print()}><Printer size={14} /> Print / Save as PDF</Btn>
          <Btn kind="ghost" small onClick={() => setPrintView(null)}><ChevronLeft size={14} /> Back to app</Btn>
        </div>
        {printView.kind === "rota" && <RotaPrint data={data} weekStart={weekStart} />}
        {printView.kind === "records" && <RecordsPrint data={data} from={range.from} to={range.to} />}
        {printView.kind === "stats" && <StatsPrint data={data} from={statRange.from} to={statRange.to} />}
      </div>
    );
  }

  const tabs = [
    { id: "rota", label: "Weekly Rota", icon: CalendarRange },
    { id: "records", label: "Staff Records", icon: LayoutDashboard },
    { id: "stats", label: "Statistics", icon: BarChart3 },
    { id: "staff", label: "Staff", icon: Users },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: T.mist, minHeight: "100vh", color: T.ink }}>
      <style>{globalCss}</style>

      <header style={{ background: T.ink, color: "#fff", padding: "18px 22px 0" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 20, margin: 0, letterSpacing: -0.3 }}>{data.title}</h1>
          <span style={{ fontSize: 12.5, color: "#9FC3BD" }}>duty rota & non-official day tracker</span>
        </div>
        <nav style={{ display: "flex", gap: 4, marginTop: 14, overflowX: "auto" }}>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)} style={{
              fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6, padding: "10px 14px",
              border: "none", borderRadius: "10px 10px 0 0", whiteSpace: "nowrap",
              background: tab === id ? T.mist : "transparent", color: tab === id ? T.ink : "#B8D2CD",
            }}><Icon size={15} /> {label}</button>
          ))}
        </nav>
      </header>

      <main style={{ padding: "20px 22px 40px", maxWidth: 1250, margin: "0 auto" }}>
        {tab === "rota" && <WeekRota data={data} update={update} weekStart={weekStart} setWeekStart={setWeekStart} onExport={() => setPrintView({ kind: "rota" })} />}
        {tab === "records" && <Records data={data} range={range} setRange={setRange} onExport={() => setPrintView({ kind: "records" })} />}
        {tab === "stats" && <Stats data={data} range={statRange} setRange={setStatRange} onExport={() => setPrintView({ kind: "stats" })} />}
        {tab === "staff" && <StaffTab data={data} update={update} />}
        {tab === "settings" && <SettingsTab data={data} update={update} />}
      </main>
    </div>
  );
}

/* ─────────────────── Weekly rota grid ─────────────────── */
function WeekRota({ data, update, weekStart, setWeekStart, onExport }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const codeById = codeByIdOf(data);

  const setCell = (date, staffId, codeId) => update((d) => {
    if (!d.cells[date]) d.cells[date] = {};
    if (codeId) d.cells[date][staffId] = codeId; else delete d.cells[date][staffId];
    return d;
  });

  const toggleNonOfficial = (date) => {
    if (data.fridayRule && parseD(date).getDay() === FRIDAY) return;
    update((d) => {
      d.nonOfficial = d.nonOfficial.includes(date)
        ? d.nonOfficial.filter((x) => x !== date)
        : [...d.nonOfficial, date].sort();
      return d;
    });
  };

  const range = `${niceDate(days[0])} – ${niceDate(days[6])}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Btn kind="ghost" small onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={15} /></Btn>
          <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 15 }}>{range}</div>
          <Btn kind="ghost" small onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={15} /></Btn>
          <Btn kind="ghost" small onClick={() => setWeekStart(startOfWeek(dstr(new Date())))}>Today</Btn>
        </div>
        <Btn kind="ghost" small onClick={onExport}><Printer size={14} /> Export PDF</Btn>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
        {data.codes.map((c) => (
          <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, color: T.inkSoft }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: c.color, border: `1px solid ${T.line}` }} />
            {c.code}
          </span>
        ))}
      </div>

      <div style={{ fontSize: 12.5, color: T.inkSoft, display: "flex", alignItems: "center", gap: 6 }}>
        <Coins size={13} color={T.sand} />
        Gold headers are <strong>non-official days</strong>{data.fridayRule ? " (all Fridays, plus any date you tap to toggle)" : " (tap a day header to toggle)"}. Duty on those days counts for payment.
      </div>

      <Card style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1080 }}>
          <thead>
            <tr>
              <th style={{ ...th, position: "sticky", left: 0, background: "#fff", zIndex: 2, minWidth: 180 }}>NAME & DESIGNATION</th>
              {days.map((date) => {
                const d = parseD(date);
                const nonOff = isNonOff(data, date);
                const lockedFriday = data.fridayRule && d.getDay() === FRIDAY;
                return (
                  <th key={date} style={{ ...th, textAlign: "center", cursor: lockedFriday ? "default" : "pointer", background: nonOff ? "#FBF1DC" : "#fff" }}
                    title={lockedFriday ? "Friday — always non-official (change in Settings)" : "Tap to toggle non-official day"}
                    onClick={() => toggleNonOfficial(date)}>
                    <div style={{ fontWeight: 700, color: nonOff ? "#A5731B" : T.inkSoft }}>{DAY_NAMES[d.getDay()]}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 500 }}>{d.getDate()} {d.toLocaleString("en", { month: "short" })}</div>
                    {nonOff && <div style={{ fontSize: 9.5, fontWeight: 800, color: "#A5731B" }}>NON-OFFICIAL</div>}
                  </th>
                );
              })}
              {["M", "A", "N", "OD", "RD", "OFF"].map((h) => (
                <th key={h} style={{ ...th, textAlign: "center", background: "#F4F8F7" }}>{h}</th>
              ))}
              <th style={{ ...th, textAlign: "center", background: "#FBF1DC", color: "#A5731B" }}>NON-OFF DUTY</th>
            </tr>
          </thead>
          <tbody>
            {data.staff.map((s) => {
              const segs = weekSegments(s, days);
              const t = weekTotalsFor(data, s, days);
              return (
                <tr key={s.id}>
                  <td style={{ ...td, position: "sticky", left: 0, background: "#fff", zIndex: 1, fontWeight: 600 }}>{s.name}</td>
                  {segs.map((seg, i) => {
                    if (seg.kind === "leave") {
                      const st = styleFor(seg.period);
                      return (
                        <td key={`l${i}`} colSpan={seg.span} style={{ ...td, textAlign: "center", background: st.bg, color: st.fg, fontWeight: 700, letterSpacing: seg.span > 1 ? 1 : 0 }}>
                          {seg.span >= 3 ? st.label : st.abbrev}
                          {seg.span >= 5 && (
                            <span style={{ fontWeight: 500, letterSpacing: 0, marginLeft: 8, fontSize: 11.5 }}>
                              ({niceDate(seg.period.start)} – {niceDate(seg.period.end)})
                            </span>
                          )}
                        </td>
                      );
                    }
                    const date = seg.date;
                    const codeId = (data.cells[date] || {})[s.id] || "";
                    const code = codeById(codeId);
                    const bg = code ? code.color : isNonOff(data, date) ? "#FDF8EE" : "#fff";
                    return (
                      <td key={date} style={{ ...td, padding: 3, textAlign: "center" }}>
                        <select value={codeId} onChange={(e) => setCell(date, s.id, e.target.value)} style={{
                          fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, width: "100%", minWidth: 74,
                          padding: "7px 4px", borderRadius: 7, border: `1px solid ${code ? "transparent" : T.line}`,
                          background: bg, color: code ? textOn(code.color) : T.inkSoft, cursor: "pointer",
                          textAlign: "center", outline: "none",
                        }}>
                          <option value="">—</option>
                          {data.codes.map((c) => <option key={c.id} value={c.id} style={{ background: "#fff", color: T.ink }}>{c.code}</option>)}
                        </select>
                      </td>
                    );
                  })}
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, background: "#FEF7E8" }}>{t.morning}</td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, background: "#F0F7EA" }}>{t.afternoon}</td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, background: "#EBF3FB" }}>{t.night}</td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, background: "#F0EBF8" }}>{t.other}</td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, background: "#F7EFE7" }}>{t.release}</td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700 }}>{t.off}</td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 800, background: "#FBF1DC", color: "#A5731B" }}>{t.nonOfficialDuty}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {[["MORNING", "morning", "#F4B860"], ["AFTERNOON", "afternoon", "#8FBF6B"], ["NIGHT", "night", "#6FA8DC"],
              ...(data.codes.some((c) => c.counts === "other") ? [["OTHER DUTY", "other", "#8E7CC3"]] : [])].map(([label, cat, color]) => (
              <tr key={cat}>
                <td style={{ ...td, position: "sticky", left: 0, zIndex: 1, background: color, color: textOn(color), fontWeight: 800, fontSize: 12 }}>{label}</td>
                {days.map((date) => (
                  <td key={date} style={{ ...td, textAlign: "center", fontWeight: 700, background: color + "33" }}>{dayCountFor(data, date, cat)}</td>
                ))}
                <td colSpan={7} style={{ ...td, background: "#fff" }} />
              </tr>
            ))}
          </tfoot>
        </table>
      </Card>
      <div style={{ fontSize: 12.5, color: T.inkSoft }}>
        RD (release duty) counts as duty for the staff member — including for non-official day payment — but not in this unit's Morning/Afternoon/Night coverage rows. Annual leave and maternity are set in the <strong>Staff</strong> tab and appear as merged bands.
      </div>
    </div>
  );
}

/* ─────────────────── Staff records (date range) ─────────────────── */
function Records({ data, range, setRange, onExport }) {
  const [open, setOpen] = useState(null);
  const valid = range.from && range.to && range.from <= range.to;
  const rows = useMemo(() => valid ? recordsFor(data, range.from, range.to) : [], [data, range, valid]);

  const cols = ["Staff", "M", "A", "N", "OD", "RD", "Total duty", "Off", "Fri off", "AL", "SL", "FRL", "ML", "Other leave", "Non-off duty", ""];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
        <RangePicker range={range} setRange={setRange} />
        <Btn kind="ghost" small onClick={onExport} disabled={!valid}><Printer size={14} /> Export PDF</Btn>
      </div>
      {!valid && <div style={{ fontSize: 13, color: T.coral }}>Pick a valid date range ("From" must be on or before "To").</div>}

      {valid && (
        <Card style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1020 }}>
            <thead>
              <tr>
                {cols.map((h) => (
                  <th key={h} style={{ ...th, textAlign: h === "Staff" ? "left" : "center", background: h === "Non-off duty" ? "#FBF1DC" : undefined, color: h === "Non-off duty" ? "#A5731B" : th.color }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <React.Fragment key={r.staff.id}>
                  <tr>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {r.staff.name}
                      {r.maternityDays > 0 && <span style={{ marginLeft: 8 }}><LeaveChip type="maternity" /></span>}
                      {r.annualDays > 0 && <span style={{ marginLeft: 8 }}><LeaveChip type="annual" /></span>}
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>{r.morning}</td>
                    <td style={{ ...td, textAlign: "center" }}>{r.afternoon}</td>
                    <td style={{ ...td, textAlign: "center" }}>{r.night}</td>
                    <td style={{ ...td, textAlign: "center" }}>{r.other}</td>
                    <td style={{ ...td, textAlign: "center" }}>{r.release}</td>
                    <td style={{ ...td, textAlign: "center", fontWeight: 700 }}>{r.totalDuty}</td>
                    <td style={{ ...td, textAlign: "center" }}>{r.off}</td>
                    <td style={{ ...td, textAlign: "center" }}>{r.fridayOff}</td>
                    <td style={{ ...td, textAlign: "center", fontWeight: 700, color: r.annualDays ? "#0B6A60" : T.ink }}>{r.annualDays}</td>
                    <td style={{ ...td, textAlign: "center", color: r.sl ? "#B3532F" : T.ink }}>{r.sl}</td>
                    <td style={{ ...td, textAlign: "center" }}>{r.frl}</td>
                    <td style={{ ...td, textAlign: "center" }}>{r.ml}</td>
                    <td style={{ ...td, textAlign: "center" }}>{r.otherLeave}</td>
                    <td style={{ ...td, textAlign: "center", fontWeight: 800, background: "#FBF1DC", color: "#A5731B" }}>{r.nonOfficialDuty}</td>
                    <td style={{ ...td }}>
                      {r.nonOfficialDuty > 0 && (
                        <Btn kind="ghost" small onClick={() => setOpen(open === r.staff.id ? null : r.staff.id)}>
                          {open === r.staff.id ? "Hide" : "Dates"}
                        </Btn>
                      )}
                    </td>
                  </tr>
                  {open === r.staff.id && (
                    <tr>
                      <td colSpan={cols.length} style={{ ...td, background: "#FDFAF3" }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#A5731B", marginBottom: 6 }}>
                          <Coins size={12} style={{ verticalAlign: -2 }} /> Non-official days worked — for payment claim
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {r.nonOfficialDates.map((x) => (
                            <span key={x.date} style={{ background: "#fff", border: `1px solid #E7D9B8`, borderRadius: 8, padding: "4px 10px", fontSize: 12.5 }}>
                              {niceDate(x.date)} · <strong>{x.code}</strong>{parseD(x.date).getDay() === FRIDAY ? " (Friday)" : ""}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div style={{ fontSize: 12.5, color: T.inkSoft }}>
        AL counts only normal working days (Fridays, Saturdays, and non-official days are not deducted). SL, FRL, and ML are counted from rota codes; "Other leave" covers other leave codes plus pre-maternity, emergency, and custom leave periods (calendar days).
      </div>
    </div>
  );
}

/* ─────────────────── Statistics ─────────────────── */
function Stats({ data, range, setRange, onExport }) {
  const valid = range.from && range.to && range.from <= range.to;
  const rows = useMemo(() => valid ? recordsFor(data, range.from, range.to) : [], [data, range, valid]);

  const dutyByStaff = rows.map((r) => ({
    name: shortName(r.staff.name),
    Morning: r.morning, Afternoon: r.afternoon, Night: r.night, "Other duty": r.other, Release: r.release,
  }));
  const nonOffByStaff = rows.map((r) => ({ name: shortName(r.staff.name), days: r.nonOfficialDuty }));
  const leaveMix = [
    { name: "Annual", value: rows.reduce((a, r) => a + r.annualDays, 0), color: "#0F8B7E" },
    { name: "Maternity", value: rows.reduce((a, r) => a + r.maternityDays, 0), color: "#9AA5AB" },
    { name: "Sick", value: rows.reduce((a, r) => a + r.sl, 0), color: "#F0A090" },
    { name: "FRL", value: rows.reduce((a, r) => a + r.frl, 0), color: "#D98BD3" },
    { name: "Medical", value: rows.reduce((a, r) => a + r.ml, 0), color: "#5E3A87" },
    { name: "Other", value: rows.reduce((a, r) => a + r.otherLeave, 0), color: "#6C7BD9" },
  ].filter((x) => x.value > 0);

  const coverage = useMemo(() => {
    if (!valid) return [];
    const dates = datesBetween(range.from, range.to);
    if (dates.length > 92) return null; // too long to chart daily
    return dates.map((date) => ({
      date: shortDate(date),
      Morning: dayCountFor(data, date, "morning"),
      Afternoon: dayCountFor(data, date, "afternoon"),
      Night: dayCountFor(data, date, "night"),
    }));
  }, [data, range, valid]);

  const totals = {
    duty: rows.reduce((a, r) => a + r.totalDuty, 0),
    nonOff: rows.reduce((a, r) => a + r.nonOfficialDuty, 0),
    leave: rows.reduce((a, r) => a + r.annualDays + r.sl + r.frl + r.ml + r.otherLeave, 0),
    off: rows.reduce((a, r) => a + r.off, 0),
  };

  const StatCard = ({ label, value, color = T.ink }) => (
    <Card style={{ flex: "1 1 140px", minWidth: 140 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: T.inkSoft, marginBottom: 6 }}>{label}</div>
      <div style={{ fontFamily: "Sora, sans-serif", fontSize: 26, fontWeight: 700, color }}>{value}</div>
    </Card>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
        <RangePicker range={range} setRange={setRange} />
        <Btn kind="ghost" small onClick={onExport} disabled={!valid}><Printer size={14} /> Export PDF</Btn>
      </div>
      {!valid ? <div style={{ fontSize: 13, color: T.coral }}>Pick a valid date range.</div> : <>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <StatCard label="Total duty shifts" value={totals.duty} />
          <StatCard label="Non-official duties" value={totals.nonOff} color="#A5731B" />
          <StatCard label="Leave days" value={totals.leave} color={T.dusk} />
          <StatCard label="Off days" value={totals.off} />
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Card style={{ flex: "2 1 420px", minWidth: 320 }}>
            <h3 style={{ margin: "0 0 10px", fontFamily: "Sora, sans-serif", fontSize: 15 }}>Duties per staff</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={dutyByStaff}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.line} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Morning" stackId="a" fill="#F4B860" />
                <Bar dataKey="Afternoon" stackId="a" fill="#8FBF6B" />
                <Bar dataKey="Night" stackId="a" fill="#6FA8DC" />
                <Bar dataKey="Other duty" stackId="a" fill="#8E7CC3" />
                <Bar dataKey="Release" stackId="a" fill="#C08552" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card style={{ flex: "1 1 280px", minWidth: 260 }}>
            <h3 style={{ margin: "0 0 10px", fontFamily: "Sora, sans-serif", fontSize: 15 }}>Leave breakdown</h3>
            {leaveMix.length === 0 ? (
              <div style={{ fontSize: 13, color: T.inkSoft, padding: "40px 0", textAlign: "center" }}>No leave in this range.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={leaveMix} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2} label={(e) => `${e.name} ${e.value}`}>
                    {leaveMix.map((x) => <Cell key={x.name} fill={x.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Card style={{ flex: "1 1 340px", minWidth: 300 }}>
            <h3 style={{ margin: "0 0 10px", fontFamily: "Sora, sans-serif", fontSize: 15 }}>Non-official duties per staff <span style={{ fontSize: 12, color: "#A5731B", fontWeight: 600 }}>(paid days)</span></h3>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={nonOffByStaff}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.line} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="days" fill="#D9A93F" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          <Card style={{ flex: "2 1 420px", minWidth: 320 }}>
            <h3 style={{ margin: "0 0 10px", fontFamily: "Sora, sans-serif", fontSize: 15 }}>Daily coverage</h3>
            {coverage === null ? (
              <div style={{ fontSize: 13, color: T.inkSoft, padding: "40px 0", textAlign: "center" }}>Range too long for a daily chart — pick 3 months or less.</div>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={coverage}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.line} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="Morning" stroke="#E8A33D" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="Afternoon" stroke="#6E9E4C" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="Night" stroke="#4A82BC" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
      </>}
    </div>
  );
}

/* ─────────────────── Print views ─────────────────── */
const pth = { border: "1px solid #999", padding: "5px 7px", fontSize: 10.5, fontWeight: 700, textAlign: "center", background: "#E8E8E8" };
const ptd = { border: "1px solid #999", padding: "5px 7px", fontSize: 11, textAlign: "center" };

function RotaPrint({ data, weekStart }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const codeById = codeByIdOf(data);
  return (
    <div>
      <div style={{ textAlign: "center", fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 2 }}>{data.title}</div>
      <div style={{ textAlign: "center", fontSize: 12, color: "#555", marginBottom: 10 }}>
        Weekly Duty Rota · {niceDate(days[0])} – {niceDate(days[6])}
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...pth, textAlign: "left" }}>NAME & DESIGNATION</th>
            {days.map((date) => {
              const d = parseD(date);
              const nonOff = isNonOff(data, date);
              return (
                <th key={date} style={{ ...pth, background: nonOff ? "#F6E3B4" : "#E8E8E8" }}>
                  {DAY_NAMES[d.getDay()]}<br />
                  <span style={{ fontWeight: 500 }}>{d.getDate()} {d.toLocaleString("en", { month: "short" })}</span>
                  {nonOff && <><br /><span style={{ fontSize: 8.5, color: "#8A5E10" }}>NON-OFFICIAL</span></>}
                </th>
              );
            })}
            {["M", "A", "N", "OD", "RD", "OFF", "NON-OFF DUTY"].map((h) => <th key={h} style={pth}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.staff.map((s) => {
            const segs = weekSegments(s, days);
            const t = weekTotalsFor(data, s, days);
            return (
              <tr key={s.id}>
                <td style={{ ...ptd, textAlign: "left", fontWeight: 700 }}>{s.name}</td>
                {segs.map((seg, i) => {
                  if (seg.kind === "leave") {
                    const st = styleFor(seg.period);
                    return (
                      <td key={`l${i}`} colSpan={seg.span} style={{ ...ptd, background: st.bg, fontWeight: 700, letterSpacing: seg.span > 1 ? 1 : 0 }}>
                        {seg.span >= 3 ? st.label : st.abbrev}
                      </td>
                    );
                  }
                  const code = codeById((data.cells[seg.date] || {})[s.id]);
                  return (
                    <td key={seg.date} style={{ ...ptd, background: code ? code.color : "#fff", color: code ? textOn(code.color) : "#999", fontWeight: 700 }}>
                      {code ? code.code : ""}
                    </td>
                  );
                })}
                <td style={ptd}>{t.morning}</td>
                <td style={ptd}>{t.afternoon}</td>
                <td style={ptd}>{t.night}</td>
                <td style={ptd}>{t.other}</td>
                <td style={ptd}>{t.release}</td>
                <td style={ptd}>{t.off}</td>
                <td style={{ ...ptd, background: "#F6E3B4", fontWeight: 800 }}>{t.nonOfficialDuty}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          {[["MORNING", "morning", "#F4B860"], ["AFTERNOON", "afternoon", "#8FBF6B"], ["NIGHT", "night", "#6FA8DC"],
            ...(data.codes.some((c) => c.counts === "other") ? [["OTHER DUTY", "other", "#8E7CC3"]] : [])].map(([label, cat, color]) => (
            <tr key={cat}>
              <td style={{ ...ptd, textAlign: "left", background: color, color: textOn(color), fontWeight: 800 }}>{label}</td>
              {days.map((date) => <td key={date} style={ptd}>{dayCountFor(data, date, cat)}</td>)}
              <td colSpan={7} style={{ border: "none" }} />
            </tr>
          ))}
        </tfoot>
      </table>
      <div style={{ fontSize: 10, color: "#666", marginTop: 8 }}>
        Legend: {data.codes.map((c) => `${c.code} = ${c.label}`).join(" · ")} · AL = Annual leave · MAT = Maternity · PML = Pre-maternity · EL = Emergency leave
      </div>
    </div>
  );
}

function RecordsPrint({ data, from, to }) {
  const rows = recordsFor(data, from, to);
  const cols = ["Staff", "M", "A", "N", "OD", "RD", "Total duty", "Off", "Fri off", "AL", "SL", "FRL", "ML", "Other leave", "Non-off duty"];
  return (
    <div>
      <div style={{ textAlign: "center", fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 2 }}>{data.title}</div>
      <div style={{ textAlign: "center", fontSize: 12, color: "#555", marginBottom: 10 }}>
        Staff Duty & Leave Record · {niceDate(from)} – {niceDate(to)}
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {cols.map((h) => (
              <th key={h} style={{ ...pth, textAlign: h === "Staff" ? "left" : "center", background: h === "Non-off duty" ? "#F6E3B4" : "#E8E8E8" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.staff.id}>
              <td style={{ ...ptd, textAlign: "left", fontWeight: 700 }}>{r.staff.name}{r.maternityDays > 0 ? " (Maternity)" : ""}</td>
              <td style={ptd}>{r.morning}</td>
              <td style={ptd}>{r.afternoon}</td>
              <td style={ptd}>{r.night}</td>
              <td style={ptd}>{r.other}</td>
              <td style={ptd}>{r.release}</td>
              <td style={{ ...ptd, fontWeight: 700 }}>{r.totalDuty}</td>
              <td style={ptd}>{r.off}</td>
              <td style={ptd}>{r.fridayOff}</td>
              <td style={ptd}>{r.annualDays}</td>
              <td style={ptd}>{r.sl}</td>
              <td style={ptd}>{r.frl}</td>
              <td style={ptd}>{r.ml}</td>
              <td style={ptd}>{r.otherLeave}</td>
              <td style={{ ...ptd, background: "#F6E3B4", fontWeight: 800 }}>{r.nonOfficialDuty}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.some((r) => r.nonOfficialDates.length > 0) && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Non-official days worked (for payment claims)</div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...pth, textAlign: "left" }}>Staff</th>
                <th style={{ ...pth, textAlign: "left" }}>Dates & duties</th>
                <th style={pth}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => r.nonOfficialDates.length > 0).map((r) => (
                <tr key={r.staff.id}>
                  <td style={{ ...ptd, textAlign: "left", fontWeight: 700 }}>{r.staff.name}</td>
                  <td style={{ ...ptd, textAlign: "left", whiteSpace: "normal" }}>
                    {r.nonOfficialDates.map((x) => `${niceDate(x.date)} (${x.code}${parseD(x.date).getDay() === FRIDAY ? ", Fri" : ""})`).join(" · ")}
                  </td>
                  <td style={{ ...ptd, fontWeight: 800 }}>{r.nonOfficialDuty}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 10, color: "#666", marginTop: 8 }}>
        AL counts working days only (Fridays, Saturdays, and non-official days excluded). Generated {niceDate(dstr(new Date()))}.
      </div>
    </div>
  );
}

function StatsPrint({ data, from, to }) {
  const rows = recordsFor(data, from, to);
  const dutyByStaff = rows.map((r) => ({
    name: shortName(r.staff.name),
    Morning: r.morning, Afternoon: r.afternoon, Night: r.night, "Other duty": r.other, Release: r.release,
  }));
  const nonOffByStaff = rows.map((r) => ({ name: shortName(r.staff.name), days: r.nonOfficialDuty }));
  const leaveMix = [
    { name: "Annual", value: rows.reduce((a, r) => a + r.annualDays, 0), color: "#0F8B7E" },
    { name: "Maternity", value: rows.reduce((a, r) => a + r.maternityDays, 0), color: "#9AA5AB" },
    { name: "Sick", value: rows.reduce((a, r) => a + r.sl, 0), color: "#F0A090" },
    { name: "FRL", value: rows.reduce((a, r) => a + r.frl, 0), color: "#D98BD3" },
    { name: "Medical", value: rows.reduce((a, r) => a + r.ml, 0), color: "#5E3A87" },
    { name: "Other", value: rows.reduce((a, r) => a + r.otherLeave, 0), color: "#6C7BD9" },
  ].filter((x) => x.value > 0);
  const dates = datesBetween(from, to);
  const coverage = dates.length > 92 ? null : dates.map((date) => ({
    date: shortDate(date),
    Morning: dayCountFor(data, date, "morning"),
    Afternoon: dayCountFor(data, date, "afternoon"),
    Night: dayCountFor(data, date, "night"),
  }));
  const totals = {
    duty: rows.reduce((a, r) => a + r.totalDuty, 0),
    nonOff: rows.reduce((a, r) => a + r.nonOfficialDuty, 0),
    leave: rows.reduce((a, r) => a + r.annualDays + r.maternityDays + r.sl + r.frl + r.ml + r.otherLeave, 0),
    off: rows.reduce((a, r) => a + r.off, 0),
  };
  const box = { border: "1px solid #BBB", borderRadius: 8, padding: 10, background: "#fff" };
  const chartTitle = { fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 12, margin: "0 0 6px" };

  return (
    <div>
      <div style={{ textAlign: "center", fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 16, marginBottom: 2 }}>{data.title}</div>
      <div style={{ textAlign: "center", fontSize: 12, color: "#555", marginBottom: 12 }}>
        Duty Statistics · {niceDate(from)} – {niceDate(to)}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        {[["Total duty shifts", totals.duty], ["Non-official duties", totals.nonOff], ["Leave days", totals.leave], ["Off days", totals.off]].map(([l, v]) => (
          <div key={l} style={{ ...box, flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 10.5, color: "#666", fontWeight: 600 }}>{l}</div>
            <div style={{ fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 700 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ ...box, flex: "0 0 62%" }}>
          <h4 style={chartTitle}>Duties per staff</h4>
          <BarChart width={620} height={220} data={dutyByStaff}>
            <CartesianGrid strokeDasharray="3 3" stroke="#DDD" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="Morning" stackId="a" fill="#F4B860" isAnimationActive={false} />
            <Bar dataKey="Afternoon" stackId="a" fill="#8FBF6B" isAnimationActive={false} />
            <Bar dataKey="Night" stackId="a" fill="#6FA8DC" isAnimationActive={false} />
            <Bar dataKey="Other duty" stackId="a" fill="#8E7CC3" isAnimationActive={false} />
            <Bar dataKey="Release" stackId="a" fill="#C08552" isAnimationActive={false} />
          </BarChart>
        </div>
        <div style={{ ...box, flex: 1 }}>
          <h4 style={chartTitle}>Leave breakdown</h4>
          {leaveMix.length === 0 ? (
            <div style={{ fontSize: 11, color: "#666", padding: "40px 0", textAlign: "center" }}>No leave in this range.</div>
          ) : (
            <PieChart width={330} height={220}>
              <Pie data={leaveMix} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72}
                paddingAngle={2} isAnimationActive={false} label={(e) => `${e.name} ${e.value}`}>
                {leaveMix.map((x) => <Cell key={x.name} fill={x.color} />)}
              </Pie>
            </PieChart>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ ...box, flex: "0 0 38%" }}>
          <h4 style={chartTitle}>Non-official duties per staff (paid days)</h4>
          <BarChart width={370} height={200} data={nonOffByStaff}>
            <CartesianGrid strokeDasharray="3 3" stroke="#DDD" />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Bar dataKey="days" fill="#D9A93F" isAnimationActive={false} />
          </BarChart>
        </div>
        <div style={{ ...box, flex: 1 }}>
          <h4 style={chartTitle}>Daily coverage</h4>
          {coverage === null ? (
            <div style={{ fontSize: 11, color: "#666", padding: "40px 0", textAlign: "center" }}>Range too long for a daily chart (max 3 months).</div>
          ) : (
            <LineChart width={600} height={200} data={coverage}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DDD" />
              <XAxis dataKey="date" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="Morning" stroke="#E8A33D" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line type="monotone" dataKey="Afternoon" stroke="#6E9E4C" dot={false} strokeWidth={2} isAnimationActive={false} />
              <Line type="monotone" dataKey="Night" stroke="#4A82BC" dot={false} strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          )}
        </div>
      </div>
      <div style={{ fontSize: 10, color: "#666", marginTop: 8 }}>Generated {niceDate(dstr(new Date()))}.</div>
    </div>
  );
}

/* ─────────────────── Staff tab ─────────────────── */
function StaffTab({ data, update }) {
  const empty = { name: "", contact: "", recc: "", licence: "", leavePeriods: [] };
  const [form, setForm] = useState(null);
  const npEmpty = { type: "annual", label: "", start: "", end: "" };
  const [np, setNp] = useState(npEmpty);

  const save = () => {
    if (!form.name.trim()) return;
    update((d) => {
      if (form.id) { const i = d.staff.findIndex((s) => s.id === form.id); d.staff[i] = form; }
      else d.staff.push({ ...form, id: uid() });
      return d;
    });
    setForm(null); setNp(npEmpty);
  };
  const remove = (id) => update((d) => {
    d.staff = d.staff.filter((s) => s.id !== id);
    Object.values(d.cells).forEach((day) => delete day[id]);
    return d;
  });

  const addPeriod = () => {
    if (!np.start || !np.end || np.end < np.start) return;
    const period = { type: np.type, start: np.start, end: np.end, id: uid() };
    if (np.type === "other" && np.label.trim()) period.label = np.label.trim();
    setForm({ ...form, leavePeriods: [...(form.leavePeriods || []), period] });
    setNp(npEmpty);
  };
  const removePeriod = (pid) => setForm({ ...form, leavePeriods: form.leavePeriods.filter((p) => p.id !== pid) });

  const onLeaveToday = (s) => leaveOn(s, dstr(new Date()));
  const licenceSoon = (s) => s.licence && (parseD(s.licence) - new Date()) / 86400000 < 90;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontFamily: "Sora, sans-serif", fontSize: 18 }}>Staff ({data.staff.length})</h2>
        <Btn onClick={() => setForm(empty)}><Plus size={15} /> Add staff</Btn>
      </div>

      {form && (
        <Card>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            <Field label="Name & designation"><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. RN AMINATH…" /></Field>
            <Field label="Contact no."><input style={inputStyle} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
            <Field label="RECC no."><input style={inputStyle} value={form.recc} onChange={(e) => setForm({ ...form, recc: e.target.value })} /></Field>
            <Field label="Licence expiry"><input type="date" style={inputStyle} value={form.licence} onChange={(e) => setForm({ ...form, licence: e.target.value })} /></Field>
          </div>

          <div style={{ marginTop: 16, borderTop: `1px solid ${T.line}`, paddingTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Leave periods</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field label="Type">
                <select style={{ ...inputStyle, width: "auto" }} value={np.type} onChange={(e) => setNp({ ...np, type: e.target.value })}>
                  <option value="annual">Annual leave</option>
                  <option value="maternity">Maternity</option>
                  <option value="prematernity">Pre-maternity</option>
                  <option value="emergency">Emergency leave</option>
                  <option value="other">Other (custom name)</option>
                </select>
              </Field>
              {np.type === "other" && (
                <Field label="Leave name">
                  <input style={{ ...inputStyle, width: 160 }} value={np.label} placeholder="e.g. Study leave"
                    onChange={(e) => setNp({ ...np, label: e.target.value })} />
                </Field>
              )}
              <Field label="From"><input type="date" style={{ ...inputStyle, width: "auto" }} value={np.start} onChange={(e) => setNp({ ...np, start: e.target.value })} /></Field>
              <Field label="To"><input type="date" style={{ ...inputStyle, width: "auto" }} value={np.end} onChange={(e) => setNp({ ...np, end: e.target.value })} /></Field>
              <Btn small onClick={addPeriod} disabled={!np.start || !np.end || np.end < np.start}><Plus size={13} /> Add period</Btn>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {(form.leavePeriods || []).length === 0 && <span style={{ fontSize: 12.5, color: T.inkSoft }}>No leave periods yet.</span>}
              {(form.leavePeriods || []).map((p) => {
                const st = styleFor(p);
                const counted = p.type === "annual" ? alWorkingDays(data, p, p.start, p.end) : spanDays(p.start, p.end);
                return (
                  <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: st.bg, color: st.fg, borderRadius: 8, padding: "5px 10px", fontSize: 12.5, fontWeight: 600 }}>
                    {st.label}: {niceDate(p.start)} – {niceDate(p.end)}
                    {p.type === "annual" ? ` (${counted} AL days of ${spanDays(p.start, p.end)}d)` : ` (${counted}d)`}
                    <button onClick={() => removePeriod(p.id)} style={{ background: "none", border: "none", cursor: "pointer", color: st.fg, display: "flex", padding: 0 }}><X size={13} /></button>
                  </span>
                );
              })}
            </div>
            <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 8 }}>
              For annual leave, Fridays, Saturdays, and non-official days inside the period are not counted as AL days.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Btn onClick={save}><Check size={15} /> {form.id ? "Save changes" : "Add staff"}</Btn>
            <Btn kind="ghost" onClick={() => { setForm(null); setNp(npEmpty); }}>Cancel</Btn>
          </div>
        </Card>
      )}

      <Card style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>{["Name & designation", "Contact", "RECC no.", "Licence expiry", "Leave periods", "Status", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {data.staff.map((s) => {
              const today = onLeaveToday(s);
              return (
                <tr key={s.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{s.name}</td>
                  <td style={td}>{s.contact}</td>
                  <td style={td}>{s.recc}</td>
                  <td style={{ ...td, color: licenceSoon(s) ? T.coral : T.ink, fontWeight: licenceSoon(s) ? 700 : 400 }}>
                    {s.licence ? niceDate(s.licence) : "—"}{licenceSoon(s) && " ⚠"}
                  </td>
                  <td style={{ ...td, whiteSpace: "normal", maxWidth: 280 }}>
                    {(s.leavePeriods || []).length === 0 ? <span style={{ color: T.inkSoft }}>—</span> :
                      (s.leavePeriods || []).map((p) => {
                        const st = styleFor(p);
                        return (
                          <span key={p.id} style={{ display: "inline-block", background: st.bg, color: st.fg, borderRadius: 6, padding: "2px 7px", fontSize: 11.5, fontWeight: 600, margin: "2px 4px 2px 0" }}>
                            {p.type === "other" ? st.label : st.abbrev}: {shortDate(p.start)}–{shortDate(p.end)}
                          </span>
                        );
                      })}
                  </td>
                  <td style={td}>{today
                    ? <LeaveChip period={today} />
                    : <span style={{ fontSize: 11.5, background: "#E8F5EC", color: T.leaf, borderRadius: 999, padding: "3px 9px", fontWeight: 700 }}>Active</span>}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <Btn kind="ghost" small onClick={() => setForm(s)} style={{ marginRight: 6 }}><Pencil size={13} /></Btn>
                    <Btn kind="danger" small onClick={() => remove(s.id)}><Trash2 size={13} /></Btn>
                  </td>
                </tr>
              );
            })}
            {data.staff.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: "center", padding: 24, color: T.inkSoft }}>No staff yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      <div style={{ fontSize: 12.5, color: T.inkSoft }}>
        ⚠ marks licences expiring within 90 days. Annual leave is tracked by leave periods — each staff member's leave renews on their own dates.
      </div>
    </div>
  );
}

/* ─────────────────── Settings tab ─────────────────── */
function SettingsTab({ data, update }) {
  const empty = { code: "", label: "", color: "#F4B860", counts: "morning" };
  const [form, setForm] = useState(null);
  const [nd, setNd] = useState({ from: "", to: "" });
  const palette = ["#F4B860", "#E8A33D", "#8FBF6B", "#6E9E4C", "#6FA8DC", "#4A82BC", "#C08552", "#9AD1C8", "#F0A090", "#D98BD3", "#5E3A87", "#2E3358", "#E8EEF2", "#FFFFFF"];

  const save = () => {
    if (!form.code.trim()) return;
    update((d) => {
      if (form.id) { const i = d.codes.findIndex((c) => c.id === form.id); d.codes[i] = form; }
      else d.codes.push({ ...form, id: uid() });
      return d;
    });
    setForm(null);
  };
  const removeCode = (id) => update((d) => {
    d.codes = d.codes.filter((c) => c.id !== id);
    Object.values(d.cells).forEach((day) => Object.keys(day).forEach((sid) => { if (day[sid] === id) delete day[sid]; }));
    return d;
  });

  const addRange = () => {
    const from = nd.from, to = nd.to || nd.from;
    if (!from || to < from) return;
    update((d) => {
      datesBetween(from, to).forEach((date) => {
        if (d.fridayRule && parseD(date).getDay() === FRIDAY) return; // already covered
        if (!d.nonOfficial.includes(date)) d.nonOfficial.push(date);
      });
      d.nonOfficial.sort();
      return d;
    });
    setNd({ from: "", to: "" });
  };
  const removeDate = (date) => update((d) => { d.nonOfficial = d.nonOfficial.filter((x) => x !== date); return d; });
  const clearAll = () => update((d) => { d.nonOfficial = []; return d; });

  const countsLabel = { morning: "Morning duty", afternoon: "Afternoon duty", night: "Night duty", other: "Other duty", release: "Release duty", off: "Off day", leave: "Leave" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <Field label="Rota title">
          <input style={{ ...inputStyle, maxWidth: 380 }} value={data.title}
            onChange={(e) => update((d) => { d.title = e.target.value; return d; })} />
        </Field>
      </Card>

      <h2 style={{ margin: "6px 0 0", fontFamily: "Sora, sans-serif", fontSize: 17 }}>Non-official days</h2>
      <Card>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          <input type="checkbox" checked={data.fridayRule}
            onChange={(e) => update((d) => { d.fridayRule = e.target.checked; return d; })}
            style={{ accentColor: T.lagoon, width: 16, height: 16 }} />
          All Fridays are non-official days
        </label>
        <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 6, marginBottom: 14 }}>
          {data.fridayRule
            ? "Fridays are marked automatically. Turn this off if you want to pick Fridays individually."
            : "Fridays are treated like any other day — tap day headers or add dates below to mark non-official days."}
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Add non-official dates (single day or range)</div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="From"><input type="date" style={{ ...inputStyle, width: "auto" }} value={nd.from} onChange={(e) => setNd({ ...nd, from: e.target.value })} /></Field>
          <Field label="To (optional)"><input type="date" style={{ ...inputStyle, width: "auto" }} value={nd.to} onChange={(e) => setNd({ ...nd, to: e.target.value })} /></Field>
          <Btn small onClick={addRange} disabled={!nd.from || (nd.to && nd.to < nd.from)}><Plus size={13} /> Add</Btn>
          {data.nonOfficial.length > 0 && <Btn kind="danger" small onClick={clearAll}><Trash2 size={13} /> Clear all</Btn>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          {data.nonOfficial.length === 0 && <span style={{ fontSize: 13, color: T.inkSoft }}>No extra dates added yet.</span>}
          {data.nonOfficial.map((date) => (
            <span key={date} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FBF1DC", border: "1px solid #E7D9B8", borderRadius: 8, padding: "5px 10px", fontSize: 12.5, fontWeight: 600, color: "#A5731B" }}>
              {niceDate(date)}
              <button onClick={() => removeDate(date)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A5731B", display: "flex", padding: 0 }}><X size={13} /></button>
            </span>
          ))}
        </div>
        <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 10 }}>
          Non-official days also don't count as annual leave days when they fall inside a leave period.
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontFamily: "Sora, sans-serif", fontSize: 17 }}>Duty codes</h2>
        <Btn onClick={() => setForm(empty)}><Plus size={15} /> New code</Btn>
      </div>

      {form && (
        <Card>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <Field label="Code (shown in grid)"><input style={inputStyle} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. CL" /></Field>
            <Field label="Full label"><input style={inputStyle} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Casual leave" /></Field>
            <Field label="Counts as">
              <select style={inputStyle} value={form.counts} onChange={(e) => setForm({ ...form, counts: e.target.value })}>
                <option value="morning">Morning duty</option>
                <option value="afternoon">Afternoon duty</option>
                <option value="night">Night duty</option>
                <option value="other">Other duty (e.g. evening, 4th/5th shift)</option>
                <option value="release">Release duty (staff only, not unit)</option>
                <option value="off">Off day</option>
                <option value="leave">Leave</option>
              </select>
            </Field>
            <Field label="Color">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 4 }}>
                {palette.map((c) => (
                  <button key={c} onClick={() => setForm({ ...form, color: c })} style={{
                    width: 26, height: 26, borderRadius: 8, background: c, cursor: "pointer",
                    border: form.color === c ? `2.5px solid ${T.ink}` : `1px solid ${T.line}`,
                  }} />
                ))}
              </div>
            </Field>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <Btn onClick={save}><Check size={15} /> {form.id ? "Save changes" : "Add code"}</Btn>
            <Btn kind="ghost" onClick={() => setForm(null)}>Cancel</Btn>
          </div>
        </Card>
      )}

      <Card style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
          <thead><tr>{["Code", "Label", "Counts as", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {data.codes.map((c) => (
              <tr key={c.id}>
                <td style={td}>
                  <span style={{ background: c.color, color: textOn(c.color), fontWeight: 800, borderRadius: 7, padding: "4px 10px", fontSize: 12.5, border: `1px solid ${T.line}` }}>{c.code}</span>
                </td>
                <td style={td}>{c.label}</td>
                <td style={td}>{countsLabel[c.counts] || c.counts}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <Btn kind="ghost" small onClick={() => setForm(c)} style={{ marginRight: 6 }}><Pencil size={13} /></Btn>
                  <Btn kind="danger" small onClick={() => removeCode(c.id)}><Trash2 size={13} /></Btn>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}