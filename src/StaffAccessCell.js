import React, { useState, useEffect, useCallback } from "react";
import supabase from "./supabaseClient";

/* ────────────────────────────────────────────────────────────────────────
   The Access column on the Staff tab.

   Before this, the column showed whatever "access level" was typed onto the
   staff row — a value nothing read. Someone could be shown as "Manager" and
   still be view-only, because real permission lives on their organisation
   membership. A control that lies is worse than no control, so this shows
   the TRUE state and makes the dropdown actually change it.

   Three states per staff row, decided by their email:
     • no access      → an Invite button (the owner's only action)
     • invited        → "Invitation sent", with nothing to change yet
     • a real member  → a role dropdown that updates their membership

   ROLE IS ORGANISATION-WIDE. That is what the database stores: one role per
   person per organisation, not per department. Making someone a manager lets
   them edit every department they belong to in that organisation, so the
   confirmation says exactly that rather than implying it is local.

   DATA SAFETY
     Reading uses org_members_list(), which refuses anyone who is not the
     owner. Changing a role updates one column on one organisation_members
     row, guarded by the existing policy (owner only, and never the owner's
     own row). It touches no rota, no staff record and no duties.
   ──────────────────────────────────────────────────────────────────────── */

const T = {
  ink: "#142B33", inkSoft: "#4A6570", mist: "#EEF4F3",
  line: "#DCE8E6", lagoon: "#0F8B7E", coral: "#E4604E",
  warn: "#8A5A0F", warnBg: "#FBF1DC", warnLine: "#E7D9B8",
};

/* Loads who has access to this organisation, keyed by email. One call for
   the whole staff table rather than one per row. */
export function useOrgAccess(deptId) {
  const [access, setAccess] = useState(null); // null = not loaded yet
  const [isOwner, setIsOwner] = useState(false);

  /* Ask about the organisation that owns THIS department, not whichever
     organisation the viewer happens to own. A manager looking at someone
     else's department is not its owner, so they get an empty list and the
     Access column offers them nothing. */
  const refresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("org_members_list",
      deptId ? { p_dept_id: deptId } : {});
    if (error || !data || !data.ok) { setAccess(new Map()); setIsOwner(false); return; }
    const m = new Map();
    (data.members || []).forEach((x) => {
      m.set((x.email || "").toLowerCase(), {
        status: "member",
        role: x.role,
        memberId: x.member_id,
        departments: x.departments || [],
      });
    });
    (data.invites || []).forEach((x) => {
      const key = (x.email || "").toLowerCase();
      // A real membership always wins over a leftover invitation.
      if (m.has(key)) return;
      m.set(key, {
        status: "pending",
        role: x.role,
        inviteId: x.invite_id,
        expired: !!x.expired,
      });
    });
    setAccess(m);
    setIsOwner(!!data.is_owner);
  }, [deptId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { access, isOwner, refresh };
}

const chip = (bg, border, color) => ({
  display: "inline-block", fontSize: 11.5, fontWeight: 700, background: bg,
  border: `1px solid ${border}`, color, borderRadius: 999, padding: "2px 9px",
  whiteSpace: "nowrap",
});

export default function StaffAccessCell({
  email,
  deptId,          // the department whose Staff tab this is
  access,          // Map from useOrgAccess, or null while loading
  isOwner = false,
  onInvite,        // () => void — opens the invite dialog for this staff row
  onChanged,       // () => void — refresh after a change
}) {
  const [busy, setBusy] = useState(false);
  const key = (email || "").trim().toLowerCase();

  if (!key) return <span style={{ color: T.inkSoft }}>—</span>;
  if (access == null) return <span style={{ color: T.inkSoft, fontSize: 12 }}>…</span>;

  const entry = access.get(key);

  /* ── Not invited yet ── */
  if (!entry) {
    if (!isOwner) return <span style={{ color: T.inkSoft }}>—</span>;
    return (
      <button
        onClick={onInvite}
        style={{
          fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer",
          background: "#fff", border: `1px solid ${T.line}`, color: T.lagoon,
          borderRadius: 7, padding: "5px 11px", whiteSpace: "nowrap",
        }}
      >Invite</button>
    );
  }

  /* ── Invited, not yet joined ── */
  if (entry.status === "pending") {
    return entry.expired
      ? <span style={chip("#FDEEEC", "#F3C9C2", "#9C3527")}>Invite expired</span>
      : <span style={chip(T.warnBg, T.warnLine, T.warn)}>Invitation sent</span>;
  }

  /* ── A member of the organisation, but not of THIS department ──
     Their role is organisation-wide, so the column would otherwise show a
     bare "Manager" tag on a department they cannot open at all. Access to a
     department comes from an invitation being accepted for it, so say so
     plainly and offer one. */
  const inThisDept = !deptId
    || (entry.departments || []).some((d) => d.id === deptId);

  if (!inThisDept) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={chip(T.mist, T.line, T.inkSoft)}>
          {entry.role === "manager" ? "Manager" : "Employee"} · not here
        </span>
        {isOwner && (
          <button
            onClick={onInvite}
            title="They belong to your organisation but have no access to this department yet"
            style={{
              fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer",
              background: "#fff", border: `1px solid ${T.line}`, color: T.lagoon,
              borderRadius: 7, padding: "5px 11px", whiteSpace: "nowrap",
            }}
          >Invite</button>
        )}
      </div>
    );
  }

  /* ── A real member of this department ── */
  const changeRole = async (next) => {
    if (next === entry.role) return;
    const otherDepts = (entry.departments || []).length;
    const msg = next === "manager"
      ? `Make ${email} a manager?\n\n` +
        `They will be able to build and publish rotas in every department they ` +
        `belong to in this organisation` +
        (otherDepts > 1 ? ` — currently ${otherDepts}.` : ".")
      : `Change ${email} to an employee?\n\n` +
        `They will be able to view rotas but no longer change them, in every ` +
        `department they belong to in this organisation.`;
    if (!window.confirm(msg)) return;

    setBusy(true);
    const { error } = await supabase
      .from("organisation_members")
      .update({ role: next })
      .eq("id", entry.memberId);
    setBusy(false);

    if (error) {
      window.alert("That couldn't be changed. Only the account owner can change someone's access level.");
      return;
    }
    if (onChanged) onChanged();
  };

  if (!isOwner) {
    return <span style={chip(T.mist, T.line, T.lagoon)}>
      {entry.role === "manager" ? "Manager" : "Employee"}
    </span>;
  }

  return (
    <select
      value={entry.role === "manager" ? "manager" : "employee"}
      disabled={busy}
      onChange={(e) => changeRole(e.target.value)}
      title="Changing this updates their access straight away"
      style={{
        fontFamily: "inherit", fontSize: 12, fontWeight: 700,
        background: "#fff", border: `1px solid ${T.line}`, color: T.ink,
        borderRadius: 7, padding: "4px 6px", cursor: busy ? "default" : "pointer",
      }}
    >
      <option value="employee">Employee</option>
      <option value="manager">Manager</option>
    </select>
  );
}