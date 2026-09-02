import { useState, useEffect, useRef, useCallback } from 'react';
import supabase from './supabaseClient';
import Auth from './Auth';
import DutyRota, { resetRotaVersionTracking } from './DutyRotaOriginal';
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
  // Owner, manager or employee. null means this account has no membership
  // row, which is every account created before invites existed — those get
  // full access, exactly as they always have.
  const [role, setRole] = useState(null);
  // The organisation this account belongs to. The name is blank for every
  // account created before this existed, and a blank name renders nothing —
  // so exports look exactly as they always have until someone fills it in.
  const [org, setOrg] = useState({ id: null, name: '' });
  // When the subscription was last checked. Used to stop rapid tab-switching
  // from firing the RPC over and over.
  const lastSubCheck = useRef(0);
  // Ticket number for the newest subscription request. Every fetch takes a
  // number on the way out and only applies its answer if that number is still
  // the newest one. Without it, a slow RPC started before a logout (or before
  // someone else signed in on the same browser) could land afterwards and
  // write the PREVIOUS account's plan into state — on a shared computer that
  // means one person's limits briefly applying to another.
  const subRequestId = useRef(0);

  // Anything still in flight belongs to the account we just left, so retire
  // its ticket the moment the signed-in user changes (including on logout).
  useEffect(() => {
    subRequestId.current += 1;
  }, [session?.user?.id]);

  // Single place that asks the database for the plan and applies the result.
  // Only touches refs and setSub, so it never needs rebuilding.
  const refreshSub = useCallback(() => {
    const ticket = (subRequestId.current += 1);
    lastSubCheck.current = Date.now();
    fetchSubscription().then((state) => {
      if (ticket === subRequestId.current) setSub(state);
    });
  }, []);

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
        resetRotaVersionTracking();
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
    refreshSub();
  }, [session?.user?.id, refreshSub]);

  // Ask again when the tab comes back to the foreground. Accounts are
  // activated by hand from the admin dashboard, so a customer can be sitting
  // in the app at the very moment their plan changes — they switch away to
  // send the transfer slip, get activated, and switch back. Without this their
  // tab keeps the old limits until they happen to reload, which is what caused
  // the "only one department is editable after upgrading" report. Nothing is
  // reloaded: the new limits flow down as props and the locks lift on their
  // own. The 15-second guard keeps quick tab-flicking from spamming the RPC.
  useEffect(() => {
    if (!session?.user?.id) return;
    const recheck = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastSubCheck.current < 15000) return;
      refreshSub();
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, [session?.user?.id, refreshSub]);

  // What this person is allowed to do inside their organisation. The database
  // enforces it either way — an employee's save is refused by RLS — but the
  // app needs to know so it can show the rota as view-only rather than let
  // someone type changes that quietly go nowhere.
  useEffect(() => {
    if (!session?.user?.id) { setRole(null); return; }
    let cancelled = false;
    supabase.rpc('my_role').then(({ data, error }) => {
      // Fail open, like the subscription check: a hiccup must never take
      // editing away from someone who is entitled to it.
      if (!cancelled) setRole(error ? null : data);
    });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // RLS limits this to the caller's own organisation, so no filter is needed.
  // Failure is quiet: a blank name is harmless, and the rota must load even
  // if this read fails.
  useEffect(() => {
    if (!session?.user?.id) { setOrg({ id: null, name: '' }); return; }
    let cancelled = false;
    supabase.from('organisations').select('id, name').limit(1).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data || !data[0]) { setOrg({ id: null, name: '' }); return; }
      setOrg({ id: data[0].id, name: data[0].name || '' });
    });
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  // Written straight to the organisations table — the name does not live in
  // rota_data like the rest of the settings, so it cannot go through update().
  const saveOrgName = useCallback(async (name) => {
    if (!org.id) return false;
    const { error } = await supabase.from('organisations').update({ name }).eq('id', org.id);
    if (error) { console.error('Could not save organisation name:', error); return false; }
    setOrg((o) => ({ ...o, name }));
    return true;
  }, [org.id]);

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
          refreshSub();
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
      <DutyRota locked={sub.locked} features={sub.features} staffLimit={sub.staffLimit}
        departmentLimit={sub.departmentLimit} role={role}
        orgName={org.name} onSaveOrgName={saveOrgName}
        canEditOrgName={role === null || role === 'owner'} />
      <LegalFooter />
    </div>
  );
}