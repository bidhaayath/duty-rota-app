import React, { useState } from "react";
import { PanelLeftClose, LogOut, ShieldCheck, CreditCard } from "lucide-react";
import supabase from "./supabaseClient";
import LogoMark from "./LogoMark";

/* ─────────────────── Side menu (laptop and desktop) ───────────────────
   The deep lagoon menu down the left of every screen, from the redesign
   (palette option B). The selected item is "cut out" of the menu: it takes
   the page's own background and curves into the page above and below, so
   it reads as part of the page rather than a button on the menu.

   For the cut-out to match the page exactly, the page background is pinned
   to the window on laptops (background-attachment: fixed) and the selected
   item paints the same background, also pinned. Same pixels, so no seam,
   even while the page scrolls under the sticky menu.

   On screens narrower than 900px the menu is hidden and the older header
   with its row of tabs shows instead, until the phone layout is built.

   Screen only: nothing here is part of an export, and it reads and writes
   nothing in the database. The one thing it remembers is whether the menu
   is shrunk to icons, kept in this browser under its own key
   (edr:navMini) — never the password-reset keys. */

const MINI_KEY = "edr:navMini";
const readMini = () => {
  try { return window.localStorage.getItem(MINI_KEY) === "1"; } catch (e) { return false; }
};

// Keep in step with PAGE_BG in DutyRotaOriginal.js.
const PAGE_BG = "radial-gradient(700px 500px at 8% 4%, #A6DCF0 0%, rgba(166,220,240,0) 70%), radial-gradient(600px 600px at 100% 38%, #9FCDE0 0%, rgba(159,205,224,0) 70%), radial-gradient(700px 500px at 50% 100%, #BDE6F1 0%, rgba(189,230,241,0) 70%), #E4F2F8";
const R = 20; // radius of the cut-out's curves

const CSS = `
  .edr-shell { display: flex; align-items: flex-start; gap: 20px; padding: 20px; }
  .edr-content { flex: 1 1 auto; min-width: 0; }
  .edr-side {
    position: sticky; top: 20px; flex: 0 0 236px; width: 236px; box-sizing: border-box;
    display: flex; flex-direction: column; gap: 16px; padding: 18px 14px;
    border-radius: 28px; background: #0E3A47; color: #CDEBF4;
    box-shadow: 0 14px 34px rgba(14,58,71,0.22);
    z-index: 30;
  }
  .edr-side[data-mini="1"] { flex-basis: 84px; width: 84px; padding: 18px 12px; align-items: center; }
  .edr-side[data-mini="1"] .edr-hide { display: none !important; }
  .edr-side[data-mini="1"] .edr-logo-row { flex-direction: column; gap: 12px !important; padding: 0 !important; }
  .edr-side[data-mini="1"] .edr-navbtn { justify-content: center; padding: 0 !important; width: 56px !important; }
  .edr-side[data-mini="1"] .edr-card { padding: 10px 6px !important; align-items: center; }
  .edr-side[data-mini="1"] .edr-card-btns { flex-direction: column; }
  .edr-side[data-mini="1"] .edr-mini-btn svg { transform: rotate(180deg); }
  .edr-mini-btn svg { transition: transform 320ms cubic-bezier(0.32, 0.72, 0, 1); }

  /* The menu items run right up to the menu's edge, so the selected one
     can open into the page. */
  .edr-nav { display: flex; flex-direction: column; gap: 3px; align-self: stretch; margin-right: -14px; }
  .edr-side[data-mini="1"] .edr-nav { margin-right: -12px; }
  .edr-tab {
    position: relative; display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 14px;
    border: none; border-radius: ${R + 2}px 0 0 ${R + 2}px; background: transparent; color: #CDEBF4;
    font-family: inherit; font-size: 14px; font-weight: 600; text-align: left; cursor: pointer;
  }
  .edr-side[data-mini="1"] .edr-tab { justify-content: center; padding: 0 14px 0 0; }
  .edr-tab:not(.edr-on):hover { background: rgba(255,255,255,0.08); color: #FFFFFF; }
  .edr-tab.edr-on { color: #0D4F61; background: ${PAGE_BG}; background-attachment: fixed; }
  .edr-tab.edr-on::before, .edr-tab.edr-on::after {
    content: ""; position: absolute; right: 0; width: ${R}px; height: ${R}px; pointer-events: none;
    background: ${PAGE_BG}; background-attachment: fixed;
  }
  .edr-tab.edr-on::before {
    top: -${R}px;
    -webkit-mask: radial-gradient(circle at 0 0, transparent ${R}px, #000 ${R + 0.5}px);
    mask: radial-gradient(circle at 0 0, transparent ${R}px, #000 ${R + 0.5}px);
  }
  .edr-tab.edr-on::after {
    bottom: -${R}px;
    -webkit-mask: radial-gradient(circle at 0 100%, transparent ${R}px, #000 ${R + 0.5}px);
    mask: radial-gradient(circle at 0 100%, transparent ${R}px, #000 ${R + 0.5}px);
  }
  .edr-side .edr-navbtn:not(.edr-tab):hover { background: rgba(255,255,255,0.14) !important; }
  @keyframes edrTabIn { from { opacity: 0.35; } to { opacity: 1; } }
  @media (prefers-reduced-motion: no-preference) {
    .edr-side { transition: flex-basis 320ms cubic-bezier(0.32, 0.72, 0, 1), width 320ms cubic-bezier(0.32, 0.72, 0, 1), padding 320ms cubic-bezier(0.32, 0.72, 0, 1); }
    .edr-tab.edr-on { animation: edrTabIn 220ms cubic-bezier(0.23, 1, 0.32, 1); }
  }
  /* The page heading that used to live in the dark header. */
  .edr-pagehead { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin: 0 0 10px; }
  @media (min-width: 900px) {
    .dr-header { display: none !important; }
    .edr-content main.dr-main { padding: 0 0 40px !important; max-width: none !important; }
    /* Pinned so the menu's cut-out matches it pixel for pixel. */
    .dr-app { background-attachment: fixed !important; }
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
    flex: 1, minHeight: 38, borderRadius: 999, fontFamily: "inherit", fontSize: 13,
    fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  };
  const ghost = { ...pill, border: "1px solid rgba(255,255,255,0.22)", background: "transparent", color: "#FFFFFF" };
  return (
    <>
      <style>{CSS}</style>
      <nav className="edr-side no-print" data-mini={mini ? "1" : "0"} aria-label="Main">
        <div className="edr-logo-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 6px" }}>
          <LogoMark size={26} />
          <span className="edr-hide" style={{ fontFamily: "'Plus Jakarta Sans', Inter, sans-serif", fontWeight: 800, fontSize: 16, color: "#FFFFFF", whiteSpace: "nowrap" }}>Easy Duty Rota</span>
          <button type="button" className="edr-mini-btn" onClick={toggleMini}
            aria-pressed={mini} aria-label={mini ? "Show the full menu" : "Shrink the menu to icons"}
            title={mini ? "Show the full menu" : "Shrink the menu to icons"}
            style={{ marginLeft: mini ? 0 : "auto", flex: "none", width: 34, height: 34, padding: 0, borderRadius: 11,
              border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.08)", color: "#CDEBF4",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
            <PanelLeftClose size={18} />
          </button>
        </div>

        {deptSwitcher}

        <div className="edr-nav">
          {items.map((it) => it.divider ? (
            <div key={it.id} aria-hidden="true" style={{ height: 1, background: "rgba(255,255,255,0.12)", margin: "8px 22px 8px 8px" }} />
          ) : (
            <button key={it.id} type="button" onClick={() => onSelect(it.id)}
              className={"edr-tab" + (it.id === activeId ? " edr-on" : "")}
              aria-current={it.id === activeId ? "page" : undefined} title={it.label}>
              <it.icon size={19} style={{ flex: "none" }} aria-hidden="true" />
              <span className="edr-hide">{it.label}</span>
            </button>
          ))}
        </div>

        <div className="edr-card" style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 18,
          background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }} title={email}>
            <div aria-hidden="true" style={{ width: 34, height: 34, flex: "none", borderRadius: "50%", background: "#F0A04B", color: "#3D2600",
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12.5 }}>{initials}</div>
            <span className="edr-hide" style={{ fontSize: 12.5, color: "#CDEBF4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{email}</span>
          </div>
          <div className="edr-card-btns" style={{ display: "flex", gap: 8 }}>
            {onOpenPlans && (
              <button type="button" onClick={onOpenPlans} title="My plan" aria-label="My plan" style={{ ...pill, border: "none", color: "#0E3A47",
                background: "#5FC4D6" }}>
                <CreditCard size={15} aria-hidden="true" /><span className="edr-hide">My plan</span>
              </button>
            )}
            <button type="button" onClick={() => supabase.auth.signOut()} title="Log out" aria-label="Log out" style={ghost}>
              <LogOut size={15} aria-hidden="true" /><span className="edr-hide">Log out</span>
            </button>
          </div>
          {onOpenAdmin && (
            <button type="button" onClick={onOpenAdmin} title="Admin" aria-label="Admin" style={{ ...ghost, flex: "none" }}>
              <ShieldCheck size={15} aria-hidden="true" /><span className="edr-hide">Admin</span>
            </button>
          )}
        </div>
      </nav>
    </>
  );
}
