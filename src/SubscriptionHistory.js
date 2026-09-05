import React, { useState, useEffect } from "react";
import { ChevronLeft, Receipt, AlertCircle } from "lucide-react";
import supabase from "./supabaseClient";

/* ────────────────────────────────────────────────────────────────────────
   Subscription history — a full screen reached from the dashboard sidebar.

   Lists this person's own past payments: when, how much, which plan.

   Data safety: READ-ONLY. One select against `payments`, which carries the
   `payments_read_own` policy (user_id = auth.uid()), so the database itself
   guarantees a person can only ever see their own rows — never another
   customer's. This screen writes nothing and deletes nothing.
   ──────────────────────────────────────────────────────────────────────── */

const T = {
  ink: "#142B33", inkSoft: "#4A6570", mist: "#EEF4F3",
  line: "#DCE8E6", lagoon: "#0F8B7E", coral: "#E4604E",
};

/* Amounts are stored in laari — 100 laari to 1 rufiyaa. */
const money = (laari) =>
  `MVR ${(Number(laari || 0) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

const prettyDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

const titleCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

/* Only two statuses exist in practice: paid and cancelled. Anything else is
   shown as-is rather than hidden, so nothing goes silently missing. */
const statusStyle = (status) => {
  const s = String(status || "").toLowerCase();
  if (s === "paid") return { bg: "#EAF6F3", border: "#BFE2DA", text: "#12655C", label: "Paid" };
  if (s === "cancelled") return { bg: "#F3F5F5", border: "#DDE4E3", text: "#6A7C81", label: "Cancelled" };
  if (s === "pending") return { bg: "#FDF6E7", border: "#EFDFB8", text: "#8A6A1F", label: "Pending" };
  return { bg: "#F3F5F5", border: "#DDE4E3", text: "#6A7C81", label: titleCase(status) };
};

export default function SubscriptionHistory({ onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) { setFailed(true); setLoading(false); return; }

      /* Newest first. paid_at is the real payment date but can be empty on a
         cancelled row, so created_at is the reliable ordering key. */
      const { data, error } = await supabase
        .from("payments")
        .select("id, amount_laari, currency, tier, billing_cycle, status, paid_at, created_at, provider")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (error) { setFailed(true); setLoading(false); return; }
      setRows(data || []);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="dr-fade-in" style={{
      fontFamily: "Inter, system-ui, sans-serif", color: T.ink,
      background: T.mist, minHeight: "100vh",
    }}>
      <style>{`
        .dr-hist-back { transition: color 140ms ease; }
        .dr-hist-back:focus-visible { outline: 2px solid ${T.lagoon}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { .dr-hist-back { transition: none; } }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "24px 22px 44px" }}>
        <button
          className="dr-hist-back"
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
        }}>Subscription history</h1>
        <p style={{ color: T.inkSoft, fontSize: 13, margin: "0 0 22px" }}>
          Every payment recorded on your account.
        </p>

        {loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: T.inkSoft, fontSize: 13.5 }}>
            Loading your payments…
          </div>
        )}

        {!loading && failed && (
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 9,
            background: "#FDEEEC", border: "1px solid #F3C9C2", color: "#9C3527",
            borderRadius: 10, padding: "12px 15px", fontSize: 13, lineHeight: 1.55,
          }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Your payment history couldn't be loaded just now. Please try again,
              or contact{" "}
              <a href="mailto:support@easydutyrota.com" style={{ color: "#9C3527", fontWeight: 700 }}>
                support@easydutyrota.com
              </a>.
            </span>
          </div>
        )}

        {!loading && !failed && rows.length === 0 && (
          <div style={{
            background: "#fff", border: `1px dashed ${T.line}`, borderRadius: 12,
            padding: "34px 24px", textAlign: "center",
          }}>
            <Receipt size={26} color={T.inkSoft} style={{ marginBottom: 10, opacity: 0.7 }} />
            <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 6 }}>No payments yet</div>
            <p style={{ fontSize: 13, color: T.inkSoft, margin: 0, lineHeight: 1.6 }}>
              Once you've paid for a plan, every payment appears here.
            </p>
          </div>
        )}

        {!loading && !failed && rows.length > 0 && (
          <>
            <div style={{
              background: "#fff", border: `1px solid ${T.line}`,
              borderRadius: 12, overflow: "hidden",
            }}>
              {rows.map((r, i) => {
                const st = statusStyle(r.status);
                return (
                  <div key={r.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: 14, padding: "14px 18px",
                    borderTop: i === 0 ? "none" : `1px solid ${T.line}`,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 3 }}>
                        {titleCase(r.tier)}
                        {r.billing_cycle && (
                          <span style={{ fontWeight: 500, color: T.inkSoft }}>
                            {" "}· {titleCase(r.billing_cycle)}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12.5, color: T.inkSoft }}>
                        {prettyDate(r.paid_at || r.created_at)}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                      <span style={{
                        fontSize: 11, fontWeight: 700, letterSpacing: 0.2,
                        background: st.bg, border: `1px solid ${st.border}`, color: st.text,
                        borderRadius: 999, padding: "3px 10px",
                      }}>{st.label}</span>
                      <div style={{
                        fontSize: 14.5, fontWeight: 700, whiteSpace: "nowrap",
                        color: String(r.status).toLowerCase() === "paid" ? T.ink : T.inkSoft,
                        textDecoration: String(r.status).toLowerCase() === "cancelled" ? "line-through" : "none",
                      }}>{money(r.amount_laari)}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ padding: "14px 18px 0", fontSize: 13, color: T.inkSoft }}>
              {rows.length} {rows.length === 1 ? "record" : "records"}
            </div>
          </>
        )}

        <p style={{ fontSize: 12, color: T.inkSoft, textAlign: "center", margin: "22px 0 0", lineHeight: 1.6 }}>
          Something missing or not as you expect? Contact{" "}
          <a href="mailto:support@easydutyrota.com" style={{ color: T.lagoon }}>
            support@easydutyrota.com
          </a>.
        </p>
      </div>
    </div>
  );
}