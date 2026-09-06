import React, { useState, useEffect } from "react";
import { Check, AlertCircle, Clock, Mail, LogOut } from "lucide-react";
import supabase from "./supabaseClient";

/* ────────────────────────────────────────────────────────────────────────
   Accepting an invitation.

   Shown when the address carries ?invite=TOKEN. The token is the secret:
   holding it is the proof of invitation, like a password-reset link.

   Everything that matters happens inside accept_invite(), a SECURITY
   DEFINER function. It reads the role and departments FROM THE STORED
   INVITE ROW, so the person accepting cannot influence what they are
   granted. This page only passes the token along and reports the answer.

   DATA SAFETY
     Accepting creates a membership for the signed-in person and links the
     departments the owner chose. It writes nothing else, and cannot touch
     any rota, staff record or another person's access.
   ──────────────────────────────────────────────────────────────────────── */

const T = {
  ink: "#142B33", inkSoft: "#4A6570", mist: "#EEF4F3",
  line: "#DCE8E6", lagoon: "#0F8B7E", coral: "#E4604E",
};

const roleWord = (r) => (r === "manager" ? "a manager" : "an employee");

export default function AcceptInvite({ token, onDone }) {
  const [preview, setPreview] = useState(null);
  const [signedInAs, setSignedInAs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { ok, reason, ... }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: { user } }, prev] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc("invite_preview", { p_token: token }),
      ]);
      if (cancelled) return;
      setSignedInAs(user?.email ? user.email.toLowerCase() : null);
      setPreview(prev.error ? { found: false } : prev.data);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const accept = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("accept_invite", { p_token: token });
    setBusy(false);
    setResult(error ? { ok: false, reason: "failed" } : data);
  };

  /* Someone signed in with the wrong account needs a way out. */
  const switchAccount = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  const shell = (children) => (
    <div style={{
      fontFamily: "Inter, system-ui, sans-serif", color: T.ink, background: T.mist,
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        background: "#fff", border: `1px solid ${T.line}`, borderRadius: 14,
        maxWidth: 460, width: "100%", padding: "26px 26px 24px",
      }}>{children}</div>
    </div>
  );

  const title = (t) => (
    <h1 style={{
      fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 700,
      margin: "0 0 8px", letterSpacing: -0.2,
    }}>{t}</h1>
  );
  const para = { fontSize: 13.5, color: T.inkSoft, lineHeight: 1.7, margin: "0 0 18px" };
  const primaryBtn = {
    width: "100%", background: T.lagoon, color: "#fff", border: "none",
    borderRadius: 9, padding: "12px 18px", fontFamily: "inherit",
    fontSize: 14, fontWeight: 700, cursor: "pointer",
  };
  const quietBtn = {
    width: "100%", background: "#fff", color: T.ink, border: `1px solid ${T.line}`,
    borderRadius: 9, padding: "11px 18px", fontFamily: "inherit",
    fontSize: 13.5, fontWeight: 700, cursor: "pointer", marginTop: 10,
  };

  if (loading) return shell(<div style={{ textAlign: "center", color: T.inkSoft, fontSize: 14 }}>Checking your invitation…</div>);

  /* ── After accepting ── */
  if (result) {
    if (result.ok) {
      return shell(<>
        <div style={{
          width: 42, height: 42, borderRadius: 999, background: "#EAF6F3",
          display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
        }}><Check size={22} color={T.lagoon} /></div>
        {title(result.already ? "You're already in" : "You're in")}
        <p style={para}>
          {result.already
            ? "This invitation was already accepted with your account. Everything is set up."
            : "Your access is set up. You'll find it under My Membership on your dashboard, with your duties on the calendar."}
        </p>
        <button style={primaryBtn} onClick={onDone}>Go to my dashboard</button>
      </>);
    }

    const failures = {
      not_signed_in: "You need to be signed in to accept this invitation.",
      not_found: "This invitation link isn't valid. Ask whoever invited you to send a new one.",
      expired: "This invitation has expired. Ask whoever invited you to send a new one.",
      already_accepted: "This invitation has already been used by someone else.",
      wrong_email: `This invitation is for ${result.invited_email}. You're signed in as ${signedInAs}.`,
      failed: "Something went wrong accepting this invitation. Please try again.",
    };
    return shell(<>
      <div style={{
        width: 42, height: 42, borderRadius: 999, background: "#FDEEEC",
        display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
      }}><AlertCircle size={22} color="#9C3527" /></div>
      {title("This invitation can't be used")}
      <p style={para}>{failures[result.reason] || failures.failed}</p>
      {result.reason === "wrong_email"
        ? <button style={primaryBtn} onClick={switchAccount}>Sign in with a different account</button>
        : <button style={primaryBtn} onClick={onDone}>Continue to EasyDutyRota</button>}
    </>);
  }

  /* ── Bad links, before anyone tries ── */
  if (!preview || !preview.found) {
    return shell(<>
      {title("Invitation not found")}
      <p style={para}>
        This link isn't valid. It may have been mistyped, or cancelled by the
        person who sent it. Ask them to send you a new one.
      </p>
      <button style={primaryBtn} onClick={onDone}>Continue to EasyDutyRota</button>
    </>);
  }

  const deptList = (preview.departments || []).join(", ");

  if (preview.expired) {
    return shell(<>
      <div style={{
        width: 42, height: 42, borderRadius: 999, background: "#FBF1DC",
        display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
      }}><Clock size={21} color="#8A5A0F" /></div>
      {title("This invitation has expired")}
      <p style={para}>
        Invitations last 14 days. Ask whoever invited you to {deptList || "the department"} to
        send a new link.
      </p>
      <button style={primaryBtn} onClick={onDone}>Continue to EasyDutyRota</button>
    </>);
  }

  /* ── Not signed in ── */
  if (!signedInAs) {
    return shell(<>
      <div style={{
        width: 42, height: 42, borderRadius: 999, background: T.mist,
        display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14,
      }}><Mail size={21} color={T.lagoon} /></div>
      {title("You've been invited")}
      <p style={para}>
        You've been invited to join <strong>{deptList || "a department"}</strong> on
        EasyDutyRota as {roleWord(preview.role)}.
      </p>
      <div style={{
        background: T.mist, border: `1px solid ${T.line}`, borderRadius: 10,
        padding: "12px 14px", fontSize: 13, lineHeight: 1.6, marginBottom: 18,
      }}>
        Sign in — or create an account — using <strong>{preview.email}</strong>.
        The invitation only works with that address.
      </div>
      <button style={primaryBtn} onClick={onDone}>Sign in or create an account</button>
      <p style={{ fontSize: 12, color: T.inkSoft, margin: "12px 0 0", lineHeight: 1.6, textAlign: "center" }}>
        Come back to this link afterwards to finish joining.
      </p>
    </>);
  }

  /* ── Signed in with the wrong account ── */
  if (signedInAs !== (preview.email || "").toLowerCase()) {
    return shell(<>
      {title("Wrong account")}
      <p style={para}>
        This invitation is for <strong>{preview.email}</strong>, but you're signed
        in as <strong>{signedInAs}</strong>. Sign out and sign back in with the
        invited address.
      </p>
      <button style={primaryBtn} onClick={switchAccount}>
        <LogOut size={15} style={{ verticalAlign: "-2px", marginRight: 7 }} />
        Sign in with a different account
      </button>
      <button style={quietBtn} onClick={onDone}>Continue as {signedInAs}</button>
    </>);
  }

  /* ── Ready to accept ── */
  return shell(<>
    {title("Join " + (deptList || "your department"))}
    <p style={para}>
      You've been invited to join <strong>{deptList || "a department"}</strong> as{" "}
      {roleWord(preview.role)}, signed in as <strong>{signedInAs}</strong>.
    </p>
    <div style={{
      background: T.mist, border: `1px solid ${T.line}`, borderRadius: 10,
      padding: "12px 14px", fontSize: 12.5, lineHeight: 1.7, marginBottom: 18, color: T.inkSoft,
    }}>
      {preview.role === "manager"
        ? "As a manager you'll be able to build and publish the rota for the departments you're added to."
        : "You'll be able to see the duty rota and your own duties. Only managers can make changes."}
    </div>
    <button style={primaryBtn} onClick={accept} disabled={busy}>
      {busy ? "Joining…" : "Accept invitation"}
    </button>
    <button style={quietBtn} onClick={onDone} disabled={busy}>Not now</button>
  </>);
}