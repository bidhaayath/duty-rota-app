import React, { useState, useEffect, useMemo } from 'react';
import supabase from './supabaseClient';

/* ─────────────── Admin dashboard ───────────────
   A private page for activating subscriptions by hand while payments are
   arranged over WhatsApp.

   Security lives in the database, not here. Both admin_list_users() and
   activate_manually() check is_admin() themselves and refuse anyone who is
   not in the admins table. Hiding this screen is only a convenience — even
   if someone found the page, the database would still say no.            */

const TIERS = ['basic', 'standard', 'plus', 'pro'];
const CYCLES = ['monthly', 'annual'];

const T = {
  teal: '#0F8B7E', deep: '#0B6A60', ink: '#142B33', soft: '#6B8A93',
  line: '#DCE8E6', bg: '#F5F9F8', warn: '#8A5A0F', warnBg: '#FBF1DC',
  bad: '#8A2E1E', badBg: '#FBEAE7', good: '#0B6A60', goodBg: '#E6F4F1',
};

const card = {
  background: '#fff', border: `1px solid ${T.line}`, borderRadius: 10,
  padding: 16, marginBottom: 16,
};
const th = {
  textAlign: 'left', padding: '9px 10px', fontSize: 11.5, fontWeight: 700,
  color: T.soft, textTransform: 'uppercase', letterSpacing: 0.3,
  borderBottom: `1px solid ${T.line}`, whiteSpace: 'nowrap',
};
const td = {
  padding: '9px 10px', fontSize: 13, borderBottom: `1px solid ${T.line}`,
  verticalAlign: 'middle',
};
const input = {
  padding: '8px 10px', border: `1px solid ${T.line}`, borderRadius: 6,
  fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box',
};

const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// Dates like "2026-09-04" parse as midnight, so comparing them against the
// current moment makes a subscription look expired for the whole of its
// final day. Compare whole days instead, so paid-through-today counts.
const toDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const hasTimeLeft = (u, today = new Date()) =>
  !!u.paid_until && toDay(u.paid_until) >= toDay(today);

// What to show in the Status column. Trial dates come from the database, so
// this always matches what the customer actually sees in the app.
function statusOf(u) {
  const today = new Date();
  if (hasTimeLeft(u, today)) {
    // Someone who has cancelled still keeps access until the date they paid
    // for, so show that rather than a blank — otherwise they look like a
    // non-customer right up until the day their access actually stops.
    return u.status === 'active'
      ? { label: `Paid · ${u.plan || '?'}`, bg: T.goodBg, fg: T.good }
      : { label: `Ending · ${u.plan || '?'}`, bg: T.warnBg, fg: T.warn };
  }
  if (u.paid_until) {
    return { label: 'Expired', bg: T.badBg, fg: T.bad };
  }
  if (u.trial_ends_at) {
    const left = daysBetween(toDay(u.trial_ends_at), toDay(today));
    if (left < 0) return { label: 'Trial ended', bg: T.badBg, fg: T.bad };
    if (left <= 7) return { label: `Trial · ${left}d left`, bg: T.warnBg, fg: T.warn };
    return { label: `Trial · ${left}d left`, bg: '#EEF4F3', fg: T.soft };
  }
  return { label: '—', bg: '#EEF4F3', fg: T.soft };
}

export default function Admin({ onExit }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [only, setOnly] = useState('all'); // all | trial | paid | expired
  const [busyEmail, setBusyEmail] = useState('');
  const [toast, setToast] = useState(null);

  const load = async () => {
    setError('');
    const { data, error } = await supabase.rpc('admin_list_users');
    if (error) {
      setError(
        /not_admin/i.test(error.message)
          ? 'This account is not an admin.'
          : `Could not load the customer list: ${error.message}`
      );
      setRows([]);
      return;
    }
    setRows(data || []);
  };

  useEffect(() => { load(); }, []);

  // Two different actions, deliberately kept apart:
  //   renew  -> activate_manually,  adds a period on to whatever is left
  //   switch -> admin_change_plan,  starts a fresh period from today
  // Both write the payment record and the subscription together in the
  // database, so one can never succeed without the other.
  const run = async (email, tier, cycle, mode, ctx = {}) => {
    const isSwitch = mode === 'switch';

    // Downgrading someone who still has paid time left takes away days they
    // have already paid for. Standard practice is to let the paid period run
    // out and move them down at renewal instead, so warn plainly here.
    if (isSwitch && ctx.isDowngrade && ctx.daysLeft > 0) {
      const proceed = window.confirm(
        `⚠ This is a DOWNGRADE and ${email} still has ${ctx.daysLeft} day` +
        `${ctx.daysLeft === 1 ? '' : 's'} paid for on ${ctx.currentPlan}.\n\n` +
        `Doing it now would take those days away.\n\n` +
        `Normally you would leave them as they are, and on ` +
        `${fmt(ctx.paidUntil)} select "${tier}" and click Renew instead.\n\n` +
        `Continue anyway?`
      );
      if (!proceed) return;
    }

    const ok = window.confirm(
      `${isSwitch ? 'Change plan for' : 'Renew'} ${email}?\n\n` +
      `Plan: ${tier}\nBilling: ${cycle}\n\n` +
      (isSwitch
        ? 'The new period starts TODAY. Any days left on their old plan are not carried over.'
        : 'This adds a period on to any time they already have left.')
    );
    if (!ok) return;

    const note = window.prompt('Note (optional) — e.g. "BML transfer 4 Aug":', '') || null;

    setBusyEmail(email);
    const { data, error } = await supabase.rpc(
      isSwitch ? 'admin_change_plan' : 'activate_manually',
      { p_email: email, p_tier: tier, p_billing_cycle: cycle, p_note: note }
    );
    setBusyEmail('');

    if (error) {
      setToast({ bad: true, msg: `Failed: ${error.message}` });
      return;
    }
    if (!data?.ok) {
      const why = {
        not_admin: 'This account is not an admin.',
        no_such_user: 'No account found with that email.',
        bad_tier_or_cycle: 'That plan or billing cycle is not valid.',
      }[data?.reason] || `Failed: ${data?.reason || 'unknown reason'}`;
      setToast({ bad: true, msg: why });
      return;
    }
    setToast({
      bad: false,
      msg: `${email} — now on ${tier}, paid until ${fmt(data.paid_until)}.`,
    });
    load(); // refresh so the row shows the new state
  };

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    const today = new Date();
    return rows.filter((u) => {
      if (q && !(u.email || '').toLowerCase().includes(q)) return false;
      // Same rules as the status badge, so the filter and the badge can
      // never disagree about who is paying.
      const paid = hasTimeLeft(u, today);
      const expired = !!u.paid_until && !paid;
      if (only === 'paid') return paid;
      if (only === 'expired') return expired;
      if (only === 'trial') return !paid && !expired;
      if (only === 'active5d') {
        if (!u.last_sign_in) return false;
        const days = daysBetween(toDay(today), toDay(u.last_sign_in));
        return days >= 0 && days <= 5;
      }
      return true;
    });
  }, [rows, search, only]);

  const stats = useMemo(() => {
    if (!rows) return null;
    const today = new Date();
    const paid = rows.filter((u) => hasTimeLeft(u, today) && u.status === 'active').length;
    const trialEndingSoon = rows.filter((u) => {
      if (!u.trial_ends_at) return false;
      const left = daysBetween(toDay(u.trial_ends_at), toDay(today));
      return left >= 0 && left <= 7;
    }).length;
    const engaged = rows.filter((u) => Number(u.duties_count) >= 30).length;
    // Logged in within the last 5 days. Unlike the duties count, which is
    // all-time, this says who is using the app right now — the people worth
    // approaching first.
    const active5d = rows.filter((u) => {
      if (!u.last_sign_in) return false;
      const days = daysBetween(toDay(today), toDay(u.last_sign_in));
      return days >= 0 && days <= 5;
    }).length;
    return { total: rows.length, paid, trialEndingSoon, engaged, active5d };
  }, [rows]);

  return (
    <div style={{ background: T.bg, minHeight: '100vh', fontFamily: 'Arial, sans-serif', color: T.ink }}>
      <div style={{ background: T.deep, color: '#fff', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <strong style={{ fontSize: 16 }}>DutyRota · Admin</strong>
        <button onClick={onExit} style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 700 }}>
          ← Back to my rota
        </button>
      </div>

      <div style={{ maxWidth: 1150, margin: '0 auto', padding: '18px 18px 50px' }}>
        {toast && (
          <div style={{ ...card, background: toast.bad ? T.badBg : T.goodBg, borderColor: toast.bad ? '#F1B8AE' : '#B8DCD5', color: toast.bad ? T.bad : T.good, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13.5 }}>{toast.bad ? '⚠ ' : '✓ '}{toast.msg}</span>
            <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: 'inherit', lineHeight: 1 }}>×</button>
          </div>
        )}

        {error && (
          <div style={{ ...card, background: T.badBg, borderColor: '#F1B8AE', color: T.bad, fontSize: 13.5 }}>
            ⚠ {error}
          </div>
        )}

        {stats && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              ['Accounts', stats.total, T.ink],
              ['Paying', stats.paid, T.good],
              ['Active last 5 days', stats.active5d, T.teal],
              ['Trial ends ≤7d', stats.trialEndingSoon, T.warn],
              ['Real users (30+ duties)', stats.engaged, T.teal],
            ].map(([label, value, colour]) => (
              <div key={label} style={{ ...card, marginBottom: 0, padding: 14 }}>
                <div style={{ fontSize: 11.5, color: T.soft, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: colour }}>{value}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ ...card, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email…"
            style={{ ...input, flex: '1 1 240px' }}
          />
          <select value={only} onChange={(e) => setOnly(e.target.value)} style={{ ...input, cursor: 'pointer' }}>
            <option value="all">Everyone</option>
            <option value="active5d">Active last 5 days</option>
            <option value="trial">On trial</option>
            <option value="paid">Paying</option>
            <option value="expired">Expired</option>
          </select>
          <button onClick={load} style={{ ...input, cursor: 'pointer', background: '#fff', fontWeight: 700, color: T.teal, borderColor: T.teal }}>
            Refresh
          </button>
          <span style={{ fontSize: 12.5, color: T.soft }}>
            {rows ? `${filtered.length} shown` : 'Loading…'}
          </span>
        </div>

        <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 860 }}>
            <thead>
              <tr>
                <th style={th}>Email</th>
                <th style={th}>Status</th>
                <th style={th}>Paid until</th>
                <th style={th}>Staff</th>
                <th style={th}>Duties</th>
                <th style={th}>Last login</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && (
                <tr><td style={{ ...td, color: T.soft }} colSpan={7}>Loading…</td></tr>
              )}
              {rows !== null && filtered.length === 0 && (
                <tr><td style={{ ...td, color: T.soft }} colSpan={7}>No accounts match.</td></tr>
              )}
              {filtered.map((u) => {
                const s = statusOf(u);
                return (
                  <tr key={u.email}>
                    <td style={{ ...td, fontWeight: 600, wordBreak: 'break-all' }}>{u.email}</td>
                    <td style={td}>
                      <span style={{ background: s.bg, color: s.fg, padding: '3px 9px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {s.label}
                      </span>
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: T.soft }}>{fmt(u.paid_until)}</td>
                    <td style={td}>{u.staff_count}</td>
                    <td style={{ ...td, fontWeight: Number(u.duties_count) >= 30 ? 700 : 400 }}>{u.duties_count}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: T.soft }}>{fmt(u.last_sign_in)}</td>
                    <td style={td}>
                      <ActionCell
                        email={u.email}
                        currentPlan={u.plan}
                        paidUntil={u.paid_until}
                        busy={busyEmail === u.email}
                        onRun={run}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p style={{ fontSize: 12, color: T.soft, lineHeight: 1.6 }}>
          <strong>Renew</strong> — first payments and repeat payments. Adds a period on to any time
          they already have left, so nobody loses days they paid for. Also how you apply a
          downgrade: wait until their paid period ends, then pick the lower plan and click Renew.
          <br />
          <strong>Change plan</strong> — upgrades. The new period starts today, and days left on
          the old plan are not carried over. Enabled only when you pick a different plan.
          <br />
          <strong>Downgrades</strong> normally wait until the paid period is over, so the customer
          keeps what they paid for. The button turns red and warns you if you try it early.
        </p>
      </div>
    </div>
  );
}

// Kept as its own component so each row remembers its own tier/cycle choice
// without re-rendering the whole table on every dropdown change.
function ActionCell({ email, currentPlan, paidUntil, busy, onRun }) {
  const [tier, setTier] = useState(currentPlan && TIERS.includes(currentPlan) ? currentPlan : 'standard');
  const [cycle, setCycle] = useState('monthly');
  // Renewing means paying again for the plan they are already on. Picking a
  // different tier is a switch, so the buttons enable accordingly and the
  // person cannot accidentally "renew" someone on to a different plan.
  const isSamePlan = currentPlan === tier;

  // TIERS is in price order, so a lower position means a cheaper plan.
  const daysLeft = paidUntil ? Math.max(0, daysBetween(paidUntil, new Date())) : 0;
  const isDowngrade =
    currentPlan && TIERS.indexOf(tier) < TIERS.indexOf(currentPlan) && TIERS.includes(currentPlan);
  const warnDowngrade = isDowngrade && daysLeft > 0;

  const ctx = { isDowngrade, daysLeft, currentPlan, paidUntil };

  const btn = (enabled, bg) => ({
    background: !enabled || busy ? '#B9CFCB' : bg,
    color: '#fff', border: 'none', borderRadius: 6, padding: '7px 11px',
    fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
    cursor: !enabled || busy ? 'not-allowed' : 'pointer',
  });

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap' }}>
      <select value={tier} onChange={(e) => setTier(e.target.value)} disabled={busy}
        style={{ ...input, padding: '6px 7px', fontSize: 12, cursor: 'pointer' }}>
        {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={cycle} onChange={(e) => setCycle(e.target.value)} disabled={busy}
        style={{ ...input, padding: '6px 7px', fontSize: 12, cursor: 'pointer' }}>
        {CYCLES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <button
        onClick={() => onRun(email, tier, cycle, 'renew', ctx)}
        disabled={busy}
        title="Adds a period on to any time they have left. Use for first payments, renewals, and applying a downgrade once the paid period is over."
        style={btn(true, T.teal)}
      >
        {busy ? '…' : 'Renew'}
      </button>
      <button
        onClick={() => onRun(email, tier, cycle, 'switch', ctx)}
        disabled={busy || isSamePlan}
        title={isSamePlan
          ? 'Pick a different plan to switch them'
          : warnDowngrade
            ? `Downgrade — they still have ${daysLeft} paid day${daysLeft === 1 ? '' : 's'} left`
            : 'Starts a fresh period from today on the new plan.'}
        style={btn(!isSamePlan, warnDowngrade ? '#8A2E1E' : '#8A5A0F')}
      >
        {warnDowngrade ? '⚠ Change plan' : 'Change plan'}
      </button>
    </div>
  );
}