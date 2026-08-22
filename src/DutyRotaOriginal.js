import React, { useState, useEffect, useMemo, useRef } from "react";
import { toPng } from "html-to-image";
import {
  Users, LayoutDashboard, Settings, CalendarRange, Plus, Trash2,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Check, X, Pencil, Coins, Baby, Plane, Printer, BarChart3,
  AlertTriangle, MoreHorizontal, ArrowDownAZ, HelpCircle, Search, ArrowLeftRight, MessageCircle, Image,
  User, Briefcase, Eye, RotateCcw, Wand2
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  Cell, CartesianGrid, LineChart, Line
} from "recharts";
import supabase from "./supabaseClient";
import RequestsTab from "./RequestsTab";
import SmartRosterTab from "./SmartRosterTab";
import { useRotaHistory, UndoRedoButtons } from "./useRotaHistory";

// Load this user's saved rota. Tries Supabase first, then a local backup,
// and finally falls back to a fresh empty rota so the app ALWAYS loads.
const loadUserRota = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // Ordered + limit 1 instead of maybeSingle: once multi-department
      // arrives a user can own several rota rows, and maybeSingle would
      // throw on the second one. Oldest row = the original rota.
      const { data: rows } = await supabase
        .from("rotas")
        .select("rota_data")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1);
      const row = rows && rows[0];
      if (row && row.rota_data) return row.rota_data;
    }
  } catch (e) {
    console.error("Supabase load failed, using local backup:", e);
  }
  // No localStorage fallback: the old "rota:v2" key wasn't keyed by user,
  // so on shared browsers it could hand one account's rota to another.
  return null;
};

// Save the rota to a local backup (instant) and Supabase (cross-device).
// Both are wrapped so a failure never breaks the app.
// Returns true on success, false on failure. The caller uses this to warn
// the person on screen — a save that silently fails is worse than one that
// visibly fails, because the person keeps working believing it's safe.
const saveUserRota = async (rotaData) => {
  // Local backup dropped: it was a global per-browser key and could cross accounts.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return true; // nobody logged in yet — nothing to report as failed
    // Update-by-id (or insert if none) rather than upsert on user_id: the
    // upsert needed the one-rota-per-user uniqueness rule, which
    // multi-department removes. This path works with or without it.
    const { data: existing } = await supabase
      .from("rotas")
      .select("id")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(1);
    const payload = { title: rotaData.title || "Duty Rota", rota_data: rotaData };
    let error;
    if (existing && existing[0]) {
      ({ error } = await supabase.from("rotas").update(payload).eq("id", existing[0].id));
    } else {
      ({ error } = await supabase.from("rotas").insert({ user_id: user.id, ...payload }));
    }
    if (error) { console.error("Supabase save failed:", error); return false; }
    return true;
  } catch (e) {
    console.error("Supabase save failed:", e);
    return false;
  }
};

/* ─────────────── Departments ───────────────
   One login can own several departments, each with its own rota row.
   Everyone currently trialing gets the Plus-level limit; the paywall
   tiers will feed this number later.                                 */

// Lists this user's departments, and self-heals accounts that predate the
// department system (or signed up between migration and deploy): any rota
// without a department gets one, named after the rota's title.
const setupDepartments = async () => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    let { data: deps } = await supabase
      .from("departments")
      .select("id, name, created_at")
      .order("created_at", { ascending: true });
    deps = deps || [];
    const { data: orphans } = await supabase
      .from("rotas").select("id, title")
      .is("department_id", null).eq("user_id", user.id);
    for (const o of orphans || []) {
      const { data: d } = await supabase
        .from("departments")
        .insert({ owner_user_id: user.id, name: (o.title || "").trim() || "Department 1" })
        .select("id, name, created_at").single();
      if (d) {
        await supabase.from("rotas").update({ department_id: d.id }).eq("id", o.id);
        deps.push(d);
      }
    }
    if (deps.length === 0) {
      const { data: d } = await supabase
        .from("departments")
        .insert({ owner_user_id: user.id, name: "Department 1" })
        .select("id, name, created_at").single();
      if (d) deps.push(d);
    }
    return deps;
  } catch (e) {
    console.error("Department setup failed, falling back to single-rota mode:", e);
    return []; // legacy mode — the app still loads
  }
};

// Last version seen from the server for each department, and the promise
// chain each department's saves queue through — see saveRotaFor below.
const rotaVersions = new Map();
const saveQueues = new Map();

const loadRotaFor = async (deptId) => {
  try {
    const { data: rows } = await supabase
      .from("rotas").select("rota_data, version")
      .eq("department_id", deptId).limit(1);
    const row = rows && rows[0];
    if (row && row.rota_data) {
      rotaVersions.set(deptId, row.version == null ? 1 : row.version);
      return row.rota_data;
    }
  } catch (e) {
    console.error("Supabase load failed, using local backup:", e);
  }
  try {
    const local = localStorage.getItem("rota:v2:" + deptId);
    if (local) {
      // The local copy carries no version, so forget any remembered one —
      // otherwise the next save could believe it knows the server's state.
      rotaVersions.delete(deptId);
      return JSON.parse(local);
    }
  } catch (e) { /* ignore */ }
  return null;
};

// Returns true on success, false on failure — see note on saveUserRota above.
// onConflict, if given, is called when another save reached the server first
// and this save was discarded rather than overwriting it.
const doSaveRotaFor = async (deptId, rotaData, onConflict) => {
  try {
    localStorage.setItem("rota:v2:" + deptId, JSON.stringify(rotaData));
  } catch (e) { /* ignore */ }
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !deptId) return true; // nothing to save yet — not a failure
    const { data: existing } = await supabase
      .from("rotas").select("id, version").eq("department_id", deptId).limit(1);
    const payload = { title: rotaData.title || "Duty Rota", rota_data: rotaData };
    let error;
    if (existing && existing[0]) {
      const row = existing[0];
      const known = rotaVersions.has(deptId) ? rotaVersions.get(deptId) : row.version;
      const { data: updated, error: updateError } = await supabase
        .from("rotas")
        .update({ ...payload, version: known + 1 })
        .eq("id", row.id).eq("version", known)
        .select("id");
      error = updateError;
      if (!error && (!updated || updated.length === 0)) {
        // Someone else saved this department since we last loaded/saved it —
        // our version no longer matches, so writing now would clobber theirs.
        console.warn("Rota save conflict: version mismatch, discarding this save.");
        if (onConflict) onConflict();
        return false;
      }
      if (!error) rotaVersions.set(deptId, known + 1);
    } else {
      ({ error } = await supabase.from("rotas").insert({ user_id: user.id, department_id: deptId, version: 1, ...payload }));
      if (!error) rotaVersions.set(deptId, 1);
    }
    if (error) { console.error("Supabase save failed:", error); return false; }
    return true;
  } catch (e) {
    console.error("Supabase save failed:", e);
    return false;
  }
};

// Queues saves per department so two saves for the same department never run
// concurrently — otherwise both could read the same version and one would
// always lose to the version-conflict check above.
const saveRotaFor = (deptId, rotaData, onConflict) => {
  const prior = saveQueues.get(deptId) || Promise.resolve();
  const next = prior.catch(() => {}).then(() => doSaveRotaFor(deptId, rotaData, onConflict));
  saveQueues.set(deptId, next);
  return next;
};

/* ─────────────────── Design tokens ─────────────────── */
const T = {
  ink: "#142B33", inkSoft: "#4A6570", mist: "#EEF4F3", card: "#FFFFFF",
  line: "#DCE8E6", lagoon: "#0F8B7E", coral: "#E4604E", leaf: "#3FA46A",
  sand: "#F4B860", dusk: "#6C7BD9", night: "#2E3358",
};

const FRIDAY = 5;
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const LEAVE_STYLES = {
  annual:       { label: "Annual Leave",     abbrev: "AL",  bg: "#D8EEE9", fg: "#0B6A60", icon: Plane },
  maternity:    { label: "Maternity",        abbrev: "MAT", bg: "#E9E9E9", fg: "#5A6B72", icon: Baby },
  prematernity: { label: "Pre-Maternity",    abbrev: "PML", bg: "#F6E0EC", fg: "#9C3D6E", icon: Baby },
  emergency:    { label: "Emergency Leave",  abbrev: "EL",  bg: "#FBE3DF", fg: "#B3532F", icon: AlertTriangle },
  other:        { label: "Other Extended Leave", abbrev: "LV", bg: "#E6E4F5", fg: "#4E4A8C", icon: MoreHorizontal },
};
// Resolve a period's display style (custom "other" labels keep the generic style)
const styleFor = (period) => {
  const base = LEAVE_STYLES[period.type] || LEAVE_STYLES.other;
  return period.type === "other" && period.label ? { ...base, label: period.label } : base;
};
const DUTY_CATS = ["morning", "afternoon", "evening", "night", "other", "release"];
// Which leave column a code feeds. "leave" is the catch-all that feeds the
// Other leave column; sl/frl/ml feed their own, so a code like N/FRL can be
// counted as FRL without being named "FRL". Newer codes say so explicitly via `counts`.
// Rotas saved before this existed have every leave code on counts:"leave", so
// fall back to the code text — that keeps their SL/FRL/ML tallies unchanged.
const leaveBucket = (code) => {
  if (["sl", "frl", "ml"].includes(code.counts)) return code.counts;
  if (code.counts !== "leave") return null;
  const c = (code.code || "").toUpperCase();
  return c === "SL" ? "sl" : c === "FRL" ? "frl" : c === "ML" ? "ml" : "other";
};
const LEAVE_BUCKET_LABELS = [["sl", "SL"], ["frl", "FRL"], ["ml", "ML"], ["other", "Other leave"]];
// Leave days grouped by category, not by the code text. A code named N/FRL set
// to count as FRL adds to the FRL bar, and every code set to Other leave shares
// one bar — so this always matches the SL/FRL/ML/Other leave columns.
const leaveTakenFrom = (rows) => {
  const totals = { sl: 0, frl: 0, ml: 0, other: 0 };
  rows.forEach((r) => {
    const b = r.leaveByBucket || {};
    ["sl", "frl", "ml", "other"].forEach((k) => { totals[k] += b[k] || 0; });
  });
  return LEAVE_BUCKET_LABELS
    .map(([k, name]) => ({ name, value: totals[k] }))
    .filter((x) => x.value > 0);
};

/* ─────────────────── Date helpers ─────────────────── */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseD = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseD(s); d.setDate(d.getDate() + n); return dstr(d); };
/* Back to the start of whatever this ward calls a week. 0 is Sunday, 1 is
   Monday, matching JavaScript's own day numbering so nothing has to be
   translated on the way through. Sunday unless the rota says otherwise,
   which is what every rota created before this setting existed assumes. */
const startOfWeek = (s, firstDay = 0) => {
  const d = parseD(s);
  return addDays(s, -((((d.getDay() - firstDay) % 7) + 7) % 7));
};
const niceDate = (s) => parseD(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const shortDate = (s) => parseD(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
// Footer stamp for exports — the moment the PDF/image was generated, not any rota date.
const exportGeneratedAt = () => {
  const n = new Date();
  return `Generated on ${niceDate(dstr(n))}, ${n.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`;
};
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
// Designation is a separate, optional field. Compact views (rota grid,
// exports, dropdowns) show "Name — Designation" when set, or just the
// name when it is not — so existing staff entered before this feature
// display exactly as they always have.
const displayName = (staff) => (staff.designation ? `${staff.name} — ${staff.designation}` : staff.name);

/* ─────────────────── Data helpers ─────────────────── */
const isNonOff = (data, date) =>
  (data.fridayRule && parseD(date).getDay() === FRIDAY) || data.nonOfficial.includes(date);
// All leave periods (annual, maternity, pre-maternity, emergency, other) count
// calendar days: every day inside the period counts, including Fridays,
// Saturdays, and non-official days.
const leaveOn = (staff, date) => (staff.leavePeriods || []).find((p) => date >= p.start && date <= p.end) || null;
const codeByIdOf = (data) => (id) => data.codes.find((c) => c.id === id);

/* Cell notes live in a separate map so all the duty-counting code, which
   reads cells[date][staffId] as a plain code id, keeps working unchanged.
   data.cellMeta[date][staffId] = { note?: string }                        */
const cellMetaOf = (data, date, staffId) => (data.cellMeta?.[date]?.[staffId]) || null;

/* Duty exchanges. When a duty is changed from what was originally rostered,
   the cell remembers what it WAS and who asked for the change:
     cellMeta[date][staffId].exchange = { originalCode: "<code id>", requestedBy: "staff"|"manager" }
   originalCode "" means the cell was originally empty. Marking is manual and
   is never cleared automatically — changing the duty back to the original
   code leaves the mark in place until the user clears it. */
const exchangeOf = (data, date, staffId) => cellMetaOf(data, date, staffId)?.exchange || null;
const EXCHANGE_BY = {
  staff:   { label: "Requested by staff",  short: "Staff",   icon: User,      color: "#2F6DB5", bg: "#E7F0FA" },
  manager: { label: "Changed by manager",  short: "Manager", icon: Briefcase, color: "#A5731B", bg: "#FBF1DC" },
};

/* ── Employment window (start/end dates are INCLUSIVE) ────────────────
   startDate empty = always employed from the beginning.
   endDate   empty = still employed (active staff).                     */
const isEmployedOn = (staff, date) => {
  if (staff.startDate && date < staff.startDate) return false;
  if (staff.endDate && date > staff.endDate) return false;
  return true;
};
// Is this person employed at any point inside [from, to]?
const employedInRange = (staff, from, to) => {
  if (staff.startDate && staff.startDate > to) return false;
  if (staff.endDate && staff.endDate < from) return false;
  return true;
};
// "Former staff" = has an end date that has already passed
const isFormer = (staff) => !!staff.endDate && staff.endDate < dstr(new Date());
// Staff to show for a given week (any day of that week overlaps employment)
const staffForDays = (data, days) =>
  data.staff.filter((s) => days.some((d) => isEmployedOn(s, d)));

const weekTotalsFor = (data, staff, days) => {
  const codeById = codeByIdOf(data);
  const t = { morning: 0, afternoon: 0, evening: 0, night: 0, other: 0, release: 0, off: 0, nonOfficialDuty: 0 };
  days.forEach((date) => {
    if (!isEmployedOn(staff, date)) return;
    if (leaveOn(staff, date)) return;
    const code = codeById((data.cells[date] || {})[staff.id]);
    if (!code) return;
    if (code.counts in t) t[code.counts]++;
    if (DUTY_CATS.includes(code.counts) && isNonOff(data, date)) t.nonOfficialDuty++;
  });
  return t;
};
// Unit coverage counts exclude release duty (staff is on duty elsewhere).
// Historical accuracy: counts whoever was EMPLOYED on that date, so past
// weeks keep the correct coverage even after someone leaves.
const dayCountFor = (data, date, cat) => {
  const codeById = codeByIdOf(data);
  return data.staff.reduce((a, s) => {
    if (!isEmployedOn(s, date)) return a;
    if (leaveOn(s, date)) return a;
    const code = codeById((data.cells[date] || {})[s.id]);
    return a + (code?.counts === cat ? 1 : 0);
  }, 0);
};
// Only staff employed at some point in [from, to] appear in records/stats
const recordsFor = (data, from, to) => {
  const codeById = codeByIdOf(data);
  const dates = datesBetween(from, to);
  return data.staff.filter((s) => employedInRange(s, from, to)).map((s) => {
    const t = { morning: 0, afternoon: 0, evening: 0, night: 0, other: 0, release: 0, off: 0, fridayOff: 0, nonOfficialDuty: 0, nonOfficialDates: [], leaveByCode: {}, leaveByBucket: { sl: 0, frl: 0, ml: 0, other: 0 } };
    dates.forEach((date) => {
      if (!isEmployedOn(s, date)) return;
      if (leaveOn(s, date)) return;
      const code = codeById((data.cells[date] || {})[s.id]);
      if (!code) return;
      if (DUTY_CATS.includes(code.counts) || code.counts === "off") t[code.counts]++;
      const bucket = leaveBucket(code);
      if (bucket) {
        t.leaveByCode[code.code.toUpperCase()] = (t.leaveByCode[code.code.toUpperCase()] || 0) + 1;
        t.leaveByBucket[bucket]++;
      }
      if (code.counts === "off" && parseD(date).getDay() === FRIDAY) t.fridayOff++;
      if (DUTY_CATS.includes(code.counts) && isNonOff(data, date)) {
        t.nonOfficialDuty++; t.nonOfficialDates.push({ date, code: code.code });
      }
    });
    // All leave periods count calendar days inside the selected range
    const rawOverlap = (p) => {
      const st = p.start > from ? p.start : from, e = p.end < to ? p.end : to;
      return st > e ? 0 : spanDays(st, e);
    };
    const annualDays = (s.leavePeriods || []).filter((p) => p.type === "annual")
      .reduce((a, p) => a + rawOverlap(p), 0);
    const maternityDays = (s.leavePeriods || []).filter((p) => p.type === "maternity")
      .reduce((a, p) => a + rawOverlap(p), 0);
    // Pre-maternity, emergency, and custom periods count as calendar days
    const otherPeriodDays = (s.leavePeriods || [])
      .filter((p) => !["annual", "maternity"].includes(p.type))
      .reduce((a, p) => a + rawOverlap(p), 0);
    const sl = t.leaveByBucket.sl, frl = t.leaveByBucket.frl, ml = t.leaveByBucket.ml;
    const otherLeave = t.leaveByBucket.other + otherPeriodDays;
    return {
      staff: s, ...t, annualDays, maternityDays, otherPeriodDays, sl, frl, ml, otherLeave,
      totalDuty: t.morning + t.afternoon + t.evening + t.night + t.other + t.release,
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
  { id: "E",    code: "E",      label: "Evening duty",         color: "#8E7CC3", counts: "evening" },
  { id: "RD",   code: "RD",     label: "Release duty (other unit)", color: "#C08552", counts: "release" },
  { id: "OFF",  code: "OFF",    label: "Off day",              color: "#FFFFFF", counts: "off" },
  { id: "NOFF", code: "(N)OFF", label: "Off after night",      color: "#E8EEF2", counts: "off" },
  { id: "SL",   code: "SL",     label: "Sick leave",           color: "#F0A090", counts: "sl" },
  { id: "FRL",  code: "FRL",    label: "Family related leave", color: "#D98BD3", counts: "frl" },
  { id: "ML",   code: "ML",     label: "Medical leave",        color: "#5E3A87", counts: "ml" },
];

const seed = () => ({
  staff: [],
  // Copy, not the shared DEFAULT_CODES array itself — otherwise editing or
  // deleting a code in one rota would mutate the app's master default list.
  codes: DEFAULT_CODES.map((c) => ({ ...c })),
  // These defaults have now been offered, so they are never re-added later.
  seededCodes: DEFAULT_CODES.map((c) => c.code.toUpperCase()),
  cells: {},
  cellMeta: {},
  onCall: {},
  nonOfficial: [],
  fridayRule: true,
  // 0 = Sunday, 1 = Monday. Sunday in the Maldives; Europe mostly runs Monday.
  weekStartsOn: 0,
  eveningEnabled: false,
  logo: "",
  title: "ENTER AREA NAME",
  // Which kind of workplace this is. Stored once at setup so signups can be
  // grouped by industry. Empty = not answered yet (accounts created before
  // this field existed keep working exactly as they always have).
  industry: "",
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
    // Employment dates: blank means "always employed" / "still employed"
    if (s.startDate === undefined) s.startDate = "";
    if (s.endDate === undefined) s.endDate = "";
    // Designation is new and optional. Existing staff (entered before this
    // feature) get a blank designation — their name stays exactly as typed,
    // nothing is auto-split or guessed.
    if (s.designation === undefined) s.designation = "";
  });
  if (d.welcomeDismissed === undefined) d.welcomeDismissed = false;
  if (!d.cellMeta) d.cellMeta = {};
  if (!d.onCall) d.onCall = {};
  if (!Array.isArray(d.nonOfficial)) d.nonOfficial = [];
  if (d.fridayRule === undefined) d.fridayRule = true;
  // Rotas saved before the week could be set began on Sunday, so that is
  // what they keep. Nobody's view shifts underneath them on upgrade.
  if (d.weekStartsOn === undefined) d.weekStartsOn = 0;
  // New accounts answer this at signup; existing accounts get an empty
  // string and are quietly prompted the first time they open Settings.
  if (d.industry === undefined) d.industry = "";
  // Evening shift is opt-in: most units run 3 shifts, so the row/column only
  // exists for rotas that turn it on (e.g. 4-shift Ramadan rosters).
  if (d.eveningEnabled === undefined) d.eveningEnabled = false;
  if (d.logo === undefined) d.logo = "";
  // Default codes are seeded ONCE, not re-added on every load. seededCodes
  // records every default that has already been offered to this rota, so a
  // code the user deliberately deleted stays deleted instead of reappearing
  // at the next login. A default that has never been seeded (i.e. one added
  // to the app after this rota was created) is still delivered normally.
  //
  // Existing rotas have no seededCodes list yet. They are treated as having
  // already been offered every current default — which is true, because the
  // old code force-added all of them on every load.
  if (!Array.isArray(d.seededCodes)) {
    d.seededCodes = DEFAULT_CODES.map((c) => c.code.toUpperCase());
  }
  const have = new Set(d.codes.map((c) => c.code.toUpperCase()));
  const seeded = new Set(d.seededCodes.map((c) => String(c).toUpperCase()));
  DEFAULT_CODES.forEach((c) => {
    const key = c.code.toUpperCase();
    if (!seeded.has(key)) {
      if (!have.has(key)) d.codes.push({ ...c });
      d.seededCodes.push(key);
    }
  });
  const mr = d.codes.find((c) => c.code.toUpperCase() === "M(R)");
  if (mr && /relief/i.test(mr.label)) mr.label = "Morning request";
  // The SL/FRL/ML default codes used to count as the generic "leave". Now each
  // has its own category. Point them at it so Settings, the columns and the
  // charts all agree. Only the untouched defaults are moved — if someone
  // deliberately set one to something else, we leave their choice alone.
  const DEFAULT_LEAVE = { SL: "sl", FRL: "frl", ML: "ml" };
  d.codes.forEach((c) => {
    const want = DEFAULT_LEAVE[(c.code || "").toUpperCase()];
    if (want && c.counts === "leave") c.counts = want;
  });
  return d;
};

/* ─────────────────── Shared UI ─────────────────── */
const Card = ({ children, style, className }) => (
  <div className={className} style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 14, padding: 18, ...style }}>{children}</div>
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
    // Days outside this person's employment window are shown as greyed, non-editable
    if (!isEmployedOn(staff, days[i])) {
      let j = i;
      while (j + 1 < days.length && !isEmployedOn(staff, days[j + 1])) j++;
      const before = staff.startDate && days[i] < staff.startDate;
      segs.push({ kind: "notEmployed", span: j - i + 1, before });
      i = j + 1;
      continue;
    }
    const p = leaveOn(staff, days[i]);
    if (!p) { segs.push({ kind: "cell", date: days[i], span: 1 }); i++; continue; }
    let j = i;
    while (j + 1 < days.length) {
      if (!isEmployedOn(staff, days[j + 1])) break;
      const q = leaveOn(staff, days[j + 1]);
      if (q && q.id === p.id) j++; else break;
    }
    segs.push({ kind: "leave", period: p, span: j - i + 1 });
    i = j + 1;
  }
  return segs;
};

/* ─────────────────── App ─────────────────── */
/* ─────────────────── First-time welcome guide ───────────────────
   Shows for new accounts. Each step ticks itself off automatically as
   the user completes it, and the card disappears once all three are
   done (or if the user dismisses it). Dismissal is stored in the rota
   data itself, so it stays dismissed across devices.                  */
function WelcomeGuide({ data, update, setTab }) {
  if (data.welcomeDismissed) return null;

  const step1 = data.title !== "ENTER AREA NAME" && data.title.trim() !== "";
  const step2 = data.staff.length > 0;
  const step3 = Object.keys(data.cells || {}).some((d) => Object.keys(data.cells[d] || {}).length > 0);
  if (step1 && step2 && step3) return null; // fully set up — nothing to show

  const dismiss = () => update((d) => { d.welcomeDismissed = true; return d; });

  const Row = ({ done, n, text, action, goto }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 0", borderBottom: `1px solid ${T.line}` }}>
      <span style={{
        flexShrink: 0, width: 24, height: 24, borderRadius: "50%",
        background: done ? T.lagoon : "#fff", border: `2px solid ${done ? T.lagoon : T.line}`,
        color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, fontWeight: 700,
      }}>
        {done ? <Check size={14} /> : <span style={{ color: T.inkSoft }}>{n}</span>}
      </span>
      <span style={{ flex: 1, fontSize: 13.5, color: done ? T.inkSoft : T.ink, textDecoration: done ? "line-through" : "none" }}>{text}</span>
      {!done && (
        <button onClick={() => setTab(goto)} style={{
          fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
          background: T.lagoon, color: "#fff", border: "none", borderRadius: 7, padding: "6px 13px", whiteSpace: "nowrap",
        }}>{action}</button>
      )}
    </div>
  );

  return (
    <Card style={{ marginBottom: 18, border: `1.5px solid ${T.lagoon}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <h3 style={{ margin: "0 0 3px", fontFamily: "Sora, sans-serif", fontSize: 16 }}>👋 Welcome! Three steps to get set up</h3>
          <p style={{ margin: "0 0 6px", fontSize: 12.5, color: T.inkSoft }}>Each step ticks itself off as you go. The full guide is in the Help tab any time.</p>
        </div>
        <button onClick={dismiss} title="Hide this guide" style={{ background: "none", border: "none", cursor: "pointer", color: T.inkSoft, padding: 4 }}>
          <X size={16} />
        </button>
      </div>
      <Row done={step1} n={1} text="Give your area or ward a name" action="Open Settings" goto="settings" />
      <Row done={step2} n={2} text="Add your staff members" action="Open Staff" goto="staff" />
      <Row done={step3} n={3} text="Fill in your first duty on the weekly rota" action="Open Rota" goto="rota" />
    </Card>
  );
}

export default function DutyRota({ locked = false, features = null, staffLimit = null, departmentLimit = null }) {
  const [data, setData] = useState(null);
  const [departments, setDepartments] = useState([]);
  const [deptId, setDeptId] = useState(null); // null = legacy single-rota mode
  const [deptMenuOpen, setDeptMenuOpen] = useState(false);
  const switchingDept = useRef(false); // guards the autosave while a switch loads
  const [tab, setTab] = useState("rota");
  /* Sunday to begin with, because the rota has not loaded yet and its
     setting is not known. The effect further down realigns this the moment
     it is, so a Monday ward sees a Monday without ever seeing a flicker of
     the wrong week. */
  const [weekStart, setWeekStart] = useState(startOfWeek(dstr(new Date())));
  const [rotaView, setRotaView] = useState("weekly");
  const [monthRange, setMonthRange] = useState(() => {
    const t = new Date();
    return {
      start: dstr(new Date(t.getFullYear(), t.getMonth(), 1)),
      end: dstr(new Date(t.getFullYear(), t.getMonth() + 1, 0)),
    };
  });
  // The rota table and its PDF both render whatever this range is —
  // 7 days in weekly view, up to 32 in monthly.
  const rotaDays = rotaView === "monthly"
    ? (() => {
        const out = [];
        let d = monthRange.start;
        while (d <= monthRange.end && out.length < 45) { out.push(d); d = addDays(d, 1); }
        return out;
      })()
    : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const [range, setRange] = useState({ from: monthStart(), to: monthEnd() });
  const [statRange, setStatRange] = useState({ from: monthStart(), to: monthEnd() });
  const [printView, setPrintView] = useState(null);
  const printBodyRef = useRef(null);
  // Tracks whether the last save to the server succeeded, so a failure is
  // shown on screen instead of only appearing in the browser console where
  // nobody using the app will ever see it.
  const [saveStatus, setSaveStatus] = useState("idle"); // "idle" | "saving" | "saved" | "error"
  const saveAttempt = useRef(0); // lets a stale save's result be ignored if a newer one has started

  useEffect(() => {
    // Retire the pre-multi-department localStorage key. It was a global,
    // per-browser cache (not per-user), so on a browser that had ever been
    // used by another account it would poison fresh sign-ups with that
    // account’s data. setupDepartments already self-heals orphan rotas from
    // the server, so this fallback path is no longer needed for anyone.
    try { localStorage.removeItem("rota:v2"); } catch (e) { /* ignore */ }

    (async () => {
      const deps = await setupDepartments();
      if (deps.length > 0) {
        setDepartments(deps);
        switchingDept.current = true;
        setDeptId(deps[0].id);
        const saved = await loadRotaFor(deps[0].id);
        setData(saved ? migrate(saved) : seed());
        switchingDept.current = false;
      } else {
        // Departments unreachable — legacy mode so nobody is locked out.
        // Server-only load; the shared localStorage fallback would cross
        // accounts, so it’s intentionally not consulted here.
        const saved = await loadUserRota();
        setData(saved ? migrate(saved) : seed());
      }
    })();
  }, []);

  // Guards against re-entry if several queued saves conflict in quick
  // succession — only the first should trigger a reload.
  const reloadingRef = useRef(false);
  const handleSaveConflict = async () => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    window.alert("Someone else updated this rota. Your screen will now load their version.");
    switchingDept.current = true;
    setData(null);
    const fresh = await loadRotaFor(deptId);
    setData(fresh ? migrate(fresh) : seed());
    switchingDept.current = false;
    reloadingRef.current = false;
  };

  useEffect(() => {
    if (!data || switchingDept.current) return;
    const myAttempt = ++saveAttempt.current;
    setSaveStatus("saving");
    const run = deptId ? saveRotaFor(deptId, data, handleSaveConflict) : saveUserRota(data);
    run.then((ok) => {
      // If another save started while this one was in flight, its result
      // is the one that matters — ignore this older, now-stale result.
      if (saveAttempt.current !== myAttempt) return;
      setSaveStatus(ok ? "saved" : "error");
    });
    // handleSaveConflict is recreated each render but always closes over the
    // current deptId, so it's intentionally left out of this dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, deptId]);

  // Lets the warning banner's "Try saving again" button re-run the same save
  // without requiring the person to make another edit first.
  const retrySave = () => {
    if (!data) return;
    setData((d) => structuredClone(d));
  };

  const switchDept = async (id) => {
    if (id === deptId) return;
    switchingDept.current = true;
    setData(null);
    setDeptId(id);
    const saved = await loadRotaFor(id);
    setData(saved ? migrate(saved) : seed());
    switchingDept.current = false;
  };

  // The database refuses two departments with the same name for one person
  // (unique index on owner_user_id + name). Postgres reports that as code
  // 23505. Without this, the person just sees a generic "could not create"
  // and has no idea the name was the problem.
  const isDuplicateNameError = (error) =>
    error && (error.code === "23505" || /duplicate key|unique constraint/i.test(error.message || ""));

  const addDepartment = async () => {
    if (departmentLimit != null && departments.length >= departmentLimit) {
      window.alert(`Your plan includes up to ${departmentLimit} department${departmentLimit === 1 ? "" : "s"}. Upgrade to add more.`);
      return;
    }
    const name = window.prompt("Name for the new department:", `Department ${departments.length + 1}`);
    if (!name || !name.trim()) return;
    const clean = name.trim();
    // Catch it here first so the person gets a clear answer straight away,
    // rather than a database error. Compared case-insensitively so "ICU" and
    // "icu" are treated as the same name to a human reading the list.
    if (departments.some((x) => (x.name || "").trim().toLowerCase() === clean.toLowerCase())) {
      window.alert(`You already have a department called "${clean}".\n\nPlease choose a different name.`);
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    const { data: d, error } = await supabase
      .from("departments")
      .insert({ owner_user_id: user.id, name: clean })
      .select("id, name, created_at").single();
    if (error || !d) {
      window.alert(isDuplicateNameError(error)
        ? `You already have a department called "${clean}".\n\nPlease choose a different name.`
        : "Could not create the department. Please try again.");
      return;
    }
    setDepartments((prev) => [...prev, d]);
    switchingDept.current = true;
    setData(null);
    setDeptId(d.id);
    setData(seed());
    switchingDept.current = false;
  };

  const renameDepartment = async () => {
    const cur = departments.find((x) => x.id === deptId);
    if (!cur) return;
    const name = window.prompt("Rename department:", cur.name);
    if (!name || !name.trim() || name.trim() === cur.name) return;
    const clean = name.trim();
    // Same check as adding — a rename can collide with an existing name too.
    if (departments.some((x) => x.id !== deptId && (x.name || "").trim().toLowerCase() === clean.toLowerCase())) {
      window.alert(`You already have a department called "${clean}".\n\nPlease choose a different name.`);
      return;
    }
    const { error } = await supabase.from("departments").update({ name: clean }).eq("id", deptId);
    if (error) {
      window.alert(isDuplicateNameError(error)
        ? `You already have a department called "${clean}".\n\nPlease choose a different name.`
        : "Could not rename the department. Please try again.");
      return;
    }
    setDepartments((prev) => prev.map((x) => (x.id === deptId ? { ...x, name: clean } : x)));
  };

  const deleteDepartment = async () => {
    if (departments.length <= 1) { window.alert("You need at least one department."); return; }
    const cur = departments.find((x) => x.id === deptId);
    if (!cur) return;
    if (!window.confirm(`Delete "${cur.name}" and ALL its rota data?\n\nThis cannot be undone.`)) return;
    const { error: rotaErr } = await supabase.from("rotas").delete().eq("department_id", deptId);
    const { error: depErr } = rotaErr ? { error: rotaErr } : await supabase.from("departments").delete().eq("id", deptId);
    if (rotaErr || depErr) { window.alert("Could not delete the department. Please try again."); return; }
    try { localStorage.removeItem("rota:v2:" + deptId); } catch (e) { /* ignore */ }
    const remaining = departments.filter((x) => x.id !== deptId);
    setDepartments(remaining);
    await switchDept(remaining[0].id);
  };

  useEffect(() => {
    if (!printView) return;
    // Close the export screen once a print job completes. No longer
    // auto-opens the print dialog — the user picks Print/Save as PDF or
    // Save as image explicitly, which is the only way both buttons are
    // reachable (cancelling the browser dialog would close the screen).
    const done = () => setPrintView(null);
    window.addEventListener("afterprint", done);
    return () => window.removeEventListener("afterprint", done);
  }, [printView]);

  // Every edit in the whole app flows through this one function, so this
  // single gate makes the entire rota view-only when the trial has ended.
  // Viewing and PDF export still work.
  const update = (fn) => {
    if (locked) {
      alert("Your free trial has ended, so the rota is view-only for now.\n\nYou can still view everything and export PDFs. To keep editing, use the Subscribe button at the top.");
      return;
    }
    if (currentDeptLocked) {
      alert("This department is view-only on your current plan.\n\nYour plan includes " + departmentLimit + " department" + (departmentLimit === 1 ? "" : "s") + ". You can still view and export this one — upgrade to edit it again.");
      return;
    }
    setData((d) => fn(structuredClone(d)));
  };

  /* Changing the setting would otherwise leave the rota sitting on a date
     that is no longer the start of a week — showing Wednesday to Tuesday
     until the next click. */
  const firstDay = data?.weekStartsOn ?? 0;
  useEffect(() => { setWeekStart((w) => startOfWeek(w, firstDay)); }, [firstDay]);

  /* ── Undo / redo ──
     Watches the rota itself rather than hooking into each edit, so every
     change anywhere in the app is undoable — including in tabs that do not
     know this exists. It has to sit ABOVE the early return below, because a
     hook cannot come after one.

     The department lock is worked out again here rather than reused from
     further down for the same reason: currentDeptLocked is defined after
     the return, and undo writes to the rota directly, so it needs its own
     gate or a view-only department could be edited through it. */
  const deptIsLocked = departmentLimit != null && deptId != null &&
    !departments.slice(0, departmentLimit).some((x) => x.id === deptId);
  const history = useRotaHistory(data, setData, deptId, { disabled: locked || deptIsLocked });

  if (!data) return <div key="dr-loading" style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 60, textAlign: "center", color: T.inkSoft }}>Loading rota…</div>;

  // Company logo is a paid feature. When the current tier doesn't include it,
  // the app behaves as if there is NO logo — header, every PDF/image export,
  // and Settings all hide it. The saved logo is NOT deleted; it stays in
  // rota_data and reappears automatically when the user upgrades.
  const canUseLogo = features ? features.company_logo : true;
  const viewData = canUseLogo ? data : { ...data, logo: "" };

  // Department allowance. Departments are held oldest-first, so the first
  // `departmentLimit` of them stay editable and anything beyond that is
  // read-only until the user upgrades. null = unlimited. Deleting an editable
  // one promotes the next in line automatically, since this is purely
  // positional. The saved data is never touched.
  const editableDeptIds = (departmentLimit == null)
    ? null // unlimited — every department editable
    : new Set(departments.slice(0, departmentLimit).map((d) => d.id));
  const deptEditable = (id) =>
    editableDeptIds == null || id == null || editableDeptIds.has(id);
  const currentDeptLocked = !deptEditable(deptId);

  // Staff allowance. On a tier with a staff limit, the first N ACTIVE staff
  // (in list order) stay editable; active staff beyond N are read-only —
  // their profile can't be edited and their rota cells can't be changed.
  // Former staff are excluded from the count (they're already frozen).
  // null = unlimited. Data is never deleted; upgrading restores full editing.
  const readonlyStaffIds = (() => {
    if (staffLimit == null || !data || !Array.isArray(data.staff)) return null;
    const active = data.staff.filter((s) => !isFormer(s));
    if (active.length <= staffLimit) return new Set(); // within limit, none locked
    const lockedActive = active.slice(staffLimit).map((s) => s.id);
    return new Set(lockedActive);
  })();
  const staffEditable = (staffId) =>
    readonlyStaffIds == null || !readonlyStaffIds.has(staffId);

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
      .recharts-wrapper, .recharts-surface { break-inside: avoid; page-break-inside: avoid; }
    }
    /* Export header: title centred, logo pinned right. On a narrow screen
       there is no room beside the title, so the logo stacks underneath
       instead of overlapping it. Print uses paper width, so printed output
       keeps the side-by-side layout regardless of device. */
    .rp-head { display: flex; align-items: center; justify-content: center; gap: 12px; margin-bottom: 2px; position: relative; }
    .rp-logo { height: 56px; max-width: 200px; object-fit: contain; position: absolute; right: 0; }
    @media screen and (max-width: 760px) {
      .rp-head { flex-direction: column; gap: 8px; }
      .rp-logo { position: static; height: 46px; max-width: 62%; }
    }
    /* Landscape for wide rota ranges only; the per-print page override
       below wins for narrower ones (weekly, records, stats). */
    @page { size: A4 landscape; margin: 10mm; }

    /* ── Frozen row-number + name columns on the rota grid ──────────────
       These have to be classes, not inline styles, because the widths
       change on a phone. On a laptop the name column is roomy; on a
       narrow screen the two frozen columns together would swallow almost
       the whole viewport and leave no room for the days, so on mobile the
       number shrinks, the name wraps to two lines inside a fixed 108px,
       and the designation hides (it is still on every export). */
    .rota-num {
      position: sticky; left: 0; z-index: 3; background: #fff;
      width: 32px; min-width: 32px; max-width: 32px;
      padding-left: 4px; padding-right: 4px; text-align: center;
    }
    .rota-name {
      position: sticky; left: 32px; z-index: 2; background: #fff;
      min-width: 168px; box-shadow: 1px 0 0 ${T.line};
    }
    .rota-foot-label { position: sticky; left: 0; z-index: 2; }

    /* ── The header on a phone ──
       On a laptop there is room for the tagline, a full-size logo and a
       labelled Undo button. On a 380px screen those three things cost about
       150 vertical pixels before the rota starts, and the rota is the reason
       anyone opened the app. So on a narrow screen the tagline goes, the
       logo shrinks to something that fits beside the title, and Undo keeps
       its arrow but loses its word. */
    .dr-legend-toggle { display: none; }
    @media screen and (max-width: 760px) {
      .dr-header { padding: 12px 14px 0 !important; }
      .dr-tagline { display: none; }
      .dr-logo { height: 34px !important; max-width: 104px !important; }
      .dr-undo-text { display: none; }
      /* Without the word, the button should not keep the width of one. */
      .dr-undo { padding: 4px 7px !important; }
      /* Twenty duty codes wrap to five lines and push the grid off the
         screen. Collapsed to one line, with a tap to see the rest. */
      .dr-legend:not(.dr-open) { max-height: 19px; overflow: hidden; }
      .dr-legend-toggle {
        display: inline-flex; align-items: center; gap: 4px;
        font-family: inherit; font-size: 12px; font-weight: 600;
        background: none; border: none; padding: 0; cursor: pointer;
      }
    }
    @media screen and (max-width: 760px) {
      .rota-num {
        width: 22px; min-width: 22px; max-width: 22px;
        padding-left: 1px; padding-right: 1px; font-size: 11px;
      }
      .rota-name {
        left: 22px; width: 108px; min-width: 108px; max-width: 108px;
        white-space: normal; word-break: break-word;
        font-size: 11.5px; line-height: 1.25;
        padding-left: 6px; padding-right: 6px;
      }
      .rota-desig { display: none; }
    }
  `;

  if (printView) {
    // 30 days is the widest the image reliably captures across devices;
    // beyond that some phones crop the right-hand columns silently. PDF export
    // is not capped — its page break is real, not a screenshot cut.
    const IMG_MAX_DAYS = 30;
    const canSaveImage = !(printView.kind === "rota" && rotaDays.length > IMG_MAX_DAYS);
    const saveAsImage = async () => {
      if (!canSaveImage) return;
      const node = printBodyRef.current;
      if (!node) return;
      try {
        // 2x pixel density so the image is crisp on retina/phone screens.
        // On a phone the export is wider than the screen, so only part of the
        // node is laid out on-screen. Capture its full scroll width, otherwise
        // the right-hand columns are silently cropped out of the image.
        const fullW = Math.ceil(Math.max(node.scrollWidth, node.offsetWidth));
        const fullH = Math.ceil(Math.max(node.scrollHeight, node.offsetHeight));
        const dataUrl = await toPng(node, {
          pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true,
          width: fullW, height: fullH,
          style: { width: fullW + "px", height: fullH + "px" },
        });
        const link = document.createElement("a");
        link.download = `${(data.title || "rota").replace(/[^\w-]+/g, "_")}.png`;
        link.href = dataUrl;
        link.click();
      } catch (e) {
        console.error("Image export failed:", e);
        window.alert("Sorry, couldn't create the image. Try Print / Save as PDF instead.");
      }
    };
    return (
      <div style={{ fontFamily: "Inter, system-ui, sans-serif", background: "#fff", minHeight: "100vh", color: T.ink, padding: 16 }}>
        <style>{globalCss}</style>
        <div className="no-print" style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          <Btn small onClick={() => window.print()}><Printer size={14} /> Print / Save as PDF</Btn>
          <Btn small onClick={saveAsImage} disabled={!canSaveImage} title={canSaveImage ? "" : `Available for ranges up to ${IMG_MAX_DAYS} days — use Print / Save as PDF for wider ranges.`}><Image size={14} /> Save as image</Btn>
          {!canSaveImage && <span style={{ alignSelf: "center", fontSize: 12, color: T.inkSoft }}>Image export supports up to {IMG_MAX_DAYS} days — use PDF for wider ranges.</span>}
          <Btn kind="ghost" small onClick={() => setPrintView(null)}><ChevronLeft size={14} /> Back to app</Btn>
        </div>
        <div ref={printBodyRef}>
        {printView.kind === "rota" && <RotaPrint data={viewData} days={rotaDays} />}
        {printView.kind === "records" && <RecordsPrint data={viewData} from={range.from} to={range.to} />}
        {printView.kind === "stats" && <StatsPrint data={viewData} from={statRange.from} to={statRange.to} />}
        {printView.kind === "insights" && <InsightsPrint data={viewData} cfg={printView.cfg} />}
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "rota", label: "Weekly Rota", icon: CalendarRange },
    { id: "records", label: "Staff Records", icon: LayoutDashboard },
    { id: "stats", label: "Statistics", icon: BarChart3 },
    { id: "staff", label: "Staff", icon: Users },
    { id: "requests", label: "Duty Requests", icon: MessageCircle },
    { id: "smart", label: "Smart Roster", icon: Wand2 },
    { id: "settings", label: "Settings", icon: Settings },
    { id: "insights", label: "Insights", icon: Search },
    { id: "help", label: "Help", icon: HelpCircle },
  ];

  return (
    <div key="dr-app" className="dr-fade-in" style={{ fontFamily: "Inter, system-ui, sans-serif", background: T.mist, minHeight: "100vh", color: T.ink }}>
      <style>{globalCss}</style>

      <header className="dr-header" style={{ background: T.ink, color: "#fff", padding: "18px 22px 0" }}>
        {departments.length > 0 && (
          <div style={{ position: "relative", display: "inline-block", marginBottom: 8 }}>
            <button onClick={() => setDeptMenuOpen((o) => !o)} style={{
              fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 7,
              background: "rgba(255,255,255,0.12)", color: "#DDEBE8", border: "1px solid rgba(255,255,255,0.22)",
              borderRadius: 999, padding: "5px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            }}>
              <Users size={13} /> {(departments.find((d) => d.id === deptId) || {}).name || "Department"}
              <ChevronDown size={13} className="dr-deptmenu-chevron" style={{ transform: deptMenuOpen ? "rotate(180deg)" : "none" }} />
            </button>
            <div
              onClick={() => setDeptMenuOpen(false)}
              style={{ position: "fixed", inset: 0, zIndex: 59, pointerEvents: deptMenuOpen ? "auto" : "none" }}
            />
            <div
              className="dr-deptmenu-panel"
              inert={!deptMenuOpen}
              style={{
                position: "absolute", top: "115%", left: 0, zIndex: 60, minWidth: 240,
                background: "#fff", color: T.ink, borderRadius: 12, border: `1px solid ${T.line}`,
                boxShadow: "0 12px 30px rgba(15,30,28,0.18)", overflow: "hidden",
                transformOrigin: "top left",
                opacity: deptMenuOpen ? 1 : 0,
                transform: deptMenuOpen ? "scale(1) translateY(0)" : "scale(0.96) translateY(-4px)",
                pointerEvents: deptMenuOpen ? "auto" : "none",
              }}
            >
                  {departments.map((d) => {
                    const ro = !deptEditable(d.id);
                    return (
                    <button key={d.id} onClick={() => { setDeptMenuOpen(false); switchDept(d.id); }} style={{
                      fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8, width: "100%",
                      padding: "10px 14px", border: "none", background: d.id === deptId ? T.mist : "#fff",
                      fontSize: 13.5, fontWeight: d.id === deptId ? 700 : 500, cursor: "pointer", textAlign: "left",
                    }}>
                      {d.id === deptId ? <Check size={14} color={T.lagoon} /> : <span style={{ width: 14 }} />}
                      <span style={{ flex: 1 }}>{d.name}</span>
                      {ro && <span title="View-only on your current plan" style={{ fontSize: 11, color: "#A5731B", background: "#FBF1DC", border: "1px solid #E7D9B8", borderRadius: 999, padding: "1px 7px", fontWeight: 700 }}>🔒 View only</span>}
                    </button>
                  );})}
                  <div style={{ borderTop: `1px solid ${T.line}` }}>
                    {!locked && (
                      <button onClick={() => { setDeptMenuOpen(false); addDepartment(); }} style={{
                        fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8, width: "100%",
                        padding: "10px 14px", border: "none", background: "#fff", fontSize: 13,
                        fontWeight: 600, color: T.lagoon, cursor: "pointer", textAlign: "left",
                      }}><Plus size={14} /> Add department</button>
                    )}
                    <button onClick={() => { setDeptMenuOpen(false); renameDepartment(); }} style={{
                      fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8, width: "100%",
                      padding: "10px 14px", border: "none", background: "#fff", fontSize: 13,
                      fontWeight: 600, cursor: "pointer", textAlign: "left",
                    }}><Pencil size={14} /> Rename this department</button>
                    {!locked && departments.length > 1 && (
                      <button onClick={() => { setDeptMenuOpen(false); deleteDepartment(); }} style={{
                        fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8, width: "100%",
                        padding: "10px 14px", border: "none", background: "#fff", fontSize: 13,
                        fontWeight: 600, color: T.coral, cursor: "pointer", textAlign: "left",
                      }}><Trash2 size={14} /> Delete this department</button>
                    )}
                  </div>
                </div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 20, margin: 0, letterSpacing: -0.3 }}>{data.title}</h1>
            <span className="dr-tagline" style={{ fontSize: 12.5, color: "#9FC3BD" }}>duty rota &amp; non-official day tracker</span>
            {saveStatus === "saving" && <span style={{ fontSize: 12, color: "#9FC3BD" }}>Saving…</span>}
            {saveStatus === "saved" && <span style={{ fontSize: 12, color: T.leaf }}>✓ Saved</span>}
            <UndoRedoButtons history={history} style={{ alignSelf: "center" }} />
          </div>
          {viewData.logo && <img className="dr-logo" src={viewData.logo} alt="" style={{ height: 62, maxWidth: 230, objectFit: "contain", flexShrink: 0 }} />}
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
        {saveStatus === "error" && (
          <div className="dr-anim-in" style={{
            background: "#FBEAE7", border: "1px solid #F1B8AE", borderRadius: 10,
            padding: "12px 16px", marginBottom: 16, fontSize: 13.5, color: "#8A2E1E",
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}>
            <span style={{ flex: "1 1 260px" }}>
              ⚠ <strong>Your last change did not save.</strong> Check your internet connection —
              your edits are still shown here, but they have not reached the server yet.
              Please don't close this tab until it saves.
            </span>
            <button onClick={retrySave} style={{
              background: T.coral, color: "#fff", fontWeight: 700, fontSize: 12.5,
              padding: "8px 15px", borderRadius: 7, border: "none", cursor: "pointer", whiteSpace: "nowrap",
            }}>
              Try saving again
            </button>
          </div>
        )}
        {currentDeptLocked && (
          <div className="dr-anim-in" style={{
            background: "#FFF8E7", border: "1px solid #EBDCB2", borderRadius: 10,
            padding: "12px 16px", marginBottom: 16, fontSize: 13.5, color: "#7A6320",
            display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
          }}>
            <span style={{ flex: "1 1 260px" }}>
              🔒 This department is <strong>view-only</strong> on your current plan
              (includes {departmentLimit} department{departmentLimit === 1 ? "" : "s"}).
              You can still view and export it. Upgrade to edit it again.
            </span>
            <a href={`https://wa.me/9607666261?text=${encodeURIComponent("Hi! I'd like to upgrade my DutyRota plan for more departments.")}`}
               target="_blank" rel="noreferrer"
               style={{ background: "#0F8B7E", color: "#fff", fontWeight: 700, fontSize: 12.5, padding: "8px 15px", borderRadius: 7, textDecoration: "none", whiteSpace: "nowrap" }}>
              Upgrade on WhatsApp
            </a>
          </div>
        )}
        <WelcomeGuide data={data} update={update} setTab={setTab} />
        {tab === "rota" && <WeekRota data={data} update={update} staffEditable={staffEditable} weekStart={weekStart} setWeekStart={setWeekStart} days={rotaDays} rotaView={rotaView} setRotaView={setRotaView} monthRange={monthRange} setMonthRange={setMonthRange} onExport={() => setPrintView({ kind: "rota" })} />}
        {tab === "records" && <Records data={data} range={range} setRange={setRange} onExport={() => setPrintView({ kind: "records" })} />}
        {tab === "stats" && <Stats data={data} range={statRange} setRange={setStatRange} onExport={() => setPrintView({ kind: "stats" })} />}
        {tab === "insights" && <InsightsTab data={data} onExport={(cfg) => setPrintView({ kind: "insights", cfg })} />}
        {tab === "staff" && <StaffTab data={data} update={update} staffLimit={staffLimit} readonlyStaffIds={readonlyStaffIds} staffEditable={staffEditable} />}
        {tab === "requests" && (
          <RequestsTab
            data={data} update={update} staffEditable={staffEditable}
            T={T} Card={Card} Btn={Btn} Field={Field}
            inputStyle={inputStyle} th={th} td={td} uid={uid} dstr={dstr}
          />
        )}
        {tab === "smart" && (
          features?.smart_roster === false ? (
            /* Trial ended and not on a plan that includes Smart Roster. The
               data is untouched — they can still see and export everything.
               If they subscribe, the feature reappears with no migration. */
            <Card>
              <h2 style={{ fontFamily: "Sora, sans-serif", fontSize: 18, margin: "0 0 8px",
                           display: "flex", alignItems: "center", gap: 10 }}>
                Smart Roster
                <span style={{ fontSize: 11, fontWeight: 700, background: "#E6E4F5",
                  color: "#4E4A8C", border: "1px solid #C4C0E8",
                  borderRadius: 999, padding: "2px 9px", letterSpacing: 0.3 }}>BETA</span>
                <span style={{ fontSize: 11, fontWeight: 700, background: "#FBF1DC",
                  color: "#8A5A0F", border: "1px solid #E7D9B8",
                  borderRadius: 999, padding: "2px 9px", letterSpacing: 0.3 }}>Plus</span>
              </h2>
              <p style={{ fontSize: 13.5, color: T.inkSoft, margin: "0 0 6px" }}>
                Smart Roster is available on the <strong>Plus plan</strong> and above. It generates
                a full week automatically, covers every shift, and improves the result until nothing
                is left uncovered.
              </p>
              <p style={{ fontSize: 13, color: T.inkSoft, margin: "0 0 18px" }}>
                Your rota data is safe — subscribe any time to keep editing and to unlock Smart Roster.
              </p>
              <a href={`https://wa.me/9607666261?text=${encodeURIComponent(
                "Hi! I'd like to upgrade my DutyRota plan to get Smart Roster.")}`}
                target="_blank" rel="noreferrer"
                style={{ background: T.lagoon, color: "#fff", fontWeight: 700, fontSize: 13.5,
                  padding: "10px 20px", borderRadius: 8, textDecoration: "none",
                  display: "inline-flex", alignItems: "center", gap: 8 }}>
                Upgrade on WhatsApp
              </a>
            </Card>
          ) : (
            <SmartRosterTab
              data={data} update={update} staffEditable={staffEditable}
              T={T} Card={Card} Btn={Btn} Field={Field}
              inputStyle={inputStyle} th={th} td={td} uid={uid} dstr={dstr}
              onApplied={(sunday) => { setWeekStart(sunday); setRotaView("weekly"); setTab("rota"); }}
            />
          )
        )}
        {tab === "settings" && <SettingsTab data={data} update={update} canUseLogo={features ? features.company_logo : true} />}
        {tab === "help" && <HelpTab data={data} />}
      </main>
    </div>
  );
}

/* ─────────────────── Duty code picker ───────────────────
   Click a cell to open a panel: filter/pick a code, add a note, or add a
   brand-new code without leaving the rota. Chips are finger-sized.       */
const NEW_CODE_COLORS = ["#F4B860", "#8FBF6B", "#6FA8DC", "#8E7CC3", "#E4604E", "#4DB6AC", "#F06292", "#A1887F", "#9575CD", "#4DD0E1"];

function CodePicker({ value, codes, onPick, cellBg, cellFg, hasCode, note, onNote, onAddCode, eveningEnabled, exchange, onExchange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("pick"); // 'pick' | 'note' | 'add' | 'swap'
  const [noteText, setNoteText] = useState(note || "");
  const [nc, setNc] = useState({ code: "", label: "", color: NEW_CODE_COLORS[0], counts: "morning" });
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const [pos, setPos] = useState(null);

  const current = codes.find((c) => c.id === value);
  const q = query.trim().toLowerCase();
  const filtered = q ? codes.filter((c) => c.code.toLowerCase().includes(q)) : codes;
  const ordered = q
    ? [...filtered].sort((a, b) => {
        const ax = a.code.toLowerCase() === q ? 0 : a.code.toLowerCase().startsWith(q) ? 1 : 2;
        const bx = b.code.toLowerCase() === q ? 0 : b.code.toLowerCase().startsWith(q) ? 1 : 2;
        return ax - bx;
      })
    : filtered;

  const PANEL_W = 244, PANEL_H = 330;
  const openPanel = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.min(Math.max(8, r.left + r.width / 2 - PANEL_W / 2), window.innerWidth - PANEL_W - 8);
      const below = r.bottom + PANEL_H < window.innerHeight;
      setPos({ left, top: below ? r.bottom + 4 : undefined, bottom: below ? undefined : window.innerHeight - r.top + 4 });
    }
    setQuery(""); setMode("pick"); setNoteText(note || "");
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 10);
  };
  const close = () => { setOpen(false); setQuery(""); setMode("pick"); };
  const pick = (id) => { onPick(id); close(); };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) close(); };
    // The panel is position:fixed with coordinates worked out when it opened, so
    // it has to close if the page scrolls behind it. Scrolling the code list
    // inside the panel is not that — ignore those.
    const onScroll = (e) => { if (!wrapRef.current?.contains(e.target)) close(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const onKey = (e) => {
    if (e.key === "Escape") { close(); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      if (q === "" || q === "-") pick("");
      else if (ordered.length > 0) pick(ordered[0].id);
    }
  };

  const saveNote = () => { onNote(noteText); close(); };
  const saveNewCode = () => {
    const c = nc.code.trim();
    if (!c) return;
    const id = onAddCode({ code: c, label: nc.label.trim() || c, color: nc.color, counts: nc.counts });
    onPick(id); // apply the new code to this cell straight away
    close();
  };

  const CATS = [
    ["morning", "Morning"], ["afternoon", "Afternoon"],
    ...(eveningEnabled ? [["evening", "Evening"]] : []), ["night", "Night"],
    ["other", "Other duty"], ["release", "Release duty"], ["off", "Off day"],
    ["sl", "Sick leave (SL)"], ["frl", "Family related leave (FRL)"],
    ["ml", "Medical leave (ML)"], ["leave", "Other leave"],
  ];
  const btnMini = { fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "6px 9px", borderRadius: 7, border: "none" };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button onClick={open ? close : openPanel} style={{
        fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, width: "100%", minWidth: 74,
        padding: "7px 4px", borderRadius: 7, border: `1px solid ${hasCode ? "transparent" : T.line}`,
        background: cellBg, color: cellFg, cursor: "pointer", textAlign: "center", outline: "none", position: "relative",
        boxShadow: open ? `0 0 0 2px ${T.lagoon}` : "none",
      }}>
        {current ? current.code : "—"}
        {/* small blue dot marks a cell that has a note */}
        {note && <span title="Has a note" style={{ position: "absolute", top: 2, right: 2, width: 7, height: 7, borderRadius: "50%", background: "#2F6DB5", border: "1px solid #fff" }} />}
        {/* icon marks a duty changed from the original: person = staff asked,
            briefcase = manager changed it */}
        {exchange && (() => {
          const cfg = EXCHANGE_BY[exchange.requestedBy];
          const Icon = cfg.icon;
          return (
            <span title={cfg.label} style={{
              position: "absolute", bottom: 1, left: 2, width: 14, height: 14, borderRadius: "50%",
              background: "#fff", border: `1px solid ${cfg.color}`, color: cfg.color,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}><Icon size={9} /></span>
          );
        })()}
      </button>

      {open && pos && (
        <div style={{
          position: "fixed", zIndex: 40, left: pos.left, top: pos.top, bottom: pos.bottom,
          width: PANEL_W, boxSizing: "border-box", background: "#fff", border: `1px solid ${T.line}`, borderRadius: 10,
          boxShadow: "0 8px 28px rgba(20,43,51,0.18)", padding: 8, overflowWrap: "break-word", wordBreak: "break-word",
        }}>
          {mode === "pick" && (
            <>
              <div style={{ maxHeight: 190, overflowY: "auto", display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 7 }}>
                <button onClick={() => pick("")} style={{ ...btnMini, padding: "7px 11px", border: `1px dashed ${T.line}`, background: "#fff", color: T.inkSoft, minWidth: 44 }}>—</button>
                {ordered.map((c, i) => (
                  <button key={c.id} onClick={() => pick(c.id)} style={{ ...btnMini, padding: "7px 11px", minWidth: 44, border: q && i === 0 ? `2px solid ${T.ink}` : "1px solid transparent", background: c.color, color: textOn(c.color) }}>{c.code}</button>
                ))}
                {ordered.length === 0 && <div style={{ fontSize: 12, color: T.inkSoft, padding: "8px 4px" }}>No code matches "{query}"</div>}
              </div>
              <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder="Type to search… Enter = pick"
                style={{ width: "100%", boxSizing: "border-box", padding: "7px 9px", border: `1px solid ${T.line}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit", outline: "none", marginBottom: 7 }} />
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setMode("note")} style={{ ...btnMini, flex: 1, background: note ? "#E7F0FA" : T.mist, color: note ? "#2F6DB5" : T.ink, border: `1px solid ${T.line}` }}>
                  {note ? "✎ Edit note" : "+ Note"}
                </button>
                <button onClick={() => setMode("add")} style={{ ...btnMini, flex: 1, background: T.mist, color: T.ink, border: `1px solid ${T.line}` }}>+ New code</button>
              </div>
              <button onClick={() => setMode("swap")} style={{
                ...btnMini, width: "100%", marginTop: 6,
                background: exchange ? EXCHANGE_BY[exchange.requestedBy].bg : T.mist,
                color: exchange ? EXCHANGE_BY[exchange.requestedBy].color : T.ink,
                border: `1px solid ${T.line}`, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                <ArrowLeftRight size={12} />
                {exchange ? `Changed · ${EXCHANGE_BY[exchange.requestedBy].short}` : "Mark as changed"}
              </button>
            </>
          )}

          {mode === "note" && (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Note for this duty</div>
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} autoFocus rows={3}
                placeholder="e.g. Left after 4 hours · swapped with Mariyam"
                style={{ width: "100%", boxSizing: "border-box", padding: "7px 9px", border: `1px solid ${T.line}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit", outline: "none", resize: "vertical" }} />
              <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
                <button onClick={() => setMode("pick")} style={{ ...btnMini, flex: 1, background: "#fff", color: T.inkSoft, border: `1px solid ${T.line}` }}>Back</button>
                <button onClick={saveNote} style={{ ...btnMini, flex: 1, background: T.lagoon, color: "#fff" }}>Save note</button>
              </div>
            </div>
          )}

          {mode === "add" && (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>New duty code</div>
              <input value={nc.code} onChange={(e) => setNc({ ...nc, code: e.target.value })} autoFocus placeholder="Short code (e.g. M/N)"
                style={{ width: "100%", boxSizing: "border-box", padding: "7px 9px", border: `1px solid ${T.line}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit", outline: "none", marginBottom: 6 }} />
              <input value={nc.label} onChange={(e) => setNc({ ...nc, label: e.target.value })} placeholder="Full name (optional)"
                style={{ width: "100%", boxSizing: "border-box", padding: "7px 9px", border: `1px solid ${T.line}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit", outline: "none", marginBottom: 6 }} />
              <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 4 }}>Counts as</div>
              <select value={nc.counts} onChange={(e) => setNc({ ...nc, counts: e.target.value })}
                style={{ width: "100%", boxSizing: "border-box", padding: "7px 9px", border: `1px solid ${T.line}`, borderRadius: 7, fontSize: 12.5, fontFamily: "inherit", outline: "none", marginBottom: 8, cursor: "pointer" }}>
                {CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 4 }}>Colour</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 9 }}>
                {NEW_CODE_COLORS.map((col) => (
                  <button key={col} onClick={() => setNc({ ...nc, color: col })} style={{ width: 22, height: 22, borderRadius: 6, background: col, cursor: "pointer", border: nc.color === col ? `2px solid ${T.ink}` : "1px solid #ccc" }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setMode("pick")} style={{ ...btnMini, flex: 1, background: "#fff", color: T.inkSoft, border: `1px solid ${T.line}` }}>Back</button>
                <button onClick={saveNewCode} disabled={!nc.code.trim()} style={{ ...btnMini, flex: 1, background: nc.code.trim() ? T.lagoon : "#B9CDCA", color: "#fff", cursor: nc.code.trim() ? "pointer" : "not-allowed" }}>Add &amp; use</button>
              </div>
              <div style={{ fontSize: 11, color: T.inkSoft, marginTop: 7 }}>You can rename or recolour it later in Settings.</div>
            </div>
          )}

          {mode === "swap" && (
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 4 }}>Duty changed from original</div>
              <div style={{ fontSize: 11.5, color: T.inkSoft, marginBottom: 8, lineHeight: 1.5 }}>
                {exchange
                  ? `Currently marked as: ${EXCHANGE_BY[exchange.requestedBy].label}. Original duty was ${codes.find((c) => c.id === exchange.originalCode)?.code || "—"}.`
                  : `Records that this duty differs from what was originally rostered. The current duty (${current ? current.code : "—"}) is kept as the original.`}
              </div>
              {!exchange && (
                <div style={{ fontSize: 12.5, color: "#8A5A0F", background: "#FBF1DC", border: "1px solid #E7D9B8", borderRadius: 6, padding: "8px 9px", marginBottom: 8, lineHeight: 1.5, display: "flex", gap: 6, alignItems: "flex-start" }}>
                  <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ minWidth: 0 }}><strong>Mark first, then change the duty</strong> — that way the original is saved correctly.</span>
                </div>
              )}
              {["staff", "manager"].map((who) => {
                const cfg = EXCHANGE_BY[who];
                const Icon = cfg.icon;
                const on = exchange?.requestedBy === who;
                return (
                  <button key={who} onClick={() => { onExchange(who); close(); }} style={{
                    ...btnMini, width: "100%", marginBottom: 6, padding: "9px 10px",
                    background: on ? cfg.bg : "#fff", color: on ? cfg.color : T.ink,
                    border: on ? `2px solid ${cfg.color}` : `1px solid ${T.line}`,
                    display: "flex", alignItems: "center", gap: 8,
                  }}>
                    <Icon size={14} /> {cfg.label}{on ? " ✓" : ""}
                  </button>
                );
              })}
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button onClick={() => setMode("pick")} style={{ ...btnMini, flex: 1, background: "#fff", color: T.inkSoft, border: `1px solid ${T.line}` }}>Back</button>
                {exchange && (
                  <button onClick={() => { onExchange(null); close(); }} style={{ ...btnMini, flex: 1, background: "#FBEAE7", color: T.coral, border: `1px solid ${T.line}` }}>
                    Clear mark
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────── Weekly rota grid ─────────────────── */
function WeekRota({ data, update, staffEditable = () => true, weekStart, setWeekStart, days, rotaView, setRotaView, monthRange, setMonthRange, onExport }) {
  const codeById = codeByIdOf(data);
  // "See original rota" shows what each changed cell was BEFORE it was
  // exchanged. The whole rota is view-only while this is on, so nobody
  // edits the past by accident.
  const [showOriginal, setShowOriginal] = useState(false);
  // The duty-code legend is collapsed on a phone; this opens it.
  const [legendOpen, setLegendOpen] = useState(false);
  const anyExchanges = days.some((date) =>
    data.staff.some((s) => exchangeOf(data, date, s.id)));

  // While "see original" is on, the summary columns and coverage rows must
  // count the ORIGINAL duties too — otherwise the cells show the old rota
  // while the totals beside them still describe the current one.
  const viewRota = useMemo(() => {
    if (!showOriginal) return data;
    const cells = { ...data.cells };
    Object.entries(data.cellMeta || {}).forEach(([date, dayMeta]) => {
      let day = null;
      Object.entries(dayMeta || {}).forEach(([sid, meta]) => {
        const ex = meta && meta.exchange;
        if (!ex) return;
        if (!day) day = { ...(cells[date] || {}) };
        if (ex.originalCode) day[sid] = ex.originalCode;
        else delete day[sid];
      });
      if (day) cells[date] = day;
    });
    return { ...data, cells };
  }, [data, showOriginal]);

  const spanOf = (a, b) => {
    let n = 0, d = a;
    while (d <= b && n <= 60) { n++; d = addDays(d, 1); }
    return n;
  };
  // Native date inputs fire onChange while you're still typing the year,
  // so any comparison against a value like "0027-06-30" (year 27) would fail.
  // Ignore anything that clearly isn't a real date, then silently clamp
  // rather than throw an alert on every keystroke.
  const looksLikeDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= "1900-01-01";
  const setRange = (start, end) => {
    if (!looksLikeDate(start) || !looksLikeDate(end)) return;
    if (end < start) end = start;
    if (spanOf(start, end) > 45) end = addDays(start, 44);
    setMonthRange({ start, end });
  };
  const shiftRange = (dir) => setMonthRange({
    start: addDays(monthRange.start, dir * days.length),
    end: addDays(monthRange.end, dir * days.length),
  });
  const thisMonth = () => {
    const t = new Date();
    setMonthRange({
      start: dstr(new Date(t.getFullYear(), t.getMonth(), 1)),
      end: dstr(new Date(t.getFullYear(), t.getMonth() + 1, 0)),
    });
  };
  const dateInput = {
    fontFamily: "inherit", fontSize: 12.5, padding: "6px 8px",
    border: `1px solid ${T.line}`, borderRadius: 8, background: "#fff", color: T.ink,
  };

  const setCell = (date, staffId, codeId) => {
    if (!staffEditable(staffId)) {
      alert("This staff member is view-only on your current plan.\n\nUpgrade to assign or change their duties.");
      return;
    }
    update((d) => {
      if (!d.cells[date]) d.cells[date] = {};
      if (codeId) d.cells[date][staffId] = codeId; else delete d.cells[date][staffId];
      return d;
    });
  };

  const setCellNote = (date, staffId, note) => {
    if (!staffEditable(staffId)) {
      alert("This staff member is view-only on your current plan.\n\nUpgrade to edit their duties.");
      return;
    }
    update((d) => {
      if (!d.cellMeta) d.cellMeta = {};
      if (!d.cellMeta[date]) d.cellMeta[date] = {};
      if (!d.cellMeta[date][staffId]) d.cellMeta[date][staffId] = {};
      const t = (note || "").trim();
      if (t) d.cellMeta[date][staffId].note = t;
      else delete d.cellMeta[date][staffId].note;
      // Only drop the whole entry once nothing is left in it — otherwise
      // clearing a note would also wipe an exchange mark on the same cell.
      if (Object.keys(d.cellMeta[date][staffId]).length === 0) delete d.cellMeta[date][staffId];
      return d;
    });
  };

  // Who is on call this date. Independent of that person's own duty cell —
  // they can be on call and have a normal shift the same day.
  const setOnCall = (date, staffId) => {
    update((d) => {
      if (!d.onCall) d.onCall = {};
      if (staffId) d.onCall[date] = staffId; else delete d.onCall[date];
      return d;
    });
  };

  // Mark / unmark this duty as changed from the original.
  //   who = "staff" | "manager" -> mark it (remembering the current code)
  //   who = null                -> clear the mark
  // The original code is only captured the FIRST time a cell is marked, so
  // switching between staff/manager later never loses the true original.
  const setExchange = (date, staffId, who) => {
    if (!staffEditable(staffId)) {
      alert("This staff member is view-only on your current plan.\n\nUpgrade to edit their duties.");
      return;
    }
    update((d) => {
      if (!d.cellMeta) d.cellMeta = {};
      if (!d.cellMeta[date]) d.cellMeta[date] = {};
      if (!d.cellMeta[date][staffId]) d.cellMeta[date][staffId] = {};
      const entry = d.cellMeta[date][staffId];
      if (!who) {
        delete entry.exchange;
      } else {
        const existing = entry.exchange;
        entry.exchange = {
          originalCode: existing ? existing.originalCode : ((d.cells[date] || {})[staffId] || ""),
          requestedBy: who,
        };
      }
      if (Object.keys(entry).length === 0) delete d.cellMeta[date][staffId];
      return d;
    });
  };

  const addCode = (codeObj) => {
    const created = { ...codeObj, id: uid() };
    update((d) => { d.codes = [...d.codes, created]; return d; });
    return created.id;
  };

  const toggleNonOfficial = (date) => {
    if (data.fridayRule && parseD(date).getDay() === FRIDAY) return;
    update((d) => {
      d.nonOfficial = d.nonOfficial.includes(date)
        ? d.nonOfficial.filter((x) => x !== date)
        : [...d.nonOfficial, date].sort();
      return d;
    });
  };

  const range = `${niceDate(days[0])} – ${niceDate(days[days.length - 1])}`;
  const shownStaff = staffForDays(data, days);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "inline-flex", border: `1px solid ${T.line}`, borderRadius: 8, overflow: "hidden" }}>
            {["weekly", "monthly"].map((v) => (
              <button key={v} onClick={() => {
                if (v === rotaView) return;
                if (v === "weekly") setWeekStart(startOfWeek(dstr(new Date()), data.weekStartsOn ?? 0));
                setRotaView(v);
              }} style={{
                fontFamily: "inherit", padding: "6px 13px", fontSize: 12.5, fontWeight: 700,
                border: "none", cursor: "pointer",
                background: rotaView === v ? T.lagoon : "#fff",
                color: rotaView === v ? "#fff" : T.inkSoft,
              }}>{v === "weekly" ? "Weekly" : "Monthly"}</button>
            ))}
          </div>
          {rotaView === "weekly" ? (
            <>
              <Btn kind="ghost" small onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft size={15} /></Btn>
              <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 15 }}>{range}</div>
              <Btn kind="ghost" small onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight size={15} /></Btn>
              <Btn kind="ghost" small onClick={() => setWeekStart(startOfWeek(dstr(new Date()), data.weekStartsOn ?? 0))}>Today</Btn>
            </>
          ) : (
            <>
              <Btn kind="ghost" small onClick={() => shiftRange(-1)}><ChevronLeft size={15} /></Btn>
              <input type="date" style={dateInput} value={monthRange.start}
                onChange={(e) => setRange(e.target.value, monthRange.end)} />
              <span style={{ color: T.inkSoft }}>–</span>
              <input type="date" style={dateInput} value={monthRange.end}
                onChange={(e) => setRange(monthRange.start, e.target.value)} />
              <Btn kind="ghost" small onClick={() => shiftRange(1)}><ChevronRight size={15} /></Btn>
              <Btn kind="ghost" small onClick={thisMonth}>This month</Btn>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* Kept visible while the toggle is ON even if this range has no
              exchanges — otherwise navigating to a clean week would hide the
              only way back out of view-only mode. */}
          {(anyExchanges || showOriginal) && (
            <Btn kind="ghost" small onClick={() => setShowOriginal((v) => !v)}
              style={showOriginal ? { background: "#E7F0FA", color: "#2F6DB5", border: "1px solid #B9D3EE" } : undefined}>
              {showOriginal ? <><RotateCcw size={14} /> Back to current</> : <><Eye size={14} /> See original rota</>}
            </Btn>
          )}
          <Btn kind="ghost" small onClick={onExport}><Printer size={14} /> Export PDF</Btn>
        </div>
      </div>

      <div>
        <div className={`dr-legend${legendOpen ? " dr-open" : ""}`}
          style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
          {data.codes.map((c) => (
            <span key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, color: T.inkSoft }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: c.color, border: `1px solid ${T.line}` }} />
              {c.code}
            </span>
          ))}
        </div>
        {/* Only rendered at all on a narrow screen — see .dr-legend-toggle. */}
        <button className="dr-legend-toggle" onClick={() => setLegendOpen((v) => !v)}
          style={{ color: T.lagoon, marginTop: 4 }}>
          {legendOpen ? "Hide codes" : `All ${data.codes.length} codes`}
          {legendOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {showOriginal && (
        <div style={{
          background: "#E7F0FA", border: "1px solid #B9D3EE", borderRadius: 10,
          padding: "10px 14px", fontSize: 13, color: "#2F6DB5",
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        }}>
          <Eye size={15} />
          <span style={{ flex: 1 }}>
            Showing the <strong>original rota</strong> — duties as they were before any exchange.
            Changed cells are outlined, and the totals and coverage rows count the original duties too.
            Editing is paused while this view is on.
          </span>
        </div>
      )}

      {/* The text is wrapped in one span so it stays a single sentence. Without
          it, each text node becomes its own flex column and gets squeezed into
          a narrow, unreadable stack on a phone. */}
      <div style={{ fontSize: 12.5, color: T.inkSoft, display: "flex", alignItems: "flex-start", gap: 6, lineHeight: 1.5 }}>
        <Coins size={13} color={T.sand} style={{ flexShrink: 0, marginTop: 2 }} />
        <span style={{ minWidth: 0 }}>
          Gold headers are <strong>non-official days</strong>{data.fridayRule ? " (all Fridays, plus any date you tap to toggle)" : " (tap a day header to toggle)"}. Duty on those days counts for payment.
        </span>
      </div>

      <Card style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1120 }}>
          <thead>
            <tr>
              <th className="rota-num" style={th}>#</th>
              <th className="rota-name" style={th}>NAME</th>
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
              {["M", "A", ...(data.eveningEnabled ? ["E"] : []), "N", "OD", "RD", "OFF"].map((h) => (
                <th key={h} style={{ ...th, textAlign: "center", background: "#F4F8F7" }}>{h}</th>
              ))}
              <th style={{ ...th, textAlign: "center", background: "#FBF1DC", color: "#A5731B" }}>NON-OFF DUTY</th>
            </tr>
          </thead>
          <tbody>
            {shownStaff.map((s, i) => {
              const segs = weekSegments(s, days);
              const t = weekTotalsFor(viewRota, s, days);
              return (
                <tr key={s.id}>
                  <td className="rota-num" style={{ ...td, fontWeight: 700, fontSize: 12, color: T.inkSoft }}>{i + 1}</td>
                  <td className="rota-name" style={{ ...td, fontWeight: 600 }}>
                    {s.name}
                    {s.designation && (
                      <span className="rota-desig" style={{ color: T.inkSoft, fontWeight: 500 }}> — {s.designation}</span>
                    )}
                  </td>
                  {segs.map((seg, i2) => {
                    if (seg.kind === "notEmployed") {
                      return (
                        <td key={`ne${i2}`} colSpan={seg.span} style={{ ...td, textAlign: "center", background: "#F2F4F5", color: "#9AA5AB", fontSize: 11.5, fontStyle: "italic" }}>
                          {seg.span >= 2 ? (seg.before ? "Not yet joined" : "Left") : "—"}
                        </td>
                      );
                    }
                    if (seg.kind === "leave") {
                      const st = styleFor(seg.period);
                      return (
                        <td key={`l${i2}`} colSpan={seg.span} style={{ ...td, textAlign: "center", background: st.bg, color: st.fg, fontWeight: 700, letterSpacing: seg.span > 1 ? 1 : 0 }}>
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
                    const meta = cellMetaOf(data, date, s.id);
                    const ex = meta?.exchange || null;
                    // In "see original" mode a changed cell shows what it was
                    // before the exchange; unchanged cells look the same.
                    const liveCodeId = (data.cells[date] || {})[s.id] || "";
                    const codeId = showOriginal && ex ? (ex.originalCode || "") : liveCodeId;
                    const code = codeById(codeId);
                    const bg = code ? code.color : isNonOff(data, date) ? "#FDF8EE" : "#fff";
                    if (showOriginal) {
                      // Read-only rendering: no picker, so the past can't be edited.
                      return (
                        <td key={date} style={{ ...td, padding: 3, textAlign: "center" }}>
                          <div title={ex ? `Original duty (${EXCHANGE_BY[ex.requestedBy].label})` : ""} style={{
                            fontSize: 12.5, fontWeight: 700, minWidth: 74, padding: "7px 4px", borderRadius: 7,
                            border: ex ? "1px dashed #2F6DB5" : `1px solid ${code ? "transparent" : T.line}`,
                            background: bg, color: code ? textOn(code.color) : T.inkSoft,
                            opacity: ex ? 1 : 0.55,
                          }}>{code ? code.code : "—"}</div>
                        </td>
                      );
                    }
                    return (
                      <td key={date} style={{ ...td, padding: 3, textAlign: "center" }}>
                        <CodePicker
                          value={codeId}
                          codes={data.codes}
                          eveningEnabled={data.eveningEnabled}
                          onPick={(id) => setCell(date, s.id, id)}
                          cellBg={bg}
                          cellFg={code ? textOn(code.color) : T.inkSoft}
                          hasCode={!!code}
                          note={meta?.note || ""}
                          onNote={(txt) => setCellNote(date, s.id, txt)}
                          onAddCode={addCode}
                          exchange={ex}
                          onExchange={(who) => setExchange(date, s.id, who)}
                        />
                      </td>
                    );
                  })}
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, background: "#FEF7E8" }}>{t.morning}</td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, background: "#F0F7EA" }}>{t.afternoon}</td>
                  {data.eveningEnabled && <td style={{ ...td, textAlign: "center", fontWeight: 700, background: "#FBEEE9" }}>{t.evening}</td>}
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, background: "#EBF3FB" }}>{t.night}</td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, background: "#F0EBF8" }}>{t.other}</td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700, background: "#F7EFE7" }}>{t.release}</td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 700 }}>{t.off}</td>
                  <td style={{ ...td, textAlign: "center", fontWeight: 800, background: "#FBF1DC", color: "#A5731B" }}>{t.nonOfficialDuty}</td>
                </tr>
              );
            })}
            <tr>
              <td className="rota-num" style={{ ...td, fontWeight: 700, fontSize: 12, color: T.inkSoft }} />
              <td className="rota-name" style={{ ...td, fontWeight: 700, color: "#A5731B" }}>On-call</td>
              {days.map((date) => {
                const picked = data.onCall?.[date] || "";
                const pickedStaff = picked ? data.staff.find((x) => x.id === picked) : null;
                // Who was actually employed on this specific date, same as staffForDays.
                const onCallStaff = data.staff.filter((s) => isEmployedOn(s, date));
                if (showOriginal) {
                  return (
                    <td key={date} style={{ ...td, padding: 3, textAlign: "center" }}>
                      <div style={{
                        fontSize: 12, fontWeight: 700, minWidth: 74, padding: "7px 4px", borderRadius: 7,
                        border: `1px solid ${T.line}`, background: "#FDF8EE",
                        color: pickedStaff ? T.ink : T.inkSoft, opacity: pickedStaff ? 1 : 0.55,
                      }}>{pickedStaff ? shortName(pickedStaff.name) : "—"}</div>
                    </td>
                  );
                }
                return (
                  <td key={date} style={{ ...td, padding: 3, textAlign: "center" }}>
                    <select
                      value={picked}
                      onChange={(e) => setOnCall(date, e.target.value)}
                      title="On-call for this day"
                      style={{
                        fontFamily: "inherit", fontSize: 12, fontWeight: 700, width: "100%", minWidth: 74,
                        padding: "6px 4px", borderRadius: 7, border: `1px solid ${T.line}`,
                        background: "#FDF8EE", color: pickedStaff ? T.ink : T.inkSoft, cursor: "pointer",
                      }}
                    >
                      <option value="">—</option>
                      {onCallStaff.map((s) => (
                        <option key={s.id} value={s.id}>{shortName(s.name)}</option>
                      ))}
                    </select>
                  </td>
                );
              })}
              <td colSpan={data.eveningEnabled ? 8 : 7} style={{ ...td, background: "#fff" }} />
            </tr>
          </tbody>
          <tfoot>
            {[["MORNING", "morning", "#F4B860"], ["AFTERNOON", "afternoon", "#8FBF6B"],
              ...(data.eveningEnabled ? [["EVENING", "evening", "#E58E77"]] : []), ["NIGHT", "night", "#6FA8DC"],
              ...(data.codes.some((c) => c.counts === "other") ? [["OTHER DUTY", "other", "#8E7CC3"]] : [])].map(([label, cat, color]) => (
              <tr key={cat}>
                <td colSpan={2} className="rota-foot-label" style={{ ...td, background: color, color: textOn(color), fontWeight: 800, fontSize: 12 }}>{label}</td>
                {days.map((date) => (
                  <td key={date} style={{ ...td, textAlign: "center", fontWeight: 700, background: color + "33" }}>{dayCountFor(viewRota, date, cat)}</td>
                ))}
                <td colSpan={data.eveningEnabled ? 8 : 7} style={{ ...td, background: "#fff" }} />
              </tr>
            ))}
          </tfoot>
        </table>
      </Card>
      <div style={{ fontSize: 12.5, color: T.inkSoft }}>
        Showing <strong>{shownStaff.length}</strong> staff for this range. The numbers down the left match the printed rota, so you can refer to a row by its number. On a phone the designation is hidden to leave room for the days — it still appears on every PDF and image export.
      </div>
      <div style={{ fontSize: 12.5, color: T.inkSoft }}>
        RD (release duty) counts as duty for the staff member — including for non-official day payment — but not in this unit's shift coverage rows. Annual leave and maternity are set in the <strong>Staff</strong> tab and appear as merged bands.
      </div>
    </div>
  );
}

/* ─────────────────── Staff records (date range) ─────────────────── */
function Records({ data, range, setRange, onExport }) {
  const [open, setOpen] = useState(null);
  const valid = range.from && range.to && range.from <= range.to;
  const rows = useMemo(() => valid ? recordsFor(data, range.from, range.to) : [], [data, range, valid]);

  const cols = ["#", "Staff", "M", "A", ...(data.eveningEnabled ? ["E"] : []), "N", "OD", "RD", "Total duty", "Off", "Fri off", "AL", "SL", "FRL", "ML", "Other leave", "Non-off duty", ""];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, flexWrap: "wrap", justifyContent: "space-between" }}>
        <RangePicker range={range} setRange={setRange} />
        <Btn kind="ghost" small onClick={onExport} disabled={!valid}><Printer size={14} /> Export PDF</Btn>
      </div>
      {!valid && <div style={{ fontSize: 13, color: T.coral }}>Pick a valid date range ("From" must be on or before "To").</div>}

      {valid && (
        <Card style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1060 }}>
            <thead>
              <tr>
                {cols.map((h, i) => (
                  <th key={h + i} style={{ ...th, textAlign: h === "Staff" ? "left" : "center", background: h === "Non-off duty" ? "#FBF1DC" : undefined, color: h === "Non-off duty" ? "#A5731B" : th.color }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <React.Fragment key={r.staff.id}>
                  <tr>
                    <td style={{ ...td, textAlign: "center", fontWeight: 700, fontSize: 12, color: T.inkSoft }}>{i + 1}</td>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {displayName(r.staff)}
                      {r.staff.endDate && (
                        <span style={{ marginLeft: 8, fontSize: 11.5, background: "#ECEFF0", color: "#5A6B72", borderRadius: 999, padding: "3px 9px", fontWeight: 700 }}>
                          left {shortDate(r.staff.endDate)}
                        </span>
                      )}
                      {r.maternityDays > 0 && <span style={{ marginLeft: 8 }}><LeaveChip type="maternity" /></span>}
                      {r.annualDays > 0 && <span style={{ marginLeft: 8 }}><LeaveChip type="annual" /></span>}
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>{r.morning}</td>
                    <td style={{ ...td, textAlign: "center" }}>{r.afternoon}</td>
                    {data.eveningEnabled && <td style={{ ...td, textAlign: "center" }}>{r.evening}</td>}
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
        AL, and all other leave periods, count every calendar day in the period (Fridays, Saturdays, and non-official days included). SL, FRL, and ML are counted from rota codes — each code’s "Counts as" setting decides which column it feeds, so a code like N/FRL can count as FRL. "Other leave" covers leave codes set to Other leave, plus pre-maternity, emergency, and other extended leave periods.
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
    Morning: r.morning, Afternoon: r.afternoon, Evening: r.evening, Night: r.night, "Other duty": r.other, Release: r.release,
  }));
  const nonOffByStaff = rows.map((r) => ({ name: shortName(r.staff.name), days: r.nonOfficialDuty }));
  // Chart 1: how many DISTINCT staff have each leave-period type overlapping the range
  const overlaps = (p) => p.start <= range.to && p.end >= range.from;
  const staffOnLeaveType = (type) =>
    rows.filter((r) => (r.staff.leavePeriods || []).some((p) => p.type === type && overlaps(p))).length;
  const leaveTypeData = [
    { name: "Annual", value: staffOnLeaveType("annual"), color: "#0F8B7E" },
    { name: "Maternity", value: staffOnLeaveType("maternity"), color: "#9AA5AB" },
    { name: "Pre-maternity", value: staffOnLeaveType("prematernity"), color: "#9C3D6E" },
    { name: "Emergency", value: staffOnLeaveType("emergency"), color: "#E4604E" },
    { name: "Other ext.", value: staffOnLeaveType("other"), color: "#6C7BD9" },
  ];
  const anyLeaveByType = leaveTypeData.some((x) => x.value > 0);

  // Chart 2: leave days by category across the range
  const leaveCodesTaken = leaveTakenFrom(rows);
  const anyLeaveCodes = leaveCodesTaken.length > 0;

  const coverage = useMemo(() => {
    if (!valid) return [];
    const dates = datesBetween(range.from, range.to);
    if (dates.length > 92) return null; // too long to chart daily
    return dates.map((date) => ({
      date: shortDate(date),
      Morning: dayCountFor(data, date, "morning"),
      Afternoon: dayCountFor(data, date, "afternoon"),
      Evening: dayCountFor(data, date, "evening"),
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
          <Card style={{ flex: "1 1 100%", minWidth: 320 }}>
            <h3 style={{ margin: "0 0 10px", fontFamily: "Sora, sans-serif", fontSize: 15 }}>Duties per staff</h3>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={dutyByStaff} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={T.line} />
                {/* Names are rotated upright: with a long staff list they collide
                    when laid flat, and recharts silently drops the ones that
                    don't fit. interval={0} keeps every name on the axis. */}
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-90} textAnchor="end" height={72} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Morning" stackId="a" fill="#F4B860" />
                <Bar dataKey="Afternoon" stackId="a" fill="#8FBF6B" />
                {data.eveningEnabled && <Bar dataKey="Evening" stackId="a" fill="#E58E77" />}
                <Bar dataKey="Night" stackId="a" fill="#6FA8DC" />
                <Bar dataKey="Other duty" stackId="a" fill="#8E7CC3" />
                <Bar dataKey="Release" stackId="a" fill="#C08552" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Card style={{ flex: "1 1 280px", minWidth: 260 }}>
            <h3 style={{ margin: "0 0 10px", fontFamily: "Sora, sans-serif", fontSize: 15 }}>Staff on leave (by type)</h3>
            {!anyLeaveByType ? (
              <div style={{ fontSize: 13, color: T.inkSoft, padding: "40px 0", textAlign: "center" }}>No leave periods in this range.</div>
            ) : (
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={leaveTypeData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.line} />
                  {/* Angled so "Pre-maternity" and "Emergency" don't collide on a phone */}
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-40} textAnchor="end" height={66} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v} staff`, "On leave"]} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {leaveTypeData.map((x) => <Cell key={x.name} fill={x.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card style={{ flex: "1 1 280px", minWidth: 260 }}>
            <h3 style={{ margin: "0 0 10px", fontFamily: "Sora, sans-serif", fontSize: 15 }}>Leave taken <span style={{ fontSize: 12, color: T.inkSoft, fontWeight: 600 }}>(days by category)</span></h3>
            {!anyLeaveCodes ? (
              <div style={{ fontSize: 13, color: T.inkSoft, padding: "40px 0", textAlign: "center" }}>No leave recorded in this range.</div>
            ) : (
              <ResponsiveContainer width="100%" height={270}>
                <BarChart data={leaveCodesTaken} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.line} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-40} textAnchor="end" height={66} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`${v}×`, "Taken"]} />
                  <Bar dataKey="value" fill="#6C7BD9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Card style={{ flex: "1 1 100%", minWidth: 300 }}>
            <h3 style={{ margin: "0 0 10px", fontFamily: "Sora, sans-serif", fontSize: 15 }}>Non-official duties per staff <span style={{ fontSize: 12, color: "#A5731B", fontWeight: 600 }}>(paid days)</span></h3>
            {nonOffByStaff.length === 0 ? (
              <div style={{ fontSize: 13, color: T.inkSoft, padding: "40px 0", textAlign: "center" }}>No staff in this range.</div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(140, nonOffByStaff.length * 30 + 30)}>
                <BarChart data={nonOffByStaff} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={T.line} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} interval={0} />
                  <Tooltip formatter={(v) => [`${v} day(s)`, "Non-official duty"]} />
                  <Bar dataKey="days" fill="#D9A93F" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Card style={{ flex: "1 1 100%", minWidth: 320 }}>
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
                  {data.eveningEnabled && <Line type="monotone" dataKey="Evening" stroke="#D0694F" dot={false} strokeWidth={2} />}
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

function RotaPrint({ data, days }) {
  const codeById = codeByIdOf(data);
  const shownStaff = staffForDays(data, days);
  // Collect notes shown this week, numbered, to list under the rota
  const noteList = [];
  const noteNum = (date, staffId) => {
    const m = cellMetaOf(data, date, staffId);
    if (!m?.note) return null;
    const staff = data.staff.find((x) => x.id === staffId);
    noteList.push({ n: noteList.length + 1, who: staff?.name || "", date, note: m.note });
    return noteList.length;
  };
  return (
    <div>
      <style>{days.length > 10
        ? "@page { size: A4 landscape; margin: 10mm; }"
        : "@page { size: A4 portrait; margin: 10mm; }"}</style>
      <div className="rp-head">
        <div style={{ textAlign: "center", fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 16 }}>{data.title}</div>
        {data.logo && <img className="rp-logo" src={data.logo} alt="" />}
      </div>
      <div style={{ textAlign: "center", fontSize: 12, color: "#555", marginBottom: 10 }}>
        {days.length === 7 ? "Weekly" : "Monthly"} Duty Rota · {niceDate(days[0])} – {niceDate(days[days.length - 1])} · {shownStaff.length} staff
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...pth, width: 24 }}>#</th>
            <th style={{ ...pth, textAlign: "left" }}>NAME &amp; DESIGNATION</th>
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
            {["M", "A", ...(data.eveningEnabled ? ["E"] : []), "N", "OD", "RD", "OFF", "NON-OFF DUTY"].map((h) => <th key={h} style={pth}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {shownStaff.map((s, i) => {
            const segs = weekSegments(s, days);
            const t = weekTotalsFor(data, s, days);
            return (
              <tr key={s.id}>
                <td style={{ ...ptd, fontWeight: 700, color: "#666" }}>{i + 1}</td>
                <td style={{ ...ptd, textAlign: "left", fontWeight: 700 }}>{displayName(s)}</td>
                {segs.map((seg, i2) => {
                  if (seg.kind === "notEmployed") {
                    return (
                      <td key={`ne${i2}`} colSpan={seg.span} style={{ ...ptd, background: "#F2F4F5", color: "#888", fontStyle: "italic" }}>
                        {seg.span >= 2 ? (seg.before ? "Not yet joined" : "Left") : "—"}
                      </td>
                    );
                  }
                  if (seg.kind === "leave") {
                    const st = styleFor(seg.period);
                    return (
                      <td key={`l${i2}`} colSpan={seg.span} style={{ ...ptd, background: st.bg, fontWeight: 700, letterSpacing: seg.span > 1 ? 1 : 0 }}>
                        {seg.span >= 3 ? st.label : st.abbrev}
                        {seg.span >= 3 && (
                          <span style={{ fontWeight: 500, letterSpacing: 0, marginLeft: 6, fontSize: 8.5 }}>
                            ({niceDate(seg.period.start)} – {niceDate(seg.period.end)})
                          </span>
                        )}
                      </td>
                    );
                  }
                  const code = codeById((data.cells[seg.date] || {})[s.id]);
                  const num = noteNum(seg.date, s.id);
                  const ex = exchangeOf(data, seg.date, s.id);
                  return (
                    <td key={seg.date} style={{ ...ptd, background: code ? code.color : "#fff", color: code ? textOn(code.color) : "#999", fontWeight: 700, position: "relative" }}>
                      {code ? code.code : ""}
                      {num && <sup style={{ fontSize: 8 }}>{num}</sup>}
                      {/* S = staff asked for the change, M = manager changed it */}
                      {ex && <sup style={{ fontSize: 8, marginLeft: 1 }}>{ex.requestedBy === "manager" ? "M" : "S"}</sup>}
                    </td>
                  );
                })}
                <td style={ptd}>{t.morning}</td>
                <td style={ptd}>{t.afternoon}</td>
                {data.eveningEnabled && <td style={ptd}>{t.evening}</td>}
                <td style={ptd}>{t.night}</td>
                <td style={ptd}>{t.other}</td>
                <td style={ptd}>{t.release}</td>
                <td style={ptd}>{t.off}</td>
                <td style={{ ...ptd, background: "#F6E3B4", fontWeight: 800 }}>{t.nonOfficialDuty}</td>
              </tr>
            );
          })}
          <tr>
            <td style={{ ...ptd, fontWeight: 700, color: "#666" }} />
            <td style={{ ...ptd, textAlign: "left", fontWeight: 700, color: "#8A5E10" }}>ON-CALL</td>
            {days.map((date) => {
              const picked = data.onCall?.[date] || "";
              const pickedStaff = picked ? data.staff.find((x) => x.id === picked) : null;
              return (
                <td key={date} style={{ ...ptd, background: "#FDF8EE", fontWeight: 700 }}>
                  {pickedStaff ? shortName(pickedStaff.name) : ""}
                </td>
              );
            })}
            <td colSpan={data.eveningEnabled ? 8 : 7} style={{ border: "none" }} />
          </tr>
        </tbody>
        <tfoot>
          {[["MORNING", "morning", "#F4B860"], ["AFTERNOON", "afternoon", "#8FBF6B"],
            ...(data.eveningEnabled ? [["EVENING", "evening", "#E58E77"]] : []), ["NIGHT", "night", "#6FA8DC"],
            ...(data.codes.some((c) => c.counts === "other") ? [["OTHER DUTY", "other", "#8E7CC3"]] : [])].map(([label, cat, color]) => (
            <tr key={cat}>
              <td colSpan={2} style={{ ...ptd, textAlign: "left", background: color, color: textOn(color), fontWeight: 800 }}>{label}</td>
              {days.map((date) => <td key={date} style={ptd}>{dayCountFor(data, date, cat)}</td>)}
              <td colSpan={data.eveningEnabled ? 8 : 7} style={{ border: "none" }} />
            </tr>
          ))}
        </tfoot>
      </table>
      <div style={{ fontSize: 10, color: "#666", marginTop: 8 }}>
        Legend: {data.codes.map((c) => `${c.code} = ${c.label}`).join(" · ")} · AL = Annual leave · MAT = Maternity · PML = Pre-maternity · EL = Emergency leave
        <br />Superscript <strong>S</strong> = duty changed at staff request · <strong>M</strong> = duty changed by manager
      </div>
      {noteList.length > 0 && (
        <div style={{ marginTop: 10, border: "1px solid #ccc", borderRadius: 6, padding: "8px 10px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Notes</div>
          {noteList.map((x) => (
            <div key={x.n} style={{ fontSize: 10.5, color: "#333", marginBottom: 2 }}>
              <sup>{x.n}</sup> {x.who}, {shortDate(x.date)}: {x.note}
            </div>
          ))}
        </div>
      )}
      {noteList.length > 0 && (
        <div style={{ fontSize: 9.5, color: "#888", marginTop: 6 }}>
          Superscript numbers refer to the notes above.
        </div>
      )}
      <div style={{ fontSize: 10, color: "#666", marginTop: 8 }}>{exportGeneratedAt()}</div>
    </div>
  );
}

function RecordsPrint({ data, from, to }) {
  const rows = recordsFor(data, from, to);
  const cols = ["#", "Staff", "M", "A", ...(data.eveningEnabled ? ["E"] : []), "N", "OD", "RD", "Total duty", "Off", "Fri off", "AL", "SL", "FRL", "ML", "Other leave", "Non-off duty"];
  return (
    <div>
      <div className="rp-head">
        <div style={{ textAlign: "center", fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 16 }}>{data.title}</div>
        {data.logo && <img className="rp-logo" src={data.logo} alt="" />}
      </div>
      <div style={{ textAlign: "center", fontSize: 12, color: "#555", marginBottom: 10 }}>
        Staff Duty &amp; Leave Record · {niceDate(from)} – {niceDate(to)} · {rows.length} staff
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
          {rows.map((r, i) => (
            <tr key={r.staff.id}>
              <td style={{ ...ptd, fontWeight: 700, color: "#666" }}>{i + 1}</td>
              <td style={{ ...ptd, textAlign: "left", fontWeight: 700 }}>{displayName(r.staff)}{r.staff.endDate ? ` (left ${shortDate(r.staff.endDate)})` : ""}{r.maternityDays > 0 ? " (Maternity)" : ""}</td>
              <td style={ptd}>{r.morning}</td>
              <td style={ptd}>{r.afternoon}</td>
              {data.eveningEnabled && <td style={ptd}>{r.evening}</td>}
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
                <th style={{ ...pth, textAlign: "left" }}>Dates &amp; duties</th>
                <th style={pth}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => r.nonOfficialDates.length > 0).map((r) => (
                <tr key={r.staff.id}>
                  <td style={{ ...ptd, textAlign: "left", fontWeight: 700 }}>{displayName(r.staff)}</td>
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
        All leave periods count calendar days.
      </div>
      <div style={{ fontSize: 10, color: "#666", marginTop: 4 }}>{exportGeneratedAt()}</div>
    </div>
  );
}

function StatsPrint({ data, from, to }) {
  const rows = recordsFor(data, from, to);
  const dutyByStaff = rows.map((r) => ({
    name: shortName(r.staff.name),
    Morning: r.morning, Afternoon: r.afternoon, Evening: r.evening, Night: r.night, "Other duty": r.other, Release: r.release,
  }));
  const nonOffByStaff = rows.map((r) => ({ name: shortName(r.staff.name), days: r.nonOfficialDuty }));
  const overlaps = (p) => p.start <= to && p.end >= from;
  const staffOnLeaveType = (type) =>
    rows.filter((r) => (r.staff.leavePeriods || []).some((p) => p.type === type && overlaps(p))).length;
  const leaveTypeData = [
    { name: "Annual", value: staffOnLeaveType("annual"), color: "#0F8B7E" },
    { name: "Maternity", value: staffOnLeaveType("maternity"), color: "#9AA5AB" },
    { name: "Pre-mat.", value: staffOnLeaveType("prematernity"), color: "#9C3D6E" },
    { name: "Emergency", value: staffOnLeaveType("emergency"), color: "#E4604E" },
    { name: "Other ext.", value: staffOnLeaveType("other"), color: "#6C7BD9" },
  ];
  const anyLeaveByType = leaveTypeData.some((x) => x.value > 0);
  const leaveCodesTaken = leaveTakenFrom(rows);
  const anyLeaveCodes = leaveCodesTaken.length > 0;
  const dates = datesBetween(from, to);
  const coverage = dates.length > 92 ? null : dates.map((date) => ({
    date: shortDate(date),
    Morning: dayCountFor(data, date, "morning"),
    Afternoon: dayCountFor(data, date, "afternoon"),
    Evening: dayCountFor(data, date, "evening"),
    Night: dayCountFor(data, date, "night"),
  }));
  const totals = {
    duty: rows.reduce((a, r) => a + r.totalDuty, 0),
    nonOff: rows.reduce((a, r) => a + r.nonOfficialDuty, 0),
    leave: rows.reduce((a, r) => a + r.annualDays + r.maternityDays + r.sl + r.frl + r.ml + r.otherLeave, 0),
    off: rows.reduce((a, r) => a + r.off, 0),
  };
  // breakInside keeps a chart card whole — without it a tall card leaves an
  // empty box on one page and its chart on the next.
  const box = { border: "1px solid #BBB", borderRadius: 8, padding: 10, background: "#fff", breakInside: "avoid", pageBreakInside: "avoid" };
  const chartTitle = { fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 12, margin: "0 0 6px" };

  return (
    <div>
      <div className="rp-head">
        <div style={{ textAlign: "center", fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 16 }}>{data.title}</div>
        {data.logo && <img className="rp-logo" src={data.logo} alt="" />}
      </div>
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

      {/* Duties per staff gets its own row — with a long staff list and upright
          names it needs the full width. The two leave charts pair on the next. */}
      <div style={{ marginBottom: 12 }}>
        <div style={box}>
          <h4 style={chartTitle}>Duties per staff</h4>
          <BarChart width={980} height={280} data={dutyByStaff} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#DDD" />
            <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-90} textAnchor="end" height={72} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="Morning" stackId="a" fill="#F4B860" isAnimationActive={false} />
            <Bar dataKey="Afternoon" stackId="a" fill="#8FBF6B" isAnimationActive={false} />
            {data.eveningEnabled && <Bar dataKey="Evening" stackId="a" fill="#E58E77" isAnimationActive={false} />}
            <Bar dataKey="Night" stackId="a" fill="#6FA8DC" isAnimationActive={false} />
            <Bar dataKey="Other duty" stackId="a" fill="#8E7CC3" isAnimationActive={false} />
            <Bar dataKey="Release" stackId="a" fill="#C08552" isAnimationActive={false} />
          </BarChart>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ ...box, flex: 1 }}>
          <h4 style={chartTitle}>Staff on leave (by type)</h4>
          {!anyLeaveByType ? (
            <div style={{ fontSize: 11, color: "#666", padding: "40px 0", textAlign: "center" }}>No leave periods in this range.</div>
          ) : (
            <BarChart width={470} height={250} data={leaveTypeData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DDD" />
              <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-40} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Bar dataKey="value" isAnimationActive={false}>
                {leaveTypeData.map((x) => <Cell key={x.name} fill={x.color} />)}
              </Bar>
            </BarChart>
          )}
        </div>
        <div style={{ ...box, flex: 1 }}>
          <h4 style={chartTitle}>Leave taken (days by category)</h4>
          {!anyLeaveCodes ? (
            <div style={{ fontSize: 11, color: "#666", padding: "40px 0", textAlign: "center" }}>No leave recorded in this range.</div>
          ) : (
            <BarChart width={470} height={250} data={leaveCodesTaken} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DDD" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-40} textAnchor="end" height={60} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
              <Bar dataKey="value" fill="#6C7BD9" isAnimationActive={false} />
            </BarChart>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ ...box }}>
          <h4 style={chartTitle}>Non-official duties per staff (paid days)</h4>
          <BarChart width={720} height={Math.max(120, nonOffByStaff.length * 24 + 24)} data={nonOffByStaff} layout="vertical" margin={{ left: 10, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#DDD" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 9 }} interval={0} />
            <Bar dataKey="days" fill="#D9A93F" isAnimationActive={false} />
          </BarChart>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
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
              {data.eveningEnabled && <Line type="monotone" dataKey="Evening" stroke="#D0694F" dot={false} strokeWidth={2} isAnimationActive={false} />}
              <Line type="monotone" dataKey="Night" stroke="#4A82BC" dot={false} strokeWidth={2} isAnimationActive={false} />
            </LineChart>
          )}
        </div>
      </div>
      <div style={{ fontSize: 10, color: "#666", marginTop: 8 }}>{exportGeneratedAt()}</div>
    </div>
  );
}

/* ─────────────────── Staff tab ─────────────────── */
function StaffTab({ data, update, staffLimit = null, readonlyStaffIds = null, staffEditable = () => true }) {
  const empty = { name: "", designation: "", contact: "", recc: "", licence: "", startDate: "", endDate: "", leavePeriods: [] };
  const [form, setForm] = useState(null);
  const [showFormer, setShowFormer] = useState(false);
  const npEmpty = { type: "annual", label: "", start: "", end: "" };
  const [np, setNp] = useState(npEmpty);

  const save = () => {
    if (!form.name.trim()) return;
    if (form.id && !staffEditable(form.id)) {
      alert("This staff member is view-only on your current plan.\n\nUpgrade to edit their details.");
      return;
    }
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      alert("Last working day cannot be before the joining date.");
      return;
    }
    update((d) => {
      if (form.id) { const i = d.staff.findIndex((s) => s.id === form.id); d.staff[i] = form; }
      else d.staff.push({ ...form, id: uid() });
      return d;
    });
    setForm(null); setNp(npEmpty);
  };
  const remove = (id) => {
    const s = data.staff.find((x) => x.id === id);
    const ok = window.confirm(
      `Permanently delete ${s?.name || "this staff member"}?\n\n` +
      "This erases all their past duties, so old rotas and statistics will no longer be correct.\n\n" +
      "If they have left, set a \"Last working day\" instead — that keeps the history."
    );
    if (!ok) return;
    update((d) => {
      d.staff = d.staff.filter((x) => x.id !== id);
      Object.values(d.cells).forEach((day) => delete day[id]);
      // Notes and exchange marks live in a parallel map — clear those too, or
      // they linger in the saved data forever with no owner.
      Object.values(d.cellMeta || {}).forEach((day) => delete day[id]);
      // On-call picks live in their own map too — same reason.
      if (d.onCall) Object.keys(d.onCall).forEach((date) => { if (d.onCall[date] === id) delete d.onCall[date]; });
      return d;
    });
  };
  // Quick action: mark someone as having left today
  const markLeft = (id) => {
    const today = dstr(new Date());
    const s = data.staff.find((x) => x.id === id);
    if (!window.confirm(`Set ${s?.name}'s last working day to today (${niceDate(today)})?\n\nTheir past duties and statistics are kept.`)) return;
    update((d) => {
      const i = d.staff.findIndex((x) => x.id === id);
      d.staff[i] = { ...d.staff[i], endDate: today };
      return d;
    });
  };
  const reactivate = (id) => update((d) => {
    const i = d.staff.findIndex((x) => x.id === id);
    d.staff[i] = { ...d.staff[i], endDate: "" };
    return d;
  });

  // Move a staff member up/down. Swaps with the previous/next VISIBLE person,
  // so hidden former staff never trap someone in place.
  const move = (id, dir) => update((d) => {
    const visibleIds = (showFormer ? d.staff : d.staff.filter((s) => !isFormer(s))).map((s) => s.id);
    const vPos = visibleIds.indexOf(id);
    const targetId = visibleIds[vPos + dir];
    if (targetId === undefined) return d; // already at the edge
    const a = d.staff.findIndex((s) => s.id === id);
    const b = d.staff.findIndex((s) => s.id === targetId);
    [d.staff[a], d.staff[b]] = [d.staff[b], d.staff[a]];
    return d;
  });

  const sortAZ = () => {
    if (!window.confirm("Sort all staff alphabetically by name?\n\nThis replaces your current order.")) return;
    update((d) => {
      d.staff = [...d.staff].sort((x, y) => x.name.localeCompare(y.name));
      return d;
    });
  };

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

  const activeStaff = data.staff.filter((s) => !isFormer(s));
  const formerStaff = data.staff.filter((s) => isFormer(s));
  // Keep original array order so the up/down arrows behave predictably
  const visibleStaff = showFormer ? data.staff : activeStaff;

  const lockedCount = readonlyStaffIds ? readonlyStaffIds.size : 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {lockedCount > 0 && (
        <div style={{
          background: "#FFF8E7", border: "1px solid #EBDCB2", borderRadius: 10,
          padding: "12px 16px", fontSize: 13.5, color: "#7A6320",
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}>
          <span style={{ flex: "1 1 260px" }}>
            🔒 <strong>{lockedCount}</strong> staff member{lockedCount === 1 ? " is" : "s are"} view-only
            on your current plan (includes {staffLimit} staff). They still appear in the rota and exports,
            but can't be edited or reassigned. Upgrade to edit everyone again.
          </span>
          <a href={`https://wa.me/9607666261?text=${encodeURIComponent("Hi! I'd like to upgrade my DutyRota plan for more staff.")}`}
             target="_blank" rel="noreferrer"
             style={{ background: "#0F8B7E", color: "#fff", fontWeight: 700, fontSize: 12.5, padding: "8px 15px", borderRadius: 7, textDecoration: "none", whiteSpace: "nowrap" }}>
            Upgrade on WhatsApp
          </a>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ margin: 0, fontFamily: "Sora, sans-serif", fontSize: 18 }}>Staff ({activeStaff.length})</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {formerStaff.length > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, color: T.inkSoft, cursor: "pointer" }}>
              <input type="checkbox" checked={showFormer} onChange={(e) => setShowFormer(e.target.checked)}
                style={{ accentColor: T.lagoon, width: 15, height: 15 }} />
              Show former staff ({formerStaff.length})
            </label>
          )}
          {data.staff.length > 1 && (
            <Btn kind="ghost" small onClick={sortAZ}><ArrowDownAZ size={14} /> Sort A–Z</Btn>
          )}
          {(() => {
            const atLimit = staffLimit != null && activeStaff.length >= staffLimit;
            return atLimit ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12.5, color: "#7A6320", background: "#FFF8E7", border: "1px solid #EBDCB2", borderRadius: 7, padding: "6px 11px", fontWeight: 600 }}>
                  🔒 {staffLimit}-staff limit reached
                </span>
                <a href={`https://wa.me/9607666261?text=${encodeURIComponent("Hi! I'd like to upgrade my DutyRota plan for more staff.")}`}
                   target="_blank" rel="noreferrer"
                   style={{ background: "#0F8B7E", color: "#fff", fontWeight: 700, fontSize: 12, padding: "7px 13px", borderRadius: 7, textDecoration: "none", whiteSpace: "nowrap" }}>
                  Upgrade
                </a>
              </div>
            ) : (
              <Btn onClick={() => setForm(empty)}><Plus size={15} /> Add staff</Btn>
            );
          })()}
        </div>
      </div>

      {form && (
        <Card className="dr-anim-in">
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            <Field label="Name"><input style={inputStyle} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Aminath Ali" /></Field>
            <Field label="Designation (optional)"><input style={inputStyle} value={form.designation || ""} onChange={(e) => setForm({ ...form, designation: e.target.value })} placeholder="e.g. Staff Nurse" /></Field>
            <Field label="Contact no."><input style={inputStyle} value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
            <Field label="RECC no."><input style={inputStyle} value={form.recc} onChange={(e) => setForm({ ...form, recc: e.target.value })} /></Field>
            <Field label="Licence expiry"><input type="date" style={inputStyle} value={form.licence} onChange={(e) => setForm({ ...form, licence: e.target.value })} /></Field>
          </div>

          <div style={{ marginTop: 16, borderTop: `1px solid ${T.line}`, paddingTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Employment dates</div>
            <div style={{ fontSize: 12, color: T.inkSoft, marginBottom: 10 }}>
              Leave blank if unknown. Both dates are inclusive — they work on their joining day and on their last working day.
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field label="Joining date (optional)">
                <input type="date" style={{ ...inputStyle, width: "auto" }} value={form.startDate || ""}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </Field>
              <Field label="Last working day (if they have left)">
                <input type="date" style={{ ...inputStyle, width: "auto" }} value={form.endDate || ""}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </Field>
              {form.endDate && (
                <Btn kind="ghost" small onClick={() => setForm({ ...form, endDate: "" })}>
                  <X size={13} /> Clear (still working)
                </Btn>
              )}
            </div>
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
                  <option value="other">Other extended leave (custom name)</option>
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
                const counted = spanDays(p.start, p.end);
                return (
                  <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: st.bg, color: st.fg, borderRadius: 8, padding: "5px 10px", fontSize: 12.5, fontWeight: 600 }}>
                    {st.label}: {niceDate(p.start)} – {niceDate(p.end)}
                    {` (${counted}d)`}
                    <button onClick={() => removePeriod(p.id)} style={{ background: "none", border: "none", cursor: "pointer", color: st.fg, display: "flex", padding: 0 }}><X size={13} /></button>
                  </span>
                );
              })}
            </div>
            <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 8 }}>
              Every leave type counts calendar days — Fridays, Saturdays, and non-official days inside a period are all counted.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <Btn onClick={save}><Check size={15} /> {form.id ? "Save changes" : "Add staff"}</Btn>
            <Btn kind="ghost" onClick={() => { setForm(null); setNp(npEmpty); }}>Cancel</Btn>
          </div>
        </Card>
      )}

      <Card style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
          <thead>
            <tr>{["#", "Name", "Designation", "Contact", "RECC no.", "Licence expiry", "Employment", "Leave periods", "Status", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {visibleStaff.map((s, idx) => {
              const today = onLeaveToday(s);
              const gone = isFormer(s);
              const arrowStyle = (disabled) => ({
                background: "transparent", border: `1px solid ${T.line}`, borderRadius: 6,
                width: 24, height: 20, display: "flex", alignItems: "center", justifyContent: "center",
                cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.3 : 1,
                color: T.ink, padding: 0,
              });
              const atTop = idx === 0;
              const atBottom = idx === visibleStaff.length - 1;
              return (
                <tr key={s.id} style={gone ? { background: "#FAFBFB", opacity: 0.72 } : undefined}>
                  <td style={{ ...td, padding: "6px 8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, color: T.inkSoft, fontWeight: 700, minWidth: 14 }}>{idx + 1}</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <button title="Move up" disabled={atTop} onClick={() => move(s.id, -1)} style={arrowStyle(atTop)}>
                          <ChevronUp size={13} />
                        </button>
                        <button title="Move down" disabled={atBottom} onClick={() => move(s.id, 1)} style={arrowStyle(atBottom)}>
                          <ChevronDown size={13} />
                        </button>
                      </div>
                    </div>
                  </td>
                  <td style={{ ...td, fontWeight: 600 }}>{s.name}</td>
                  <td style={{ ...td, color: s.designation ? T.ink : T.inkSoft }}>{s.designation || "—"}</td>
                  <td style={td}>{s.contact}</td>
                  <td style={td}>{s.recc}</td>
                  <td style={{ ...td, color: gone ? T.inkSoft : licenceSoon(s) ? T.coral : T.ink, fontWeight: !gone && licenceSoon(s) ? 700 : 400 }}>
                    {s.licence ? niceDate(s.licence) : "—"}{!gone && licenceSoon(s) && " ⚠"}
                  </td>
                  <td style={{ ...td, fontSize: 12 }}>
                    {s.startDate ? `From ${shortDate(s.startDate)}` : "—"}
                    {s.endDate && <><br /><span style={{ color: "#B3532F", fontWeight: 600 }}>Left {shortDate(s.endDate)}</span></>}
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
                  <td style={td}>{gone
                    ? <span style={{ fontSize: 11.5, background: "#ECEFF0", color: "#5A6B72", borderRadius: 999, padding: "3px 9px", fontWeight: 700 }}>Former staff</span>
                    : !staffEditable(s.id)
                    ? <span title="View-only on your current plan" style={{ fontSize: 11.5, background: "#FBF1DC", color: "#A5731B", border: "1px solid #E7D9B8", borderRadius: 999, padding: "3px 9px", fontWeight: 700 }}>🔒 View only</span>
                    : today
                    ? <LeaveChip period={today} />
                    : <span style={{ fontSize: 11.5, background: "#E8F5EC", color: T.leaf, borderRadius: 999, padding: "3px 9px", fontWeight: 700 }}>Active</span>}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <Btn kind="ghost" small disabled={!staffEditable(s.id)} onClick={() => { if (staffEditable(s.id)) setForm(s); }} style={{ marginRight: 6 }}><Pencil size={13} /></Btn>
                    {gone
                      ? <Btn kind="ghost" small onClick={() => reactivate(s.id)} style={{ marginRight: 6 }}>Reactivate</Btn>
                      : <Btn kind="ghost" small disabled={!staffEditable(s.id)} onClick={() => markLeft(s.id)} style={{ marginRight: 6 }}>Mark left</Btn>}
                    <Btn kind="danger" small disabled={!staffEditable(s.id)} onClick={() => remove(s.id)}><Trash2 size={13} /></Btn>
                  </td>
                </tr>
              );
            })}
            {visibleStaff.length === 0 && <tr><td colSpan={10} style={{ ...td, textAlign: "center", padding: 24, color: T.inkSoft }}>No staff yet.</td></tr>}
          </tbody>
        </table>
      </Card>
      <div style={{ fontSize: 12.5, color: T.inkSoft }}>
        ⚠ marks licences expiring within 90 days. Annual leave is tracked by leave periods — each staff member's leave renews on their own dates.
      </div>
      <div style={{ fontSize: 12.5, color: T.inkSoft }}>
        Use the ▲ ▼ arrows to set the order staff appear in — this order is used in the weekly rota, records, statistics, and all PDF exports.
      </div>
      <div style={{ fontSize: 12.5, color: T.inkSoft }}>
        When someone resigns or transfers, use <strong>Mark left</strong> (or set a last working day) instead of deleting them.
        They disappear from future rotas, but past rotas, coverage counts, and statistics stay correct. <strong>Delete</strong> erases their history permanently.
      </div>
    </div>
  );
}

/* ─────────────────── Settings tab ─────────────────── */
/* ─────────────────── Help / instructions ─────────────────── */
/* ─────────────────── Insights: counting engine ───────────────────
   For one staff member over a date range, count how many times each
   duty code was worked. Leave days do NOT count as duty (matches the
   rest of the app). Also break each code down by day-of-week and by
   non-official days, so questions like "how many Friday M duties" are
   answerable.                                                        */
const insightsForStaff = (data, staff, from, to) => {
  const codeById = codeByIdOf(data);
  const dates = datesBetween(from, to).filter((d) => isEmployedOn(staff, d));
  // perCode[codeId] = { total, byDow: [7], nonOfficial }
  const perCode = {};
  let leaveDays = 0, emptyDays = 0;
  dates.forEach((date) => {
    if (leaveOn(staff, date)) { leaveDays++; return; }
    const cid = (data.cells[date] || {})[staff.id] || "";
    if (!cid) { emptyDays++; return; }
    const code = codeById(cid);
    if (!code) { emptyDays++; return; }
    if (!perCode[cid]) perCode[cid] = { total: 0, byDow: [0, 0, 0, 0, 0, 0, 0], nonOfficial: 0 };
    perCode[cid].total++;
    perCode[cid].byDow[parseD(date).getDay()]++;
    if (isNonOff(data, date)) perCode[cid].nonOfficial++;
  });
  return { perCode, leaveDays, emptyDays, workingDays: dates.length };
};

// How many times a specific code was worked on a specific day-of-week
// (dow = 0..6, or -1 for "any day") by one staff member in the range.
const comboCount = (data, staff, codeId, dow, from, to) => {
  const dates = datesBetween(from, to).filter((d) => isEmployedOn(staff, d));
  let n = 0;
  dates.forEach((date) => {
    if (leaveOn(staff, date)) return;
    if ((data.cells[date] || {})[staff.id] !== codeId) return;
    if (dow !== -1 && parseD(date).getDay() !== dow) return;
    n++;
  });
  return n;
};

// For one code across ALL staff: who did it most, in the range.
const codeLeaderboard = (data, codeId, from, to) => {
  const dates = datesBetween(from, to);
  return data.staff
    .filter((s) => employedInRange(s, from, to))
    .map((s) => {
      let n = 0;
      dates.forEach((date) => {
        if (!isEmployedOn(s, date)) return;
        if (leaveOn(s, date)) return;
        if ((data.cells[date] || {})[s.id] === codeId) n++;
      });
      return { staff: s, count: n };
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
};

// Duty exchanges per staff member in a date range, split by who asked for
// the change. Counts marks that are CURRENTLY set (clearing a mark removes
// it from these totals), matching how the rest of the app reports.
const exchangesFor = (data, from, to) => {
  const dates = datesBetween(from, to);
  return data.staff
    .filter((s) => employedInRange(s, from, to))
    .map((s) => {
      let staffReq = 0, managerReq = 0;
      dates.forEach((date) => {
        const ex = exchangeOf(data, date, s.id);
        if (!ex) return;
        if (ex.requestedBy === "manager") managerReq++; else staffReq++;
      });
      return { staff: s, staffReq, managerReq, total: staffReq + managerReq };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
};

// Who was on call, and how much of it fell on a paid (non-official) day, per
// staff member employed at some point in the range. Only staff with at least
// one on-call day are returned, matching exchangesFor's pattern above.
const onCallInsights = (data, from, to) => {
  const dates = datesBetween(from, to);
  return data.staff
    .filter((s) => employedInRange(s, from, to))
    .map((s) => {
      let days = 0, paidDays = 0;
      dates.forEach((date) => {
        if (!isEmployedOn(s, date)) return;
        if (data.onCall?.[date] !== s.id) return;
        days++;
        if (isNonOff(data, date)) paidDays++;
      });
      return { staff: s, days, paidDays };
    })
    .filter((r) => r.days > 0)
    .sort((a, b) => b.days - a.days);
};

function InsightsTab({ data, onExport }) {
  const [range, setRange] = useState({ from: monthStart(), to: monthEnd() });
  const [staffId, setStaffId] = useState(data.staff[0]?.id || "");
  const [codeId, setCodeId] = useState(data.codes[0]?.id || "");
  const [comboCode, setComboCode] = useState(data.codes[0]?.id || "");
  const [comboDow, setComboDow] = useState(5); // Friday default
  const [cmpA, setCmpA] = useState(data.staff[0]?.id || "");
  const [cmpB, setCmpB] = useState(data.staff[1]?.id || "");

  const codeById = codeByIdOf(data);
  const staff = data.staff.find((s) => s.id === staffId);
  const result = staff ? insightsForStaff(data, staff, range.from, range.to) : null;
  const rows = result
    ? Object.entries(result.perCode)
        .map(([cid, v]) => ({ code: codeById(cid), ...v }))
        .filter((r) => r.code)
        .sort((a, b) => b.total - a.total)
    : [];

  const leaderboard = codeLeaderboard(data, codeId, range.from, range.to);
  const exchanges = exchangesFor(data, range.from, range.to);
  const onCall = onCallInsights(data, range.from, range.to);
  const combo = data.staff.find((s) => s.id === staffId)
    ? comboCount(data, staff, comboCode, comboDow, range.from, range.to)
    : 0;

  const staffA = data.staff.find((s) => s.id === cmpA);
  const staffB = data.staff.find((s) => s.id === cmpB);
  const resA = staffA ? insightsForStaff(data, staffA, range.from, range.to) : null;
  const resB = staffB ? insightsForStaff(data, staffB, range.from, range.to) : null;
  const cmpCodes = data.codes.filter((c) => (resA?.perCode[c.id]?.total || 0) + (resB?.perCode[c.id]?.total || 0) > 0);

  const selStyle = { ...inputStyle, width: "auto", minWidth: 150, cursor: "pointer" };
  const H = ({ children }) => <h3 style={{ margin: "0 0 12px", fontFamily: "Sora, sans-serif", fontSize: 15 }}>{children}</h3>;
  const dowFull = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <h2 style={{ margin: "0 0 4px", fontFamily: "Sora, sans-serif", fontSize: 20 }}>Insights</h2>
        <p style={{ margin: 0, fontSize: 13, color: T.inkSoft }}>Dig into who did what. Leave days are not counted as duty.</p>
      </div>

      {/* Shared date range */}
      <Card>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="From"><input type="date" style={{ ...inputStyle, width: "auto" }} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="To"><input type="date" style={{ ...inputStyle, width: "auto" }} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
          <Btn kind="ghost" small onClick={() => setRange({ from: monthStart(), to: monthEnd() })}>This month</Btn>
        </div>
      </Card>

      {/* 1 + 2: Per-staff breakdown with Friday / non-official split */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <H>Staff breakdown</H>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select style={selStyle} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
              {data.staff.map((s) => <option key={s.id} value={s.id}>{displayName(s)}{isFormer(s) ? " (former)" : ""}</option>)}
            </select>
            {staff && <Btn kind="ghost" small onClick={() => onExport({ view: "staff", staffId, range })}><Printer size={13} /> PDF</Btn>}
          </div>
        </div>
        {!staff ? <div style={{ color: T.inkSoft, fontSize: 13 }}>No staff yet.</div> : rows.length === 0 ? (
          <div style={{ color: T.inkSoft, fontSize: 13, padding: "20px 0", textAlign: "center" }}>No duties recorded for {displayName(staff)} in this range.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
              <thead><tr>{["Duty code", "Total", "Fridays", "Sat", "Non-official", "Mon", "Tue", "Wed", "Thu", "Sun"].map((h) => <th key={h} style={{ ...th, textAlign: h === "Duty code" ? "left" : "center" }}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code.id}>
                    <td style={{ ...td }}><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: r.code.color }} /><strong>{r.code.code}</strong> <span style={{ color: T.inkSoft, fontSize: 12 }}>{r.code.label}</span></span></td>
                    <td style={{ ...td, textAlign: "center", fontWeight: 700 }}>{r.total}</td>
                    <td style={{ ...td, textAlign: "center", color: r.byDow[5] ? T.ink : T.inkSoft }}>{r.byDow[5]}</td>
                    <td style={{ ...td, textAlign: "center", color: r.byDow[6] ? T.ink : T.inkSoft }}>{r.byDow[6]}</td>
                    <td style={{ ...td, textAlign: "center", fontWeight: 600, color: r.nonOfficial ? "#B3532F" : T.inkSoft }}>{r.nonOfficial}</td>
                    <td style={{ ...td, textAlign: "center", color: T.inkSoft }}>{r.byDow[1]}</td>
                    <td style={{ ...td, textAlign: "center", color: T.inkSoft }}>{r.byDow[2]}</td>
                    <td style={{ ...td, textAlign: "center", color: T.inkSoft }}>{r.byDow[3]}</td>
                    <td style={{ ...td, textAlign: "center", color: T.inkSoft }}>{r.byDow[4]}</td>
                    <td style={{ ...td, textAlign: "center", color: T.inkSoft }}>{r.byDow[0]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 8 }}>
              Worked {result.workingDays} day(s) in range · on leave {result.leaveDays} day(s) · no duty entered {result.emptyDays} day(s).
            </div>
          </div>
        )}
      </Card>

      {/* 4: Specific combo counter */}
      <Card>
        <H>Quick question</H>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 14 }}>
          <span>How many times did</span>
          <select style={selStyle} value={staffId} onChange={(e) => setStaffId(e.target.value)}>
            {data.staff.map((s) => <option key={s.id} value={s.id}>{displayName(s)}</option>)}
          </select>
          <span>do</span>
          <select style={{ ...selStyle, minWidth: 90 }} value={comboCode} onChange={(e) => setComboCode(e.target.value)}>
            {data.codes.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
          </select>
          <span>on a</span>
          <select style={{ ...selStyle, minWidth: 110 }} value={comboDow} onChange={(e) => setComboDow(Number(e.target.value))}>
            <option value={-1}>any day</option>
            {dowFull.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
          <span>?</span>
        </div>
        <div style={{ marginTop: 16, fontSize: 15 }}>
          {staff && <span><strong style={{ fontSize: 22, color: T.lagoon }}>{combo}</strong> time{combo === 1 ? "" : "s"} — {displayName(staff)} did <strong>{codeById(comboCode)?.code}</strong> on {comboDow === -1 ? "any day" : dowFull[comboDow] + "s"} in this range.</span>}
        </div>
      </Card>

      {/* 3: Per-code leaderboard */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <H>Who did a code the most</H>
          <select style={selStyle} value={codeId} onChange={(e) => setCodeId(e.target.value)}>
            {data.codes.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.label}</option>)}
          </select>
        </div>
        {leaderboard.length === 0 ? (
          <div style={{ color: T.inkSoft, fontSize: 13, padding: "16px 0", textAlign: "center" }}>Nobody did {codeById(codeId)?.code} in this range.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {leaderboard.map((r, i) => {
              const max = leaderboard[0].count;
              return (
                <div key={r.staff.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ width: 20, textAlign: "right", fontSize: 12, color: T.inkSoft, fontWeight: 700 }}>{i + 1}</span>
                  <span style={{ width: 160, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName(r.staff)}</span>
                  <div style={{ flex: 1, background: T.mist, borderRadius: 6, height: 22, position: "relative", minWidth: 60 }}>
                    <div style={{ width: `${(r.count / max) * 100}%`, background: codeById(codeId)?.color || T.lagoon, height: "100%", borderRadius: 6, minWidth: 24 }} />
                    <span style={{ position: "absolute", right: 8, top: 0, lineHeight: "22px", fontSize: 12, fontWeight: 700, color: T.ink }}>{r.count}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Duty exchanges */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <H>Duty exchanges</H>
          <div style={{ display: "flex", gap: 12, fontSize: 12, color: T.inkSoft, flexWrap: "wrap" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <User size={13} color={EXCHANGE_BY.staff.color} /> Requested by staff
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Briefcase size={13} color={EXCHANGE_BY.manager.color} /> Changed by manager
            </span>
          </div>
        </div>
        {exchanges.length === 0 ? (
          <div style={{ color: T.inkSoft, fontSize: 13, padding: "16px 0", textAlign: "center" }}>
            No duty exchanges marked in this range.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
              <thead><tr>
                <th style={{ ...th, textAlign: "left" }}>Staff</th>
                <th style={{ ...th, textAlign: "center" }}>By staff</th>
                <th style={{ ...th, textAlign: "center" }}>By manager</th>
                <th style={{ ...th, textAlign: "center" }}>Total</th>
              </tr></thead>
              <tbody>
                {exchanges.map((r) => (
                  <tr key={r.staff.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{displayName(r.staff)}</td>
                    <td style={{ ...td, textAlign: "center", color: r.staffReq ? EXCHANGE_BY.staff.color : T.inkSoft, fontWeight: r.staffReq ? 700 : 400 }}>{r.staffReq}</td>
                    <td style={{ ...td, textAlign: "center", color: r.managerReq ? EXCHANGE_BY.manager.color : T.inkSoft, fontWeight: r.managerReq ? 700 : 400 }}>{r.managerReq}</td>
                    <td style={{ ...td, textAlign: "center", fontWeight: 800 }}>{r.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 8 }}>
              Counts duties currently marked as changed from the original. Clearing a mark removes it from these totals.
            </div>
          </div>
        )}
      </Card>

      {/* On-call */}
      <Card>
        <H>On-call</H>
        {onCall.length === 0 ? (
          <div style={{ color: T.inkSoft, fontSize: 13, padding: "16px 0", textAlign: "center" }}>
            No on-call assignments in this period.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 420 }}>
              <thead><tr>
                <th style={{ ...th, textAlign: "left" }}>Staff</th>
                <th style={{ ...th, textAlign: "center" }}>On-call days</th>
                <th style={{ ...th, textAlign: "center" }}>On-call (non-official days)</th>
              </tr></thead>
              <tbody>
                {onCall.map((r) => (
                  <tr key={r.staff.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{displayName(r.staff)}</td>
                    <td style={{ ...td, textAlign: "center", fontWeight: 700 }}>{r.days}</td>
                    <td style={{ ...td, textAlign: "center", fontWeight: 600, color: r.paidDays ? "#B3532F" : T.inkSoft }}>{r.paidDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 8 }}>
              "On-call (non-official days)" is the subset of on-call days that fell on a non-official day and earned non-official-day payment.
            </div>
          </div>
        )}
      </Card>

      {/* 5: Compare two staff */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
          <H>Compare two staff</H>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select style={{ ...selStyle, minWidth: 130 }} value={cmpA} onChange={(e) => setCmpA(e.target.value)}>
              {data.staff.map((s) => <option key={s.id} value={s.id}>{displayName(s)}</option>)}
            </select>
            <ArrowLeftRight size={16} color={T.inkSoft} />
            <select style={{ ...selStyle, minWidth: 130 }} value={cmpB} onChange={(e) => setCmpB(e.target.value)}>
              {data.staff.map((s) => <option key={s.id} value={s.id}>{displayName(s)}</option>)}
            </select>
          </div>
        </div>
        {!staffA || !staffB ? <div style={{ color: T.inkSoft, fontSize: 13 }}>Pick two staff to compare.</div> : cmpCodes.length === 0 ? (
          <div style={{ color: T.inkSoft, fontSize: 13, padding: "16px 0", textAlign: "center" }}>Neither did any duties in this range.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={{ ...th, textAlign: "left" }}>Duty code</th>
              <th style={{ ...th, textAlign: "center" }}>{displayName(staffA)}</th>
              <th style={{ ...th, textAlign: "center" }}>{displayName(staffB)}</th>
            </tr></thead>
            <tbody>
              {cmpCodes.map((c) => {
                const a = resA.perCode[c.id]?.total || 0, b = resB.perCode[c.id]?.total || 0;
                return (
                  <tr key={c.id}>
                    <td style={td}><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: c.color }} /><strong>{c.code}</strong></span></td>
                    <td style={{ ...td, textAlign: "center", fontWeight: a >= b ? 700 : 400, color: a > b ? T.lagoon : T.ink }}>{a}</td>
                    <td style={{ ...td, textAlign: "center", fontWeight: b >= a ? 700 : 400, color: b > a ? T.lagoon : T.ink }}>{b}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function InsightsPrint({ data, cfg }) {
  const staff = data.staff.find((s) => s.id === cfg.staffId);
  if (!staff) return <div>Staff not found.</div>;
  const codeById = codeByIdOf(data);
  const res = insightsForStaff(data, staff, cfg.range.from, cfg.range.to);
  const rows = Object.entries(res.perCode)
    .map(([cid, v]) => ({ code: codeById(cid), ...v }))
    .filter((r) => r.code)
    .sort((a, b) => b.total - a.total);
  const cols = ["Duty code", "Total", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Non-official"];
  return (
    <div>
      <div className="rp-head">
        <div style={{ textAlign: "center", fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 16 }}>{data.title}</div>
        {data.logo && <img className="rp-logo" src={data.logo} alt="" />}
      </div>
      <div style={{ textAlign: "center", fontSize: 12, color: "#555", marginBottom: 10 }}>
        Duty breakdown — {displayName(staff)} · {niceDate(cfg.range.from)} – {niceDate(cfg.range.to)}
      </div>
      {rows.length === 0 ? (
        <div style={{ textAlign: "center", fontSize: 12, color: "#666", padding: "20px 0" }}>No duties recorded in this range.</div>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead><tr>{cols.map((h) => <th key={h} style={{ ...pth, textAlign: h === "Duty code" ? "left" : "center", background: h === "Non-official" ? "#F6E3B4" : "#E8E8E8" }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code.id}>
                <td style={{ ...ptd, textAlign: "left", fontWeight: 700 }}>{r.code.code} <span style={{ fontWeight: 400, color: "#666" }}>{r.code.label}</span></td>
                <td style={{ ...ptd, fontWeight: 700 }}>{r.total}</td>
                <td style={ptd}>{r.byDow[0]}</td>
                <td style={ptd}>{r.byDow[1]}</td>
                <td style={ptd}>{r.byDow[2]}</td>
                <td style={ptd}>{r.byDow[3]}</td>
                <td style={ptd}>{r.byDow[4]}</td>
                <td style={ptd}>{r.byDow[5]}</td>
                <td style={ptd}>{r.byDow[6]}</td>
                <td style={{ ...ptd, background: "#F6E3B4", fontWeight: 800 }}>{r.nonOfficial}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ fontSize: 11, color: "#666", marginTop: 8 }}>
        Worked {res.workingDays} day(s) · on leave {res.leaveDays} · no duty entered {res.emptyDays}. Leave days are not counted as duty.
      </div>
      <div style={{ fontSize: 10, color: "#666", marginTop: 4 }}>{exportGeneratedAt()}</div>
    </div>
  );
}

const SUPPORT_WHATSAPP = "9607666261"; // +960 Maldives
const SUPPORT_LINK = `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(
  "Hi! I have a question about DutyRota."
)}`;

function HelpTab({ data }) {
  const Section = ({ title, children }) => (
    <Card style={{ marginBottom: 14 }}>
      <h3 style={{ margin: "0 0 10px", fontFamily: "Sora, sans-serif", fontSize: 16, color: T.ink }}>{title}</h3>
      <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "#33474F" }}>{children}</div>
    </Card>
  );
  const Code = ({ children }) => (
    <span style={{ background: T.mist, border: `1px solid ${T.line}`, borderRadius: 5, padding: "1px 7px", fontWeight: 700, fontSize: 12.5, whiteSpace: "nowrap" }}>{children}</span>
  );
  const Step = ({ n, children }) => (
    <div style={{ display: "flex", gap: 11, marginBottom: 9, alignItems: "flex-start" }}>
      <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: T.lagoon, color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
      <span>{children}</span>
    </div>
  );

  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 4px", fontFamily: "Sora, sans-serif", fontSize: 20 }}>How to use DutyRota</h2>
        <p style={{ margin: 0, fontSize: 13.5, color: T.inkSoft }}>A quick guide to setting up and running your duty rota. You can come back here any time.</p>
      </div>

      <Section title="1. Getting started">
        <Step n="1">Go to the <strong>Settings</strong> tab and type your area or ward name in the box at the top. This name shows at the top of every page and on your printed rota.</Step>
        <Step n="2">Go to the <strong>Staff</strong> tab and add each staff member with the <strong>Add staff</strong> button.</Step>
        <Step n="3">Go to the <strong>Weekly Rota</strong> tab and start filling in duties by clicking a cell and choosing a code.</Step>
        <Step n="4">Optional — in <strong>Settings</strong>, upload your organisation&rsquo;s <strong>logo</strong>. It appears at the top right of the app and on every PDF and image you export.</Step>
        <p style={{ marginTop: 10, marginBottom: 0 }}>That&rsquo;s it — your rota saves automatically, and syncs to any device you log in from.</p>
      </Section>

      <Section title="2. Filling in the rota">
        <p style={{ marginTop: 0 }}>In the <strong>Weekly Rota</strong> tab, each staff member has a row and each day has a cell. Click a cell to open the code picker. Use the arrows at the top to move between weeks.</p>
        <p style={{ marginBottom: 10 }}><strong>Weekly or Monthly view.</strong> Use the <strong>Weekly</strong> / <strong>Monthly</strong> buttons at the top left. Weekly shows seven days,
          beginning on whichever day you have set in <strong>Settings</strong> — Sunday by default, or Monday
          if that is how your week runs. Monthly lets you pick any date range up to 45 days — handy for a pay period that runs, say, the 15th to the 15th rather than a calendar month. Use <strong>This month</strong> for the current calendar month, and the arrows to step forward or back by the same length of range. You can edit duties in either view.</p>
        <p style={{ marginBottom: 4 }}><strong>Three fast ways to enter a duty:</strong></p>
        <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
          <li style={{ marginBottom: 5 }}><strong>Tap a colour chip</strong> — quickest on a phone.</li>
          <li style={{ marginBottom: 5 }}><strong>Type and press Enter</strong> — type a letter or two (like <Code>m</Code> or <Code>sl</Code>) and press Enter to pick the top match. Fastest on a laptop.</li>
          <li>Tap <strong>—</strong> to clear a cell.</li>
        </ul>
        <p style={{ marginBottom: 4 }}><strong>Made a mistake?</strong> Use the <strong>Undo</strong> button at the top of the page, or press Ctrl+Z (⌘Z on a Mac). It works for every change anywhere in the app — a duty you overwrote, a deleted code, a staff member you removed, a whole generated week. Hover over the button and it tells you what it will undo. Redo is the arrow beside it.</p>
        <p style={{ marginBottom: 4 }}><strong>Add a note to any duty.</strong> In the picker, tap <strong>+ Note</strong> to jot something like "left after 4 hours" or "swapped with Mariyam". A small blue dot marks cells that have a note, and all notes appear on the printed rota. Notes are just for your record — they don't change any counts.</p>
        <p style={{ marginBottom: 10 }}><strong>Need a code that doesn't exist yet?</strong> Tap <strong>+ New code</strong> right in the picker — give it a name, colour, and what it counts as (morning, night, off, etc.), and it's added and applied straight away. No need to leave the rota. You can rename or recolour it later in Settings.</p>
        <p style={{ marginBottom: 10 }}><strong>Row numbers.</strong> Every staff row is numbered down the left, and the same numbers appear on the printed rota, so you can tell at a glance how many staff are on the rota and refer to a row by its number in a handover or on WhatsApp.</p>
        <p>Your current duty codes (change these any time in Settings):</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {data.codes.map((c) => (
            <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: T.mist, border: `1px solid ${T.line}`, borderRadius: 7, padding: "4px 9px", fontSize: 12.5 }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: c.color, display: "inline-block" }} />
              <strong>{c.label}</strong>
            </span>
          ))}
        </div>
        <p style={{ marginBottom: 0, marginTop: 12 }}>The bottom rows show how many staff are on Morning, Afternoon, and Night each day, so you can see your coverage at a glance. Running a 4-shift roster (e.g. during Ramadan)? Turn on <strong>Evening shift</strong> in Settings and Evening gets its own coverage row, column and “Counts as” option.</p>
      </Section>

      <Section title="3. Non-official days & payment">
        <p style={{ marginTop: 0 }}>Non-official days are days where duty counts for extra payment. There are two ways a day becomes non-official:</p>
        <ul style={{ margin: "6px 0", paddingLeft: 20 }}>
          <li style={{ marginBottom: 5 }}><strong>Fridays</strong> — if the Friday rule is switched on in Settings, every Friday is automatically non-official.</li>
          <li>Any other day you mark by hand — click the small marker on a day's header in the Weekly Rota to toggle it.</li>
        </ul>
        <p style={{ marginBottom: 0 }}>When a staff member works a duty on a non-official day, it's counted toward their non-official day payment in the Staff Records and Statistics.</p>
      </Section>

      <Section title="4. Using the On-call row">
        <p style={{ marginTop: 0 }}>At the bottom of the weekly rota, below your staff, there's an On-call row. For each day, use the dropdown to pick the staff member who is on call. Leave it blank if nobody is on call that day. On-call sits alongside the normal rota, so a person can be on call and also have a shift the same day; it does not replace their duty.</p>
        <p><strong>A note on payment:</strong> on-call is tracked separately from your non-official-day duty payments. Being on call does not add to a person's non-official-day duty count — that count is only for worked shifts. On-call days are recorded on their own.</p>
        <p style={{ marginBottom: 0 }}><strong>Where to see it:</strong> The Insights tab shows a breakdown of on-call — how many days each person was on call, and how many of those fell on non-official days. The On-call row also appears on the printed rota and image exports.</p>
      </Section>

      <Section title="5. Leave — two different kinds">
        <p style={{ marginTop: 0 }}>DutyRota handles leave in two ways, and it helps to know the difference:</p>
        <p style={{ marginBottom: 4 }}><strong>Leave periods</strong> (set in the Staff tab)</p>
        <p style={{ marginTop: 0 }}>For longer, planned leave — <strong>annual, maternity, pre-maternity, emergency,</strong> and <strong>other</strong>. You give a start and end date, and it fills the whole period on the rota automatically. All of these count every calendar day in the period, including Fridays, Saturdays, and non-official days.</p>
        <p style={{ marginBottom: 4 }}><strong>Leave codes</strong> (entered in the Weekly Rota)</p>
        <p style={{ marginTop: 0, marginBottom: 0 }}>For day-by-day leave — <Code>SL</Code> (sick leave), <Code>FRL</Code>, <Code>ML</Code>, and any others. You enter these in a cell like any duty. Each code’s <strong>Counts as</strong> setting decides which category it adds to, so a code like <Code>N/FRL</Code> can count as FRL.</p>
      </Section>

      <Section title="6. Recording a changed duty (duty exchanges)">
        <p style={{ marginTop: 0 }}>When a duty ends up different from what you originally rostered — a nurse asked to swap, or you moved her yourself — you can mark that on the cell, so the rota keeps a record of both the change and who asked for it.</p>
        <p style={{ marginBottom: 4, fontWeight: 700, color: T.ink }}>Mark it first, then change the duty</p>
        <p style={{ marginTop: 0 }}>
          This order matters. When you mark a cell, DutyRota saves whatever duty is
          in it <em>at that moment</em> as the original. So:
        </p>
        <ol style={{ margin: "6px 0 10px", paddingLeft: 20 }}>
          <li style={{ marginBottom: 5 }}>Click the cell that is about to change.</li>
          <li style={{ marginBottom: 5 }}>Tap <strong>Mark as changed</strong>, then choose <strong>Requested by staff</strong> or <strong>Changed by manager</strong>.</li>
          <li>Now set the new duty code.</li>
        </ol>
        <p style={{ marginBottom: 10 }}>
          If you change the duty first and mark it afterwards, the new duty gets saved as the
          "original" — which isn't what you want. If that happens, clear the mark, put the old
          code back, mark it, then set the new code again.
        </p>
        <p style={{ marginBottom: 4 }}><strong>What you'll see</strong></p>
        <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
          <li style={{ marginBottom: 5 }}>A small round icon in the corner of the cell — a <strong>person</strong> for staff-requested, a <strong>briefcase</strong> for manager-changed.</li>
          <li style={{ marginBottom: 5 }}><strong>See original rota</strong> button at the top right — turn it on to view the rota as it was before any exchanges. Changed cells are outlined, the totals and coverage rows follow the original duties too, and editing is paused while you're in this view.</li>
          <li style={{ marginBottom: 5 }}>On the printed rota, a small <strong>S</strong> or <strong>M</strong> next to the duty, explained in the legend.</li>
          <li>In the <strong>Insights</strong> tab, a <strong>Duty exchanges</strong> table showing per staff member how many changes were at their request and how many you made.</li>
        </ul>
        <p style={{ marginBottom: 0 }}>The mark stays until you clear it — changing the duty back to the original code does not remove it. To clear it, open the cell, tap the <strong>Changed</strong> button, then <strong>Clear mark</strong>. Applying a generated week over those dates also clears the marks on the cells it rewrites, and tells you how many before it does.</p>
      </Section>

      <Section title="7. When someone joins or leaves">
        <p style={{ marginTop: 0 }}>When a staff member resigns or moves to another department, <strong>do not delete them</strong> — that would erase their past duties and make old rotas and statistics wrong.</p>
        <p>Instead, in the <strong>Staff</strong> tab, open that person and set a <strong>Last working day</strong> (or use the <strong>Mark left</strong> button for today). They will:</p>
        <ul style={{ margin: "6px 0", paddingLeft: 20 }}>
          <li style={{ marginBottom: 5 }}>Disappear from rotas after that date</li>
          <li style={{ marginBottom: 5 }}>Still appear correctly in past rotas and reports</li>
          <li>Move into "Former staff", hidden until you tick <strong>Show former staff</strong></li>
        </ul>
        <p style={{ marginBottom: 0 }}>For a new joiner, set a <strong>Joining date</strong> so they don't show on rotas before they started. If someone comes back, use <strong>Reactivate</strong>.</p>
      </Section>

      <Section title="8. Ordering your staff list">
        <p style={{ margin: 0 }}>In the <strong>Staff</strong> tab, use the up and down arrows next to each name to set the order staff appear in. This order is used everywhere — the weekly rota, records, statistics, and printed PDFs, including the row numbers. The <strong>Sort A–Z</strong> button arranges everyone alphabetically in one click.</p>
      </Section>

      <Section title="9. Reports & printing">
        <p style={{ marginTop: 0 }}>The <strong>Staff Records</strong> tab shows totals per person for a date range you choose. The <strong>Statistics</strong> tab shows charts — including how many staff are on each type of leave, and how many leave days were taken in each category (SL, FRL, ML, Other leave).</p>
        <p>On any of these, the <strong>Export PDF</strong> button opens an export view with two choices:</p>
        <ul style={{ margin: "6px 0", paddingLeft: 20 }}>
          <li style={{ marginBottom: 5 }}><strong>Print / Save as PDF</strong> — a clean printable version for your records or the noticeboard. Best done from a computer; wide monthly ranges print in landscape automatically.</li>
          <li><strong>Save as image</strong> — downloads the same layout as a picture, ready to share on WhatsApp. This is usually the easier option on a phone. Available for ranges up to 30 days.</li>
        </ul>
        <p style={{ marginBottom: 0 }}>Your logo, if you have set one, appears on both.</p>
      </Section>

      <Section title="10. Managing more than one department">
        <p style={{ marginTop: 0 }}>If you run more than one ward or unit, you don&rsquo;t need a separate login for each. Use the department button at the top left — the one showing your current department name.</p>
        <ul style={{ margin: "6px 0", paddingLeft: 20 }}>
          <li style={{ marginBottom: 5 }}><strong>Switch</strong> — tap any department in the list to open its rota.</li>
          <li style={{ marginBottom: 5 }}><strong>Add department</strong> — creates a fresh rota with its own staff, codes, settings and logo.</li>
          <li style={{ marginBottom: 5 }}><strong>Rename this department</strong> — change its name in the list.</li>
          <li><strong>Delete this department</strong> — removes it and all of its rota data. This cannot be undone, and you always keep at least one department.</li>
        </ul>
        <p style={{ marginBottom: 0 }}>Departments are completely separate: staff, duty codes, statistics and exports never mix between them. Undo works within one department — switching to another starts a fresh trail, so you can never undo one ward's change into another's.</p>
      </Section>

      <Section title="11. Digging into the details (Insights tab)">
        <p style={{ marginTop: 0 }}>The <strong>Insights</strong> tab answers specific questions about who did what. Pick a date range at the top, then use any of these:</p>
        <ul style={{ margin: "6px 0", paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}><strong>Staff breakdown</strong> — choose a nurse to see every duty code she worked, split by day of the week, with Fridays, Saturdays, and non-official days shown separately.</li>
          <li style={{ marginBottom: 6 }}><strong>Quick question</strong> — build a sentence like "How many times did Aminath do M on a Friday?" and get an instant answer.</li>
          <li style={{ marginBottom: 6 }}><strong>Who did a code the most</strong> — pick a code and see which staff did it most often, ranked.</li>
          <li style={{ marginBottom: 6 }}><strong>Duty exchanges</strong> — how many duties were changed for each staff member, split by staff-requested and manager-changed.</li>
          <li><strong>Compare two staff</strong> — see two nurses' duty counts side by side.</li>
        </ul>
        <p style={{ marginBottom: 0 }}>Leave days are never counted as duty here, and you can export the staff breakdown to PDF.</p>
      </Section>

      <Section title="12. Your account & data">
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}><strong>It saves automatically.</strong> There's no save button — every change is kept.</li>
          <li style={{ marginBottom: 6 }}><strong>It works across devices.</strong> Log in on your laptop and your phone with the same email, and you'll see the same rota.</li>
          <li style={{ marginBottom: 6 }}><strong>Your rota is private to your account.</strong> Only you can see it.</li>
          <li style={{ marginBottom: 6 }}><strong>Undo lasts for the session.</strong> It remembers your last 20 changes while the page is open. Closing or reloading the page starts it fresh, so anything you want reversed, reverse before you leave.</li>
          <li><strong>Forgot your password?</strong> Use the "Forgot password?" link on the login screen. You'll get an email with a link — open it on the same device and choose a new password.</li>
        </ul>
      </Section>

      <Section title="13. Smart Roster (beta)">
        <p style={{ marginTop: 0 }}>
          Smart Roster generates a full week automatically. It is a <strong>Plus feature</strong>{" "}
          and is currently in <strong>beta</strong> — it works well for most wards, but always
          check the result before applying it and use Undo if anything looks wrong.
        </p>
        <p style={{ marginBottom: 4, fontWeight: 700, color: T.ink }}>Before you generate</p>
        <p style={{ marginTop: 0 }}>
          The generator needs three things to be set up first: your staff (on the <strong>Staff</strong>{" "}
          tab), your duty codes (in <strong>Settings</strong>), and your coverage rules (in the{" "}
          <strong>Smart Roster</strong> tab itself — how many staff per shift, how many off days, and
          so on). It checks whether a week is possible before generating and tells you if something
          would make it impossible.
        </p>
        <p style={{ marginBottom: 4, fontWeight: 700, color: T.ink }}>What the settings mean</p>
        <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}><strong>How many staff on each shift</strong> — the fewest and most you want on Morning, Afternoon, Evening and Night. Set a shift to 0 if your ward doesn't run it.</li>
          <li style={{ marginBottom: 6 }}><strong>…of whom senior / in-charge / team leader</strong> — how many of the people on that shift must be able to take charge. Set to 0 if it doesn't matter. The word is yours to choose in Staff exceptions.</li>
          <li style={{ marginBottom: 6 }}><strong>What one person gets in a week</strong> — how many of each shift, how many off days, and how many duties in total. "Fewest" is a goal; "Most" is a firm limit.</li>
          <li style={{ marginBottom: 6 }}><strong>In a row</strong> — how many of the same shift can come together before a change. Two nights together is normal; keeping the others to about three stops someone from getting a whole week of afternoons.</li>
          <li style={{ marginBottom: 6 }}><strong>Staff exceptions</strong> — tick a shift for anyone who only ever does that one. Tick <strong>Senior</strong> (or whatever your ward calls it) for anyone who can take charge. Use <strong>Skip</strong> for anyone whose duties you enter by hand.</li>
          <li style={{ marginBottom: 6 }}><strong>Duty rules</strong> — which shifts may or may not follow each other. The usual ones are already set: no morning, afternoon or evening straight after a night.</li>
          <li><strong>Which code to write</strong> — if you have more than one code for the same duty type, pick the one the generator should use. The rest day after nights is the most important one to check.</li>
        </ul>
        <p style={{ marginBottom: 4, fontWeight: 700, color: T.ink }}>Generating</p>
        <Step n="1">Pick the week. It defaults to next week, which is almost always the one being planned. The label says which day a week begins on — change that in <strong>Settings → The week</strong>.</Step>
        <Step n="2">Press <strong>Generate this week</strong>. It builds the week quickly several times over, then improves it by rearrangement — about a second for a week, a few seconds for a month.</Step>
        <Step n="3">Read the result before pressing Apply. The banner tells you if any shift is uncovered (with the exact numbers), if a setting couldn't be fully met, or if a shift has no one in charge. Check the grid looks right.</Step>
        <Step n="4">Press <strong>Apply to rota</strong>. It asks you to confirm, writes the duties, and takes you straight to that week in the Weekly Rota tab. If anything looks wrong, press <strong>Undo</strong> immediately — it puts the rota back exactly as it was.</Step>
        <p style={{ marginBottom: 4, marginTop: 10, fontWeight: 700, color: T.ink }}>What it will and won't do</p>
        <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}>It <strong>covers every shift first</strong>, then shares the duty types fairly. A fair week shows a mix along each row — not five afternoons in a row.</li>
          <li style={{ marginBottom: 6 }}>It <strong>respects approved duty requests</strong>. Approve a request on the Duty Requests tab before generating and the generator will honour it.</li>
          <li style={{ marginBottom: 6 }}>It <strong>skips staff who are on recorded leave</strong> automatically — annual leave, maternity, and any leave period set on the Staff tab.</li>
          <li style={{ marginBottom: 6 }}>It <strong>only rosters staff employed that week</strong>. Someone who left last month or hasn't joined yet will not appear in the generated week, and it says so.</li>
          <li style={{ marginBottom: 6 }}>It <strong>carries recent history forward</strong>. Someone who did a lot of nights last week gets fewer this week. Set how far back to look under <strong>More rules → Look back at recent duties</strong>.</li>
          <li style={{ marginBottom: 6 }}>It <strong>does not move recorded leave</strong> or any cell marked as sick leave, family related leave, or medical leave — those stay exactly as they are.</li>
          <li>It <strong>cannot guarantee a perfect result every time</strong>. Some combinations of staff numbers and rules are impossible — it tells you with the exact numbers so you know what to change.</li>
        </ul>
        <p style={{ marginBottom: 4, fontWeight: 700, color: T.ink }}>The totals table below the preview</p>
        <p style={{ marginTop: 0, marginBottom: 0 }}>
          After generating, a table shows each person's totals across a date range you choose —
          this year, this month, the last three months, or any range you set. The proposed week is
          counted in when it falls inside the range, replacing whatever is currently on those dates.
          Non-official duties are shown separately because they carry extra pay — a small gap in one
          week becomes a large one by December.
        </p>
      </Section>

      <Section title="Still stuck? Message us">
        <p style={{ marginTop: 0 }}>
          If something isn't working, you're not sure how to do something, or you'd like a feature
          added — send us a message on WhatsApp. It helps if you say what you were trying to do and
          what happened instead.
        </p>
        <a href={SUPPORT_LINK} target="_blank" rel="noreferrer" style={{
          display: "inline-flex", alignItems: "center", gap: 8, background: T.lagoon, color: "#fff",
          fontWeight: 700, fontSize: 13.5, padding: "10px 18px", borderRadius: 8,
          textDecoration: "none", marginTop: 4,
        }}>
          <MessageCircle size={16} /> Message us on WhatsApp
        </a>
      </Section>
    </div>
  );
}

function SettingsTab({ data, update, canUseLogo = true }) {
  const empty = { code: "", label: "", color: "#F4B860", counts: "morning" };
  const [form, setForm] = useState(null);
  const [nd, setNd] = useState({ from: "", to: "" });
  const palette = [
    "#F4B860", "#E8A33D", "#E58E77", "#E4604E", "#C0483A", "#C08552", "#8C5A2B",
    "#8FBF6B", "#6E9E4C", "#4F7D3A", "#9AD1C8", "#5FA89C", "#2E7D6F",
    "#6FA8DC", "#4A82BC", "#2C5C8A", "#8E7CC3", "#6C5BA8", "#5E3A87",
    "#D98BD3", "#B761B0", "#F0A090", "#D96A6A",
    "#2E3358", "#5A6472", "#98A2B3", "#C9D2DC", "#E8EEF2", "#FFFFFF",
  ];

  const save = () => {
    if (!form.code.trim()) return;
    update((d) => {
      if (form.id) { const i = d.codes.findIndex((c) => c.id === form.id); d.codes[i] = form; }
      else d.codes.push({ ...form, id: uid() });
      return d;
    });
    setForm(null);
  };
  const removeCode = (id) => {
    // Deleting a code also clears it from every cell that used it, so the
    // count of what is about to disappear is worth showing first.
    const c = data.codes.find((x) => x.id === id);
    const used = Object.values(data.cells || {})
      .reduce((n, day) => n + Object.values(day || {}).filter((v) => v === id).length, 0);
    if (!window.confirm(
      `Delete the ${c ? c.code : ""} code?` +
      (used ? `\n\nIt is used on ${used} ${used === 1 ? "duty" : "duties"}, and those cells will be emptied.` : "") +
      `\n\nUndo will bring it back if you change your mind.`
    )) return;
    update((d) => {
      d.codes = d.codes.filter((c2) => c2.id !== id);
      Object.values(d.cells).forEach((day) => Object.keys(day).forEach((sid) => { if (day[sid] === id) delete day[sid]; }));
      return d;
    });
  };

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

  const countsLabel = { morning: "Morning duty", afternoon: "Afternoon duty", evening: "Evening duty", night: "Night duty", other: "Other duty", release: "Release duty", off: "Off day", sl: "Sick leave (SL)", frl: "Family related leave (FRL)", ml: "Medical leave (ML)", leave: "Other leave" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <Field label="Area / ward name (shown at the top)">
          <input style={{ ...inputStyle, maxWidth: 380 }} value={data.title}
            onChange={(e) => update((d) => { d.title = e.target.value; return d; })} />
        </Field>
      </Card>

      <h2 style={{ margin: "6px 0 0", fontFamily: "Sora, sans-serif", fontSize: 17 }}>Logo</h2>
      <Card>
        {!canUseLogo && (
          <div style={{
            background: "#FFF8E7", border: "1px solid #EBDCB2", borderRadius: 8,
            padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#7A6320",
            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          }}>
            <span>🔒 Adding your own logo is a <strong>Plus</strong> feature.</span>
            <a href={`https://wa.me/9607666261?text=${encodeURIComponent("Hi! I'd like to upgrade my DutyRota plan to add a company logo.")}`}
               target="_blank" rel="noreferrer"
               style={{ background: "#0F8B7E", color: "#fff", fontWeight: 700, fontSize: 12, padding: "6px 13px", borderRadius: 6, textDecoration: "none", whiteSpace: "nowrap" }}>
              Upgrade on WhatsApp
            </a>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", opacity: canUseLogo ? 1 : 0.55, pointerEvents: canUseLogo ? "auto" : "none" }}>
          {canUseLogo && data.logo ? (
            <img src={data.logo} alt="Logo" style={{ height: 76, maxWidth: 240, objectFit: "contain", border: `1px solid ${T.line}`, borderRadius: 8, padding: 8, background: "#fff" }} />
          ) : (
            <div style={{ height: 76, width: 140, border: `1px dashed ${T.line}`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: T.inkSoft }}>No logo</div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <label style={{
              fontFamily: "inherit", fontSize: 13, fontWeight: 700, cursor: "pointer",
              background: T.lagoon, color: "#fff", padding: "9px 15px", borderRadius: 8,
              display: "inline-flex", alignItems: "center", gap: 7,
            }}>
              <Image size={14} /> {canUseLogo && data.logo ? "Replace logo" : "Upload logo"}
              <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }}
                disabled={!canUseLogo}
                onChange={(e) => {
                  const file = e.target.files && e.target.files[0];
                  e.target.value = "";
                  if (!file) return;
                  // Shrink before storing: the logo travels inside rota_data, so a
                  // full-size photo would bloat every save. 480px keeps it sharp at
                  // the header and export sizes, including on retina screens.
                  const reader = new FileReader();
                  reader.onload = () => {
                    const img = new window.Image();
                    img.onload = () => {
                      const maxW = 480, maxH = 240;
                      let w = img.width, h = img.height;
                      const scale = Math.min(maxW / w, maxH / h, 1);
                      w = Math.round(w * scale); h = Math.round(h * scale);
                      const canvas = document.createElement("canvas");
                      canvas.width = w; canvas.height = h;
                      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
                      const out = canvas.toDataURL("image/png"); // PNG keeps transparency
                      if (out.length > 700000) { window.alert("That image is too large even after resizing. Try a simpler logo file."); return; }
                      update((d) => { d.logo = out; return d; });
                    };
                    img.onerror = () => window.alert("Sorry, that image could not be read. Try a PNG or JPG.");
                    img.src = reader.result;
                  };
                  reader.onerror = () => window.alert("Sorry, that file could not be read.");
                  reader.readAsDataURL(file);
                }} />
            </label>
            {canUseLogo && data.logo && (
              <Btn kind="danger" small onClick={() => { if (window.confirm("Remove the logo?")) update((d) => { d.logo = ""; return d; }); }}>
                <Trash2 size={14} /> Remove
              </Btn>
            )}
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 10 }}>
          Appears on the right of the header and on every PDF and image export. PNG with a transparent background looks best. Images are resized automatically.
        </div>
      </Card>

      <div style={{ marginTop: 10 }}>
        <Field label="Type of workplace">
          <select style={{ ...inputStyle, maxWidth: 380, cursor: "pointer" }}
            value={data.industry || ""}
            onChange={(e) => update((d) => { d.industry = e.target.value; return d; })}>
            <option value="">Select your workplace type…</option>
            <option value="hospital">Hospital or clinic</option>
            <option value="resort">Resort or hotel</option>
            <option value="guesthouse">Guesthouse</option>
            <option value="airport">Airport or airline</option>
            <option value="security">Security</option>
            <option value="restaurant">Restaurant or café</option>
            <option value="factory">Factory or plant</option>
            <option value="other">Other</option>
          </select>
        </Field>
        {!data.industry && (
          <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 6 }}>
            Helps us improve the app for your industry. Takes one second and is never shared.
          </div>
        )}
      </div>

      <h2 style={{ margin: "6px 0 0", fontFamily: "Sora, sans-serif", fontSize: 17 }}>The week</h2>
      <Card>
        <Field label="A week begins on">
          <select style={{ ...inputStyle, width: "auto", cursor: "pointer" }}
            value={data.weekStartsOn ?? 0}
            onChange={(e) => update((d) => { d.weekStartsOn = Number(e.target.value); return d; })}>
            <option value={0}>Sunday — Sunday to Saturday</option>
            <option value={1}>Monday — Monday to Sunday</option>
          </select>
        </Field>
        <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 10, lineHeight: 1.6 }}>
          Which seven days the Weekly Rota shows, and the seven the Smart Roster plans and counts
          its weekly limits over — so a "five duties a week" rule is measured across your week, not
          somebody else's. It changes nothing about the duties themselves: nobody's shift moves, and
          non-official days are set separately below.
        </div>
      </Card>

      <h2 style={{ margin: "6px 0 0", fontFamily: "Sora, sans-serif", fontSize: 17 }}>Shifts</h2>
      <Card>
        <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
          <input type="checkbox" checked={!!data.eveningEnabled}
            onChange={(e) => update((d) => {
              const on = e.target.checked;
              d.eveningEnabled = on;
              // Convenience on enable: the stock E / E(R) codes start counting
              // as Evening duty. Disabling changes nothing — codes keep their
              // Evening category (still fully counted in totals and payment;
              // only the E column, coverage row and chart segment hide).
              if (on) {
                d.codes.forEach((c) => {
                  const cc = (c.code || "").toUpperCase();
                  if (c.counts === "other" && (cc === "E" || cc === "E(R)")) c.counts = "evening";
                });
              }
              return d;
            })}
            style={{ accentColor: T.lagoon, width: 16, height: 16 }} />
          Enable Evening shift (for 4-shift rosters)
        </label>
        <div style={{ fontSize: 12.5, color: T.inkSoft, marginTop: 6 }}>
          {data.eveningEnabled
            ? "Evening has its own coverage row, column and \u201cCounts as\u201d option, and your E / E(R) codes count as Evening duty."
            : "Off by default \u2014 most units run 3 shifts. Turn on for a 4-shift roster (e.g. Ramadan): Evening gets its own coverage row and column, and your E / E(R) codes automatically count as Evening duty. Turning it off later only hides the Evening column and row \u2014 evening shifts still count in totals and payment."}
        </div>
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
          Duty worked on a non-official day counts toward payment.
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontFamily: "Sora, sans-serif", fontSize: 17 }}>Duty codes</h2>
        <Btn onClick={() => setForm(empty)}><Plus size={15} /> New code</Btn>
      </div>

      {form && (
        <Card className="dr-anim-in">
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <Field label="Code (shown in grid)"><input style={inputStyle} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. CL" /></Field>
            <Field label="Full label"><input style={inputStyle} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Casual leave" /></Field>
            <Field label="Counts as">
              <select style={inputStyle} value={form.counts} onChange={(e) => setForm({ ...form, counts: e.target.value })}>
                <option value="morning">Morning duty</option>
                <option value="afternoon">Afternoon duty</option>
                {(data.eveningEnabled || form.counts === "evening") && <option value="evening">Evening duty</option>}
                <option value="night">Night duty</option>
                <option value="other">Other duty (e.g. extra or 5th shift)</option>
                <option value="release">Release duty (staff only, not unit)</option>
                <option value="off">Off day</option>
                <option value="sl">Sick leave (SL)</option>
                <option value="frl">Family related leave (FRL)</option>
                <option value="ml">Medical leave (ML)</option>
                <option value="leave">Other leave</option>
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