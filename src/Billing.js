import React, { useState, useEffect } from 'react';
import { Crown } from 'lucide-react';
import supabase from './supabaseClient';

/* ─────────────── Pricing page ───────────────
   Built to the "Duty Rota Pricing Page — Final Specification" document.

   The rules that shape everything here:
   - USD is the primary price; MVR is an approximate reference underneath.
   - A feature that is not live NEVER gets a normal checkmark. It appears
     in a muted "In development" section with no promised date.
   - Prices come from plan_limits in the database — the cards, the
     comparison table and the checkout message all read the same source,
     so they cannot disagree.
   - Feature flags below control the phase. Flip premiumLaunchPricing to
     true (and update the database prices) only when Smart Roster is live.

   Upgrading currently opens WhatsApp. When a payment gateway arrives,
   only startCheckout() changes.                                        */

const WHATSAPP = '9607666261'; // +960 Maldives

/* ── Feature flags ──
   All false today. Turning one on moves its feature from "In development"
   to a live checkmark on eligible plans. premiumLaunchPricing switches
   Plus/Pro to the Phase 2 prices — which must ALSO be updated in
   plan_limits, since the database is the price source of truth.        */
const featureFlags = {
  smartRoster: true,
  employeeAccess: false,
  premiumLaunchPricing: false,
};

/* Copy and future-limits per tier. Prices are NOT here — they live in the
   database. This holds only wording and the planned (not yet live) limits. */
const PLAN_COPY = {
  basic: {
    blurb: 'For small teams that create and share duty rotas manually.',
    adminUsersFuture: null,
    employeeAccessFuture: true,
    smartRosterFuture: false,
  },
  standard: {
    blurb: 'For one-department organisations with unlimited staff.',
    adminUsersFuture: null,
    employeeAccessFuture: true,
    smartRosterFuture: false,
  },
  plus: {
    blurb: 'For growing organisations managing several departments.',
    badge: 'Best Plan',
    adminUsersFuture: null,
    employeeAccessFuture: true,
    smartRosterFuture: true,
  },
  pro: {
    blurb: 'For larger organisations with more departments and support needs.',
    adminUsersFuture: null,
    employeeAccessFuture: true,
    smartRosterFuture: true,
  },
};

const INCLUDED_IN_ALL = [
  'Weekly and monthly rota views',
  'PDF and image export',
  'Your own duty codes',
  'Staff records and leave tracking',
  'Duty exchange tracking',
  'Statistics and insights',
];

const T = {
  teal: '#0F8B7E', deep: '#0B6A60', ink: '#142B33', soft: '#6B8A93',
  line: '#DCE8E6', bg: '#F5F9F8', faint: '#B6C7C4',
  warn: '#8A5A0F', warnBg: '#FBF1DC', warnLine: '#E7D9B8',
  bad: '#8A2E1E', badBg: '#FBEAE7', badLine: '#F1B8AE',
  good: '#0B6A60', goodBg: '#E6F4F1', goodLine: '#B8DCD5',
  devBg: '#F1F5F4',
};

const card = {
  background: '#fff', border: `1px solid ${T.line}`, borderRadius: 12,
  padding: 18, marginBottom: 16,
};

const usd = (cents) => (cents == null ? null : `$${(cents / 100).toFixed(2)}`);
const mvr = (laari) => (laari == null ? null : `MVR ${Math.round(laari / 100).toLocaleString('en-US')}`);
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) : '—');

/* Savings are calculated from the USD source prices, never from rounded
   MVR values — the spec is explicit about this, because rounded figures
   drift and produce percentages that do not match the shown prices.    */
const annualSavingUsd = (p) => {
  const m = p?.price_monthly_usd_cents, a = p?.price_annual_usd_cents;
  if (!m || !a) return null;
  const twelve = m * 12;
  if (a >= twelve) return null;
  return {
    pct: Math.round(((twelve - a) / twelve) * 100),
    perYearUsd: twelve - a,
  };
};

// One place that decides what "choose this plan" does. Swap the body for a
// checkout redirect once the payment gateway is live; nothing else changes.
const startCheckout = (label, cycle, p, isCycleSwitch) => {
  const total = cycle === 'annual' ? usd(p?.price_annual_usd_cents) : usd(p?.price_monthly_usd_cents);
  const terms = cycle === 'annual' ? `annual (${total} billed yearly)` : `monthly (${total}/month)`;
  const msg = isCycleSwitch
    ? `Hi! I'm on DutyRota ${label} and I'd like to switch to ${terms}.`
    : `Hi! I'd like to subscribe to DutyRota ${label} — ${terms}.`;
  window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`, '_blank', 'noreferrer');
};
const contactSales = () => {
  const msg = "Hi! I'd like to ask about a custom DutyRota plan for my organisation.";
  window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`, '_blank', 'noreferrer');
};

const Tick = () => <span style={{ color: T.teal, fontWeight: 800, marginRight: 7 }}>✓</span>;

function DevList({ items, note }) {
  /* The muted in-development block. Deliberately styled unlike the live
     features — grey background, no checkmarks — so an unavailable feature
     can never be mistaken for an included one.                         */
  if (!items.length) return null;
  return (
    <div style={{ background: T.devBg, border: `1px dashed ${T.line}`, borderRadius: 8, padding: '9px 11px', marginBottom: 14 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, color: T.soft, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
        Coming soon
      </div>
      {items.map((f) => (
        <div key={f} style={{ fontSize: 12.5, color: T.soft, lineHeight: 1.8 }}>{f}</div>
      ))}
      {note && <div style={{ fontSize: 11.5, color: T.soft, marginTop: 5, lineHeight: 1.5 }}>{note}</div>}
    </div>
  );
}

export default function Billing({ onExit, email }) {
  const [sub, setSub] = useState(null);
  const [plans, setPlans] = useState(null);
  const [cycle, setCycle] = useState('annual'); // annual first — anchors on the lower monthly-equivalent price
  const [error, setError] = useState('');
  const [openFaq, setOpenFaq] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [subRes, planRes] = await Promise.all([
        supabase.rpc('my_subscription'),
        supabase.from('plan_limits').select('*').order('rank', { ascending: true }),
      ]);
      if (cancelled) return;
      if (subRes.error) setError('Could not load your subscription details.');
      setSub(subRes.data || null);
      setPlans(planRes.error ? [] : (planRes.data || []));
      // Someone already paying should see the cycle they are actually billed
      // on, so the page matches their bill rather than the sales default.
      if (subRes.data?.state === 'active' && subRes.data?.billing_cycle) {
        setCycle(subRes.data.billing_cycle === 'annual' ? 'annual' : 'monthly');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const state = sub?.state;
  const currentTier = sub?.paid_tier || null;
  const daysLeft = sub?.days_remaining ?? null;

  const banner = (() => {
    if (!sub) return null;
    if (state === 'active') {
      return {
        bg: T.goodBg, line: T.goodLine, fg: T.good,
        title: `You are on the ${currentTier || 'paid'} plan`,
        body: `Your subscription runs until ${fmt(sub.paid_until)}` +
              (daysLeft != null ? ` — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left.` : '.'),
      };
    }
    if (state === 'trialing') {
      const urgent = daysLeft != null && daysLeft <= 7;
      return {
        bg: urgent ? T.warnBg : '#fff', line: urgent ? T.warnLine : T.line,
        fg: urgent ? T.warn : T.ink,
        title: daysLeft != null ? `Free trial — ${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'Free trial',
        body: `Your trial ends on ${fmt(sub.trial_ends_at)}. Subscribe before then to keep editing without interruption.`,
      };
    }
    return {
      bg: T.badBg, line: T.badLine, fg: T.bad,
      title: 'Your access has ended',
      body: 'Your rota and all your data are safe — you can still view everything and export PDFs, ' +
            'but editing is paused. Subscribe to pick up where you left off.',
    };
  })();

  const maxSaving = Math.max(0, ...(plans || []).map((p) => annualSavingUsd(p)?.pct || 0));

  /* ── FAQ content ──
     The change/cancel answers describe the policy actually implemented in
     the admin tooling: upgrades start a fresh period today; downgrades
     apply when the current paid period ends; access always runs to the end
     of what was paid for.                                              */
  const faqs = [
    ['Who can edit my duty rota?',
      'You can, as the account owner. Once invitations launch you will also be able to make any of your staff a manager for a department, and they can build and publish that department\'s rota. There is no limit on how many managers you appoint.'],
    ['What is employee access?',
      'Employee access allows staff to log in and view the latest published duty rota that is relevant to them. It is being rolled out now and will be included in every plan, including Basic.'],
    ['Is multi-user access available now?',
      'It is being rolled out now. The groundwork is live and email invitations are the last piece; we will let you know as soon as you can invite your team.'],
    ['What is Smart Roster?',
      'Smart Roster automates the repetitive parts of building a duty rota while leaving the final schedule in your control. It is included with Plus, Pro and Custom. Basic and Standard use manual rota creation.'],
    ['How does annual billing work?',
      'Annual plans are charged once for the full year. The displayed monthly amount is the monthly equivalent of the annual charge.'],
    ['Why is the MVR amount approximate?',
      'USD is the primary price. The MVR amount is a reference and may differ slightly depending on the payment method or bank exchange rate.'],
    ['Can I change plans later?',
      'Yes. Upgrades take effect immediately and start a new billing period from that day. Downgrades take effect when your current paid period ends, so you keep everything you have already paid for.'],
    ['Can I cancel at any time?',
      'Yes — message us on WhatsApp. Your access continues until the end of the period you have paid for, and your rota and data remain safe throughout.'],
  ];

  return (
    <div style={{ background: T.bg, minHeight: '100vh', fontFamily: 'Arial, sans-serif', color: T.ink }}>
      <div style={{ background: T.deep, color: '#fff', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <strong style={{ fontSize: 16 }}>Your plan</strong>
        <button onClick={onExit} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit' }}>
          ← Back to my rota
        </button>
      </div>

      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '18px 18px 60px' }}>
        {error && (
          <div style={{ ...card, background: T.badBg, borderColor: T.badLine, color: T.bad, fontSize: 13.5 }}>⚠ {error}</div>
        )}
        {!sub && !error && <div style={{ ...card, color: T.soft, fontSize: 13.5 }}>Loading your plan…</div>}

        {banner && (
          <div style={{ ...card, background: banner.bg, borderColor: banner.line }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: banner.fg, marginBottom: 6 }}>{banner.title}</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: banner.fg === T.ink ? T.soft : banner.fg }}>{banner.body}</div>
            {email && <div style={{ fontSize: 12, color: T.soft, marginTop: 10 }}>Account: {email}</div>}
          </div>
        )}

        {/* 1 — Hero */}
        <div style={{ textAlign: 'center', margin: '26px 0 18px' }}>
          <h1 style={{ fontSize: 24, margin: '0 0 8px' }}>Simple plans for smarter duty scheduling</h1>
          <p style={{ fontSize: 13.5, color: T.soft, lineHeight: 1.6, maxWidth: 560, margin: '0 auto' }}>
            Create and manage duty rotas with clear tools today, and access more automation and
            collaboration features as they become available.
          </p>
        </div>

        {/* 2 — Billing toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 22 }}>
          <div style={{ display: 'inline-flex', background: '#fff', border: `1px solid ${T.line}`, borderRadius: 8, overflow: 'hidden' }}>
            {['monthly', 'annual'].map((c) => (
              <button key={c} onClick={() => setCycle(c)} style={{
                padding: '9px 18px', fontSize: 13, fontWeight: 700, border: 'none',
                cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                background: cycle === c ? T.teal : 'transparent',
                color: cycle === c ? '#fff' : T.soft,
              }}>
                {c === 'monthly' ? 'Monthly' : maxSaving > 0 ? `Annual — save up to ${maxSaving}%` : 'Annual'}
              </button>
            ))}
          </div>
        </div>

        {/* 3 — The four plan cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(225px, 1fr))', gap: 14, alignItems: 'stretch' }}>
          {plans === null && <div style={{ ...card, color: T.soft, fontSize: 13.5 }}>Loading plans…</div>}
          {plans && plans.length === 0 && (
            <div style={{ ...card, color: T.soft, fontSize: 13.5 }}>Plan details are unavailable right now.</div>
          )}

          {plans && plans.map((p) => {
            const copy = PLAN_COPY[p.tier] || {};
            const annual = cycle === 'annual';
            // Being on a plan and being on that plan's billing cycle are two
            // different things. A monthly subscriber looking at the annual
            // prices must still be able to switch — so only an exact match
            // of tier AND cycle counts as "nothing to do here".
            const isCurrentPlan = currentTier === p.tier && state === 'active';
            const subCycle = sub?.billing_cycle || null;
            // A subscription with no cycle recorded cannot meaningfully be
            // "switched" to anything, so treat it as an exact match rather
            // than offering a switch that makes no sense.
            const isCurrentExact = isCurrentPlan && (!subCycle || subCycle === cycle);
            const isCycleSwitch = isCurrentPlan && !isCurrentExact;
            const isCurrent = isCurrentExact; // controls the highlighted border
            const saving = annual ? annualSavingUsd(p) : null;
            const isPlus = p.tier === 'plus';

            const headUsd = annual
              ? usd(p.price_annual_usd_cents ? Math.round(p.price_annual_usd_cents / 12) : null)
              : usd(p.price_monthly_usd_cents);
            const headMvr = annual
              ? mvr(p.price_annual_laari ? p.price_annual_laari / 12 : null)
              : mvr(p.price_monthly_laari);

            // Live features, straight from the database limits.
            const live = [
              p.max_staff == null ? 'Unlimited staff members' : `Up to ${p.max_staff} staff members`,
              `${p.max_departments == null ? 'Unlimited' : p.max_departments} department${p.max_departments === 1 ? '' : 's'}`,
              'Manual rota creation',
              'PDF and image export',
              ...(featureFlags.employeeAccess && copy.employeeAccessFuture ? ['Unlimited employee viewing access'] : []),
              ...(featureFlags.smartRoster && copy.smartRosterFuture ? ['Smart Roster automation'] : []),
              ...(p.has_company_logo ? ['Your own company logo'] : []),
              p.has_priority_support ? 'Priority support' : 'Standard support',
            ];

            // Not-yet-live features for this plan, shown muted with no ticks.
            const dev = [
              ...(!featureFlags.smartRoster && copy.smartRosterFuture ? ['Smart Roster automation'] : []),
              ...(!featureFlags.employeeAccess && copy.employeeAccessFuture ? ['Unlimited employee viewing access'] : []),
            ];
            const devNote = !featureFlags.employeeAccess
              ? 'Your plan is limited by departments, not by how many people use it.'
              : null;

            return (
              <div key={p.tier} style={{
                ...card, marginBottom: 0, display: 'flex', flexDirection: 'column', position: 'relative',
                borderColor: isCurrent ? T.teal : isPlus ? T.teal : T.line,
                borderWidth: isCurrent || isPlus ? 2 : 1,
                boxShadow: isPlus ? '0 4px 14px rgba(15,139,126,0.12)' : 'none',
              }}>
                {copy.badge && !featureFlags.premiumLaunchPricing && (
                  <span style={{ position: 'absolute', top: -11, left: 14, background: T.teal, color: '#fff', fontSize: 10.5, fontWeight: 800, padding: '4px 11px 4px 9px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.4, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Crown size={12} strokeWidth={2.5} />
                    {copy.badge}
                  </span>
                )}
                {isPlus && featureFlags.premiumLaunchPricing && (
                  <span style={{ position: 'absolute', top: -11, left: 14, background: T.warn, color: '#fff', fontSize: 10.5, fontWeight: 800, padding: '4px 11px 4px 9px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.4, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Crown size={12} strokeWidth={2.5} />
                    Best Value
                  </span>
                )}
                {saving && (
                  <span style={{ position: 'absolute', top: -10, right: 14, background: T.warn, color: '#fff', fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                    Save {saving.pct}%
                  </span>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, marginTop: copy.badge || saving ? 6 : 0, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 800 }}>{p.label || p.tier}</span>
                  {isCurrentPlan && (
                    <span style={{ background: T.goodBg, color: T.good, fontSize: 10.5, fontWeight: 800, padding: '3px 8px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                      {isCurrentExact || !subCycle ? 'Current' : `Current · ${subCycle}`}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: T.soft, lineHeight: 1.5, marginBottom: 10, minHeight: 36 }}>
                  {copy.blurb || ''}
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: T.teal }}>{headUsd || '—'}</span>
                  <span style={{ fontSize: 12.5, color: T.soft }}>/month</span>
                </div>
                <div style={{ fontSize: 11.5, color: T.soft, marginTop: 3, marginBottom: 12, lineHeight: 1.6 }}>
                  Approx. {headMvr || '—'}/month
                  {annual && p.price_annual_usd_cents && (
                    <><br />{usd(p.price_annual_usd_cents)} billed annually</>
                  )}
                </div>

                <div style={{ fontSize: 10.5, fontWeight: 800, color: T.soft, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
                  Live features
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', fontSize: 12.5, lineHeight: 1.9 }}>
                  {live.map((f) => <li key={f}><Tick />{f}</li>)}
                </ul>

                <div style={{ flex: 1 }}>
                  <DevList items={dev} note={devNote} />
                </div>

                <button
                  onClick={() => startCheckout(p.label || p.tier, cycle, p, isCycleSwitch)}
                  disabled={isCurrentExact}
                  style={{
                    width: '100%', padding: '11px 12px', borderRadius: 8, border: 'none',
                    fontFamily: 'inherit', fontSize: 13.5, fontWeight: 800,
                    background: isCurrentExact ? '#EEF4F3' : T.teal,
                    color: isCurrentExact ? T.soft : '#fff',
                    cursor: isCurrentExact ? 'default' : 'pointer',
                  }}
                >
                  {isCurrentExact
                    ? 'Your current plan'
                    : isCycleSwitch
                      ? `Switch to ${annual ? 'annual' : 'monthly'} billing`
                      : `Choose ${p.label || p.tier}`}
                </button>
              </div>
            );
          })}
        </div>

        {/* 4 — Billing and currency note */}
        <p style={{ fontSize: 11.5, color: T.soft, textAlign: 'center', margin: '14px 0 22px', lineHeight: 1.6 }}>
          Prices are displayed in USD. MVR amounts are approximate reference values and may differ
          slightly depending on the payment method or bank exchange rate.
        </p>

        {/* 5 — Features in development banner */}
        <div style={{ ...card, background: T.devBg, borderStyle: 'dashed' }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Multi-user access is rolling out now</div>
          <p style={{ fontSize: 13, color: T.soft, lineHeight: 1.7, margin: 0 }}>
            Your team will be able to sign in and see the duty rota that applies to them, instead of
            waiting for an exported file. Every plan includes it, Basic included, and there is no cap
            on how many people you add — your plan is limited by departments, not by people. You will
            also be able to make any staff member a manager for a department, so they can build and
            publish its rota. The groundwork is live and email invitations are the last piece.
          </p>
        </div>

        {/* 6 — Custom plan, its own wide section */}
        <div style={{ ...card, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
          <div style={{ flex: '1 1 300px' }}>
            <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>
              Need a plan tailored to your organisation?
            </div>
            <p style={{ fontSize: 13, color: T.soft, lineHeight: 1.7, margin: '0 0 10px' }}>
              Contact us for a plan designed around your organisation's size, structure and setup
              requirements.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0 16px', fontSize: 12.5, lineHeight: 2 }}>
              <span><Tick />Unlimited staff members</span>
              <span><Tick />Unlimited departments</span>
              <span><Tick />Your own company logo</span>
              <span><Tick />Priority support</span>
              <span><Tick />Dedicated setup assistance</span>
            </div>
          </div>
          <div style={{ flex: '0 0 auto', textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.teal, marginBottom: 10 }}>Let's talk</div>
            <button onClick={contactSales} style={{
              padding: '11px 22px', borderRadius: 8, border: `1px solid ${T.teal}`,
              background: '#fff', color: T.teal, fontFamily: 'inherit',
              fontSize: 13.5, fontWeight: 800, cursor: 'pointer',
            }}>
              Contact Sales
            </button>
          </div>
        </div>

        {/* 7 — Included in every plan */}
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Included in every plan</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '2px 18px' }}>
            {INCLUDED_IN_ALL.map((f) => (
              <div key={f} style={{ fontSize: 13, lineHeight: 2 }}><Tick />{f}</div>
            ))}
          </div>
        </div>

        {/* 8 — Full comparison table */}
        <h2 style={{ fontSize: 16, margin: '4px 0 12px' }}>Compare features</h2>
        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640, fontSize: 12.5 }}>
            <thead>
              <tr>
                {['Feature', 'Basic', 'Standard', 'Plus', 'Pro', 'Custom'].map((h) => (
                  <th key={h} style={{ textAlign: h === 'Feature' ? 'left' : 'center', padding: '10px 12px', fontSize: 11.5, fontWeight: 800, color: T.soft, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: `1px solid ${T.line}`, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['Staff members', '20', 'Unlimited', 'Unlimited', 'Unlimited', 'Unlimited'],
                ['Departments', '1', '1', '6', '12', 'Unlimited'],
                ['Employee viewing access', 'Rolling out', 'Rolling out', 'Rolling out', 'Rolling out', 'Rolling out'],
                ['Manual rota creation', 'Included', 'Included', 'Included', 'Included', 'Included'],
                ['PDF and image export', 'Included', 'Included', 'Included', 'Included', 'Included'],
                ['Smart Roster', 'Not included', 'Not included', 'Included', 'Included', 'Included'],
                ['Custom company logo', 'Not included', 'Not included', 'Included', 'Included', 'Included'],
                ['Support', 'Standard', 'Standard', 'Standard', 'Priority', 'Priority'],
                ['Dedicated setup help', 'Not included', 'Not included', 'Not included', 'Not included', 'Included'],
              ].map(([feature, ...cells]) => (
                <tr key={feature}>
                  <td style={{ padding: '9px 12px', borderBottom: `1px solid ${T.line}`, fontWeight: 600, whiteSpace: 'nowrap' }}>{feature}</td>
                  {cells.map((c, i) => (
                    <td key={i} style={{
                      padding: '9px 12px', borderBottom: `1px solid ${T.line}`, textAlign: 'center',
                      color: c === 'Included' ? T.teal : (c === 'In development' || c === 'Rolling out') ? T.warn : c === 'Not included' ? T.faint : T.ink,
                      fontWeight: c === 'Included' ? 700 : 400, whiteSpace: 'nowrap',
                    }}>
                      {c === 'Included' ? '✓ Included' : c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 9 — Smart Roster section */}
        <div style={{ ...card }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Smart Roster</div>
          <p style={{ fontSize: 13, color: T.soft, lineHeight: 1.7, margin: 0 }}>
            Smart Roster takes the repetitive work out of building a duty rota and leaves the final
            schedule in your hands — nothing is published until you say so. It is included with
            Plus, Pro and Custom plans.
          </p>
        </div>

        {/* 10 — How to subscribe */}
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>How to subscribe</div>
          <p style={{ fontSize: 13, color: T.soft, lineHeight: 1.7, margin: 0 }}>
            Choose a plan above to open a WhatsApp message to us. We will confirm the payment details
            and activate your plan, usually on the same day. Your duty rota and all your data remain
            unchanged during activation. Prices are displayed in US dollars, with the approximate
            rufiyaa equivalent shown underneath.
          </p>
        </div>

        {/* 11 — FAQs */}
        <div style={{ ...card, padding: '8px 18px' }}>
          <div style={{ fontSize: 14, fontWeight: 700, margin: '10px 0' }}>Frequently asked questions</div>
          {faqs.map(([q, a], i) => (
            <div key={q} style={{ borderTop: `1px solid ${T.line}` }}>
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                style={{
                  width: '100%', textAlign: 'left', background: 'none', border: 'none',
                  padding: '11px 0', fontSize: 13, fontWeight: 700, color: T.ink,
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                }}
              >
                {q}
                <span style={{ color: T.soft, flexShrink: 0 }}>{openFaq === i ? '−' : '+'}</span>
              </button>
              {openFaq === i && (
                <p style={{ fontSize: 12.5, color: T.soft, lineHeight: 1.7, margin: '0 0 12px' }}>{a}</p>
              )}
            </div>
          ))}
        </div>

        {/* 12 — Final note */}
        <p style={{ fontSize: 11.5, color: T.soft, textAlign: 'center', lineHeight: 1.7 }}>
          Features marked "Coming soon" are not available yet. Your rota and all your data are
          preserved through any plan activation or change.
        </p>
      </div>
    </div>
  );
}