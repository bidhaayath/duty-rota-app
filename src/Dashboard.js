import React, { useState, useEffect, useMemo, useRef } from "react";
import { Users, ChevronLeft, ChevronRight, Plus, User, CreditCard, X } from "lucide-react";
import supabase from "./supabaseClient";
import Account from "./Account";
import SubscriptionHistory from "./SubscriptionHistory";
import Members from "./Members";
import { ownedByMe } from "./deptAllowance";
import { weekTotalsFor, isEmployedOn, leaveOn, entriesOf as rotaEntriesOf, DUTY_CATS } from "./rotaCounts";

/* ────────────────────────────────────────────────────────────────────────
   My Dashboard — full-screen personal home.

   Left: a sidebar of everywhere this person can go —
         My Organisation (departments they own), My Membership (departments
         shared with them), Settings, My Plans, Log out.
   Right: a month calendar of THEIR OWN duties, gathered from every
          department at once, and a "Today — …" line.

   Which duties are "mine": a staff row whose email matches the login email
   IS this person. Same rule everywhere, owned or shared — the rule invites
   already use.

   READ-ONLY. This screen writes nothing to the database. It loads rotas the
   person is already allowed to load (through the loadRota function handed in
   by the parent, which carries the correct version-desc / created_at-asc
   ordering) and filters to their own cells in the browser. It cannot change,
   delete or expose anything, and can never surface a duty they couldn't
   already see. The only action that leaves the page is signing out.
   ──────────────────────────────────────────────────────────────────────── */

const T = {
  ink: "#0E3A47", inkSoft: "#3A5F6B", mist: "#E4F2F8", card: "#FFFFFF",
  line: "#D3E5EC", lagoon: "#0D4F61", coral: "#E4604E",
};
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
/* Leave periods, shown with the same short codes and colours as the rota
   (LEAVE_STYLES in DutyRotaOriginal.js). A custom "other" leave keeps its
   own name as the label. */
const LEAVE_CHIPS = {
  annual:       { abbrev: "AL",  label: "Annual leave",         bg: "#D8EEE9" },
  maternity:    { abbrev: "MAT", label: "Maternity leave",      bg: "#E9E9E9" },
  prematernity: { abbrev: "PML", label: "Pre-maternity leave",  bg: "#F6E0EC" },
  emergency:    { abbrev: "EL",  label: "Emergency leave",      bg: "#FBE3DF" },
  other:        { abbrev: "LV",  label: "Other extended leave", bg: "#E6E4F5" },
};
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const pad = (n) => String(n).padStart(2, "0");
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a, b) => dstr(a) === dstr(b);

const textOn = (hex) => {
  if (!hex || hex[0] !== "#" || hex.length < 7) return T.ink;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? T.ink : "#FFFFFF";
};

/* Six-week grid (Sunday first) covering the given month. Always six rows so
   the calendar keeps a steady height as you page between months. */
const monthGrid = (year, month) => {
  const first = new Date(year, month, 1);
  const cur = new Date(year, month, 1 - first.getDay());
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) { row.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    weeks.push(row);
  }
  return weeks;
};

/* Show the real role rather than assuming anything that isn't "manager" is an
   employee — an unexpected value should look odd, not quietly mislabel. */
const roleLabel = (role) => {
  if (!role) return "Member";
  const r = String(role).toLowerCase();
  if (r === "manager") return "Manager";
  if (r === "employee") return "Employee";
  if (r === "owner") return "Owner";
  return String(role);
};

export default function Dashboard({
  departments = [],
  isMyDept = ownedByMe,
  deptPerms = null,
  orgName = "",
  loadRota,
  onOpenDepartment,
  onAddDepartment = null,
  canAddDepartment = false,
  onOpenPlans = null,
  screen: screenProp = null,
  onScreen = null,
}) {
  /* Which full screen is showing. "home" is the calendar; "account" is the
     account screen reached from the sidebar. Kept here rather than in the
     parent so the sidebar owns its own navigation. */
  const [screenOwn, setScreenOwn] = useState("home");
  // The side menu can drive this from outside (Your account, Members).
  const screen = screenProp || screenOwn;
  const setScreen = (next) => { if (onScreen) onScreen(next); else setScreenOwn(next); };
  const [email, setEmail] = useState(null);
  const [accountName, setAccountName] = useState("");
  const [staffName, setStaffName] = useState("");

  /* The name to greet them by. What they set on their account screen wins —
     it's the one they chose deliberately. A staff-row name is the fallback,
     then the email. Re-read whenever we come back to the calendar, so a name
     just changed on the account screen shows immediately. */
  useEffect(() => {
    if (screen !== "home") return;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      const meta = (user && user.user_metadata) || {};
      setAccountName((meta.full_name || meta.name || "").trim());
    })();
    return () => { cancelled = true; };
  }, [screen]);

  const displayName = accountName || staffName
    || (email ? email.split("@")[0] : "there");

  const [rotasByDept, setRotasByDept] = useState({});
  const [loading, setLoading] = useState(true);

  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });

  const deptKey = departments.map((d) => d.id).join(",");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      const mail = (user?.email || "").trim().toLowerCase();
      setEmail(mail);

      const entries = await Promise.all(
        departments.map(async (d) => {
          try { return [d.id, await loadRota(d.id)]; }
          catch { return [d.id, null]; }
        })
      );
      if (cancelled) return;
      const map = {};
      entries.forEach(([id, data]) => { if (data) map[id] = data; });
      setRotasByDept(map);

      let nameFromStaff = "";
      for (const d of departments) {
        const mine = (map[d.id]?.staff || []).find(
          (s) => mail && (s.email || "").trim().toLowerCase() === mail
        );
        if (mine && mine.name) { nameFromStaff = mine.name; break; }
      }
      setStaffName(nameFromStaff);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deptKey]);

  /* Owned vs shared, decided by the parent (deptAllowance's showsAsMine):
     in my organisation and I own it, with owner_user_id standing in until
     that is known. It never waits on my_departments(), so nothing moves
     between the two lists when that lands. deptPerms is only needed for
     the role shown beside a shared one. */
  const owned = [];
  const memberships = [];
  departments.forEach((d) => {
    if (isMyDept(d)) owned.push(d);
    else memberships.push({ ...d, role: deptPerms ? deptPerms.get(d.id)?.role : undefined });
  });

  const myMemberships = useMemo(() => {
    if (!email) return [];
    return departments.map((d) => {
      const rota = rotasByDept[d.id];
      if (!rota) return null;
      const mine = (rota.staff || []).find(
        (s) => (s.email || "").trim().toLowerCase() === email
      );
      if (!mine) return null;
      return {
        deptName: d.name, deptId: d.id, staffId: mine.id, me: mine,
        staff: rota.staff || [], eveningEnabled: !!rota.eveningEnabled,
        codes: rota.codes || [], cells: rota.cells || {},
        // Needed to mark non-official days and on-call turns. Both are
        // per department, so someone in two departments can have a day
        // that is non-official in one and ordinary in the other.
        onCall: rota.onCall || {},
        posts: rota.posts || [],
        /* The department's own switches. This screen reads the saved rota
           directly, so without them it would happily show a second duty or a
           post that the manager has turned off — the employee seeing more than
           the person who set the rota. Hidden, not deleted: switching back on
           brings everything straight back. */
        postsEnabled: !!rota.postsEnabled,
        splitEnabled: !!rota.splitEnabled,
        nonOfficial: rota.nonOfficial || [],
        fridayRule: rota.fridayRule !== false,
      };
    }).filter(Boolean);
  }, [departments, rotasByDept, email]);

  /* A cell is either a plain duty code id, or a list of duties when a
     department uses tasks or split shifts:
         "abc123"   or   [{ code: "abc", post: "p1" }, ...]
     Both shapes must read the same here. Passing a list straight through
     would put an object where React expects text, which throws and takes
     the whole calendar down. */
  const entriesOf = (raw) => {
    if (!raw) return [];
    if (typeof raw === "string") return [{ code: raw, post: "" }];
    if (Array.isArray(raw)) return raw.filter((e) => e && e.code);
    return [];
  };

  const FRIDAY = 5;
  /* A non-official day is set per department: every Friday when the
     Friday rule is on, plus any date the manager marked. */
  const isNonOfficial = (m, dateStr) =>
    (m.fridayRule && new Date(dateStr + "T00:00:00").getDay() === FRIDAY) ||
    (m.nonOfficial || []).includes(dateStr);

  /* Everything known about one day, across every department the person
     belongs to. The calendar cell uses the short parts; the panel
     underneath shows the rest. */
  const dayInfo = (dateStr) => {
    const duties = [];
    let anyNonOfficial = false;
    let anyOnCall = false;
    myMemberships.forEach((m) => {
      const nonOff = isNonOfficial(m, dateStr);
      const onCall = (m.onCall || {})[dateStr] === m.staffId;
      if (nonOff) anyNonOfficial = true;
      if (onCall) anyOnCall = true;
      /* On leave: the leave shows instead of the cell, exactly as the rota
         treats it (a leave day is never counted as a duty). */
      const period = isEmployedOn(m.me, dateStr) ? leaveOn(m.me, dateStr) : null;
      if (period) {
        const ls = LEAVE_CHIPS[period.type] || LEAVE_CHIPS.other;
        duties.push({
          postName: "", post: "", text: ls.abbrev,
          label: period.type === "other" && period.label ? period.label : ls.label,
          color: ls.bg, deptName: m.deptName, deptId: m.deptId, counts: "leave",
          nonOfficial: nonOff, onCall: false, leave: true,
        });
        return;
      }
      // One entry per duty, so a split shift shows both.
      const dayEntries = entriesOf((m.cells[dateStr] || {})[m.staffId]);
      // Only the first duty unless this department uses split duties.
      const visible = m.splitEnabled ? dayEntries : dayEntries.slice(0, 1);
      visible.forEach((entry) => {
        const code = m.codes.find((c) => c.id === entry.code);
        if (!code && !entry.code) return;
        // Cells store the post id, so the name is looked up here. A post that
        // has since been deleted resolves to nothing and simply is not shown.
        const post = m.postsEnabled
          ? (m.posts || []).find((x) => x.id === entry.post)
          : null;
        duties.push({
          postName: post ? post.name : "",
          text: code ? code.code : "?",
          label: code ? (code.label || "") : "",
          // The post id from the department list, resolved to a name below.
          post: entry.post || "",
          color: code ? code.color : T.mist,
          deptName: m.deptName,
          deptId: m.deptId,
          counts: code ? code.counts : "",
          nonOfficial: nonOff,
          onCall,
        });
      });
      // On call with no duty rostered still deserves a line in the panel.
      if (onCall && !dayEntries.length) {
        duties.push({
          text: "", label: "", post: "", postName: "", color: T.mist,
          deptName: m.deptName, nonOfficial: nonOff, onCall: true, onCallOnly: true,
        });
      }
    });
    return { duties, anyNonOfficial, anyOnCall };
  };

  const grid = monthGrid(view.year, view.month);
  // The panel underneath follows whichever day is tapped, starting on today.
  const [selected, setSelected] = useState(dstr(today));
  const selectedInfo = dayInfo(selected);
  const niceFullDate = (ds) =>
    new Date(ds + "T00:00:00").toLocaleDateString("en-GB",
      { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  /* Moving to another month also moves the selection, otherwise the panel
     underneath keeps describing a day that is no longer on screen and no
     cell appears highlighted. Landing back on the current month reselects
     today, which is what someone paging back and forth expects. */
  const goToMonth = (year, month) => {
    setView({ year, month });
    const onThisMonth = year === today.getFullYear() && month === today.getMonth();
    setSelected(onThisMonth ? dstr(today) : dstr(new Date(year, month, 1)));
  };
  const prevMonth = () => goToMonth(view.month === 0 ? view.year - 1 : view.year, view.month === 0 ? 11 : view.month - 1);
  const nextMonth = () => goToMonth(view.month === 11 ? view.year + 1 : view.year, view.month === 11 ? 0 : view.month + 1);

  /* Left and right arrow keys change the month on Home — unless the person
     is typing somewhere, or holding a modifier (browser shortcuts). The ref
     always holds this render's functions, so the listener never goes stale. */
  const monthNav = useRef({});
  monthNav.current = { prev: prevMonth, next: nextMonth };
  useEffect(() => {
    if (screen !== "home") return undefined;
    const onKey = (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      if (e.key === "ArrowLeft") monthNav.current.prev(); else monthNav.current.next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);
  // A sideways swipe on the calendar changes the month on a phone.
  const swipe = useRef(null);
  const onCalTouchStart = (e) => {
    const p = e.touches[0];
    swipe.current = p ? { x: p.clientX, y: p.clientY } : null;
  };
  const onCalTouchEnd = (e) => {
    const start = swipe.current; swipe.current = null;
    const p = e.changedTouches[0];
    if (!start || !p) return;
    const dx = p.clientX - start.x, dy = p.clientY - start.y;
    // Clearly sideways and long enough, so a scroll down the page never flips the month.
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) nextMonth(); else prevMonth();
  };

  if (screen === "account") {
    return <Account onBack={() => setScreen("home")} />;
  }

  if (screen === "history") {
    return <SubscriptionHistory onBack={() => setScreen("home")} />;
  }

  if (screen === "members") {
    return <Members onBack={() => setScreen("home")} />;
  }

  if (loading) {
    return (
      <div style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 60, textAlign: "center", color: T.inkSoft }}>
        Loading your dashboard…
      </div>
    );
  }

  /* ── Home, liquid glass ──
     Everything below reads the same memberships as the calendar, so it can
     never show a duty the person couldn't already see. Read-only. */
  const todayStr = dstr(today);
  const greeting = (() => {
    const h = today.getHours();
    return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  })();
  const WORKED = (c) => DUTY_CATS.includes(c);

  // Who else works the same shift today, in the same department.
  const onWithMe = (deptId, dateStr, counts) => {
    if (!WORKED(counts)) return [];
    const m = myMemberships.find((x) => x.deptId === deptId);
    if (!m) return [];
    return (m.staff || []).filter((s) => {
      if (s.id === m.staffId || !isEmployedOn(s, dateStr) || leaveOn(s, dateStr)) return false;
      return rotaEntriesOf((m.cells[dateStr] || {})[s.id])
        .some((e) => (m.codes.find((c) => c.id === e.code) || {}).counts === counts);
    }).map((s) => s.name).filter(Boolean);
  };

  const todayInfo = dayInfo(todayStr);
  const todayDuties = todayInfo.duties.filter((d) => !d.onCallOnly);
  const lead = todayDuties.find((d) => WORKED(d.counts)) || todayDuties[0] || null;
  const leadWith = lead ? onWithMe(lead.deptId, todayStr, lead.counts) : [];
  const leadPost = lead && lead.postName;
  const manyDepts = myMemberships.length > 1;

  // The next four days, whatever is on them.
  const upcoming = [1, 2, 3, 4].map((n) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
    const ds = dstr(d);
    const info = dayInfo(ds);
    const first = info.duties.find((x) => !x.onCallOnly) || null;
    return { ds, d, first, nonOfficial: info.anyNonOfficial, more: Math.max(0, info.duties.filter((x) => !x.onCallOnly).length - 1) };
  });

  /* This month, counted with the rota's own rules (rotaCounts.js), so the
     numbers match the per-person totals on each department's rota. */
  const monthDays = [];
  for (let d = new Date(today.getFullYear(), today.getMonth(), 1); d.getMonth() === today.getMonth(); d.setDate(d.getDate() + 1)) {
    monthDays.push(dstr(d));
  }
  const monthTotals = { morning: 0, afternoon: 0, evening: 0, night: 0, off: 0 };
  myMemberships.forEach((m) => {
    const t = weekTotalsFor({ codes: m.codes, cells: m.cells, nonOfficial: m.nonOfficial, fridayRule: m.fridayRule }, m.me, monthDays);
    Object.keys(monthTotals).forEach((k) => { monthTotals[k] += t[k] || 0; });
  });
  const showEvening = monthTotals.evening > 0 || myMemberships.some((m) => m.eveningEnabled);
  // Non-official days worked: each DATE once, however many departments or duties.
  const nonOffWorked = monthDays.filter((ds) => myMemberships.some((m) => {
    if (!isNonOfficial(m, ds) || !isEmployedOn(m.me, ds) || leaveOn(m.me, ds)) return false;
    return rotaEntriesOf((m.cells[ds] || {})[m.staffId])
      .some((e) => WORKED((m.codes.find((c) => c.id === e.code) || {}).counts));
  }));

  const initialsOf = (name) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  const AVATARS = [["#FDE3BF", "#6B3E00"], ["#D7ECFB", "#0B3A5E"], ["#E3F3DA", "#24501A"], ["#EDE5FB", "#45297A"], ["#FBE1DD", "#6E2016"]];
  const chip = (color, extra = {}) => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
    fontWeight: 800, background: color || "#fff", color: textOn(color || "#FFFFFF"),
    border: "1px solid rgba(14,58,71,0.12)", ...extra,
  });
  const card = {
    boxSizing: "border-box", borderRadius: 20, background: "rgba(255,255,255,0.74)",
    border: "1px solid rgba(255,255,255,0.9)", boxShadow: "0 8px 24px rgba(14,58,71,0.07)",
  };
  const eyebrow = { fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: T.inkSoft };
  const H = "'Plus Jakarta Sans', Inter, sans-serif";

  /* A department: its initials. On a
     phone only that badge shows (the name is in its label and tooltip). */
  const DeptCard = ({ d, i, badge, sub }) => {
    return (
      <button type="button" className="edr-home-dept" title={d.name} aria-label={`Open ${d.name}`}
        onClick={() => onOpenDepartment && onOpenDepartment(d.id)} style={{
          ...card, borderRadius: 18, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
          textAlign: "left", fontFamily: "inherit", color: T.ink, cursor: "pointer", minWidth: 0,
        }}>
        <span className="edr-dept-badge" aria-hidden="true" style={{ flex: "none", width: 34, height: 34, borderRadius: "50%", overflow: "hidden",
          display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12,
          background: AVATARS[i % AVATARS.length][0], color: AVATARS[i % AVATARS.length][1] }}>
          {initialsOf(d.name)}
        </span>
        <span className="edr-dept-text" style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
          <span style={{ fontWeight: 600, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
          {sub && <span style={{ fontSize: 11.5, color: T.inkSoft }}>{sub}</span>}
        </span>
        <span className="edr-dept-role">{badge}</span>
      </button>
    );
  };

  return (
    <div className="dr-fade-in edr-home" style={{ fontFamily: "Inter, system-ui, sans-serif", color: T.ink }}>
      <style>{`
        .edr-home-dept:hover { background: rgba(255,255,255,0.9) !important; }
        .edr-day:hover { border-color: #1F7F9F !important; }
        /* Left: Today, Next, calendar, details. Right: this month. */
        .edr-home-grid { display: grid; grid-template-columns: minmax(0, 1fr) 250px; gap: 14px; align-items: start; margin-bottom: 18px; }
        .edr-home-right { position: sticky; top: 20px; display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .edr-home-left { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
        .edr-home-top { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 12px; }
        .edr-rings { display: flex; flex-direction: column; gap: 10px; }
        @keyframes edrRise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes edrRing { from { stroke-dashoffset: var(--edr-ring-c); } }
        @media (prefers-reduced-motion: no-preference) {
          .edr-home > * { animation: edrRise 340ms cubic-bezier(0.23, 1, 0.32, 1) backwards; }
          .edr-home > *:nth-child(3) { animation-delay: 60ms; }
          .edr-home > *:nth-child(4) { animation-delay: 120ms; }
          .edr-home > *:nth-child(n+5) { animation-delay: 180ms; }
          .edr-ring-arc { animation: edrRing 700ms cubic-bezier(0.23, 1, 0.32, 1) 120ms backwards; }
        }
        @media (max-width: 1080px) {
          .edr-home-grid { grid-template-columns: minmax(0, 1fr); }
          .edr-home-right { position: static; }
          /* Stacked (phone, narrow window): the tapped day comes straight after
             the calendar, then this month. */
          .edr-daydetails { order: -1; }
          .edr-rings { flex-direction: row; flex-wrap: wrap; justify-content: space-between; }
        }
        @media (max-width: 899px) { .edr-home { padding: 12px 10px 24px; } }
        /* Phone: everything a size smaller, departments as badges only. */
        @media (max-width: 640px) {
          .edr-home h1 { font-size: 19px !important; }
          .edr-home-sub, .edr-home-date { display: none !important; }
          .edr-home-top { gap: 8px; }
          .edr-cal { padding: 10px 6px !important; border-radius: 16px !important; }
          .edr-cal-grid { gap: 3px !important; }
          .edr-day { min-height: 44px !important; padding: 3px !important; border-radius: 8px !important; gap: 2px !important; }
          .edr-num { font-size: 10.5px !important; height: 16px !important; min-width: 16px !important; }
          .edr-day .edr-daychip { height: 16px !important; font-size: 9.5px !important; border-radius: 5px !important; }
          .edr-today-code { min-width: 52px !important; height: 52px !important; font-size: 22px !important; border-radius: 15px !important; }
          .edr-cal-dow { font-size: 10px !important; }
          .edr-rings { gap: 4px; }
          .edr-ring-row { flex-direction: column !important; gap: 2px !important; }
          .edr-dept-grid { grid-template-columns: repeat(auto-fill, minmax(46px, 1fr)) !important; gap: 8px !important; }
          .edr-home-dept { justify-content: center; padding: 6px !important; border-radius: 14px !important; }
          .edr-dept-text, .edr-dept-role { display: none !important; }
          .edr-dept-badge { width: 36px !important; height: 36px !important; }
          .edr-home h2 { font-size: 15px !important; }
        }
      `}</style>

      {/* Greeting */}
      <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <h1 style={{ margin: 0, fontFamily: H, fontWeight: 800, fontSize: 24, letterSpacing: "-0.02em" }}>{greeting}, {displayName}</h1>
          <p className="edr-home-sub" style={{ margin: 0, fontSize: 13, color: T.inkSoft }}>Your duties from every department, in one place.</p>
        </div>
        <span className="edr-home-date" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 999,
          background: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.95)", fontSize: 12.5, fontWeight: 500 }}>
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "#7DBE5C" }} />
          {niceFullDate(todayStr)}
        </span>
      </header>

      <div className="edr-home-grid">
      <div className="edr-home-left">

      {/* Today · Next — two small cards side by side */}
      <section aria-label="Today" className="edr-home-top">
        {/* Filled in the side menu's deep lagoon, so today stands out; white
            text on it passes contrast comfortably. */}
        <div style={{ borderRadius: 18, padding: "12px 14px", display: "flex", alignItems: "center", gap: 14, minWidth: 0, boxSizing: "border-box",
          color: "#FFFFFF", background: "linear-gradient(135deg, #0E3A47 0%, #0D4F61 55%, #1F7F9F 100%)",
          border: todayInfo.anyNonOfficial ? "2px solid #E6C27A" : "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 10px 24px rgba(13,79,97,0.25)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
            <span style={{ ...eyebrow, color: "#9FD7E6", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              Today
              {todayInfo.anyNonOfficial && <span style={{ padding: "1px 7px", borderRadius: 999, background: "#FFE3A3", color: "#5C3B00", letterSpacing: 0, textTransform: "none", fontWeight: 700 }}>Non-official</span>}
              {todayInfo.anyOnCall && <span style={{ padding: "1px 7px", borderRadius: 999, background: "#F3D9A4", color: "#5C3F08", letterSpacing: 0, textTransform: "none", fontWeight: 700 }}>On call</span>}
            </span>
            <span style={{ fontFamily: H, fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>{lead ? (lead.label || lead.text) : "Nothing rostered"}</span>
            <span style={{ fontSize: 12, color: "#CDEBF4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {lead ? [lead.deptName, leadPost].filter(Boolean).join(" · ") : (myMemberships.length ? "No duty in your name today" : "Duties appear when a staff row carries your login email")}
            </span>
            {lead && WORKED(lead.counts) && (
              <span title={leadWith.join(", ")} style={{ fontSize: 12, fontStyle: "italic", color: "#9FE3EE", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {leadWith.length ? `With ${leadWith.slice(0, 4).join(", ")}${leadWith.length > 4 ? ` +${leadWith.length - 4}` : ""}` : "Nobody else on this shift"}
              </span>
            )}
            {todayDuties.length > 1 && <span style={{ fontSize: 11.5, color: "#CDEBF4" }}>+{todayDuties.length - 1} more today</span>}
            {lead && (
              <button type="button" onClick={() => onOpenDepartment && onOpenDepartment(lead.deptId)} style={{
                alignSelf: "flex-start", marginTop: 4, height: 28, padding: "0 12px", borderRadius: 999, border: "none",
                background: "#FFFFFF", color: "#0D4F61", fontFamily: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Open rota</button>
            )}
          </div>
          {lead
            ? <span className="edr-today-code" style={chip(lead.color, { flex: "none", minWidth: 74, height: 74, padding: "0 8px", borderRadius: 20, fontFamily: H, fontSize: lead.text.length > 3 ? 18 : 34, border: "2px solid rgba(255,255,255,0.85)", boxShadow: "0 6px 16px rgba(0,0,0,0.18)" })}>{lead.text}</span>
            : <span className="edr-today-code" style={{ flex: "none", width: 74, height: 74, borderRadius: 20, border: "1.5px dashed rgba(255,255,255,0.45)", display: "flex", alignItems: "center", justifyContent: "center", color: "#CDEBF4", fontSize: 22 }}>—</span>}
        </div>

        <div style={{ ...card, borderRadius: 18, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <span style={eyebrow}>Next</span>
          {upcoming.slice(0, 3).map((u) => (
            <div key={u.ds} title={`${niceFullDate(u.ds)}: ${u.first ? (u.first.label || u.first.text) + (manyDepts ? ` · ${u.first.deptName}` : "") : "nothing rostered"}${u.nonOfficial ? " · non-official day" : ""}`}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "3px 4px 3px 12px", borderRadius: 999,
                border: u.nonOfficial ? "1.5px solid #E6C27A" : "1.5px solid rgba(14,58,71,0.22)",
                background: u.nonOfficial ? "rgba(255,240,207,0.7)" : "rgba(255,255,255,0.5)" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: u.nonOfficial ? "#7A4F00" : T.ink, whiteSpace: "nowrap" }}>
                {u.d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}
              </span>
              {u.first
                ? <span style={chip(u.first.color, { minWidth: 44, height: 24, padding: "0 8px", borderRadius: 999, fontSize: 11, whiteSpace: "nowrap" })}>{u.first.text}{u.more ? "+" : ""}</span>
                : <span style={{ minWidth: 44, height: 24, borderRadius: 999, border: `1px dashed ${T.line}`, display: "flex", alignItems: "center", justifyContent: "center", color: T.inkSoft, fontSize: 11 }}>—</span>}
            </div>
          ))}
        </div>
      </section>

      {/* Calendar — a box per day, only the codes inside */}
      <section className="edr-cal" aria-labelledby="edr-cal-h" onTouchStart={onCalTouchStart} onTouchEnd={onCalTouchEnd}
        style={{ touchAction: "pan-y", ...card, borderRadius: 20, display: "flex", flexDirection: "column", gap: 10, padding: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" onClick={prevMonth} aria-label="Previous month" style={roundBtn}><ChevronLeft size={16} /></button>
            <h2 id="edr-cal-h" style={{ margin: "0 4px", fontFamily: H, fontSize: 16, fontWeight: 700, minWidth: 130, textAlign: "center" }}>{MONTHS[view.month]} {view.year}</h2>
            <button type="button" onClick={nextMonth} aria-label="Next month" style={roundBtn}><ChevronRight size={16} /></button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, fontSize: 11.5, color: T.inkSoft }}>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 3, background: "#FFF0CF", border: "1px solid #E6C27A" }} />Non-official</span>
            <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 3, border: "2px solid #0D4F61", boxSizing: "border-box" }} />Today</span>
          </div>
        </div>
        <div className="edr-cal-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
          {DAY_NAMES.map((d) => (
            <div key={d} className="edr-cal-dow" style={{ textAlign: "center", fontSize: 12, fontWeight: 600, color: "#1F7F9F" }}>
              {d.charAt(0) + d.slice(1).toLowerCase()}
            </div>
          ))}
          {grid.filter((week) => week.some((d) => d.getMonth() === view.month)).flat().map((date) => {
            const ds = dstr(date);
            const inMonth = date.getMonth() === view.month;
            const isToday = sameDay(date, today);
            const isSelected = ds === selected;
            const info = dayInfo(ds);
            const duties = info.duties.filter((d) => !d.onCallOnly);
            const nonOff = info.anyNonOfficial && inMonth;
            return (
              <button key={ds} type="button" className="edr-day" aria-pressed={isSelected}
                aria-label={niceFullDate(ds) + (duties.length ? ", " + duties.map((d) => d.label || d.text).join(", ") : "") + (info.anyNonOfficial ? ", non-official day" : "")}
                onClick={() => {
                  if (!inMonth) setView({ year: date.getFullYear(), month: date.getMonth() });
                  setSelected(ds);
                }}
                style={{
                  position: "relative", minHeight: 58, minWidth: 0, boxSizing: "border-box", padding: "5px 5px 6px", borderRadius: 12,
                  display: "flex", flexDirection: "column", alignItems: "stretch", gap: 4, textAlign: "left",
                  fontFamily: "inherit", color: "inherit", cursor: "pointer", opacity: inMonth ? 1 : 0.4,
                  background: isSelected ? "#E3F2F7" : nonOff ? "rgba(255,240,207,0.95)" : "rgba(255,255,255,0.8)",
                  border: isSelected ? "2px solid #1F7F9F" : isToday ? "2px solid #0D4F61" : nonOff ? "1px solid #E6C27A" : "1px solid rgba(14,58,71,0.10)",
                  boxShadow: isSelected ? "0 6px 16px rgba(13,79,97,0.18)" : "none",
                }}>
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
                  <span className="edr-num" style={{
                    minWidth: 20, height: 20, padding: "0 5px", borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontSize: 12, fontWeight: isToday ? 700 : 600, fontVariantNumeric: "tabular-nums",
                    background: isToday ? "#0D4F61" : "transparent", color: isToday ? "#fff" : nonOff ? "#7A4F00" : T.ink,
                  }}>{date.getDate()}</span>
                  {info.anyOnCall && <span title="On call" style={{ fontSize: 8.5, fontWeight: 800, color: "#5C3F08", background: "#F3D9A4", borderRadius: 4, padding: "2px 3px", lineHeight: 1 }}>OC</span>}
                </span>
                {duties.slice(0, 2).map((duty, i) => (
                  <span key={i} className="edr-daychip" style={chip(duty.color, { height: 20, borderRadius: 6, padding: "0 4px", fontSize: 11, overflow: "hidden", whiteSpace: "nowrap" })}>{duty.text}</span>
                ))}
                {duties.length > 2 && <span style={{ fontSize: 9.5, color: T.inkSoft, textAlign: "center" }}>+{duties.length - 2}</span>}
              </button>
            );
          })}
        </div>
      </section>
      </div>

      {/* Right: this month, then the day you tapped (beside the calendar) */}
      <div className="edr-home-right">
      <aside className="edr-month" aria-label="This month" style={{ ...card, borderRadius: 20, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <span style={eyebrow}>This month · {MONTHS[today.getMonth()]}</span>
        <div className="edr-rings">
          {[
            ["M", monthTotals.morning, "#F4B860", "#F7C35F", "#4A3300"],
            ["A", monthTotals.afternoon, "#8FBF6B", "#9BD08A", "#1D3B12"],
            ...(showEvening ? [["E", monthTotals.evening, "#8E7CC3", "#C9B8EC", "#2E1F55"]] : []),
            ["N", monthTotals.night, "#6FA8DC", "#7FB2E5", "#0B2A4A"],
            ["OFF", monthTotals.off, "#9FB6BD", "#FFFFFF", "#24505C"],
          ].map(([label, n, ring, chipBg, chipFg]) => {
            const r = 20, c = 2 * Math.PI * r;
            const share = Math.min(1, n / monthDays.length);
            return (
              <div key={label} className="edr-ring-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                title={`${n} ${label} this month (of ${monthDays.length} days)`}>
                <span style={{ minWidth: 34, height: 24, padding: "0 6px", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11.5, fontWeight: 800, background: chipBg, color: chipFg, border: label === "OFF" ? "1px solid #9FB6BD" : "none" }}>{label}</span>
                <svg width="50" height="50" viewBox="0 0 50 50" role="img" aria-label={`${label}: ${n}`}>
                  <circle cx="25" cy="25" r={r} fill="none" stroke="#E4EEF2" strokeWidth="6" />
                  <circle className="edr-ring-arc" cx="25" cy="25" r={r} fill="none" stroke={ring} strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={c} strokeDashoffset={c * (1 - share)} transform="rotate(-90 25 25)"
                    style={{ "--edr-ring-c": c }} />
                  <text x="25" y="29.5" textAnchor="middle" fontSize="13" fontWeight="800" fill="#0E3A47" fontFamily="Inter, sans-serif">{n}</text>
                </svg>
              </div>
            );
          })}
        </div>
        <div style={{ borderTop: `1px solid ${T.line}`, paddingTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ ...eyebrow, color: "#7A4F00" }}>Non-official days</span>
          <span style={{ fontFamily: H, fontSize: 26, fontWeight: 800, color: "#5C3B00", lineHeight: 1 }}>{nonOffWorked.length}</span>
        </div>
      </aside>

      {selected && (
        <section aria-label="Day details" className="edr-daydetails" style={{
          ...card, borderRadius: 18, display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px",
          background: selectedInfo.anyNonOfficial ? "rgba(255,244,222,0.9)" : card.background,
          border: selectedInfo.anyNonOfficial ? "1px solid #E6C27A" : card.border,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: selectedInfo.anyNonOfficial ? "#A06A00" : "#1F7F9F" }}>
                {selectedInfo.anyNonOfficial ? "Non-official day" : selected === todayStr ? "Today" : "Official day"}{selectedInfo.anyOnCall ? " · On call" : ""}
              </span>
              <h3 style={{ margin: 0, fontFamily: H, fontSize: 14.5, fontWeight: 800 }}>{niceFullDate(selected)}</h3>
            </div>
            <button type="button" aria-label="Close day details" onClick={() => setSelected(null)} style={{
              flex: "none", width: 26, height: 26, padding: 0, borderRadius: "50%", border: "none", background: "rgba(14,58,71,0.08)", color: T.ink,
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}><X size={12} /></button>
          </div>
          {selectedInfo.duties.length === 0 ? (
            <div style={{ fontSize: 12.5, color: T.inkSoft }}>No duty scheduled{selectedInfo.anyNonOfficial ? " — non-official day." : "."}</div>
          ) : selectedInfo.duties.map((d, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 12, background: "rgba(255,255,255,0.85)" }}>
              <span style={d.onCallOnly
                ? { flex: "none", minWidth: 40, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "#FBF1DC", color: "#A5731B", fontWeight: 800, fontSize: 12 }
                : chip(d.color, { flex: "none", minWidth: 40, height: 30, padding: "0 6px", borderRadius: 8, fontSize: d.text.length > 3 ? 10 : 13 })}>
                {d.onCallOnly ? "OC" : d.text}
              </span>
              <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{d.onCallOnly ? "On call" : (d.label || d.text)}</span>
                <span style={{ fontSize: 11.5, color: T.inkSoft }}>
                  {[d.postName, d.deptName].filter(Boolean).join(" · ")}{d.onCall && !d.onCallOnly ? " · on call" : ""}
                </span>
                {d.nonOfficial && WORKED(d.counts) && <span style={{ fontSize: 11, color: "#7A4F00", fontWeight: 600 }}>Counts for non-official payment</span>}
              </span>
            </div>
          ))}
        </section>
      )}

      </div>
      </div>

      {/* Your departments */}
      <section aria-labelledby="edr-own-h" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <h2 id="edr-own-h" style={{ margin: 0, fontFamily: H, fontSize: 17, fontWeight: 700 }}>Your departments</h2>
            <span style={{ fontSize: 12, color: T.inkSoft }}>{orgName ? `${orgName} · you own these` : "You own these"}</span>
          </div>
          {owned.length > 0 && (
            <button type="button" onClick={() => setScreen("members")} style={{
              display: "flex", alignItems: "center", gap: 6, height: 34, padding: "0 14px", borderRadius: 999, border: "none",
              background: "linear-gradient(90deg, #0D4F61, #1F7F9F)", color: "#fff", fontFamily: "inherit", fontSize: 13, fontWeight: 600,
              cursor: "pointer" }}><Users size={15} /> Members</button>
          )}
        </div>
        <div className="edr-dept-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
          {owned.map((d, i) => (
            <DeptCard key={d.id} d={d} i={i} badge={<span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: "#0D4F61", color: "#fff" }}>Owner</span>} />
          ))}
          {owned.length === 0 && !(canAddDepartment && onAddDepartment) && (
            <div style={{ fontSize: 12.5, color: T.inkSoft, border: `1px dashed ${T.line}`, borderRadius: 16, padding: 12 }}>No departments of your own yet.</div>
          )}
          {canAddDepartment && onAddDepartment && (
            <button type="button" onClick={onAddDepartment} title="Add a department" aria-label="Add a department" className="edr-home-dept" style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 54, borderRadius: 18,
              border: "1.5px dashed rgba(13,79,97,0.45)", background: "rgba(255,255,255,0.3)", color: "#0D4F61",
              fontFamily: "inherit", fontWeight: 600, fontSize: 13, cursor: "pointer" }}><Plus size={16} /><span className="edr-dept-text">Add a department</span></button>
          )}
        </div>
      </section>

      {/* Shared with you */}
      <section aria-labelledby="edr-shared-h" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <h2 id="edr-shared-h" style={{ margin: 0, fontFamily: H, fontSize: 17, fontWeight: 700 }}>Your shared departments</h2>
          <span style={{ fontSize: 12, color: T.inkSoft }}>Owned by someone else and shared with you</span>
        </div>
        {memberships.length === 0 ? (
          <div style={{ fontSize: 12.5, color: T.inkSoft, border: `1px dashed ${T.line}`, borderRadius: 16, padding: 12, lineHeight: 1.5 }}>
            No departments have been shared with you yet. When someone invites you to their department, it will appear here.
          </div>
        ) : (
          <div className="edr-dept-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 10 }}>
            {memberships.map((d, i) => (
              <DeptCard key={d.id} d={d} i={i + owned.length}
                badge={<span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: "rgba(255,255,255,0.85)", border: "1px solid rgba(14,58,71,0.25)", color: T.ink }}>{roleLabel(d.role)}</span>}
                sub={String(d.role || "").toLowerCase() === "employee" ? "View only" : null} />
            ))}
          </div>
        )}
      </section>

      {/* Account and billing history. Until the redesigned Your account
          screen (step 6) gathers these together, both are reached from here
          on every screen size — the side menu's Your account opens the first. */}
      <section aria-label="Your account" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" onClick={() => setScreen("account")} style={pillBtn}><User size={15} /> Your account</button>
        <button type="button" onClick={() => setScreen("history")} style={pillBtn}><CreditCard size={15} /> Subscription history</button>
      </section>
    </div>
  );
}

const roundBtn = {
  width: 34, height: 34, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.95)", background: "rgba(255,255,255,0.7)",
  color: "#0E3A47", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0,
};
const pillBtn = {
  display: "flex", alignItems: "center", gap: 6, minHeight: 36, padding: "0 14px", borderRadius: 999,
  border: "1px solid rgba(14,58,71,0.18)", background: "rgba(255,255,255,0.7)", color: "#0E3A47",
  fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
