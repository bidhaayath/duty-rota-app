import {
  summarisePromo, offerOpen, openOffers, countdownParts, isLastDay,
  endsInText, offerEndDate, maldivesDay, planPrice,
} from './promo';

// The real client needs Supabase settings the test run doesn't have; these
// tests never reach the network.
jest.mock('./supabaseClient', () => ({}));

const ENDS = '2026-11-01T00:00:00+05:00';
const ENDS_MS = Date.parse(ENDS);
const HOUR = 3600000;
const DAY = 24 * HOUR;

const row = (over = {}) => ({
  tier: 'plus',
  monthly_list_laari: 100000, monthly_laari: 80000,
  monthly_list_usd_cents: 6500, monthly_usd_cents: 5200,
  monthly_percent_off: 20, monthly_ends_at: ENDS, monthly_offer_used: false,
  annual_list_laari: 1000000, annual_laari: 500000,
  annual_list_usd_cents: 65000, annual_usd_cents: 32500,
  annual_percent_off: 50, annual_ends_at: ENDS, annual_offer_used: false,
  server_now: '2026-10-21T10:00:00Z',
  ...over,
});

const plan = {
  tier: 'plus',
  price_monthly_laari: 100000, price_monthly_usd_cents: 6500,
  price_annual_laari: 1000000, price_annual_usd_cents: 65000,
};

describe('summarisePromo', () => {
  test('reads both offers and the clock offset', () => {
    const clientNow = Date.parse('2026-10-21T09:59:00Z'); // device a minute slow
    const p = summarisePromo([row()], clientNow);
    expect(p.offset).toBe(60000);
    expect(p.annual).toEqual({ percentOff: 50, endsAt: ENDS_MS, used: false });
    expect(p.monthly).toEqual({ percentOff: 20, endsAt: ENDS_MS, used: false });
  });

  test('no promotion running gives null offers', () => {
    const p = summarisePromo([row({
      monthly_percent_off: null, monthly_ends_at: null,
      annual_percent_off: null, annual_ends_at: null,
    })], 0);
    expect(p.monthly).toBeNull();
    expect(p.annual).toBeNull();
  });

  test('no rows gives null', () => {
    expect(summarisePromo([], 0)).toBeNull();
    expect(summarisePromo(null, 0)).toBeNull();
  });
});

describe('open offers', () => {
  const promo = summarisePromo([row({ annual_offer_used: true })], Date.parse('2026-10-21T10:00:00Z'));

  test('a used offer is not open', () => {
    expect(offerOpen(promo.annual, ENDS_MS - DAY)).toBe(false);
    expect(offerOpen(promo.monthly, ENDS_MS - DAY)).toBe(true);
  });

  test('the end moment itself is closed', () => {
    expect(offerOpen(promo.monthly, ENDS_MS - 1)).toBe(true);
    expect(offerOpen(promo.monthly, ENDS_MS)).toBe(false);
  });

  test('lists only what is still open, annual first', () => {
    const both = summarisePromo([row()], 0);
    expect(openOffers(both, ENDS_MS - DAY).offers.map((o) => o.cycle)).toEqual(['annual', 'monthly']);
    expect(openOffers(promo, ENDS_MS - DAY).offers.map((o) => o.cycle)).toEqual(['monthly']);
    expect(openOffers(both, ENDS_MS - DAY).endsAt).toBe(ENDS_MS);
    expect(openOffers(both, ENDS_MS).offers).toEqual([]);
    expect(openOffers(null, 0)).toEqual({ offers: [], endsAt: null });
  });
});

describe('countdown', () => {
  test('splits into days, hours, minutes and seconds', () => {
    expect(countdownParts(2 * DAY + 3 * HOUR + 4 * 60000 + 5000 + 999))
      .toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5 });
    expect(countdownParts(-5000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  test('last day is the final 24 hours', () => {
    expect(isLastDay(DAY + 1)).toBe(false);
    expect(isLastDay(DAY)).toBe(true);
    expect(isLastDay(1)).toBe(true);
    expect(isLastDay(0)).toBe(false);
  });

  test('strip wording', () => {
    expect(endsInText(10 * DAY)).toBe('ends in 10 days');
    expect(endsInText(DAY + HOUR)).toBe('ends in 2 days');
    expect(endsInText(DAY)).toBe('ends today');
    expect(endsInText(HOUR)).toBe('ends today');
  });
});

describe('Maldives dates', () => {
  test('ends_at at midnight means the offer ends on 31 October', () => {
    expect(offerEndDate(ENDS_MS)).toBe('31 October');
  });

  test('today is the Maldives date, whatever the device time zone', () => {
    // 20:00 UTC on 31 October is already 1 November in the Maldives (UTC+5).
    expect(maldivesDay(Date.parse('2026-10-31T20:00:00Z'))).toBe('2026-11-01');
    expect(maldivesDay(Date.parse('2026-10-31T18:59:59Z'))).toBe('2026-10-31');
  });
});

describe('planPrice', () => {
  test('uses the offer price when it is lower', () => {
    expect(planPrice(plan, row(), 'annual')).toEqual({
      laari: 500000, usdCents: 32500, listLaari: 1000000, listUsdCents: 65000, discounted: true,
    });
    expect(planPrice(plan, row(), 'monthly')).toEqual({
      laari: 80000, usdCents: 5200, listLaari: 100000, listUsdCents: 6500, discounted: true,
    });
  });

  test('offer already used: the server returns list prices, shown as normal', () => {
    const r = row({ annual_laari: 1000000, annual_usd_cents: 65000, annual_offer_used: true });
    expect(planPrice(plan, r, 'annual')).toEqual({
      laari: 1000000, usdCents: 65000, listLaari: 1000000, listUsdCents: 65000, discounted: false,
    });
  });

  test('no plan_prices row falls back to the list price', () => {
    expect(planPrice(plan, undefined, 'annual')).toEqual({
      laari: 1000000, usdCents: 65000, listLaari: 1000000, listUsdCents: 65000, discounted: false,
    });
  });
});
