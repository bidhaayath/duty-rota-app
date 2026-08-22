import { useState, useEffect } from 'react';
import supabase from './supabaseClient';
import Auth from './Auth';
import DutyRota from './DutyRotaOriginal';
import Admin from './Admin';
import Billing from './Billing';

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
   Access is decided by the database, not here. The my_subscription() RPC
   returns the SAME can_write value that the row-level security policies use
   to allow or block a save. Reading it here means the paywall banner and the
   actual security can never disagree — no matter how a row was edited.

   Paid accounts are activated by the payment webhook or, for now, by hand
   from the admin dashboard.                                              */

// Ask the database for this user's subscription state. my_subscription()
// runs as the logged-in user and returns can_write, state, and days_remaining
// — the exact same logic RLS enforces on every write.
const fetchSubscription = async () => {
  try {
    const { data, error } = await supabase.rpc('my_subscription');
    if (error || !data) {
      // Fail open: a Supabase hiccup must never lock a paying user out.
      // On failure we also grant all features rather than block them.
      return { locked: false, daysLeft: null, active: false, features: null, staffLimit: null, departmentLimit: null };
    }
    return {
      locked:     !data.can_write,                        // blocked -> show paywall
      active:     data.state === 'active',
      daysLeft:   data.state === 'trialing' ? data.days_remaining : null,
      features:   data.features || null,                  // { insights, company_logo, priority_support }
      staffLimit: data.staff_limit,                       // number, or null = unlimited
      departmentLimit: data.department_limit,             // number, or null = unlimited
    };
  } catch (e) {
    console.error('Subscription check failed:', e);
    return { locked: false, daysLeft: null, active: false, features: null, staffLimit: null, departmentLimit: null }; // fail open
  }
};

/* ─────────────── Banners ─────────────── */

function TrialEndingNote({ daysLeft, onSeePlans }) {
  // Heads-up in the last 7 days, with a link to the plans page so people can
  // act before the view-only switch rather than after it.
  return (
    <div className="dr-anim-in" style={{ background: '#FFF8E7', borderBottom: '1px solid #EBDCB2', padding: '10px 20px', fontSize: 13, color: '#7A6320', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <span>
        Your free trial ends in <strong>{daysLeft} day{daysLeft === 1 ? '' : 's'}</strong>.
      </span>
      <button onClick={onSeePlans} style={{
        background: '#0F8B7E', color: '#fff', fontWeight: 700, fontSize: 12,
        padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
        whiteSpace: 'nowrap', fontFamily: 'inherit',
      }}>
        See plans
      </button>
    </div>
  );
}

function Paywall({ onSeePlans }) {
  return (
    <div className="dr-anim-in" style={{ background: 'linear-gradient(135deg, #0F8B7E, #0B6A60)', color: '#fff', padding: '18px 20px' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, justifyContent: 'space-between' }}>
        <div style={{ flex: '1 1 320px' }}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Your free trial has ended</div>
          <div style={{ fontSize: 13, opacity: 0.95, lineHeight: 1.5 }}>
            Your rota and all your data are safe — you can still view everything and export PDFs,
            but editing is paused. Subscribe to continue right where you left off.
          </div>
        </div>
        <button onClick={onSeePlans} style={{
          background: '#fff', color: '#0B6A60', fontWeight: 800, fontSize: 14,
          padding: '11px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
          whiteSpace: 'nowrap', fontFamily: 'inherit',
        }}>
          See plans
        </button>
      </div>
    </div>
  );
}

/* ─────────────── Legal footer ───────────────
   The policy pages are static HTML in /public, served outside React, so these
   are ordinary links rather than routes. They open in a new tab so nobody
   loses their place in a rota they're mid-way through editing. */
function LegalFooter() {
  const link = {
    color: '#4A6570', textDecoration: 'none', fontSize: 12.5,
  };
  return (
    <div className="no-print" style={{
      borderTop: '1px solid #DCE8E6', background: '#EEF4F3',
      padding: '18px 20px', marginTop: 28,
      display: 'flex', flexWrap: 'wrap', gap: 18,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <a href="/privacy" target="_blank" rel="noopener noreferrer" style={link}>Privacy Policy</a>
      <a href="/terms" target="_blank" rel="noopener noreferrer" style={link}>Terms of Service</a>
      <a href="/refunds" target="_blank" rel="noopener noreferrer" style={link}>Refunds &amp; Cancellation</a>
      <a href="mailto:support@easydutyrota.com" style={link}>support@easydutyrota.com</a>
      <span style={{ color: '#8AA0A8', fontSize: 12 }}>SHAB INVESTMENT</span>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(recoveryPending());
  const [sub, setSub] = useState({ locked: false, daysLeft: null, active: false, features: null, staffLimit: null, departmentLimit: null });
  // Whether this account may open the admin screen. The database decides —
  // is_admin() reads the admins table. Showing or hiding the button here is
  // only tidiness: admin_list_users() and activate_manually() check for
  // themselves and refuse anyone who is not on the list.
  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showBilling, setShowBilling] = useState(false);

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

  // Check trial/subscription whenever someone is logged in. Asks the database
  // directly, so this matches exactly what the app will let them save.
  useEffect(() => {
    if (!session?.user?.id) return;
    let cancelled = false;
    fetchSubscription().then((state) => {
      if (!cancelled) setSub(state);
    });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user?.id) { setIsAdmin(false); setShowAdmin(false); return; }
    let cancelled = false;
    supabase.rpc('is_admin').then(({ data, error }) => {
      if (!cancelled) setIsAdmin(!error && data === true);
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

  if (showAdmin && isAdmin) return <Admin onExit={() => setShowAdmin(false)} />;

  if (showBilling) {
    return (
      <Billing
        email={session.user.email}
        onExit={() => {
          setShowBilling(false);
          // They may have just been activated, so ask the database again
          // rather than leaving a stale paywall on screen.
          fetchSubscription().then(setSub);
        }}
      />
    );
  }

  const showEndingNote = !sub.active && !sub.locked && sub.daysLeft !== null && sub.daysLeft <= 7;

  return (
    <div>
      {sub.locked && <Paywall onSeePlans={() => setShowBilling(true)} />}
      {showEndingNote && <TrialEndingNote daysLeft={sub.daysLeft} onSeePlans={() => setShowBilling(true)} />}
      <div className="no-print" style={{ background: 'white', padding: '15px 20px', borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '20px' }}>📋 DutyRota</h1>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: '#666' }}>{session.user.email}</span>
          <button
            onClick={() => setShowBilling(true)}
            style={{ padding: '8px 16px', background: 'white', color: '#0F8B7E', border: '1px solid #0F8B7E', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            My plan
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowAdmin(true)}
              style={{ padding: '8px 16px', background: '#0B6A60', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              Admin
            </button>
          )}
          <button
            onClick={() => supabase.auth.signOut()}
            style={{ padding: '8px 16px', background: '#E4604E', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Logout
          </button>
        </div>
      </div>
      <DutyRota locked={sub.locked} features={sub.features} staffLimit={sub.staffLimit} departmentLimit={sub.departmentLimit} />
      <LegalFooter />
    </div>
  );
}