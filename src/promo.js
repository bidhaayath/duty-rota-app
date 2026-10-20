import { useState, useEffect } from 'react';
import supabase from './supabaseClient';

/* ─────────────── Promotions ───────────────
   The database decides the offer and the price: plan_prices() and
   bml_start_payment use the same rule, so nothing here works out a
   discount. This file only reads what the server said and counts down.

   Time: ends_at is an exact moment from the server. The countdown measures
   it against the server's clock (server_now, corrected for a device whose
   clock is wrong), so neither the device's time zone nor its clock setting
   changes when the offer ends. Dates shown to people are in Maldives time. */

const DAY = 86400000;
const MALDIVES = 'Indian/Maldives';

// One plan_prices() row carries the promotion for every tier, so the first
// row is enough. clientNow is the device's Date.now() when the answer came in.
export function summarisePromo(rows, clientNow) {
  const r = Array.isArray(rows) && rows[0];
  if (!r) return null;
  const serverNow = Date.parse(r.server_now);
  const offer = (percentOff, ends, used) => {
    const endsAt = Date.parse(ends);
    return percentOff && Number.isFinite(endsAt)
      ? { percentOff, endsAt, used: !!used }
      : null;
  };
  return {
    offset: Number.isFinite(serverNow) ? serverNow - clientNow : 0,
    monthly: offer(r.monthly_percent_off, r.monthly_ends_at, r.monthly_offer_used),
    annual: offer(r.annual_percent_off, r.annual_ends_at, r.annual_offer_used),
  };
}

// An offer this account can still take, at server time `now`.
export const offerOpen = (o, now) => !!o && !o.used && now < o.endsAt;

// The offers still open to this account, annual first (the order they are
// advertised in), and when the last of them ends.
export function openOffers(promo, now) {
  if (!promo) return { offers: [], endsAt: null };
  const offers = [['annual', promo.annual], ['monthly', promo.monthly]]
    .filter(([, o]) => offerOpen(o, now))
    .map(([cycle, o]) => ({ cycle, ...o }));
  return {
    offers,
    endsAt: offers.length ? Math.max(...offers.map((o) => o.endsAt)) : null,
  };
}

export function countdownParts(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

// The offer ends at midnight Maldives time, so its final 24 hours are the
// last calendar day there.
export const isLastDay = (ms) => ms > 0 && ms <= DAY;

export const endsInText = (ms) =>
  (ms <= DAY ? 'ends today' : `ends in ${Math.ceil(ms / DAY)} days`);

// ends_at is the first moment AFTER the offer (midnight), so the last day of
// the offer is the day of the moment just before it.
export const offerEndDate = (endsAt) =>
  new Date(endsAt - 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: MALDIVES });

// Today's date in the Maldives, e.g. "2026-10-21".
export const maldivesDay = (ms) =>
  new Date(ms).toLocaleDateString('en-CA', { timeZone: MALDIVES });

/* What a plan costs on one billing cycle for this account, next to its
   normal price. `row` is that tier's plan_prices() row; without one (the
   function is missing or failed) the plan_limits list price stands, which
   is also what the server charges when it has no promotion to apply.    */
export function planPrice(plan, row, cycle) {
  const annual = cycle === 'annual';
  const listLaari = annual ? plan.price_annual_laari : plan.price_monthly_laari;
  const listUsdCents = annual ? plan.price_annual_usd_cents : plan.price_monthly_usd_cents;
  const offerLaari = row ? (annual ? row.annual_laari : row.monthly_laari) : null;
  const offerUsdCents = row ? (annual ? row.annual_usd_cents : row.monthly_usd_cents) : null;
  const discounted = offerLaari != null && listLaari != null && offerLaari < listLaari;
  return {
    laari: discounted ? offerLaari : listLaari,
    usdCents: discounted && offerUsdCents != null ? offerUsdCents : listUsdCents,
    listLaari,
    listUsdCents,
    discounted,
  };
}

// Never throws: a failure means "no promotion", and every price falls back
// to the normal one.
export async function fetchPromo() {
  try {
    const { data, error } = await supabase.rpc('plan_prices');
    if (error || !Array.isArray(data)) return { rows: [], promo: null };
    return { rows: data, promo: summarisePromo(data, Date.now()) };
  } catch {
    return { rows: [], promo: null };
  }
}

// The server's current time, refreshed every `everyMs`.
export function useServerNow(offset, everyMs) {
  const [now, setNow] = useState(() => Date.now() + (offset || 0));
  useEffect(() => {
    const tick = () => setNow(Date.now() + (offset || 0));
    tick();
    const id = setInterval(tick, everyMs);
    return () => clearInterval(id);
  }, [offset, everyMs]);
  return now;
}
