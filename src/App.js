import { useState, useEffect } from 'react';
import supabase from './supabaseClient';
import Auth from './Auth';
import DutyRota from './DutyRotaOriginal';

// A password-reset link signs the user in automatically. Without this check,
// App.js would see a valid session and jump straight to the rota, never giving
// them a chance to type a new password. So while type=recovery is in the URL,
// we keep showing the Auth screen. An expired link carries error=... instead,
// and Auth handles that on its own.
const RECOVERY_FLAG = 'dutyrota:recovering';

const isRecoveryUrl = () => {
  const hash = (window.location.hash || '').replace(/^#/, '');
  const search = (window.location.search || '').replace(/^\?/, '');
  const p = new URLSearchParams(hash || search);
  return p.get('type') === 'recovery' && !p.get('error');
};

const recoveryPending = () => {
  if (isRecoveryUrl()) return true;
  try { return sessionStorage.getItem(RECOVERY_FLAG) === '1'; } catch { return false; }
};

/* ─────────────── Trial & subscription ───────────────
   Every account gets 30 free days from first login. During the trial there is
   no mention of payment (except a quiet note in the last 7 days). After 30
   days the rota becomes view-only and a subscribe banner appears.
   Paid accounts are activated manually: set status='active' (and optionally
   paid_until) on their row in the Supabase subscriptions table.            */
const TRIAL_DAYS = 30;
const WHATSAPP = '9607666261'; // +960 Maldives
const WA_LINK = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
  "Hi! My DutyRota free trial has ended and I'd like to subscribe."
)}`;
const WA_LINK_EARLY = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
  "Hi! My DutyRota free trial is ending soon and I'd like to subscribe."
)}`;

const fetchSubscription = async (userId) => {
  try {
    const { data: row } = await supabase
      .from('subscriptions')
      .select('trial_start, status, paid_until')
      .eq('user_id', userId)
      .maybeSingle();
    if (row) return row;
    // First login: start the 30-day trial. trial_start is set by the
    // database itself, so it can't be tampered with from the browser.
    await supabase.from('subscriptions').insert({ user_id: userId });
    const { data: fresh } = await supabase
      .from('subscriptions')
      .select('trial_start, status, paid_until')
      .eq('user_id', userId)
      .maybeSingle();
    return fresh;
  } catch (e) {
    console.error('Subscription check failed:', e);
    return null; // fail open — a Supabase hiccup must never lock a paying user out
  }
};

const subscriptionState = (row) => {
  if (!row) return { locked: false, daysLeft: null, active: false }; // fail open
  const today = new Date();
  const paidOk = !row.paid_until || today <= new Date(row.paid_until + 'T23:59:59');
  if (row.status === 'active' && paidOk) return { locked: false, daysLeft: null, active: true };
  const elapsed = Math.floor((Date.now() - new Date(row.trial_start).getTime()) / 86400000);
  const daysLeft = TRIAL_DAYS - elapsed;
  return { locked: daysLeft <= 0, daysLeft: Math.max(0, daysLeft), active: false };
};

/* ─────────────── Banners ─────────────── */

function TrialEndingNote({ daysLeft }) {
  // Heads-up in the last 7 days, with a subscribe link so people can act
  // before the view-only switch rather than after it.
  return (
    <div style={{ background: '#FFF8E7', borderBottom: '1px solid #EBDCB2', padding: '10px 20px', fontSize: 13, color: '#7A6320', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <span>
        Your free trial ends in <strong>{daysLeft} day{daysLeft === 1 ? '' : 's'}</strong>.
      </span>
      <a href={WA_LINK_EARLY} target="_blank" rel="noreferrer" style={{
        background: '#0F8B7E', color: '#fff', fontWeight: 700, fontSize: 12,
        padding: '6px 14px', borderRadius: 6, textDecoration: 'none', whiteSpace: 'nowrap',
      }}>
        Subscribe on WhatsApp
      </a>
    </div>
  );
}

function Paywall() {
  return (
    <div style={{ background: 'linear-gradient(135deg, #0F8B7E, #0B6A60)', color: '#fff', padding: '18px 20px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, justifyContent: 'space-between' }}>
        <div style={{ flex: '1 1 320px' }}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Your free trial has ended</div>
          <div style={{ fontSize: 13, opacity: 0.95, lineHeight: 1.5 }}>
            Your rota and all your data are safe — you can still view everything and export PDFs,
            but editing is paused. Subscribe to continue right where you left off.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, lineHeight: 1.6, textAlign: 'right' }}>
            <div><strong>MVR 231</strong> / month <span style={{ opacity: 0.85 }}>($14.99)</span></div>
            <div><strong>MVR 154</strong> / month billed annually <span style={{ opacity: 0.85 }}>($9.99)</span></div>
          </div>
          <a href={WA_LINK} target="_blank" rel="noreferrer" style={{
            background: '#fff', color: '#0B6A60', fontWeight: 800, fontSize: 14,
            padding: '11px 18px', borderRadius: 8, textDecoration: 'none', whiteSpace: 'nowrap',
          }}>
            Subscribe on WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(recoveryPending());
  const [sub, setSub] = useState({ locked: false, daysLeft: null, active: false });

  useEffect(() => {
    if (isRecoveryUrl()) {
      try { sessionStorage.setItem(RECOVERY_FLAG, '1'); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        try { sessionStorage.setItem(RECOVERY_FLAG, '1'); } catch { /* ignore */ }
        setRecovering(true);
      }
      if (event === 'SIGNED_OUT') {
        try { sessionStorage.removeItem(RECOVERY_FLAG); } catch { /* ignore */ }
        setRecovering(false);
      }
      setSession(session);
    });

    const done = () => {
      try { sessionStorage.removeItem(RECOVERY_FLAG); } catch { /* ignore */ }
      setRecovering(false);
    };
    window.addEventListener('dutyrota:recovery-done', done);

    const abandon = () => {
      try {
        if (sessionStorage.getItem(RECOVERY_FLAG) === '1') supabase.auth.signOut();
      } catch { /* ignore */ }
    };
    window.addEventListener('beforeunload', abandon);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('dutyrota:recovery-done', done);
      window.removeEventListener('beforeunload', abandon);
    };
  }, []);

  // Check trial/subscription whenever someone is logged in
  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    fetchSubscription(session.user.id).then((row) => {
      if (!cancelled) setSub(subscriptionState(row));
    });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        Loading...
      </div>
    );
  }

  if (!session || recovering) return <Auth />;

  const showEndingNote = !sub.active && !sub.locked && sub.daysLeft !== null && sub.daysLeft <= 7;

  return (
    <div>
      {sub.locked && <Paywall />}
      {showEndingNote && <TrialEndingNote daysLeft={sub.daysLeft} />}
      <div style={{ background: 'white', padding: '15px 20px', borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '20px' }}>📋 DutyRota</h1>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: '#666' }}>{session.user.email}</span>
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ padding: '8px 16px', background: '#E4604E', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Logout
          </button>
        </div>
      </div>
      <DutyRota locked={sub.locked} />
    </div>
  );
}