import React, { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard, Users, ChevronLeft, ChevronRight, Plus,
  Settings, CreditCard, User, LogOut,
} from "lucide-react";
import supabase from "./supabaseClient";
import Account from "./Account";
import SubscriptionHistory from "./SubscriptionHistory";
import Members from "./Members";

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
  ink: "#142B33", inkSoft: "#4A6570", mist: "#EEF4F3", card: "#FFFFFF",
  line: "#DCE8E6", lagoon: "#0F8B7E", coral: "#E4604E",
};
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
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
  deptPerms = null,
  orgName = "",
  loadRota,
  onOpenDepartment,
  onAddDepartment = null,
  canAddDepartment = false,
  onOpenPlans = null,
}) {
  /* Which full screen is showing. "home" is the calendar; "account" is the
     account screen reached from the sidebar. Kept here rather than in the
     parent so the sidebar owns its own navigation. */
  const [screen, setScreen] = useState("home");
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

  /* Owned vs shared. With no permission info (legacy single-organisation
     accounts, or the lookup hasn't landed yet) treat a department as owned —
     that's how a solo owner's departments have always behaved. Only an
     explicit is_owner === false moves one under My Membership. */
  const owned = [];
  const memberships = [];
  departments.forEach((d) => {
    const perm = deptPerms ? deptPerms.get(d.id) : null;
    if (perm && perm.isOwner === false) memberships.push({ ...d, role: perm.role });
    else owned.push(d);
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
        deptName: d.name, staffId: mine.id,
        codes: rota.codes || [], cells: rota.cells || {},
        // Needed to mark non-official days and on-call turns. Both are
        // per department, so someone in two departments can have a day
        // that is non-official in one and ordinary in the other.
        onCall: rota.onCall || {},
        posts: rota.posts || [],
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
      // One entry per duty, so a split shift shows both.
      entriesOf((m.cells[dateStr] || {})[m.staffId]).forEach((entry) => {
        const code = m.codes.find((c) => c.id === entry.code);
        if (!code && !entry.code) return;
        // Cells store the post id, so the name is looked up here. A post that
        // has since been deleted resolves to nothing and simply is not shown.
        const post = (m.posts || []).find((x) => x.id === entry.post);
        duties.push({
          postName: post ? post.name : "",
          text: code ? code.code : "?",
          label: code ? (code.label || "") : "",
          // The post id from the department list, resolved to a name below.
          post: entry.post || "",
          color: code ? code.color : T.mist,
          deptName: m.deptName,
          nonOfficial: nonOff,
          onCall,
        });
      });
      // On call with no duty rostered still deserves a line in the panel.
      if (onCall && !entriesOf((m.cells[dateStr] || {})[m.staffId]).length) {
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

  const logout = async () => {
    if (!window.confirm("Sign out of EasyDutyRota?")) return;
    await supabase.auth.signOut();
    window.location.reload();
  };

  /* ── Sidebar pieces ── */
  const SectionHead = ({ icon: Icon, children, note, soon = false }) => (
    <div style={{ marginBottom: 8 }}>
      <div className="dr-dash-sec" style={{
        background: T.lagoon, color: "#fff", borderRadius: 10, padding: "11px 14px",
        fontFamily: "Sora, sans-serif", fontSize: 14.5, fontWeight: 600,
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <Icon size={16} />
        <span style={{ flex: 1 }}>{children}</span>
        {soon && <span style={{
          fontSize: 10.5, fontWeight: 700, color: "#fff", letterSpacing: 0.2,
          background: "rgba(255,255,255,0.22)", border: "1px solid rgba(255,255,255,0.35)",
          borderRadius: 999, padding: "1px 8px",
        }}>Soon</span>}
      </div>
      {note && <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.72)", padding: "6px 2px 0" }}>{note}</div>}
    </div>
  );

  const DeptRow = ({ id, name, tag }) => (
    <button
      className="dr-dash-item"
      onClick={() => onOpenDepartment && onOpenDepartment(id)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        width: "100%", textAlign: "left", cursor: "pointer", marginBottom: 7,
        background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.28)", borderRadius: 10,
        padding: "10px 13px", fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, color: T.ink,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      {tag && <span style={{
        fontSize: 11, fontWeight: 700, color: T.lagoon, background: T.mist,
        border: `1px solid ${T.line}`, borderRadius: 999, padding: "2px 8px", flexShrink: 0,
      }}>{tag}</span>}
    </button>
  );

  const MenuRow = ({ icon: Icon, label, onClick, soon = false, danger = false }) => (
    <button
      className={soon ? undefined : "dr-dash-item"}
      onClick={soon ? undefined : onClick}
      disabled={soon}
      title={soon ? "Coming soon" : undefined}
      style={{
        display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
        cursor: soon ? "default" : "pointer", marginBottom: 7,
        background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.28)", borderRadius: 9,
        padding: "10px 13px", fontFamily: "inherit", fontSize: 13.5, fontWeight: 600,
        color: soon ? "rgba(255,255,255,0.6)" : (danger ? "#FFB4A6" : "#fff"), opacity: soon ? 0.7 : 1,
      }}
    >
      <Icon size={15} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
      {soon && <span style={{
        fontSize: 10.5, fontWeight: 700, color: "rgba(255,255,255,0.85)", background: "rgba(255,255,255,0.18)",
        border: `1px solid ${T.line}`, borderRadius: 999, padding: "1px 7px",
      }}>Soon</span>}
    </button>
  );

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

  return (
    <div className="dr-fade-in dr-theme" style={{
      fontFamily: "Inter, system-ui, sans-serif", color: "#fff",
      minHeight: "100vh", position: "relative", overflow: "hidden",
      /* The sign-in page's background, brought inside: a deep blue-teal
         gradient with a few large soft-focus blobs drifting over it. The
         blobs are what the frosted panels pick up — without something
         behind it, glass is just a pale rectangle. */
      background: "linear-gradient(140deg,#1B6F8C 0%,#1E7D96 35%,#2A6FA8 70%,#3B6FB5 100%)",
      backgroundAttachment: "fixed",
    }}>
      {/* Decorative only. Absolute rather than fixed: a fixed layer covers the
         whole viewport, including the top bar this component does not own, and
         a blurred blob drifting over it washed out the My plan and Logout
         buttons. Absolute keeps the blobs inside the dashboard where they
         belong. */}
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
        <span style={{ position: "absolute", width: 420, height: 420, borderRadius: "50%", background: "#7FD4C1", filter: "blur(90px)", opacity: 0.5, top: -120, right: -80 }} />
        <span style={{ position: "absolute", width: 360, height: 360, borderRadius: "50%", background: "#8FA8E8", filter: "blur(90px)", opacity: 0.45, bottom: -110, right: 40 }} />
        <span style={{ position: "absolute", width: 300, height: 300, borderRadius: "50%", background: "#E8C07F", filter: "blur(85px)", opacity: 0.36, bottom: 80, left: -110 }} />
        <span style={{ position: "absolute", width: 380, height: 380, borderRadius: "50%", background: "#6FC9E8", filter: "blur(90px)", opacity: 0.4, top: 120, left: -140 }} />
      </div>
      <style>{`
        /* ── Liquid glass ──
           Frosted surfaces for the frame: the card, the panel, the sidebar
           rows. A light top edge makes each surface look like it catches the
           light from above, which is what stops it reading as a flat grey box.

           The duty chips inside the calendar are deliberately left solid.
           Their job is being read at a glance, and frosting them would wash
           the colours into each other — the one thing on this screen that
           must stay crisp. Glass around the data, not over it. */
        .dr-glass {
          background: rgba(255,255,255,0.14);
          -webkit-backdrop-filter: blur(22px) saturate(140%);
          backdrop-filter: blur(22px) saturate(140%);
          border: 1px solid rgba(255,255,255,0.30);
          box-shadow: 0 10px 34px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.40);
        }
        .dr-glass-soft {
          background: rgba(255,255,255,0.13);
          -webkit-backdrop-filter: blur(14px) saturate(130%);
          backdrop-filter: blur(14px) saturate(130%);
          border: 1px solid rgba(255,255,255,0.26);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.32);
        }
        /* Without backdrop-filter a translucent panel over this background is
           unreadable, so the surfaces fall back to a solid deep blue. */
        @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
          .dr-glass { background: rgba(16,74,96,0.92); }
          .dr-glass-soft { background: rgba(16,74,96,0.86); }
        }

        /* ── Text on the dark background ──
           The screen was built for dark ink on white, so every colour below is
           inverted here rather than edited in thirty-five places inline. Scoped
           to .dr-theme so nothing else in the app is touched.

           The duty chips and the rows inside the day panel are deliberately
           excluded: they carry their own colours and must stay crisp. */
        .dr-theme .dr-dash-title { color: #fff !important; }
        .dr-theme .dr-dash-sub { color: rgba(255,255,255,0.75) !important; }
        .dr-theme .dr-dash-month { color: #fff !important; }
        .dr-theme .dr-dash-dow { color: rgba(255,255,255,0.7) !important; }
        .dr-theme .dr-dash-pdate { color: #fff !important; }
        .dr-theme .dr-dash-daynum { color: rgba(255,255,255,0.82) !important; }
        .dr-theme .dr-dash-item { color: #fff !important; }
        /* The section headings sat at the same tone as the rows under them, so
           a heading looked like one more item in the list. Mint sets them apart
           and ties them to the other markers in this theme — today, the selected
           day, the TODAY badge — rather than introducing another colour. */
        .dr-theme .dr-dash-sec {
          background: linear-gradient(135deg, rgba(11,58,79,0.62), rgba(11,58,79,0.40)) !important;
          border: 1px solid rgba(255,255,255,0.22) !important;
          color: #FFFFFF !important;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.18) !important;
          letter-spacing: 0.2px;
        }
        /* The icon keeps the mint so the heading still belongs to this theme
           while the bar itself sits back and lets the department names lead. */
        .dr-theme .dr-dash-sec svg { color: #8FE3D2; }
        .dr-theme .dr-dash-item:hover {
          background: rgba(255,255,255,0.24) !important;
          border-color: rgba(255,255,255,0.45) !important;
        }
        .dr-dash-item { transition: background 140ms ease, border-color 140ms ease, transform 140ms ease; }
        .dr-dash-item:hover { background: rgba(255,255,255,0.78); border-color: rgba(15,139,126,0.35); }
        .dr-dash-item:active { transform: scale(0.99); }
        .dr-dash-item:focus-visible { outline: 2px solid ${T.lagoon}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { .dr-dash-item { transition: none; } }
        @media (max-width: 900px) {
          .dr-dash-wrap { grid-template-columns: 1fr !important; gap: 16px !important; }
          /* The calendar is why an employee opens this on a phone, so it
             comes first; the organisation and account menus follow. */
          .dr-dash-main { order: 1; }
          .dr-dash-side { order: 2; }
        }
        /* Phone typography. The desktop sizes are comfortable on a wide
           screen and shouty on a 380px one, so everything steps down and
           the padding tightens to give the grid its width back. */
        @media (max-width: 640px) {
          .dr-dash-main { padding: 14px 11px 18px !important; border-radius: 11px !important; }
          .dr-dash-title { font-size: 18px !important; margin-bottom: 2px !important; }
          .dr-dash-sub { font-size: 11.5px !important; margin-bottom: 13px !important; }
          .dr-dash-month { font-size: 14px !important; min-width: 128px !important; }
          .dr-dash-dow { font-size: 9px !important; padding: 2px 0 !important; }
          .dr-dash-day { padding: 3px 3px !important; border-radius: 7px !important; }
          .dr-dash-code { font-size: 10px !important; }
          .dr-dash-task { font-size: 8.5px !important; }
          .dr-dash-panel { padding: 11px 12px !important; margin-top: 14px !important; }
          .dr-dash-pdate { font-size: 13px !important; }
          .dr-dash-sec { font-size: 13px !important; padding: 9px 12px !important; }
          .dr-dash-item { font-size: 12.5px !important; padding: 9px 11px !important; }
        }
        /* Fit the whole month on one screen. A phone user wants to see the
           shape of their month at a glance, not scroll through it, so the
           cells lose their padding and the duty chips become compact bars.
           Text stays legible; what goes is the space around it. */
        @media (max-width: 640px) {
          .dr-dash-grid { gap: 2px !important; }
          .dr-dash-day {
            min-height: 0 !important; padding: 2px 2px 3px !important;
            border-radius: 5px !important; overflow: hidden;
          }
          .dr-dash-daynum { font-size: 9.5px !important; min-width: 15px !important; height: 15px !important; }
          .dr-dash-oc { font-size: 7.5px !important; padding: 1px 2.5px !important; }
          .dr-dash-duty {
            padding: 1px 3px !important; margin-bottom: 2px !important;
            border-radius: 4px !important;
          }
          .dr-dash-code { font-size: 9px !important; line-height: 1.15 !important; }
          .dr-dash-task { font-size: 7.5px !important; line-height: 1.15 !important; }
        }
      `}</style>

      <div className="dr-dash-wrap" style={{
        position: "relative", zIndex: 1,
        display: "grid", gridTemplateColumns: "310px 1fr", gap: 26,
        maxWidth: 1250, margin: "0 auto", padding: "24px 22px 44px",
        alignItems: "start",
      }}>
        {/* ── Sidebar ── */}
        <aside className="dr-dash-side" style={{ display: "flex", flexDirection: "column" }}>
          <SectionHead icon={LayoutDashboard} note={orgName || "You can name your organisation in Settings."}>
            My Organisation
          </SectionHead>
          {owned.length === 0
            ? <div style={{
                fontSize: 12.5, color: "rgba(255,255,255,0.75)", border: "1px dashed rgba(255,255,255,0.32)",
                borderRadius: 9, padding: "12px 14px", lineHeight: 1.6, marginBottom: 7,
              }}>
                No departments of your own yet.
              </div>
            : owned.map((d) => <DeptRow key={d.id} id={d.id} name={d.name} />)}
          {canAddDepartment && onAddDepartment && (
            <button
              className="dr-dash-item"
              onClick={onAddDepartment}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                cursor: "pointer", marginBottom: 7, background: "rgba(255,255,255,0.16)",
                border: `1px dashed ${T.line}`, borderRadius: 9, padding: "10px 13px",
                fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: T.lagoon,
              }}
            ><Plus size={15} /> Add a department</button>
          )}

          {/* Who can get into this organisation. Owners only — a member has
              no business seeing, or removing, anyone else's access. */}
          {owned.length > 0 && (
            <MenuRow icon={Users} label="Members" onClick={() => setScreen("members")} />
          )}

          <div style={{ height: 14 }} />

          <SectionHead
            icon={Users}
            soon={memberships.length === 0}
            note={memberships.length === 0 ? null : "Departments shared with you."}
          >My Membership</SectionHead>
          {memberships.length === 0
            ? <div style={{
                fontSize: 12.5, color: "rgba(255,255,255,0.75)", border: "1px dashed rgba(255,255,255,0.32)",
                borderRadius: 9, padding: "12px 14px", lineHeight: 1.6, marginBottom: 7,
              }}>
                Sharing a department with your team is coming soon. When it
                arrives, departments shared with you will appear here.
              </div>
            : memberships.map((d) => (
                <DeptRow key={d.id} id={d.id} name={d.name} tag={roleLabel(d.role)} />
              ))}

          <div style={{ height: 14 }} />

          <SectionHead icon={Settings}>Settings</SectionHead>
          <MenuRow icon={User} label="Your account" onClick={() => setScreen("account")} />
          <MenuRow icon={CreditCard} label="Subscription history" onClick={() => setScreen("history")} />

          <div style={{ height: 14 }} />

          <SectionHead icon={CreditCard}>My Plans</SectionHead>
          <MenuRow icon={CreditCard} label="View my plan" onClick={onOpenPlans} soon={!onOpenPlans} />

          <div style={{ height: 14 }} />
          <MenuRow icon={LogOut} label="Log out" onClick={logout} danger />
        </aside>

        {/* ── Calendar ── */}
        <main className="dr-dash-main dr-glass" style={{
          borderRadius: 16, padding: "22px 22px 26px",
        }}>
          <h1 className="dr-dash-title" style={{
            fontFamily: "Sora, sans-serif", fontSize: 25, fontWeight: 700, color: T.lagoon,
            textAlign: "center", margin: "0 0 4px", letterSpacing: -0.3,
          }}>Welcome, {displayName}!</h1>
          <p className="dr-dash-sub" style={{ textAlign: "center", color: T.inkSoft, fontSize: 13, margin: "0 0 20px" }}>
            Your duties across every department, in one place.
          </p>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 14 }}>
            <button className="dr-dash-item" onClick={prevMonth} aria-label="Previous month" style={navBtn}><ChevronLeft size={18} /></button>
            <div className="dr-dash-month" style={{ fontFamily: "Sora, sans-serif", fontSize: 16.5, fontWeight: 600, minWidth: 180, textAlign: "center" }}>
              {MONTHS[view.month]} {view.year}
            </div>
            <button className="dr-dash-item" onClick={nextMonth} aria-label="Next month" style={navBtn}><ChevronRight size={18} /></button>
          </div>

          <div className="dr-dash-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4, marginBottom: 4 }}>
            {DAY_NAMES.map((d) => (
              <div key={d} className="dr-dash-dow" style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700, color: T.inkSoft, letterSpacing: 0.5, padding: "4px 0" }}>{d}</div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {grid.map((week, wi) => (
              <div key={wi} className="dr-dash-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
                {week.map((date) => {
                  const ds = dstr(date);
                  const inMonth = date.getMonth() === view.month;
                  const isToday = sameDay(date, today);
                  const isSelected = ds === selected;
                  /* Neighbouring-month days carry their duties too. A shift on
                     the 30th of August is still a shift, and leaving those cells
                     blank made the start of a month look emptier than it is. They
                     are faded so the month in view still reads as the subject. */
                  const info = dayInfo(ds);
                  const duties = info.duties.filter((d) => !d.onCallOnly);
                  return (
                    <button
                      key={ds}
                      onClick={() => {
                        // Tapping a day from the month either side moves the
                        // calendar there, rather than describing a day that is
                        // barely visible at the edge of the grid.
                        if (!inMonth) setView({ year: date.getFullYear(), month: date.getMonth() });
                        setSelected(ds);
                      }}
                      aria-label={niceFullDate(ds)}
                      className="dr-dash-day"
                      style={{
                        position: "relative",
                        textAlign: "left", fontFamily: "inherit", cursor: "pointer",
                        minHeight: duties.length ? 58 : 38, borderRadius: 10, padding: "5px 6px",
                        /* Deliberately NOT frosted. Glass belongs on the few big
                           surfaces — the card and the panel below — the way it
                           works on the sign-in page. Giving all 42 cells their own
                           frosted panel made every empty day look like something
                           worth reading, and the month stopped being scannable.

                           So: a day with duties gets a quiet white card, a day
                           without gets nothing at all beyond its number, and the
                           gold of a non-official day still shows through. */
                        background: !inMonth ? "transparent"
                          : info.anyNonOfficial ? "rgba(243,217,164,0.26)"
                          : duties.length ? "rgba(255,255,255,0.12)"
                          : "transparent",
                        /* Faded rather than hidden: enough to read, not enough to
                           be mistaken for part of this month. Days with a duty stay
                           a little clearer than empty ones. */
                        /* Lagoon is too dark to read as a highlight here, so the
                           selected and today markers use the pale mint from the
                           sign-in palette instead. */
                        border: isSelected
                          ? "2px solid #8FE3D2"
                          : isToday
                            ? "1.5px solid rgba(143,227,210,0.75)"
                            : (inMonth && (duties.length || info.anyNonOfficial))
                              ? "1px solid rgba(255,255,255,0.22)"
                              : "1px solid transparent",
                        boxShadow: isSelected ? "0 4px 18px rgba(143,227,210,0.28)" : "none",
                        opacity: inMonth ? 1 : (duties.length ? 0.45 : 0.3),
                      }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: duties.length ? 4 : 0 }}>
                        <span className="dr-dash-daynum" style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          minWidth: 19, height: 19, borderRadius: 999, padding: "0 5px",
                          fontSize: 11, fontWeight: 700, lineHeight: 1,
                          background: isToday ? "#8FE3D2" : "transparent",
                          color: isToday ? "#0E4C4A" : (info.anyNonOfficial ? "#F3D9A4" : "rgba(255,255,255,0.82)"),
                        }}>{pad(date.getDate())}</span>
                        {/* On call is a state, not a duty, so it gets a mark
                            rather than a block of its own. */}
                        {/* Pinned to the corner rather than sitting beside the
                            date: in a narrow cell the two competed for width and
                            this was the one that got clipped. */}
                        {info.anyOnCall && (
                          <span title="On call" className="dr-dash-oc" style={{
                            position: "absolute", top: 2, right: 2,
                            fontSize: 8.5, fontWeight: 800, letterSpacing: 0.2, lineHeight: 1,
                            color: "#5C3F08", background: "#F3D9A4",
                            borderRadius: 4, padding: "2px 3px",
                          }}>OC</span>
                        )}
                      </div>
                      {/* The cell carries the duty and its task only. Which
                          department, and what the code means, are in the panel
                          below — a month grid has no room to say everything. */}
                      {duties.map((duty, i) => (
                        <div key={i} className="dr-dash-duty" style={{
                          background: duty.color, color: textOn(duty.color),
                          borderRadius: 6, padding: "3px 6px", marginBottom: 3,
                          overflow: "hidden", border: "1px solid rgba(0,0,0,0.06)",
                        }}>
                          <div className="dr-dash-code" style={{ fontSize: 11, fontWeight: 800, lineHeight: 1.2 }}>{duty.text}</div>
                          {duty.postName && (
                            <div className="dr-dash-task" style={{
                              fontSize: 9.5, fontWeight: 500, lineHeight: 1.3, opacity: 0.9,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>{duty.postName}</div>
                          )}
                        </div>
                      ))}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {/* ── The day in detail ──
              The grid can only carry a code and a task. Everything else that
              matters — which department, what the code actually means, whether
              the day counts for payment, whether they are on call — lives here,
              for whichever day is tapped. Opens on today. */}
          <div className="dr-dash-panel dr-glass-soft" style={{
            marginTop: 18, borderRadius: 14, padding: "14px 16px",
            background: selectedInfo.anyNonOfficial ? "rgba(243,217,164,0.22)" : undefined,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 10 }}>
              <span className="dr-dash-pdate" style={{ fontFamily: "Sora, sans-serif", fontSize: 15, fontWeight: 600 }}>
                {niceFullDate(selected)}
              </span>
              {selected === dstr(today) && (
                <span style={{
                  fontSize: 10.5, fontWeight: 700, color: "#0E4C4A", background: "#8FE3D2",
                  borderRadius: 999, padding: "2px 9px",
                }}>TODAY</span>
              )}
              {selectedInfo.anyNonOfficial && (
                <span style={{
                  fontSize: 10.5, fontWeight: 700, color: "#5C3F08", background: "#F3D9A4",
                  border: "1px solid rgba(255,255,255,0.35)", borderRadius: 999, padding: "2px 9px",
                }}>NON-OFFICIAL DAY</span>
              )}
              {selectedInfo.anyOnCall && (
                <span style={{
                  fontSize: 10.5, fontWeight: 700, color: "#5C3F08", background: "#F3D9A4",
                  border: "1px solid rgba(255,255,255,0.35)", borderRadius: 999, padding: "2px 9px",
                }}>ON CALL</span>
              )}
            </div>

            {selectedInfo.duties.length === 0 ? (
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.78)" }}>
                No duty scheduled{selectedInfo.anyNonOfficial ? " — this is a non-official day." : "."}
              </div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {selectedInfo.duties.map((d, i) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 11,
                    /* Solid, not glass: this row carries the duty colour chip
                       and the post name, and both need to stay crisp. */
                    background: "#fff", border: `1px solid ${T.line}`,
                    borderRadius: 9, padding: "10px 12px",
                  }}>
                    <span style={{
                      flexShrink: 0, minWidth: 40, textAlign: "center",
                      background: d.onCallOnly ? "#FBF1DC" : d.color,
                      color: d.onCallOnly ? "#A5731B" : textOn(d.color),
                      border: "1px solid rgba(0,0,0,0.07)", borderRadius: 7,
                      padding: "6px 8px", fontSize: 12.5, fontWeight: 800, lineHeight: 1.2,
                    }}>{d.onCallOnly ? "OC" : d.text}</span>
                    <div style={{ minWidth: 0 }}>
                      {/* This row is solid white so the duty colour stays crisp,
                         which means its text must set a dark colour explicitly.
                         Without it the line inherits the white used everywhere
                         else on this theme and disappears. */}
                      <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35, color: T.ink }}>
                        {d.onCallOnly ? "On call" : (d.label || d.text)}
                        {d.postName && <span style={{ fontWeight: 500, color: T.inkSoft }}> — {d.postName}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 2 }}>
                        {d.deptName}
                        {d.onCall && !d.onCallOnly && " · on call"}
                        {d.nonOfficial && " · counts as non-official day duty"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p style={{ textAlign: "center", color: "rgba(255,255,255,0.7)", fontSize: 11.5, margin: "20px 0 0", lineHeight: 1.6 }}>
            A duty appears here when a staff row in that department carries your
            login email. This view is read-only — open a department to make changes.
          </p>
        </main>
      </div>
    </div>
  );
}

const navBtn = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 34, height: 34, borderRadius: 9, cursor: "pointer",
  background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.28)", color: "#fff",
};