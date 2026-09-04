import React, { useState, useEffect } from "react";
import { ChevronLeft, Mail, User, KeyRound, Check, AlertCircle } from "lucide-react";
import supabase from "./supabaseClient";

/* ────────────────────────────────────────────────────────────────────────
   Your account — a full screen reached from the dashboard sidebar.

   Three things, all about THIS person's own login, never about anyone
   else's data:
     • Their email address (shown, not editable — it identifies them to
       every department they belong to, so changing it here would quietly
       break which duties they see).
     • Their display name, which is what the dashboard greets them by.
     • A password reset, sent to their own inbox.

   Data safety: this touches the signed-in person's own auth record only.
   It writes no rota, no staff row, no department, and nothing belonging to
   any other person or organisation. Nothing here can delete anything.
   ──────────────────────────────────────────────────────────────────────── */

const T = {
  ink: "#142B33", inkSoft: "#4A6570", mist: "#EEF4F3",
  line: "#DCE8E6", lagoon: "#0F8B7E", coral: "#E4604E",
};

export default function Account({ onBack }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null); // { kind: "ok" | "bad", text }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      const meta = (user && user.user_metadata) || {};
      const current = meta.full_name || meta.name || "";
      setEmail(user?.email || "");
      setName(current);
      setSavedName(current);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const saveName = async () => {
    const clean = name.trim();
    if (clean === savedName) return;
    setBusy(true); setNote(null);
    const { error } = await supabase.auth.updateUser({ data: { full_name: clean } });
    setBusy(false);
    if (error) {
      setNote({ kind: "bad", text: "That didn't save. Please try again." });
      return;
    }
    setSavedName(clean);
    setNote({ kind: "ok", text: "Your name has been saved." });
  };

  const sendReset = async () => {
    if (!email) return;
    if (!window.confirm(`Send a password reset link to ${email}?`)) return;
    setBusy(true); setNote(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    setNote(error
      ? { kind: "bad", text: "The reset email couldn't be sent. Please try again." }
      : { kind: "ok", text: `A reset link is on its way to ${email}. Check your inbox.` });
  };

  const dirty = name.trim() !== savedName;

  const card = {
    background: "#fff", border: `1px solid ${T.line}`, borderRadius: 12,
    padding: "20px 22px", marginBottom: 16,
  };
  const label = {
    fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
    color: T.inkSoft, display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
  };

  if (loading) {
    return <div style={{ fontFamily: "Inter, system-ui, sans-serif", padding: 60, textAlign: "center", color: T.inkSoft }}>
      Loading…
    </div>;
  }

  return (
    <div className="dr-fade-in" style={{
      fontFamily: "Inter, system-ui, sans-serif", color: T.ink,
      background: T.mist, minHeight: "100vh",
    }}>
      <style>{`
        .dr-acc-btn { transition: background 140ms ease, border-color 140ms ease, transform 140ms ease; }
        .dr-acc-btn:hover:not(:disabled) { filter: brightness(0.97); }
        .dr-acc-btn:active:not(:disabled) { transform: scale(0.99); }
        .dr-acc-btn:focus-visible { outline: 2px solid ${T.lagoon}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { .dr-acc-btn { transition: none; } }
      `}</style>

      <div style={{ maxWidth: 620, margin: "0 auto", padding: "24px 22px 44px" }}>
        <button
          className="dr-acc-btn"
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
        }}>Your account</h1>
        <p style={{ color: T.inkSoft, fontSize: 13, margin: "0 0 22px" }}>
          Your sign-in details. Changes here affect only you.
        </p>

        {note && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 9,
            background: note.kind === "ok" ? "#EAF6F3" : "#FDEEEC",
            border: `1px solid ${note.kind === "ok" ? "#BFE2DA" : "#F3C9C2"}`,
            color: note.kind === "ok" ? "#12655C" : "#9C3527",
            borderRadius: 10, padding: "11px 14px", fontSize: 13, marginBottom: 16, lineHeight: 1.5,
          }}>
            {note.kind === "ok" ? <Check size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              : <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />}
            <span>{note.text}</span>
          </div>
        )}

        {/* Email */}
        <div style={card}>
          <div style={label}><Mail size={13} /> Email address</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>{email}</div>
          <p style={{ fontSize: 12, color: T.inkSoft, margin: 0, lineHeight: 1.6 }}>
            This is how your organisation identifies you, and how your duties
            find their way to your calendar. To change it, contact us at{" "}
            <a href="mailto:support@easydutyrota.com" style={{ color: T.lagoon }}>
              support@easydutyrota.com
            </a>.
          </p>
        </div>

        {/* Display name */}
        <div style={card}>
          <div style={label}><User size={13} /> Your name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Athifa Ibrahim"
            maxLength={60}
            style={{
              width: "100%", boxSizing: "border-box", fontFamily: "inherit",
              fontSize: 14.5, padding: "10px 12px", borderRadius: 9,
              border: `1px solid ${T.line}`, color: T.ink, marginBottom: 10,
            }}
          />
          <p style={{ fontSize: 12, color: T.inkSoft, margin: "0 0 12px", lineHeight: 1.6 }}>
            Used to greet you on your dashboard. Your name on a duty rota comes
            from that department's staff list and isn't changed here.
          </p>
          <button
            className="dr-acc-btn"
            onClick={saveName}
            disabled={!dirty || busy}
            style={{
              background: dirty && !busy ? T.lagoon : "#E7EFED",
              color: dirty && !busy ? "#fff" : T.inkSoft,
              border: "none", borderRadius: 9, padding: "10px 18px",
              fontFamily: "inherit", fontSize: 13.5, fontWeight: 700,
              cursor: dirty && !busy ? "pointer" : "default",
            }}
          >{busy ? "Saving…" : "Save name"}</button>
        </div>

        {/* Password */}
        <div style={card}>
          <div style={label}><KeyRound size={13} /> Password</div>
          <p style={{ fontSize: 13, color: T.inkSoft, margin: "0 0 12px", lineHeight: 1.6 }}>
            We'll email you a link to choose a new password. Your current one
            keeps working until you use it.
          </p>
          <button
            className="dr-acc-btn"
            onClick={sendReset}
            disabled={busy}
            style={{
              background: "#fff", color: T.ink, border: `1px solid ${T.line}`,
              borderRadius: 9, padding: "10px 18px", fontFamily: "inherit",
              fontSize: 13.5, fontWeight: 700, cursor: busy ? "default" : "pointer",
            }}
          >{busy ? "Working…" : "Send password reset email"}</button>
        </div>

        <p style={{ fontSize: 12, color: T.inkSoft, textAlign: "center", margin: "18px 0 0", lineHeight: 1.6 }}>
          Need to close your account? Contact{" "}
          <a href="mailto:support@easydutyrota.com" style={{ color: T.lagoon }}>
            support@easydutyrota.com
          </a>{" "}
          and we'll take care of it.
        </p>
      </div>
    </div>
  );
}