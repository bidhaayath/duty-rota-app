import React, { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft, Users, Clock, Copy, Check, AlertCircle, Trash2, Search,
} from "lucide-react";
import supabase from "./supabaseClient";

/* ────────────────────────────────────────────────────────────────────────
   Members — everyone who can get into this organisation.

   Answers one question: who has access, and to what? Employment details
   (contact number, licence, leave, employment dates) deliberately stay on
   each department's Staff tab, where they belong — this screen is about
   access alone, so there is only ever one place to change a given thing.

   Shows accepted members and still-pending invitations, and lets the owner
   remove access, cancel an invitation, or copy an invite link again.

   DATA SAFETY
     Reading uses org_members_list(), which refuses anyone who is not the
     owner of the organisation.

     Removing access deletes the member_departments link, and the
     organisation_members row when it was their last department. It does
     NOT touch the person's staff record, their duties, or any rota — past
     rotas keep showing who worked, exactly as before. Only their ability
     to sign in and see the department is withdrawn.
   ──────────────────────────────────────────────────────────────────────── */

const T = {
  ink: "#142B33", inkSoft: "#4A6570", mist: "#EEF4F3",
  line: "#DCE8E6", lagoon: "#0F8B7E", coral: "#E4604E",
  warn: "#8A5A0F", warnBg: "#FBF1DC", warnLine: "#E7D9B8",
};

const roleLabel = (r) => {
  const s = String(r || "").toLowerCase();
  if (s === "manager") return "Manager";
  if (s === "employee") return "Employee";
  if (s === "owner") return "Owner";
  return r || "Member";
};

const prettyDate = (iso) => {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export default function Members({ onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data: res, error: err } = await supabase.rpc("org_members_list");
    if (err) {
      setError("Couldn't load your members just now. Please try again.");
      setLoading(false);
      return;
    }
    setData(res);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /* Remove one department's access. If it was their last, the membership
     goes too, so nobody is left with a membership that grants nothing. */
  const removeDepartment = async (member, dept) => {
    const last = (member.departments || []).length <= 1;
    const msg = last
      ? `Remove ${member.email}'s access to ${dept.name}?\n\n` +
        `This is their only department, so they will no longer be part of ` +
        `your organisation and won't be able to sign in to it.\n\n` +
        `Their staff record and all past duties are kept.`
      : `Remove ${member.email}'s access to ${dept.name}?\n\n` +
        `They keep access to their other departments. Their staff record ` +
        `and all past duties are kept.`;
    if (!window.confirm(msg)) return;

    setBusyId(member.member_id + dept.id); setError(null);

    const { error: delErr } = await supabase
      .from("member_departments")
      .delete()
      .eq("member_id", member.member_id)
      .eq("department_id", dept.id);

    if (delErr) {
      setError("That couldn't be removed. Please try again.");
      setBusyId(null); return;
    }

    if (last) {
      const { error: memErr } = await supabase
        .from("organisation_members")
        .delete()
        .eq("id", member.member_id);
      if (memErr) {
        setError("Their department was removed, but the membership couldn't be. Please try again.");
        setBusyId(null); await load(); return;
      }
    }

    setBusyId(null);
    await load();
  };

  const cancelInvite = async (inv) => {
    if (!window.confirm(
      `Cancel the invitation for ${inv.email}?\n\nTheir link will stop working. You can invite them again later.`
    )) return;
    setBusyId(inv.invite_id); setError(null);
    const { error: err } = await supabase.from("invites").delete().eq("id", inv.invite_id);
    setBusyId(null);
    if (err) { setError("The invitation couldn't be cancelled. Please try again."); return; }
    await load();
  };

  const copyLink = async (inv) => {
    const link = `${window.location.origin}/?invite=${inv.token}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedId(inv.invite_id);
      setTimeout(() => setCopiedId(null), 2200);
    } catch {
      setError("Couldn't copy the link automatically. " + link);
    }
  };

  const shellStyle = {
    fontFamily: "Inter, system-ui, sans-serif", color: T.ink,
    background: T.mist, minHeight: "100vh",
  };
  const card = {
    background: "#fff", border: `1px solid ${T.line}`, borderRadius: 12,
    padding: "15px 17px", marginBottom: 11,
  };
  const chip = (bg, border, color) => ({
    fontSize: 11, fontWeight: 700, background: bg,
    border: `1px solid ${border}`, color, borderRadius: 999, padding: "2px 9px",
    whiteSpace: "nowrap",
  });
  const smallBtn = {
    fontFamily: "inherit", fontSize: 12, fontWeight: 700, cursor: "pointer",
    background: "#fff", border: `1px solid ${T.line}`, color: T.ink,
    borderRadius: 7, padding: "6px 11px", whiteSpace: "nowrap",
  };

  const allMembers = (data && data.members) || [];
  /* A leftover invitation for someone who has already joined is noise — it
     would list the same person twice, once as a member and once as waiting.
     The membership is the truth, so the stale invitation is hidden. */
  const memberEmails = new Set(allMembers.map((m) => (m.email || "").toLowerCase()));
  const allInvites = ((data && data.invites) || [])
    .filter((i) => !memberEmails.has((i.email || "").toLowerCase()));

  /* Search matches an email or any of their department names, so an owner
     can find "everyone in Medical Ward" as easily as one person. */
  const q = query.trim().toLowerCase();
  const matches = (row) => {
    if (!q) return true;
    if ((row.email || "").toLowerCase().includes(q)) return true;
    return (row.departments || []).some((d) => (d.name || "").toLowerCase().includes(q));
  };
  const members = allMembers.filter(matches);
  const invites = allInvites.filter(matches);
  const hiddenCount = (allMembers.length - members.length) + (allInvites.length - invites.length);

  return (
    <div className="dr-fade-in" style={shellStyle}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 22px 44px" }}>
        <button
          onClick={onBack}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer",
            background: "transparent", border: "none", color: T.lagoon,
            fontFamily: "inherit", fontSize: 13.5, fontWeight: 700,
            padding: "6px 2px", marginBottom: 14,
          }}
        ><ChevronLeft size={16} /> Back to my dashboard</button>

        <h1 style={{
          fontFamily: "Sora, sans-serif", fontSize: 23, fontWeight: 700,
          margin: "0 0 4px", letterSpacing: -0.3,
        }}>Members</h1>
        <p style={{ color: T.inkSoft, fontSize: 13, margin: "0 0 22px", lineHeight: 1.6 }}>
          Everyone who can sign in and see your departments. Employment details
          — contact, licence, leave — stay on each department's Staff tab.
        </p>

        {error && (
          <div style={{
            display: "flex", gap: 9, alignItems: "flex-start",
            background: "#FDEEEC", border: "1px solid #F3C9C2", color: "#9C3527",
            borderRadius: 10, padding: "11px 14px", fontSize: 13, marginBottom: 14, lineHeight: 1.55,
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ wordBreak: "break-word" }}>{error}</span>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: T.inkSoft, fontSize: 13.5 }}>
            Loading your members…
          </div>
        )}

        {!loading && data && !data.is_owner && (
          <div style={{ ...card, textAlign: "center", padding: "30px 22px", color: T.inkSoft, fontSize: 13.5, lineHeight: 1.7 }}>
            Only the owner of an organisation can manage its members.
          </div>
        )}

        {!loading && data && data.is_owner && (
          <>
            {(allMembers.length + allInvites.length) > 4 && (
              <div style={{ position: "relative", marginBottom: 16 }}>
                <Search size={15} style={{
                  position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
                  color: T.inkSoft, pointerEvents: "none",
                }} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, email or department"
                  style={{
                    width: "100%", boxSizing: "border-box", fontFamily: "inherit",
                    fontSize: 13.5, padding: "10px 12px 10px 34px", borderRadius: 9,
                    border: `1px solid ${T.line}`, color: T.ink, background: "#fff",
                  }}
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    style={{
                      position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
                      background: "transparent", border: "none", cursor: "pointer",
                      color: T.inkSoft, fontFamily: "inherit", fontSize: 12, fontWeight: 700,
                      padding: "4px 7px",
                    }}
                  >Clear</button>
                )}
              </div>
            )}

            {q && hiddenCount > 0 && (
              <div style={{ fontSize: 12.5, color: T.inkSoft, marginBottom: 12 }}>
                {hiddenCount} {hiddenCount === 1 ? "person" : "people"} hidden by your search.
              </div>
            )}

            {/* ── Accepted members ── */}
            <div style={{
              fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
              color: T.inkSoft, margin: "0 0 9px", display: "flex", alignItems: "center", gap: 7,
            }}><Users size={14} /> Members ({members.length})</div>

            {members.length === 0 ? (
              <div style={{
                background: "#fff", border: `1px dashed ${T.line}`, borderRadius: 12,
                padding: "24px 20px", textAlign: "center", color: T.inkSoft,
                fontSize: 13, lineHeight: 1.7, marginBottom: 22,
              }}>
                {q ? "No members match your search."
                   : "Nobody has joined yet. Invite someone from a department's Staff tab."}
              </div>
            ) : (
              <div style={{ marginBottom: 22 }}>
                {members.map((m) => (
                  <div key={m.member_id} style={card}>
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                        <div style={{ fontSize: 14.5, fontWeight: 700, wordBreak: "break-word" }}>{m.email}</div>
                        <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 3 }}>
                          Joined {prettyDate(m.joined_at)}
                        </div>
                      </div>
                      <span style={chip(T.mist, T.line, T.lagoon)}>{roleLabel(m.role)}</span>
                    </div>

                    <div style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 7 }}>
                      {(m.departments || []).length === 0 ? (
                        <div style={{ fontSize: 12.5, color: T.inkSoft }}>
                          No departments — they can sign in but see nothing.
                        </div>
                      ) : m.departments.map((d) => (
                        <div key={d.id} style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between",
                          gap: 10, background: T.mist, border: `1px solid ${T.line}`,
                          borderRadius: 8, padding: "8px 11px",
                        }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{d.name}</span>
                          <button
                            onClick={() => removeDepartment(m, d)}
                            disabled={busyId === m.member_id + d.id}
                            style={{ ...smallBtn, color: T.coral, borderColor: "#F3C9C2" }}
                          >
                            {busyId === m.member_id + d.id ? "Removing…" : "Remove access"}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Pending invitations ── */}
            <div style={{
              fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
              color: T.inkSoft, margin: "0 0 9px", display: "flex", alignItems: "center", gap: 7,
            }}><Clock size={14} /> Invitations ({invites.length})</div>

            {invites.length === 0 ? (
              <div style={{
                background: "#fff", border: `1px dashed ${T.line}`, borderRadius: 12,
                padding: "20px", textAlign: "center", color: T.inkSoft, fontSize: 13, lineHeight: 1.7,
              }}>
                {q ? "No invitations match your search." : "No invitations waiting."}
              </div>
            ) : invites.map((inv) => (
              <div key={inv.invite_id} style={card}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, wordBreak: "break-word" }}>{inv.email}</div>
                    <div style={{ fontSize: 12, color: T.inkSoft, marginTop: 3 }}>
                      {(inv.departments || []).map((d) => d.name).join(", ") || "No department"}
                      {" · "}
                      {inv.expired
                        ? `Expired ${prettyDate(inv.expires_at)}`
                        : `Expires ${prettyDate(inv.expires_at)}`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={chip(T.mist, T.line, T.lagoon)}>{roleLabel(inv.role)}</span>
                    {inv.expired
                      ? <span style={chip("#FDEEEC", "#F3C9C2", "#9C3527")}>Expired</span>
                      : <span style={chip(T.warnBg, T.warnLine, T.warn)}>Waiting</span>}
                  </div>
                </div>

                <div style={{ marginTop: 11, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {!inv.expired && (
                    <button onClick={() => copyLink(inv)} style={smallBtn}>
                      {copiedId === inv.invite_id
                        ? <><Check size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Copied</>
                        : <><Copy size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Copy link again</>}
                    </button>
                  )}
                  <button
                    onClick={() => cancelInvite(inv)}
                    disabled={busyId === inv.invite_id}
                    style={{ ...smallBtn, color: T.coral, borderColor: "#F3C9C2" }}
                  >
                    <Trash2 size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
                    {busyId === inv.invite_id ? "Cancelling…" : "Cancel invitation"}
                  </button>
                </div>
              </div>
            ))}

            <p style={{ fontSize: 12, color: T.inkSoft, margin: "22px 0 0", lineHeight: 1.7, textAlign: "center" }}>
              Removing access never deletes anyone's staff record or their past
              duties — those stay on the rota exactly as they are.
            </p>
          </>
        )}
      </div>
    </div>
  );
}