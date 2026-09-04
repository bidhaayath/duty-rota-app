import React, { useState, useEffect, useMemo } from "react";
import {
  LayoutDashboard, Users, ChevronLeft, ChevronRight, Plus,
  Settings, CreditCard, User, LogOut,
} from "lucide-react";
import supabase from "./supabaseClient";
import Account from "./Account";

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
      return { deptName: d.name, staffId: mine.id, codes: rota.codes || [], cells: rota.cells || {} };
    }).filter(Boolean);
  }, [departments, rotasByDept, email]);

  const dutiesOn = (dateStr) => {
    const out = [];
    myMemberships.forEach((m) => {
      const codeId = (m.cells[dateStr] || {})[m.staffId];
      if (!codeId) return;
      const code = m.codes.find((c) => c.id === codeId);
      out.push({
        text: code ? code.code : codeId,
        color: code ? code.color : T.mist,
        deptName: m.deptName,
      });
    });
    return out;
  };

  const grid = monthGrid(view.year, view.month);
  const todaysDuties = dutiesOn(dstr(today));
  const prevMonth = () => setView((v) => (v.month === 0 ? { year: v.year - 1, month: 11 } : { year: v.year, month: v.month - 1 }));
  const nextMonth = () => setView((v) => (v.month === 11 ? { year: v.year + 1, month: 0 } : { year: v.year, month: v.month + 1 }));

  const logout = async () => {
    if (!window.confirm("Sign out of EasyDutyRota?")) return;
    await supabase.auth.signOut();
    window.location.reload();
  };

  /* ── Sidebar pieces ── */
  const SectionHead = ({ icon: Icon, children, note, soon = false }) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{
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
      {note && <div style={{ fontSize: 11.5, color: T.inkSoft, padding: "6px 2px 0" }}>{note}</div>}
    </div>
  );

  const DeptRow = ({ id, name, tag }) => (
    <button
      className="dr-dash-item"
      onClick={() => onOpenDepartment && onOpenDepartment(id)}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        width: "100%", textAlign: "left", cursor: "pointer", marginBottom: 7,
        background: "#fff", border: `1px solid ${T.line}`, borderRadius: 9,
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
        background: "#fff", border: `1px solid ${T.line}`, borderRadius: 9,
        padding: "10px 13px", fontFamily: "inherit", fontSize: 13.5, fontWeight: 600,
        color: soon ? T.inkSoft : (danger ? T.coral : T.ink), opacity: soon ? 0.7 : 1,
      }}
    >
      <Icon size={15} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{label}</span>
      {soon && <span style={{
        fontSize: 10.5, fontWeight: 700, color: T.inkSoft, background: T.mist,
        border: `1px solid ${T.line}`, borderRadius: 999, padding: "1px 7px",
      }}>Soon</span>}
    </button>
  );

  if (screen === "account") {
    return <Account onBack={() => setScreen("home")} />;
  }

  if (loading) {
    return (
      <div style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 60, textAlign: "center", color: T.inkSoft }}>
        Loading your dashboard…
      </div>
    );
  }

  return (
    <div className="dr-fade-in" style={{
      fontFamily: "Inter, system-ui, sans-serif", color: T.ink,
      background: T.mist, minHeight: "100vh",
    }}>
      <style>{`
        .dr-dash-item { transition: background 140ms ease, border-color 140ms ease, transform 140ms ease; }
        .dr-dash-item:hover { background: ${T.mist}; border-color: #C7DBD7; }
        .dr-dash-item:active { transform: scale(0.99); }
        .dr-dash-item:focus-visible { outline: 2px solid ${T.lagoon}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { .dr-dash-item { transition: none; } }
        @media (max-width: 900px) { .dr-dash-wrap { grid-template-columns: 1fr !important; } }
      `}</style>

      <div className="dr-dash-wrap" style={{
        display: "grid", gridTemplateColumns: "310px 1fr", gap: 26,
        maxWidth: 1250, margin: "0 auto", padding: "24px 22px 44px",
        alignItems: "start",
      }}>
        {/* ── Sidebar ── */}
        <aside style={{ display: "flex", flexDirection: "column" }}>
          <SectionHead icon={LayoutDashboard} note={orgName || "You can name your organisation in Settings."}>
            My Organisation
          </SectionHead>
          {owned.length === 0
            ? <div style={{
                fontSize: 12.5, color: T.inkSoft, border: `1px dashed ${T.line}`,
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
                cursor: "pointer", marginBottom: 7, background: "#fff",
                border: `1px dashed ${T.line}`, borderRadius: 9, padding: "10px 13px",
                fontFamily: "inherit", fontSize: 13, fontWeight: 600, color: T.lagoon,
              }}
            ><Plus size={15} /> Add a department</button>
          )}

          <div style={{ height: 14 }} />

          <SectionHead
            icon={Users}
            soon={memberships.length === 0}
            note={memberships.length === 0 ? null : "Departments shared with you."}
          >My Membership</SectionHead>
          {memberships.length === 0
            ? <div style={{
                fontSize: 12.5, color: T.inkSoft, border: `1px dashed ${T.line}`,
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
          <MenuRow icon={CreditCard} label="Subscription history" soon />

          <div style={{ height: 14 }} />

          <SectionHead icon={CreditCard}>My Plans</SectionHead>
          <MenuRow icon={CreditCard} label="View my plan" onClick={onOpenPlans} soon={!onOpenPlans} />

          <div style={{ height: 14 }} />
          <MenuRow icon={LogOut} label="Log out" onClick={logout} danger />
        </aside>

        {/* ── Calendar ── */}
        <main style={{
          background: "#fff", border: `1px solid ${T.line}`, borderRadius: 14,
          padding: "22px 22px 26px",
        }}>
          <h1 style={{
            fontFamily: "Sora, sans-serif", fontSize: 25, fontWeight: 700, color: T.lagoon,
            textAlign: "center", margin: "0 0 4px", letterSpacing: -0.3,
          }}>Welcome, {displayName}!</h1>
          <p style={{ textAlign: "center", color: T.inkSoft, fontSize: 13, margin: "0 0 20px" }}>
            Your duties across every department, in one place.
          </p>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: 14 }}>
            <button className="dr-dash-item" onClick={prevMonth} aria-label="Previous month" style={navBtn}><ChevronLeft size={18} /></button>
            <div style={{ fontFamily: "Sora, sans-serif", fontSize: 16.5, fontWeight: 600, minWidth: 180, textAlign: "center" }}>
              {MONTHS[view.month]} {view.year}
            </div>
            <button className="dr-dash-item" onClick={nextMonth} aria-label="Next month" style={navBtn}><ChevronRight size={18} /></button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
            {DAY_NAMES.map((d) => (
              <div key={d} style={{ textAlign: "center", fontSize: 10.5, fontWeight: 700, color: T.inkSoft, letterSpacing: 0.5, padding: "4px 0" }}>{d}</div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {grid.map((week, wi) => (
              <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
                {week.map((date) => {
                  const inMonth = date.getMonth() === view.month;
                  const isToday = sameDay(date, today);
                  const duties = inMonth ? dutiesOn(dstr(date)) : [];
                  return (
                    <div key={dstr(date)} style={{
                      minHeight: duties.length ? 58 : 38, borderRadius: 8, padding: "5px 6px",
                      /* A day with nothing on it recedes: no fill, a fainter
                         edge. Days that carry a duty keep the white card, so
                         the eye lands on them first. */
                      background: !inMonth ? "transparent" : (duties.length ? "#fff" : "#FBFDFC"),
                      border: isToday
                        ? `1.5px solid ${T.lagoon}`
                        : `1px solid ${inMonth && duties.length ? T.line : "#E9F0EE"}`,
                      opacity: inMonth ? 1 : 0.45,
                    }}>
                      <div style={{ marginBottom: duties.length ? 4 : 0 }}>
                        <span style={{
                          display: "inline-flex", alignItems: "center", justifyContent: "center",
                          minWidth: 19, height: 19, borderRadius: 999, padding: "0 5px",
                          fontSize: 11, fontWeight: 700, lineHeight: 1,
                          background: isToday ? T.lagoon : "transparent",
                          color: isToday ? "#fff" : T.inkSoft,
                        }}>{pad(date.getDate())}</span>
                      </div>
                      {duties.map((duty, i) => (
                        <div key={i} title={`${duty.text} — ${duty.deptName}`} style={{
                          background: duty.color, color: textOn(duty.color),
                          borderRadius: 6, padding: "3px 6px", marginBottom: 3,
                          overflow: "hidden", border: `1px solid rgba(0,0,0,0.06)`,
                        }}>
                          {/* The code leads — it's what you read at a glance.
                              The department sits under it, full text so nothing
                              needs decoding, but lighter so it doesn't compete. */}
                          <div style={{ fontSize: 11, fontWeight: 800, lineHeight: 1.2, letterSpacing: 0.1 }}>{duty.text}</div>
                          <div style={{
                            fontSize: 9.5, fontWeight: 500, lineHeight: 1.3, opacity: 0.85,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>{duty.deptName}</div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div style={{ textAlign: "center", marginTop: 18, fontSize: 14.5, fontWeight: 600 }}>
            {todaysDuties.length === 0
              ? <span style={{ color: T.inkSoft }}>Today — no duty scheduled</span>
              : <span>Today — {todaysDuties.map((d) => `${d.text} (${d.deptName})`).join(" · ")}</span>}
          </div>

          <p style={{ textAlign: "center", color: T.inkSoft, fontSize: 11.5, margin: "20px 0 0", lineHeight: 1.6 }}>
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
  background: "#fff", border: `1px solid ${T.line}`, color: T.ink,
};