import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft, ChevronRight, User, Lightbulb, Users, FileText, History, LifeBuoy, Download, Mail, MessageCircle, AlertTriangle,
} from "lucide-react";
import supabase from "./supabaseClient";
import Account from "./Account";
import Members from "./Members";
import SubscriptionHistory from "./SubscriptionHistory";
import {
  SELLER, QUOTE_VALID_DAYS, quoteHtml, receiptHtml, openDoc, mailto, whatsapp, withGst, money, planLine, downloadData,
} from "./accountDocs";

/* ─────────────── Your account ───────────────
   One place for everything about this person's own account: Profile (with
   My plan), Request a feature, Members, Generate a quotation, Subscription
   history and Support. A menu on the left on laptops; a list that opens
   each section on phones.

   Profile, Members and Subscription history are the existing screens,
   shown inside this page (their `embedded` mode), so they work exactly as
   before.

   Data safety:
   - Reads only: my_subscription(), plan_limits (prices), the person's own
     payments (inside Subscription history) and rotas already loaded for
     their dashboard. Nothing here writes to the database or deletes anything.
   - Feature and removal requests open the person's own email app with a
     ready-written message; the account is removed by hand at our end.
   - Quotations and receipts open in a new tab to save as PDF. Nothing is
     stored, so quotation numbers come from the date and time.        */

const T = { ink: "#0E3A47", soft: "#3A5F6B", line: "#D3E5EC", lagoon: "#0D4F61", mist: "#E4F2F8" };
const H = "'Plus Jakarta Sans', Inter, sans-serif";
const glass = {
  background: "rgba(255,255,255,0.66)", backdropFilter: "blur(22px) saturate(170%)", WebkitBackdropFilter: "blur(22px) saturate(170%)",
  border: "1px solid rgba(255,255,255,0.85)", borderRadius: 24, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 10px 30px rgba(14,58,71,0.07)",
  boxSizing: "border-box", minWidth: 0,
};
const inp = { fontFamily: "inherit", fontSize: 14, color: T.ink, border: `1px solid ${T.line}`, background: "#fff", borderRadius: 12, padding: "10px 12px", minHeight: 44, boxSizing: "border-box", width: "100%" };
const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: T.soft, marginBottom: 6 };
const h2 = { margin: 0, fontFamily: H, fontSize: 17, fontWeight: 700 };
const primary = { fontFamily: "inherit", border: 0, background: T.ink, color: "#fff", borderRadius: 999, padding: "0 20px", minHeight: 44, fontSize: 13.5, fontWeight: 700, cursor: "pointer" };
const ghost = { fontFamily: "inherit", border: `1px solid ${T.line}`, background: "#fff", color: T.lagoon, borderRadius: 999, padding: "0 16px", minHeight: 42, fontSize: 13, fontWeight: 600, cursor: "pointer" };
const pill = (on) => ({ fontFamily: "inherit", border: `1px solid ${on ? T.ink : T.line}`, background: on ? T.ink : "#fff", color: on ? "#fff" : T.soft, borderRadius: 999, padding: "0 14px", minHeight: 38, fontSize: 13, fontWeight: 600, cursor: "pointer" });
const seg = (on) => ({ flex: 1, fontFamily: "inherit", border: 0, borderRadius: 999, minHeight: 38, fontSize: 13, fontWeight: 600, cursor: "pointer", background: on ? "#fff" : "transparent", color: on ? T.ink : T.soft, boxShadow: on ? "0 2px 8px rgba(14,58,71,.12)" : "none" });

const SECTIONS = [
  { id: "profile", label: "Profile", sub: "Email, name, password, my plan", icon: User },
  { id: "feature", label: "Request a feature", sub: "Tell us what would help", icon: Lightbulb },
  { id: "members", label: "Members", sub: "Who can open your departments", icon: Users },
  { id: "quote", label: "Generate a quotation", sub: "A PDF for your procurement office", icon: FileText, tag: "NEW" },
  { id: "history", label: "Subscription history", sub: "Payments and receipts", icon: History },
  { id: "support", label: "Support", sub: "Help, WhatsApp, remove account", icon: LifeBuoy },
];

const useNarrow = () => {
  const q = "(max-width: 720px)";
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia && window.matchMedia(q).matches);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(q); const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on); return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
};

/* ── My plan: days left on the paid plan or trial ── */
function MyPlan({ onOpenPlans, onHistory }) {
  const [sub, setSub] = useState(null);
  useEffect(() => {
    let off = false;
    supabase.rpc("my_subscription").then(({ data }) => { if (!off) setSub(data || {}); });
    return () => { off = true; };
  }, []);
  const days = sub?.days_remaining ?? null;
  const period = sub?.billing_cycle === "monthly" ? 30 : sub?.paid_until ? 365 : 30;
  const pct = days == null ? 0 : Math.max(2, Math.min(100, Math.round((days / period) * 100)));
  const tier = sub?.paid_tier || sub?.plan || null;
  const name = sub?.state === "trial" || (!sub?.paid_until && !tier) ? "Free trial" : `${tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "Your"} plan`;
  const until = sub?.paid_until ? new Date(sub.paid_until).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;
  return (
    <section style={{ borderRadius: 24, padding: 22, color: "#fff", background: "linear-gradient(135deg, #0B4555, #2F8FA6)", boxShadow: "0 14px 34px rgba(13,79,97,.22)", display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <h2 style={{ ...h2, color: "#fff" }}>My plan</h2>
      {!sub ? <div style={{ fontSize: 13, opacity: 0.9 }}>Loading…</div> : (
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 104, height: 104, flex: "none" }}>
            <svg viewBox="0 0 100 100" style={{ width: 104, height: 104, transform: "rotate(-90deg)" }} aria-hidden="true">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="9" />
              <circle cx="50" cy="50" r="42" pathLength="100" fill="none" stroke="#fff" strokeWidth="9" strokeLinecap="round" style={{ strokeDasharray: `${pct} 100`, transition: "stroke-dasharray .9s cubic-bezier(.22,1,.36,1)" }} />
            </svg>
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <strong style={{ fontFamily: H, fontSize: 26 }}>{days == null ? "—" : days}</strong><span style={{ fontSize: 10.5, opacity: 0.9 }}>days left</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 13 }}>
            <strong style={{ fontSize: 15 }}>{name}</strong>
            {until && <div>Paid until <strong>{until}</strong></div>}
            <div style={{ opacity: 0.9 }}>Nothing renews by itself.</div>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {onOpenPlans && <button onClick={onOpenPlans} style={{ ...primary, background: "#fff", color: T.lagoon }}>See plans &amp; renew</button>}
        <button onClick={onHistory} style={{ ...ghost, background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,0.5)" }}>Payment history</button>
      </div>
    </section>
  );
}

function FeatureRequest({ email, orgName }) {
  const [area, setArea] = useState("Rota");
  const [need, setNeed] = useState("Would help a lot");
  const [text, setText] = useState("");
  const body = `${text.trim()}\n\nPart of the app: ${area}\nHow much it would help: ${need}\n\nFrom: ${email || ""}${orgName ? `\nOrganisation: ${orgName}` : ""}`;
  return (
    <section style={{ ...glass, padding: 22, display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
      <h2 className="ya-h2" style={h2}>Request a feature</h2>
      <p style={{ margin: 0, fontSize: 13.5, color: T.soft, lineHeight: 1.5 }}>Tell us what would make your rota easier. It opens your email with the message ready to send to {SELLER.email}.</p>
      <div><div style={lbl}>Which part of the app?</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{["Rota", "Leave", "Reports", "Smart Roster", "Ini", "Other"].map((a) => <button key={a} aria-pressed={area === a} onClick={() => setArea(a)} style={pill(area === a)}>{a}</button>)}</div></div>
      <div><label htmlFor="ya-feature" style={lbl}>What would you like?</label>
        <textarea id="ya-feature" rows={5} value={text} onChange={(e) => setText(e.target.value)} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }}
          placeholder="For example: let staff swap duties with each other and send me the request to approve." /></div>
      <div><div style={lbl}>How much would it help?</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{["Nice to have", "Would help a lot", "We can't work without it"].map((a) => <button key={a} aria-pressed={need === a} onClick={() => setNeed(a)} style={pill(need === a)}>{a}</button>)}</div></div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <a href={text.trim() ? mailto(`Feature request: ${area}`, body) : undefined} aria-disabled={!text.trim()}
          onClick={(e) => { if (!text.trim()) e.preventDefault(); }}
          style={{ ...primary, display: "inline-flex", alignItems: "center", gap: 8, textDecoration: "none", opacity: text.trim() ? 1 : 0.5 }}><Mail size={16} /> Send request</a>
        <a href={whatsapp(`Feature request (${area}, ${need}): ${text.trim()}`)} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600, color: T.lagoon }}>or send it on WhatsApp</a>
      </div>
    </section>
  );
}

const QUOTE_KEY = "edr:quoteTo"; // what was typed last time; this browser only

function Quotation({ orgName }) {
  const [plans, setPlans] = useState(null);
  const [failed, setFailed] = useState(false);
  const saved = useMemo(() => { try { return JSON.parse(window.localStorage.getItem(QUOTE_KEY) || "{}"); } catch (e) { return {}; } }, []);
  const [to, setTo] = useState({ org: saved.org || orgName || "", address: saved.address || "", attn: saved.attn || "", ref: "" });
  const [tier, setTier] = useState(saved.tier || "plus");
  const [cycle, setCycle] = useState(saved.cycle || "annual");
  const [kind, setKind] = useState("quote");
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    let off = false;
    supabase.from("plan_limits").select("tier, label, rank, price_monthly_laari, price_annual_laari, max_departments, max_staff")
      .order("rank", { ascending: true })
      .then(({ data, error }) => {
        if (off) return;
        if (error) { setFailed(true); setPlans([]); return; }
        setPlans((data || []).filter((p) => ["basic", "standard", "plus", "pro"].includes(p.tier) && (p.price_monthly_laari || p.price_annual_laari)));
      });
    return () => { off = true; };
  }, []);
  // The organisation's name can arrive after this opens: fill it in then, unless something was typed.
  useEffect(() => { if (orgName) setTo((t) => (t.org.trim() ? t : { ...t, org: orgName })); }, [orgName]);
  useEffect(() => {
    try { window.localStorage.setItem(QUOTE_KEY, JSON.stringify({ org: to.org, address: to.address, attn: to.attn, tier, cycle })); } catch (e) { /* private mode */ }
  }, [to.org, to.address, to.attn, tier, cycle]);
  const plan = plans && (plans.find((p) => p.tier === tier) || plans[0]);
  const html = plan ? quoteHtml({ kind, to, plan, cycle, date: new Date() }) : "";
  // The same page, without its print button, with screen margins and a little smaller.
  const preview = html.replace('<div class="bar"><button onclick="window.print()">Save as PDF / Print</button></div>', "")
    .replace("</style>", "body{zoom:.82;background:#fff}.sheet{padding:28px 30px}</style>");
  const amounts = plan ? withGst(cycle === "annual" ? plan.price_annual_laari : plan.price_monthly_laari) : null;
  const field = (k, label, ph) => (
    <div><label htmlFor={`ya-q-${k}`} style={lbl}>{label}</label>
      <input id={`ya-q-${k}`} value={to[k]} placeholder={ph} onChange={(e) => setTo({ ...to, [k]: e.target.value })} style={inp} /></div>
  );
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
      <section style={{ ...glass, flex: "1 1 300px", padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 className="ya-h2" style={h2}>Generate a quotation</h2>
        <p style={{ margin: 0, fontSize: 13, color: T.soft, lineHeight: 1.5 }}>A PDF your office can send to procurement. Prices come from the plans page, with GST added. Valid for {QUOTE_VALID_DAYS} days.</p>
        <div style={{ display: "flex", padding: 3, borderRadius: 999, background: "rgba(14,58,71,0.06)" }}>
          {[["quote", "Quotation"], ["proforma", "Proforma invoice"]].map(([id, n]) => <button key={id} aria-pressed={kind === id} onClick={() => setKind(id)} style={seg(kind === id)}>{n}</button>)}
        </div>
        {field("org", "Organisation", "Ministry, hospital or company name")}
        {field("address", "Address", "Street, island / city")}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
          {field("attn", "Attention", "e.g. Procurement Section")}
          {field("ref", "Their reference (optional)", "PO / file no.")}
        </div>
        <div><div style={lbl}>Plan</div>
          {!plans ? <div style={{ fontSize: 13, color: T.soft }}>Loading plans…</div> : failed || !plans.length ? (
            <div style={{ fontSize: 13, color: "#9C3527" }}>The plan prices couldn't be loaded. Please try again, or contact {SELLER.email}.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 6 }}>
              {plans.map((p) => { const on = plan && plan.tier === p.tier; return (
                <button key={p.tier} aria-pressed={on} onClick={() => setTier(p.tier)} style={{ ...pill(on), borderRadius: 12, minHeight: 54, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1, fontWeight: 700 }}>
                  {p.label || p.tier}<span style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.85 }}>{p.max_departments == null ? "Unlimited" : p.max_departments} dept{p.max_departments === 1 ? "" : "s"}</span>
                </button>); })}
            </div>
          )}</div>
        <div><div style={lbl}>Period</div>
          <div style={{ display: "flex", padding: 3, borderRadius: 999, background: "rgba(14,58,71,0.06)" }}>
            {[["monthly", "Monthly"], ["annual", "12 months"]].map(([id, n]) => <button key={id} aria-pressed={cycle === id} onClick={() => setCycle(id)} style={seg(cycle === id)}>{n}</button>)}
          </div></div>
        {amounts && (
          <div style={{ background: "rgba(255,255,255,0.8)", borderRadius: 14, padding: "10px 14px", fontSize: 13, color: T.soft, display: "flex", flexDirection: "column", gap: 3 }}>
            <div>{plan.label || plan.tier} · {planLine(plan)}</div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Subtotal {money(amounts.subtotal)} + GST {money(amounts.gst)}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", color: T.ink, fontWeight: 800, fontSize: 15 }}><span>Total</span><span>{money(amounts.total)}</span></div>
          </div>
        )}
        <button disabled={!plan || !to.org.trim()} onClick={() => setBlocked(!openDoc(html))}
          style={{ ...primary, minHeight: 48, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: plan && to.org.trim() ? 1 : 0.5 }}>
          <Download size={16} /> Open {kind === "proforma" ? "proforma invoice" : "quotation"} as PDF
        </button>
        <div style={{ fontSize: 12, color: T.soft }}>{blocked ? "Your browser blocked the new tab. Allow pop-ups for easydutyrota.com and try again." : "It opens in a new tab: press “Save as PDF / Print” there."}</div>
      </section>
      {plan && (
        <section aria-label="Preview" style={{ flex: "1.3 1 380px", minWidth: 0, background: "#fff", borderRadius: 8, boxShadow: "0 20px 50px rgba(14,58,71,0.18)", overflow: "hidden" }}>
          <iframe title="Quotation preview" srcDoc={preview} sandbox="" style={{ width: "100%", height: 760, border: 0, display: "block" }} />
        </section>
      )}
    </div>
  );
}

function Support({ email, orgName, ownedRotas }) {
  const [reason, setReason] = useState("");
  const [more, setMore] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const canExport = ownedRotas.length > 0;
  const body = `Please remove my Easy Duty Rota account.\n\nAccount email: ${email || ""}${orgName ? `\nOrganisation: ${orgName}` : ""}\nReason: ${reason || "(not given)"}${more.trim() ? `\n\n${more.trim()}` : ""}`;
  const link = { display: "flex", alignItems: "center", gap: 10, padding: 14, background: "rgba(255,255,255,0.78)", borderRadius: 14, textDecoration: "none", color: T.ink, fontWeight: 600, fontSize: 14 };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 16, alignItems: "start" }}>
      <section style={{ ...glass, padding: 22, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={h2}>Get help</h2>
        <a href={whatsapp("Hello, I need help with Easy Duty Rota.")} target="_blank" rel="noreferrer" style={link}><MessageCircle size={18} /><span style={{ flex: 1 }}>WhatsApp {SELLER.phone}</span><ChevronRight size={16} /></a>
        <a href={mailto("Help with Easy Duty Rota", `\n\nFrom: ${email || ""}${orgName ? `\nOrganisation: ${orgName}` : ""}`)} style={link}><Mail size={18} /><span style={{ flex: 1 }}>{SELLER.email}</span><ChevronRight size={16} /></a>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, color: T.soft, lineHeight: 1.5 }}>The Help page inside any department explains every screen.</p>
      </section>
      <section style={{ padding: 22, borderRadius: 24, background: "rgba(255,240,236,0.9)", border: "1px solid #F1C9BF", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <h2 style={{ ...h2, color: "#8A2E1E", display: "flex", alignItems: "center", gap: 8 }}><AlertTriangle size={18} /> Remove my account</h2>
        <p style={{ margin: 0, fontSize: 13, color: "#6B3A30", lineHeight: 1.5 }}>This removes your organisation, every department and rota, and all members' access. It can't be undone. We remove it by hand and email you when it's done.</p>
        <button disabled={!canExport || saving} onClick={async () => { setSaving(true); try { await downloadData(ownedRotas, orgName); setSaved(true); } finally { setSaving(false); } }}
          style={{ ...ghost, alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 8, color: "#6B3A30", borderColor: "#E9B7AB", opacity: canExport ? 1 : 0.5 }}>
          <Download size={15} /> {saving ? "Preparing…" : saved ? "Downloaded — download again" : "Download my data first (Excel)"}
        </button>
        <div><label htmlFor="ya-reason" style={{ ...lbl, color: "#6B3A30" }}>Why are you leaving?</label>
          <select id="ya-reason" value={reason} onChange={(e) => setReason(e.target.value)} style={inp}>
            <option value="">Choose a reason</option>
            {["We moved to another system", "Too expensive", "Missing a feature we need", "Our ward or organisation closed", "Something else"].map((r) => <option key={r}>{r}</option>)}
          </select></div>
        <textarea rows={3} value={more} onChange={(e) => setMore(e.target.value)} placeholder="Anything else you'd like us to know (optional)" aria-label="Anything else" style={{ ...inp, resize: "vertical" }} />
        <a href={reason ? mailto("Please remove my account", body) : undefined} aria-disabled={!reason} onClick={(e) => { if (!reason) e.preventDefault(); }}
          style={{ ...primary, alignSelf: "flex-start", background: "#A8402A", display: "inline-flex", alignItems: "center", textDecoration: "none", opacity: reason ? 1 : 0.5 }}>Send removal request</a>
      </section>
    </div>
  );
}

export default function YourAccount({ section: start = "profile", onBack, onOpenPlans = null, orgName = "", email = "", ownedRotas = [] }) {
  const narrow = useNarrow();
  const [section, setSection] = useState(start);
  const [listOpen, setListOpen] = useState(start === "profile"); // phones open on the list
  useEffect(() => { setSection(start); setListOpen(start === "profile"); }, [start]);
  const pick = (id) => { setSection(id); setListOpen(false); };
  /* Start at the top: opening Your account, a section, or the phone list
     otherwise keeps wherever the dashboard was scrolled to. */
  const topRef = useRef(null);
  useEffect(() => {
    const el = topRef.current;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "start" });
    if (typeof window !== "undefined" && window.scrollTo) window.scrollTo(0, 0);
  }, [section, listOpen]);
  const current = SECTIONS.find((s) => s.id === section) || SECTIONS[0];

  const nav = (
    <nav aria-label="Account sections" style={{ ...glass, padding: 10, display: "flex", flexDirection: "column", gap: 2, ...(narrow ? {} : { flex: "0 0 270px", position: "sticky", top: 16 }) }}>
      {SECTIONS.map((s) => {
        const on = !narrow && s.id === section; const Icon = s.icon;
        return (
          <button key={s.id} onClick={() => pick(s.id)} aria-current={on ? "page" : undefined}
            style={{ fontFamily: "inherit", display: "flex", alignItems: "center", gap: 12, border: 0, borderRadius: 14, padding: "0 12px", minHeight: narrow ? 60 : 46, textAlign: "left", cursor: "pointer",
              background: on ? T.ink : "transparent", color: on ? "#fff" : T.ink, borderBottom: narrow ? "1px solid rgba(14,58,71,0.06)" : 0 }}>
            <span style={{ width: 34, height: 34, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", background: on ? "rgba(255,255,255,0.14)" : "rgba(14,58,71,0.06)" }}><Icon size={17} /></span>
            <span style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{s.label}</span>
              {narrow && <span style={{ fontSize: 12, color: T.soft }}>{s.sub}</span>}
            </span>
            {s.tag && <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 999, padding: "2px 7px", background: on ? "rgba(255,255,255,0.2)" : "#D7EEF4", color: on ? "#fff" : T.lagoon }}>{s.tag}</span>}
            {narrow && <ChevronRight size={16} color={T.soft} />}
          </button>
        );
      })}
    </nav>
  );

  const body = (
    <main key={section} className="ya-in" style={{ flex: "999 1 560px", minWidth: 0 }}>
      {section === "profile" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 16, alignItems: "start" }}>
          <div style={{ minWidth: 0 }}><Account embedded /></div>
          <MyPlan onOpenPlans={onOpenPlans} onHistory={() => pick("history")} />
        </div>
      )}
      {section === "feature" && <FeatureRequest email={email} orgName={orgName} />}
      {section === "members" && <section style={{ ...glass, padding: 20 }}><Members embedded /></section>}
      {section === "quote" && <Quotation orgName={orgName} />}
      {section === "history" && (
        <section style={{ ...glass, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <h2 className="ya-h2" style={h2}>Subscription history</h2>
            <button onClick={() => pick("profile")} style={ghost}>My plan</button>
          </div>
          <SubscriptionHistory embedded onReceipt={(r) => openDoc(receiptHtml({ payment: r, to: { org: orgName, email } }))} />
        </section>
      )}
      {section === "support" && <Support email={email} orgName={orgName} ownedRotas={ownedRotas} />}
    </main>
  );

  return (
    <div ref={topRef} style={{ fontFamily: "Inter, system-ui, sans-serif", color: T.ink, maxWidth: 1240, margin: "0 auto", padding: "22px 20px 44px", boxSizing: "border-box", scrollMarginTop: 0 }}>
      <style>{`
        @keyframes ya-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .ya-in { animation: ya-in .45s cubic-bezier(.22,1,.36,1) both; }
        @media (max-width: 720px) { .ya-h2 { display: none; } }
        @media (prefers-reduced-motion: reduce) { .ya-in { animation: none; } }
        @media (prefers-reduced-transparency: reduce) { .ya-in section, nav[aria-label="Account sections"] { backdrop-filter: none !important; background: rgba(255,255,255,0.95) !important; } }
      `}</style>
      {narrow && !listOpen ? (
        <button onClick={() => setListOpen(true)} style={{ ...ghost, display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 12 }}><ChevronLeft size={16} /> Your account</button>
      ) : onBack ? (
        <button onClick={onBack} style={{ fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", border: 0, color: T.lagoon, fontSize: 13.5, fontWeight: 700, padding: "6px 2px", marginBottom: 8, cursor: "pointer" }}>
          <ChevronLeft size={16} /> Back to my dashboard</button>
      ) : null}
      <h1 style={{ margin: "0 0 16px", fontFamily: H, fontSize: 26, fontWeight: 800, letterSpacing: "-0.02em" }}>{narrow && !listOpen ? current.label : "Your account"}</h1>
      {narrow ? (listOpen ? nav : body) : (
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start" }}>{nav}{body}</div>
      )}
    </div>
  );
}
