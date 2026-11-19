import React, { useState } from "react";
import { PanelLeftClose, LogOut, ShieldCheck, CreditCard } from "lucide-react";
import supabase from "./supabaseClient";
import LogoMark from "./LogoMark";

/* ─────────────────── Side menu (laptop and desktop) ───────────────────
   The frosted menu down the left of every department screen, from the
   liquid glass redesign. On screens narrower than 900px it is hidden and
   the older header with its row of tabs is shown instead, until the phone
   layout (bottom bar) is built.

   Screen only: nothing here is part of an export, and it reads and writes
   nothing in the database. The one thing it remembers is whether the menu
   is shrunk to icons, kept in this browser under its own key
   (edr:navMini) — never the password-reset keys. */

const MINI_KEY = "edr:navMini";
const readMini = () => {
  try { return window.localStorage.getItem(MINI_KEY) === "1"; } catch (e) { return false; }
};

const CSS = `
  .edr-shell { display: flex; align-items: flex-start; gap: 20px; padding: 20px; }
  .edr-content { flex: 1 1 auto; min-width: 0; }
  .edr-side {
    position: sticky; top: 20px; flex: 0 0 236px; width: 236px; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 16px; padding: 18px 14px;
    border-radius: 28px; background: rgba(255,255,255,0.55);
    border: 1px solid rgba(255,255,255,0.9);
    -webkit-backdrop-filter: blur(20px) saturate(180%); backdrop-filter: blur(20px) saturate(180%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.85), 0 10px 30px rgba(14,58,71,0.08);
    z-index: 30;
  }
  .edr-side[data-mini="1"] { flex-basis: 84px; width: 84px; padding: 18px 12px; align-items: center; }
  .edr-side[data-mini="1"] .edr-hide { display: none !important; }
  .edr-side[data-mini="1"] .edr-logo-row { flex-direction: column; gap: 12px !important; padding: 0 !important; }
  .edr-side[data-mini="1"] .edr-navbtn { justify-content: center; padding: 0 !important; width: 56px !important; }
  .edr-side[data-mini="1"] .edr-card { padding: 10px 6px !important; align-items: center; }
  .edr-side[data-mini="1"] .edr-card-btns { flex-direction: column; }
  .edr-side[data-mini="1"] .edr-mini-btn svg { transform: rotate(180deg); }
  .edr-navbtn:not(.edr-on):hover { background: rgba(255,255,255,0.6) !important; }
  .edr-mini-btn svg { transition: transform 320ms cubic-bezier(0.32, 0.72, 0, 1); }
  @media (prefers-reduced-motion: no-preference) {
    .edr-side { transition: flex-basis 320ms cubic-bezier(0.32, 0.72, 0, 1), width 320ms cubic-bezier(0.32, 0.72, 0, 1), padding 320ms cubic-bezier(0.32, 0.72, 0, 1); }
  }
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .edr-side { background: rgba(255,255,255,0.92); }
  }
  /* The page heading that used to live in the dark header. */
  .edr-pagehead { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin: 4px 0 18px; }
  @media (min-width: 900px) {
    .dr-header { display: none !important; }
    .edr-content main.dr-main { padding: 0 0 40px !important; max-width: none !important; }
  }
  @media (max-width: 899px) {
    .edr-shell { display: block; padding: 0; }
    .edr-side, .edr-pagehead, .edr-desk-only { display: none !important; }
  }
`;

export default function SideMenu({ items, activeId, onSelect, deptSwitcher, email = "", onOpenPlans = null, onOpenAdmin = null }) {
  const [mini, setMini] = useState(readMini);
  const toggleMini = () => {
    setMini((m) => {
      const next = !m;
      try { window.localStorage.setItem(MINI_KEY, next ? "1" : "0"); } catch (e) { /* private mode: just don't remember */ }
      return next;
    });
  };
  const initials = (email.split("@")[0] || "?").replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "?";
  const pill = {
    flex: 1, minHeight: 40, borderRadius: 999, fontFamily: "inherit", fontSize: 13,
    fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  };
  return (
    <>
      <style>{CSS}</style>
      <nav className="edr-side no-print" data-mini={mini ? "1" : "0"} aria-label="Main">
        <div className="edr-logo-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px" }}>
          <LogoMark size={26} />
          <span className="edr-hide" style={{ fontFamily: "'Plus Jakarta Sans', Inter, sans-serif", fontWeight: 800, fontSize: 16, color: "#0E3A47", whiteSpace: "nowrap" }}>Easy Duty Rota</span>
          <button type="button" className="edr-mini-btn" onClick={toggleMini}
            aria-pressed={mini} aria-label={mini ? "Show the full menu" : "Shrink the menu to icons"}
            title={mini ? "Show the full menu" : "Shrink the menu to icons"}
            style={{ marginLeft: mini ? 0 : "auto", flex: "none", width: 34, height: 34, padding: 0, borderRadius: 11,
              border: "1px solid rgba(14,58,71,0.12)", background: "rgba(255,255,255,0.7)", color: "#0D4F61",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <PanelLeftClose size={18} />
          </button>
        </div>

        {deptSwitcher}

        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {items.map((it) => it.divider ? (
            <div key={it.id} aria-hidden="true" style={{ height: 1, background: "rgba(14,58,71,0.10)", margin: "6px 8px" }} />
          ) : (
            <button key={it.id} type="button" onClick={() => onSelect(it.id)}
              className={"edr-navbtn" + (it.id === activeId ? " edr-on" : "")}
              aria-current={it.id === activeId ? "page" : undefined} title={it.label}
              style={{
                display: "flex", alignItems: "center", gap: 12, minHeight: 44, padding: "0 12px",
                borderRadius: 14, border: "none", cursor: "pointer", fontFamily: "inherit",
                fontSize: 14, fontWeight: 600, textAlign: "left",
                background: it.id === activeId ? "linear-gradient(90deg, #0D4F61, #1F7F9F)" : "transparent",
                color: it.id === activeId ? "#FFFFFF" : "#0E3A47",
                boxShadow: it.id === activeId ? "0 6px 16px rgba(13,79,97,0.22)" : "none",
              }}>
              <it.icon size={19} style={{ flex: "none" }} aria-hidden="true" />
              <span className="edr-hide">{it.label}</span>
            </button>
          ))}
        </div>

        <div className="edr-card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 18,
          background: "rgba(255,255,255,0.6)", border: "1px solid rgba(255,255,255,0.95)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }} title={email}>
            <div aria-hidden="true" style={{ width: 36, height: 36, flex: "none", borderRadius: "50%", background: "#F0A04B", color: "#3D2600",
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>{initials}</div>
            <span className="edr-hide" style={{ fontSize: 12.5, color: "#3A5F6B", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{email}</span>
          </div>
          <div className="edr-card-btns" style={{ display: "flex", gap: 8 }}>
            {onOpenPlans && (
              <button type="button" onClick={onOpenPlans} title="My plan" aria-label="My plan" style={{ ...pill, border: "none", color: "#fff",
                background: "linear-gradient(90deg, #0D4F61, #1F7F9F)" }}>
                <CreditCard size={15} aria-hidden="true" /><span className="edr-hide">My plan</span>
              </button>
            )}
            <button type="button" onClick={() => supabase.auth.signOut()} title="Log out" aria-label="Log out"
              style={{ ...pill, border: "1px solid rgba(14,58,71,0.18)", background: "rgba(255,255,255,0.7)", color: "#0E3A47" }}>
              <LogOut size={15} aria-hidden="true" /><span className="edr-hide">Log out</span>
            </button>
          </div>
          {onOpenAdmin && (
            <button type="button" onClick={onOpenAdmin} title="Admin" aria-label="Admin"
              style={{ ...pill, flex: "none", border: "1px solid rgba(14,58,71,0.18)", background: "rgba(255,255,255,0.7)", color: "#0D4F61" }}>
              <ShieldCheck size={15} aria-hidden="true" /><span className="edr-hide">Admin</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}
