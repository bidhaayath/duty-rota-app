import React, { useState, useEffect, useCallback } from 'react';
import { Crown } from 'lucide-react';
import supabase from './supabaseClient';
import {
  fetchPromo, planPrice, openOffers, countdownParts, isLastDay, offerEndDate, useServerNow,
} from './promo';

/* ─────────────── Pricing page ───────────────
   Built to the "Duty Rota Pricing Page — Final Specification" document.

   The rules that shape everything here:
   - USD is the primary price; MVR is an approximate reference underneath.
   - A feature that is not live NEVER gets a normal checkmark. It appears
     in a muted "In development" section with no promised date.
   - Prices come from plan_limits in the database — the cards, the
     comparison table and the checkout dialog all read the same source,
     so they cannot disagree.
   - Feature flags below control the phase. Flip premiumLaunchPricing to
     true (and update the database prices) only when Smart Roster is live.

   Choosing a plan opens the checkout dialog, which hands over to the BML
   Payment Gateway. The card is charged in MVR, so the checkout dialog shows
   the MVR amount as the charge and USD underneath as the reference.

   Promotions: plan_prices() returns, per tier, the normal price and what
   this account would pay today. The cards and the checkout dialog show
   those, and the dialog sends the amount it showed, so the server refuses
   to go on if the price has changed (see /api/bml/start).               */

export const WHATSAPP = '9607666261'; // +960 Maldives

/* ── Feature flags ──
   All false today. Turning one on moves its feature from "In development"
   to a live checkmark on eligible plans. premiumLaunchPricing switches
   Plus/Pro to the Phase 2 prices — which must ALSO be updated in
   plan_limits, since the database is the price source of truth.        */
const featureFlags = {
  smartRoster: true,
  employeeAccess: true,
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
  'PDF, image and Excel export',
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
/* The checkout dialog must show the exact amount the card will be charged,
   to the laari — not the rounded reference figure used on the cards.    */
const mvrExact = (laari) => (laari == null ? null
  : `MVR ${(laari / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
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

/* Wording for refusals that cannot be fixed by trying again — the pay
   button is switched off for these, so the customer is not invited to
   press it a second time for the same message.                        */
const DOWNGRADE_MESSAGE =
  'You are currently on a higher plan. A change to a smaller plan takes effect when your paid period ends, so there is nothing to pay today. Message us on WhatsApp if you would like us to arrange it.';

const PRICE_CHANGED_MESSAGE =
  'The price changed while this page was open, usually because an offer has just ended. Nothing has been charged. The total above is now up to date — please check it and press Pay again.';

/* Plain-English wording for every way the payment can be refused before
   the customer reaches the bank. Anything unrecognised falls back to the
   last line, so a new reason can never show a raw code to a customer.  */
const checkoutErrorMessage = (status, data) => {
  const reason = (data && (data.error || data.reason)) || '';
  const map = {
    downgrade_wait: DOWNGRADE_MESSAGE,
    price_changed: PRICE_CHANGED_MESSAGE,
    not_signed_in:
      'Your session has expired. Please sign in again and try once more.',
    payments_not_configured:
      'Card payment is not switched on yet. Please message us on WhatsApp to subscribe.',
    gateway_unavailable:
      'The payment gateway did not respond. Please try again in a few minutes, or message us on WhatsApp.',
    server_error:
      'Something went wrong on our side. Please try again, or message us on WhatsApp.',
  };
  if (map[reason]) return map[reason];
  if (status === 401) return map.not_signed_in;
  if (status === 503) return map.payments_not_configured;
  if (status === 502) return map.gateway_unavailable;
  return 'We could not start the payment. Please try again, or message us on WhatsApp and we will help.';
};

const contactSales = () => {
  const msg = "Hi! I'd like to ask about a custom Easy Duty Rota plan for my organisation.";
  window.open(`https://wa.me/${WHATSAPP}?text=${encodeURIComponent(msg)}`, '_blank', 'noreferrer');
};
const whatsappHelp = () => {
  const msg = 'Hi! I need some help subscribing to Easy Duty Rota.';
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

/* The promotion banner. It ticks on its own every second so the rest of the
   page doesn't re-render with it. The countdown runs to the server's ends_at
   on the server's clock; on the final day it turns red, and once the offer
   ends (or this account has used every offer) it disappears.          */
function PromoBanner({ promo }) {
  const now = useServerNow(promo?.offset, 1000);
  const { offers, endsAt } = openOffers(promo, now);
  if (!offers.length) return null;

  const left = endsAt - now;
  const last = isLastDay(left);
  const c = countdownParts(left);
  const two = (n) => String(n).padStart(2, '0');
  const boxes = [[c.days, c.days === 1 ? 'day' : 'days'], [two(c.hours), 'hrs'], [two(c.minutes), 'min'], [two(c.seconds), 'sec']];

  return (
    <div role="region" aria-label="Special offer" style={{
      borderRadius: 14, padding: '20px 18px', marginBottom: 16, color: '#fff', textAlign: 'center',
      background: last ? 'linear-gradient(135deg, #C0392B, #7F1D1D)' : 'linear-gradient(135deg, #0F8B7E, #0B5A52)',
      boxShadow: last ? '0 6px 20px rgba(192,57,43,0.30)' : '0 6px 20px rgba(11,106,96,0.25)',
    }}>
      <div style={{ fontSize: 'clamp(19px, 5vw, 26px)', fontWeight: 900, letterSpacing: 0.3, lineHeight: 1.25 }}>
        NOVEMBER ROSTER, SORTED! 🚀
      </div>
      <div style={{ fontSize: 'clamp(16px, 4.4vw, 21px)', fontWeight: 900, color: '#FFE08A', margin: '8px 0 6px', lineHeight: 1.35 }}>
        {offers.map((o) => `${o.percentOff}% OFF ${o.cycle === 'annual' ? 'ANNUAL' : 'MONTHLY'}`).join(' · ')}
      </div>
      <div style={{ fontSize: 13.5, opacity: 0.95, lineHeight: 1.5 }}>
        Make holiday duty planning easier with EasyDutyRota.
      </div>

      <div style={{ margin: '14px 0 10px', fontSize: 15, fontWeight: 800, lineHeight: 1.5 }}>
        {last && (
          <span style={{ display: 'inline-block', background: '#fff', color: '#C0392B', borderRadius: 20, padding: '2px 11px', marginRight: 8, fontSize: 13, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Last day!
          </span>
        )}
        Offer ends {offerEndDate(endsAt)} — Subscribe now!
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
        {boxes.map(([n, label]) => (
          <div key={label} style={{ background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 10, minWidth: 58, padding: '7px 6px' }}>
            <div style={{ fontSize: 24, fontWeight: 900, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{n}</div>
            <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.9 }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Billing({ onExit, email }) {
  const [sub, setSub] = useState(null);
  const [plans, setPlans] = useState(null);
  const [cycle, setCycle] = useState('annual'); // annual first — anchors on the lower monthly-equivalent price
  const [error, setError] = useState('');
  const [openFaq, setOpenFaq] = useState(null);

  // Checkout dialog state. `checkout` holds the plan the customer picked.
  const [checkout, setCheckout] = useState(null);
  const [agreed, setAgreed] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');

  // This account's prices from plan_prices(), by tier, and the promotion.
  // Empty / null when there is none, and then every list price stands.
  const [priceRows, setPriceRows] = useState({});
  const [promo, setPromo] = useState(null);

  const applyPrices = useCallback(({ rows, promo: p }) => {
    setPriceRows(Object.fromEntries(rows.map((r) => [r.tier, r])));
    setPromo(p);
  }, []);
  const loadPrices = useCallback(async () => { applyPrices(await fetchPromo()); }, [applyPrices]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Prices load with the plans, so a discounted card never first shows
      // the normal price and then jumps.
      const [subRes, planRes, priceRes] = await Promise.all([
        supabase.rpc('my_subscription'),
        supabase.from('plan_limits').select('*').order('rank', { ascending: true }),
        fetchPromo(),
      ]);
      if (cancelled) return;
      if (subRes.error) setError('Could not load your subscription details.');
      setSub(subRes.data || null);
      applyPrices(priceRes);
      setPlans(planRes.error ? [] : (planRes.data || []));
      // Someone already paying should see the cycle they are actually billed
      // on, so the page matches their bill rather than the sales default.
      if (subRes.data?.state === 'active' && subRes.data?.billing_cycle) {
        setCycle(subRes.data.billing_cycle === 'annual' ? 'annual' : 'monthly');
      }
    })();
    return () => { cancelled = true; };
  }, [applyPrices]);

  // When an offer ends with the page open, ask the server again shortly
  // after, so the cards and the checkout drop to the normal price.
  useEffect(() => {
    if (!promo) return undefined;
    const now = Date.now() + promo.offset;
    const ends = [promo.monthly, promo.annual].filter(Boolean).map((o) => o.endsAt).filter((t) => t > now);
    if (!ends.length) return undefined;
    const wait = Math.min(...ends) - now + 1500;
    if (wait > 2147483647) return undefined; // beyond setTimeout's range
    const id = setTimeout(loadPrices, wait);
    return () => clearTimeout(id);
  }, [promo, loadPrices]);

  const state = sub?.state;
  const currentTier = sub?.paid_tier || null;
  const daysLeft = sub?.days_remaining ?? null;

  // One place that decides what "choose this plan" does: it opens the
  // checkout dialog. Nothing is sent anywhere until the customer agrees
  // to the terms and presses the pay button.
  const openCheckout = (p, forCycle, isCycleSwitch) => {
    setAgreed(false);
    setPayError('');
    setPaying(false);
    setCheckout({ plan: p, cycle: forCycle, isCycleSwitch });
  };

  const closeCheckout = () => {
    if (paying) return; // don't let it close mid-redirect
    setCheckout(null);
    setPayError('');
    setAgreed(false);
  };

  // Everything the checkout dialog needs, worked out once. The plan is
  // looked up again by tier so a price reload shows up in an open dialog.
  const co = (() => {
    if (!checkout) return null;
    const p = (plans || []).find((x) => x.tier === checkout.plan.tier) || checkout.plan;
    const annual = checkout.cycle === 'annual';
    const pr = planPrice(p, priceRows[p.tier], checkout.cycle);
    return {
      label: p.label || p.tier,
      annual,
      amountLaari: pr.laari,
      totalMvr: mvrExact(pr.laari),
      listMvr: pr.discounted ? mvrExact(pr.listLaari) : null,
      totalUsd: usd(pr.usdCents),
      percentOff: pr.discounted ? (promo?.[checkout.cycle]?.percentOff || null) : null,
      period: annual ? 'One payment for 12 months' : 'One payment for 1 month',
      isCycleSwitch: checkout.isCycleSwitch,
    };
  })();

  /* Ask our own server to start the payment. The server decides the price
     from plan_limits, any promotion and the rules (renewal, upgrade,
     downgrade), creates the pending payment and hands back the gateway's
     payment page address. It is also told the amount this dialog showed,
     and refuses to continue if its own price is different.            */
  const payNow = async () => {
    if (!checkout || !agreed || paying) return;
    setPaying(true);
    setPayError('');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) {
        setPayError('Your session has expired. Please sign in again and try once more.');
        setPaying(false);
        return;
      }
      const res = await fetch('/api/bml/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tier: checkout.plan.tier, cycle: checkout.cycle, expectedAmountLaari: co.amountLaari }),
      });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (res.ok && data && data.url) {
        window.location.href = data.url; // over to the gateway
        return;
      }
      // The price moved under the customer: fetch the current one so the
      // dialog shows it, and let them decide again.
      if (res.status === 409) await loadPrices();
      setPayError(checkoutErrorMessage(res.status, data));
      setPaying(false);
    } catch (e) {
      setPayError('We could not reach the payment service. Please check your internet connection and try again.');
      setPaying(false);
    }
  };

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

  // The promotion on a cycle that this account can still use. Once it ends,
  // the reload after ends_at clears it.
  const offerFor = (c) => (promo?.[c] && !promo[c].used ? promo[c] : null);
  const toggleLabel = (c) => {
    const o = offerFor(c);
    if (c === 'monthly') return o ? `Monthly — ${o.percentOff}% off` : 'Monthly';
    if (o) return `Annual — ${o.percentOff}% off`;
    return maxSaving > 0 ? `Annual — save up to ${maxSaving}%` : 'Annual';
  };

  /* ── FAQ content ──
     The change/cancel answers describe the policy actually implemented in
     the admin tooling: upgrades start a fresh period today; downgrades
     apply when the current paid period ends; access always runs to the end
     of what was paid for.                                              */
  const faqs = [
    ['Who can edit my duty rota?',
      'You can, as the account owner, and so can anyone you make a manager for a department. Managers can build and publish that department\'s rota. You can appoint as many managers as you need.'],
    ['What is employee access?',
      'Employee access lets staff sign in and see the duty rota. It is included in every plan, including Basic.'],
    ['Is multi-user access available now?',
      'Yes. Put a staff member\'s email on their row, press Invite and send them the link, as an employee who can view the rota or a manager who can edit it. Your plan is limited by departments, not by people (Basic allows up to 20 staff).'],
    ['What is Smart Roster?',
      'Smart Roster automates the repetitive parts of building a duty rota while leaving the final schedule in your control. It is included with Plus, Pro and Custom. Basic and Standard use manual rota creation.'],
    ['What is Ini?',
      'Ini is an AI rota assistant on the Plus, Pro and Custom plans. Write what you need in plain words, such as leave, duty changes, swaps, weekly offs or building a month, and Ini turns it into a checklist for you to confirm.'],
    ['Will Ini change my rota without asking?',
      'No. Ini only suggests changes. Nothing is saved until you press Add, and everything from one note can be reverted with one Undo.'],
    ['Who can use Ini?',
      'Owners and managers of departments on Plus, Pro or Custom. Employees can’t use it.'],
    ['How many notes can I use?',
      '50 notes per department each month on paid plans, and 10 during a free trial. The count resets on the 1st of each month (Maldives time).'],
    ['What happens to the information I send to Ini?',
      'Your note, staff names on that rota, duty codes and dates go to our AI provider, Anthropic, to be read. Anthropic does not train its models on it, and deletes it within 30 days. We never send email addresses, phone numbers or payment details. See our Privacy Policy for details.'],
    ['What if Ini gets something wrong?',
      'Untick the line or change the person before pressing Add. If it’s already added, press Undo once. Do this before refreshing the page.'],
    ['How does annual billing work?',
      'Annual plans are charged once for the full year. The displayed monthly amount is the monthly equivalent of the annual charge.'],
    ['Which currency am I charged in?',
      'USD is the primary price shown on this page. Your card is charged in Maldivian rufiyaa, and the exact rufiyaa amount is shown before you pay. If your card was issued outside the Maldives, your own bank converts that amount, so the figure on your statement may differ slightly.'],
    ['Can I change plans later?',
      'Yes. Upgrades take effect immediately and start a new billing period from that day. Downgrades take effect when your current paid period ends, so you keep everything you have already paid for.'],
    ['Can I cancel at any time?',
      'Yes — message us on WhatsApp. Your access continues until the end of the period you have paid for, and your rota and data remain safe throughout.'],
  ];

  // Some refusals can never succeed by trying again (a downgrade, for
  // example), so the pay button is switched off rather than inviting
  // another press that produces the same message.
  const blocked = payError === DOWNGRADE_MESSAGE;

  return (
    <div style={{ background: T.bg, minHeight: '100vh', fontFamily: 'Arial, sans-serif', color: T.ink }}>
      <div style={{ background: T.deep, color: '#fff', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <strong style={{ fontSize: 16 }}>Your plan</strong>
        <button onClick={onExit} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit' }}>
          ← Back to my rota
        </button>
      </div>

      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '18px 18px 60px' }}>
        <PromoBanner promo={promo} />

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
                {toggleLabel(c)}
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
            const isPlus = p.tier === 'plus';

            // What this account pays on this cycle, next to the normal price.
            // An account that has used this cycle's offer gets list prices
            // back from the server, plus a note saying why.
            const pr = planPrice(p, priceRows[p.tier], cycle);
            const offerPct = pr.discounted ? (promo?.[cycle]?.percentOff || null) : null;
            const offerUsed = !!promo?.[cycle]?.used;
            // The offer badge takes the corner the usual annual saving uses.
            const saving = annual && !pr.discounted ? annualSavingUsd(p) : null;

            const perMonthUsd = (cents) => usd(cents ? (annual ? Math.round(cents / 12) : cents) : null);
            const headUsd = perMonthUsd(pr.usdCents);
            const headListUsd = pr.discounted ? perMonthUsd(pr.listUsdCents) : null;
            const headMvr = mvr(pr.laari ? (annual ? pr.laari / 12 : pr.laari) : null);

            // Live features, straight from the database limits.
            const live = [
              p.max_staff == null ? 'Unlimited staff members' : `Up to ${p.max_staff} staff members`,
              `${p.max_departments == null ? 'Unlimited' : p.max_departments} department${p.max_departments === 1 ? '' : 's'}`,
              'Manual rota creation',
              'PDF, image and Excel export',
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
                {pr.discounted && (
                  <span style={{ position: 'absolute', top: -10, right: 14, background: '#C0392B', color: '#fff', fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                    {offerPct ? `${offerPct}% off` : 'Offer'}
                  </span>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, marginTop: copy.badge || saving || pr.discounted ? 6 : 0, flexWrap: 'wrap' }}>
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
                  {headListUsd && (
                    <s title="Normal price" style={{ fontSize: 15, fontWeight: 700, color: T.soft }}>{headListUsd}</s>
                  )}
                  <span style={{ fontSize: 22, fontWeight: 800, color: T.teal }}>{headUsd || '—'}</span>
                  <span style={{ fontSize: 12.5, color: T.soft }}>/month</span>
                </div>
                <div style={{ fontSize: 11.5, color: T.soft, marginTop: 3, marginBottom: 12, lineHeight: 1.6 }}>
                  Approx. {headMvr || '—'}/month
                  {annual && pr.usdCents && (
                    <>
                      <br />
                      {pr.discounted && <><s title="Normal price">{usd(pr.listUsdCents)}</s>{' '}</>}
                      {usd(pr.usdCents)} billed annually
                    </>
                  )}
                  {offerUsed && (
                    <><br /><span style={{ fontWeight: 700 }}>Offer already used</span></>
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
                  onClick={() => openCheckout(p, cycle, isCycleSwitch)}
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
          Prices are displayed in USD. Payment is charged in Maldivian rufiyaa, and the exact
          rufiyaa amount is shown before you pay. Cards issued outside the Maldives are converted
          by your own bank, so the amount on your statement may differ slightly.
        </p>

        {/* 5 — Features in development banner */}
        <div style={{ ...card, background: T.devBg, borderStyle: 'dashed' }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Your whole team can sign in</div>
          <p style={{ fontSize: 13, color: T.soft, lineHeight: 1.7, margin: 0 }}>
            Invite staff to see the duty rota themselves, instead of waiting for an exported file.
            Every plan includes it, Basic included. You can also make a staff member a manager for a
            department, so they can build and publish its rota.
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
                ['Employee viewing access', 'Included', 'Included', 'Included', 'Included', 'Included'],
                ['Manual rota creation', 'Included', 'Included', 'Included', 'Included', 'Included'],
                ['PDF, image and Excel export', 'Included', 'Included', 'Included', 'Included', 'Included'],
                ['Smart Roster', 'Not included', 'Not included', 'Included', 'Included', 'Included'],
                ['Ini AI assistant', 'Not included', 'Not included', '✓ 50 notes / dept / month', '✓ 50 notes / dept / month', '✓ 50 notes / dept / month'],
                ['Custom company logo', 'Not included', 'Not included', 'Included', 'Included', 'Included'],
                ['Support', 'Standard', 'Standard', 'Standard', 'Priority', 'Priority'],
                ['Dedicated setup help', 'Not included', 'Not included', 'Not included', 'Not included', 'Included'],
              ].map(([feature, ...cells]) => (
                <tr key={feature}>
                  <td style={{ padding: '9px 12px', borderBottom: `1px solid ${T.line}`, fontWeight: 600, whiteSpace: 'nowrap' }}>{feature}</td>
                  {cells.map((c, i) => (
                    <td key={i} style={{
                      padding: '9px 12px', borderBottom: `1px solid ${T.line}`, textAlign: 'center',
                      color: (c === 'Included' || c.startsWith('✓')) ? T.teal : (c === 'In development' || c === 'Rolling out') ? T.warn : c === 'Not included' ? T.faint : T.ink,
                      fontWeight: (c === 'Included' || c.startsWith('✓')) ? 700 : 400, whiteSpace: 'nowrap',
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

        {/* 9b — Ini section */}
        <div style={{ ...card }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Ini, your AI rota assistant</div>
          <p style={{ fontSize: 13, color: T.soft, lineHeight: 1.7, margin: 0 }}>
            Write what you need in plain words, like leave, duty changes, swaps, weekly offs or
            building a month, and Ini turns it into a checklist you confirm. One Undo reverts it all.
            Included with Plus, Pro and Custom.
          </p>
        </div>

        {/* 10 — How to subscribe */}
        <div style={card}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>How to subscribe</div>
          <p style={{ fontSize: 13, color: T.soft, lineHeight: 1.7, margin: 0 }}>
            Choose a plan above, check the details and pay by card through the BML Payment Gateway.
            Your plan is activated as soon as the payment is confirmed, and your duty rota and all
            your data remain unchanged. Subscriptions do not renew automatically — you choose a plan
            again when your period ends. If you would prefer to pay by bank transfer, message us on
            WhatsApp.
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

      {/* ── Checkout dialog ──
         The last screen before the gateway. It states exactly what will be
         charged, in the currency the card is charged in, who the merchant
         is, and requires the terms to be accepted before paying.

         boxSizing keeps the padding inside the width — without it the
         dialog is wider than a phone screen and the right edge is cut off. */}
      {co && (
        <div
          onClick={closeCheckout}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(10,30,34,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, zIndex: 1000, overflowY: 'auto', boxSizing: 'border-box',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 420,
              padding: 20, boxShadow: '0 10px 40px rgba(0,0,0,0.25)', margin: 'auto',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 17, fontWeight: 800 }}>Confirm your subscription</div>
              <button
                onClick={closeCheckout}
                disabled={paying}
                aria-label="Close"
                style={{ background: 'none', border: 'none', fontSize: 20, lineHeight: 1, color: T.soft, cursor: paying ? 'default' : 'pointer', fontFamily: 'inherit', padding: 0 }}
              >
                ×
              </button>
            </div>

            <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: 14, marginBottom: 14, boxSizing: 'border-box' }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 2 }}>
                Easy Duty Rota {co.label} — {co.annual ? 'annual' : 'monthly'}
              </div>
              <div style={{ fontSize: 12, color: T.soft, marginBottom: 12 }}>{co.period}</div>

              <div style={{ fontSize: 11.5, color: T.soft, textTransform: 'uppercase', letterSpacing: 0.4, fontWeight: 800 }}>
                Total to pay
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                {co.listMvr && (
                  <s title="Normal price" style={{ fontSize: 15, fontWeight: 700, color: T.soft }}>{co.listMvr}</s>
                )}
                <span style={{ fontSize: 26, fontWeight: 800, color: T.ink, lineHeight: 1.3 }}>
                  {co.totalMvr || '—'}
                </span>
              </div>
              {co.totalUsd && (
                <div style={{ fontSize: 12, color: T.soft, marginTop: 2 }}>
                  Approximately {co.totalUsd} — your card is charged in rufiyaa
                </div>
              )}
              {co.listMvr && (
                <div style={{ fontSize: 12, color: '#C0392B', fontWeight: 700, marginTop: 8, lineHeight: 1.6 }}>
                  {co.percentOff ? `${co.percentOff}% off` : 'Offer price'} for this payment.
                  {' '}Renewals are at the normal price.
                </div>
              )}

              {co.isCycleSwitch && (
                <div style={{ fontSize: 12, color: T.soft, marginTop: 10, lineHeight: 1.6 }}>
                  Any days remaining on your current plan are added on top of this period.
                </div>
              )}
            </div>

            {/* Card scheme logos supplied by BML. */}
            <div style={{ marginBottom: 12 }}>
              <img
                src="/payment-logos.png"
                alt="Accepted payment cards"
                style={{ height: 26, maxWidth: '100%', display: 'block' }}
              />
              <div style={{ fontSize: 11.5, color: T.soft, lineHeight: 1.5, marginTop: 6 }}>
                Payments are processed securely by the BML Payment Gateway
              </div>
            </div>

            <div style={{ fontSize: 12, color: T.soft, lineHeight: 1.7, marginBottom: 12 }}>
              Merchant: SHAB INVESTMENT, Maldives<br />
              Please keep a copy of your payment confirmation for your records.
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 12.5, color: T.ink, lineHeight: 1.6, marginBottom: 14, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                disabled={paying}
                style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0, cursor: 'pointer' }}
              />
              <span>
                I agree to the{' '}
                <a href="/terms/" target="_blank" rel="noreferrer" style={{ color: T.teal, fontWeight: 700 }}>Terms of Service</a>,{' '}
                <a href="/refunds/" target="_blank" rel="noreferrer" style={{ color: T.teal, fontWeight: 700 }}>Refund Policy</a> and{' '}
                <a href="/privacy/" target="_blank" rel="noreferrer" style={{ color: T.teal, fontWeight: 700 }}>Privacy Policy</a>.
              </span>
            </label>

            {payError && (
              <div style={{ background: T.badBg, border: `1px solid ${T.badLine}`, color: T.bad, borderRadius: 8, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.6, marginBottom: 12, boxSizing: 'border-box' }}>
                {payError}
                <div style={{ marginTop: 8 }}>
                  <button
                    onClick={whatsappHelp}
                    style={{ background: 'none', border: 'none', padding: 0, color: T.bad, fontWeight: 800, fontSize: 12.5, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    Message us on WhatsApp
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={payNow}
              disabled={!agreed || paying || blocked}
              style={{
                width: '100%', padding: '12px', borderRadius: 8, border: 'none',
                fontFamily: 'inherit', fontSize: 14, fontWeight: 800, boxSizing: 'border-box',
                background: !agreed || paying || blocked ? '#EEF4F3' : T.teal,
                color: !agreed || paying || blocked ? T.soft : '#fff',
                cursor: !agreed || paying || blocked ? 'default' : 'pointer',
              }}
            >
              {paying ? 'Opening payment page…' : `Pay ${co.totalMvr || ''}`}
            </button>

            <button
              onClick={closeCheckout}
              disabled={paying}
              style={{
                width: '100%', padding: '10px', marginTop: 8, borderRadius: 8,
                border: 'none', background: 'none', color: T.soft, boxSizing: 'border-box',
                fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
                cursor: paying ? 'default' : 'pointer',
              }}
            >
              Cancel
            </button>

            <p style={{ fontSize: 11, color: T.soft, textAlign: 'center', lineHeight: 1.6, margin: '10px 0 0' }}>
              You will be redirected to the BML Payment Gateway to process the transaction.
              We never see or store your card number.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}