import React, { useState, useEffect } from "react";
import { X, Copy, Check, Link2, AlertCircle } from "lucide-react";
import supabase from "./supabaseClient";

/* ────────────────────────────────────────────────────────────────────────
   Invite a staff member to their own login.

   Creates a row in `invites` and hands the owner a link to send however
   they like — WhatsApp, Viber, SMS. No email service involved.

   The link carries a long random token. Holding it is the proof of
   invitation, the same way a password-reset link works. It expires after
   14 days (the database default) and stops working once used.

   WHAT THIS WRITES
     One row in `invites`. Nothing else. It creates no membership and grants
     no access — that only happens when the person accepts, through the
     accept_invite function, which reads the role from the stored row so the
     recipient cannot change what they were granted.

     The insert is guarded by the invites_insert policy: only the owner of
     the organisation may create one, `invited_by` is forced to be them, and
     the role can only ever be employee or manager — never owner.
   ──────────────────────────────────────────────────────────────────────── */

const T = {
  ink: "#142B33", inkSoft: "#4A6570", mist: "#EEF4F3",
  line: "#DCE8E6", lagoon: "#0F8B7E", coral: "#E4604E",
  warn: "#8A5A0F", warnBg: "#FBF1DC", warnLine: "#E7D9B8",
};

/* A long unguessable token. crypto.getRandomValues is the browser's
   cryptographic generator — not Math.random, which is predictable. */
const makeToken = () => {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

export default function InviteDialog({
  staff,          // the staff row being invited: { id, name, email, employmentRole }
  deptId,
  deptName,
  canGrantManager = false,
  onClose,
}) {
  const email = (staff?.email || "").trim();
  const [role, setRole] = useState(
    staff?.employmentRole === "manager" && canGrantManager ? "manager" : "employee"
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [link, setLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [myEmail, setMyEmail] = useState(null);

  /* Who is signed in. Needed on open so inviting yourself is refused
     before the form is filled in, rather than at the final click. */
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (alive) setMyEmail((data?.user?.email || "").toLowerCase());
    });
    return () => { alive = false; };
  }, []);

  const isSelf = !!email && myEmail !== null && email.toLowerCase() === myEmail;

  const createInvite = async () => {
    setBusy(true); setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("You appear to be signed out. Please sign in again."); setBusy(false); return; }

      /* Never invite yourself. Accepting it would create a membership row
         in your own organisation with a role below owner, and the app reads
         that row ahead of ownership — which quietly demotes you in your own
         organisation. It also gains nothing: your duties already show on
         your calendar once your email is on your staff record. */
      if (email.toLowerCase() === (user.email || "").toLowerCase()) {
        setError(
          "This is your own account, so an invitation isn't needed — you already " +
          "have full access. Your duties appear on your calendar automatically " +
          "once your email is on your staff record."
        );
        setBusy(false); return;
      }

      /* The organisation this department belongs to. Read from the database
         rather than trusted from the page, so the invite can only ever point
         where the department actually lives. */
      const { data: dept, error: deptErr } = await supabase
        .from("departments")
        .select("organisation_id")
        .eq("id", deptId)
        .single();

      if (deptErr || !dept) {
        setError("Couldn't confirm which organisation this department belongs to.");
        setBusy(false); return;
      }

      const token = makeToken();
      const { error: insErr } = await supabase.from("invites").insert({
        organisation_id: dept.organisation_id,
        email: email.toLowerCase(),
        role,
        department_ids: [deptId],
        token,
        invited_by: user.id,
      });

      if (insErr) {
        /* An empty result or a policy refusal both land here. The most
           likely cause by far is not being the organisation owner. */
        setError(
          insErr.message && /policy|permission|denied/i.test(insErr.message)
            ? "Only the account owner can invite people. Ask them to send this invitation."
            : "The invitation couldn't be created. Please try again."
        );
        setBusy(false); return;
      }

      setLink(`${window.location.origin}/?invite=${token}`);
      setBusy(false);
    } catch (e) {
      setError("Something went wrong creating the invitation.");
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* Clipboard can be blocked. The link is on screen and selectable,
         so the owner can still copy it by hand. */
      setError("Couldn't copy automatically — select the link and copy it.");
    }
  };

  const label = { fontSize: 11.5, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", color: T.inkSoft, marginBottom: 6 };

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(20,43,51,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 18, zIndex: 1000,
      }}
    >
      <div style={{
        background: "#fff", borderRadius: 14, width: "100%", maxWidth: 460,
        padding: "20px 22px 22px", fontFamily: "Inter, system-ui, sans-serif",
        color: T.ink, maxHeight: "90vh", overflowY: "auto",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
          <h2 style={{ fontFamily: "Sora, sans-serif", fontSize: 18, fontWeight: 700, margin: 0 }}>
            {link ? "Invitation ready" : "Invite to their own login"}
          </h2>
          <button onClick={onClose} aria-label="Close" style={{
            background: "transparent", border: "none", cursor: "pointer",
            color: T.inkSoft, padding: 2, lineHeight: 0,
          }}><X size={18} /></button>
        </div>

        {!link && (
          <>
            <p style={{ fontSize: 13, color: T.inkSoft, margin: "0 0 16px", lineHeight: 1.6 }}>
              {staff?.name} will be able to sign in and see <strong>{deptName}</strong>.
            </p>

            <div style={{ marginBottom: 14 }}>
              <div style={label}>Their email</div>
              <div style={{
                fontSize: 14, fontWeight: 600, background: T.mist,
                border: `1px solid ${T.line}`, borderRadius: 9, padding: "10px 13px",
              }}>{email || "— no email on this staff record —"}</div>
              <p style={{ fontSize: 11.5, color: T.inkSoft, margin: "6px 0 0", lineHeight: 1.5 }}>
                They must sign in with this exact address. Change it on their
                staff record first if it's wrong.
              </p>
              {isSelf && (
                <div style={{
                  display: "flex", gap: 9, alignItems: "flex-start", marginTop: 10,
                  background: T.warnBg, border: `1px solid ${T.warnLine}`, color: T.warn,
                  borderRadius: 10, padding: "11px 13px", fontSize: 12.5, lineHeight: 1.6,
                }}>
                  <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    This is your own account, so no invitation is needed — you
                    already have full access. Your duties show on your calendar
                    automatically because your email is on this staff record.
                  </span>
                </div>
              )}
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={label}>Access level</div>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                style={{
                  width: "100%", boxSizing: "border-box", fontFamily: "inherit",
                  fontSize: 14, padding: "10px 12px", borderRadius: 9,
                  border: `1px solid ${T.line}`, color: T.ink, background: "#fff",
                }}
              >
                <option value="employee">Employee — can view only</option>
                {canGrantManager && (
                  <option value="manager">Manager — can edit rotas</option>
                )}
              </select>
              {!canGrantManager && (
                <p style={{ fontSize: 11.5, color: T.inkSoft, margin: "6px 0 0" }}>
                  Only the account owner can make someone a manager.
                </p>
              )}
            </div>

            {/* The honest warning about organisation-wide manager rights. */}
            <div style={{
              display: "flex", gap: 9, alignItems: "flex-start",
              background: T.warnBg, border: `1px solid ${T.warnLine}`, color: T.warn,
              borderRadius: 10, padding: "11px 13px", fontSize: 12.5, lineHeight: 1.6, marginBottom: 16,
            }}>
              <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                {role === "manager"
                  ? "A manager can edit every department they are added to in this organisation, not just this one."
                  : "If this person is already a manager in this organisation, they will be able to edit this department too, whatever you choose here."}
              </span>
            </div>

            {error && (
              <div style={{
                display: "flex", gap: 9, alignItems: "flex-start",
                background: "#FDEEEC", border: "1px solid #F3C9C2", color: "#9C3527",
                borderRadius: 10, padding: "11px 13px", fontSize: 12.5, lineHeight: 1.55, marginBottom: 14,
              }}>
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{error}</span>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={onClose} style={{
                background: "#fff", border: `1px solid ${T.line}`, color: T.ink,
                borderRadius: 9, padding: "10px 16px", fontFamily: "inherit",
                fontSize: 13.5, fontWeight: 700, cursor: "pointer",
              }}>Cancel</button>
              <button
                onClick={createInvite}
                disabled={busy || !email || isSelf}
                style={{
                  background: busy || !email || isSelf ? "#E7EFED" : T.lagoon,
                  color: busy || !email || isSelf ? T.inkSoft : "#fff",
                  border: "none", borderRadius: 9, padding: "10px 18px",
                  fontFamily: "inherit", fontSize: 13.5, fontWeight: 700,
                  cursor: busy || !email || isSelf ? "default" : "pointer",
                  display: "inline-flex", alignItems: "center", gap: 7,
                }}
              ><Link2 size={15} /> {busy ? "Creating…" : "Create invite link"}</button>
            </div>
          </>
        )}

        {link && (
          <>
            <p style={{ fontSize: 13, color: T.inkSoft, margin: "0 0 14px", lineHeight: 1.6 }}>
              Send this link to <strong>{staff?.name}</strong> on WhatsApp, or however
              you normally reach them. It works once, only for{" "}
              <strong>{email}</strong>, and expires in 14 days.
            </p>

            <div style={{
              background: T.mist, border: `1px solid ${T.line}`, borderRadius: 9,
              padding: "11px 13px", fontSize: 12, wordBreak: "break-all",
              fontFamily: "ui-monospace, monospace", marginBottom: 12, lineHeight: 1.6,
            }}>{link}</div>

            <button
              onClick={copy}
              style={{
                width: "100%", background: copied ? "#EAF6F3" : T.lagoon,
                color: copied ? "#12655C" : "#fff",
                border: copied ? "1px solid #BFE2DA" : "none",
                borderRadius: 9, padding: "11px 16px", fontFamily: "inherit",
                fontSize: 13.5, fontWeight: 700, cursor: "pointer",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {copied ? <><Check size={16} /> Copied — now paste it to them</>
                      : <><Copy size={16} /> Copy link</>}
            </button>

            {error && (
              <p style={{ fontSize: 12, color: "#9C3527", margin: "10px 0 0", lineHeight: 1.5 }}>{error}</p>
            )}

            <p style={{ fontSize: 11.5, color: T.inkSoft, margin: "14px 0 0", lineHeight: 1.6 }}>
              Nothing has changed for them yet. They join{" "}
              {role === "manager" ? "as a manager" : "as an employee"} only once
              they open the link and sign in.
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={onClose} style={{
                background: "#fff", border: `1px solid ${T.line}`, color: T.ink,
                borderRadius: 9, padding: "10px 18px", fontFamily: "inherit",
                fontSize: 13.5, fontWeight: 700, cursor: "pointer",
              }}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}