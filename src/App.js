import { useState, useEffect } from 'react';
import supabase from './supabaseClient';
import Auth from './Auth';
import DutyRota from './DutyRotaOriginal';

// A password-reset link SIGNS THE USER IN so they can change their password.
// That session must never be usable for anything else. We remember that a
// recovery is in progress (even across refreshes) and force a sign-out if the
// user abandons it, so a reset link can never become a free login.
const RECOVERY_FLAG = 'dutyrota:recovering';

const isRecoveryUrl = () => {
  const hash = (window.location.hash || '').replace(/^#/, '');
  const search = (window.location.search || '').replace(/^\?/, '');
  const p = new URLSearchParams(hash || search);
  return p.get('type') === 'recovery' && !p.get('error');
};

// True if a recovery is in progress right now, or was started and not finished
const recoveryPending = () => {
  if (isRecoveryUrl()) return true;
  try { return sessionStorage.getItem(RECOVERY_FLAG) === '1'; } catch { return false; }
};

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(recoveryPending());

  // Mark the recovery as in-progress immediately, so a refresh mid-reset does
  // not drop the user straight into the app with an unchanged password.
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

    // Auth.js fires this ONLY after the new password is saved successfully
    const done = () => {
      try { sessionStorage.removeItem(RECOVERY_FLAG); } catch { /* ignore */ }
      setRecovering(false);
    };
    window.addEventListener('dutyrota:recovery-done', done);

    // If they close the tab mid-reset, end the session. A recovery link must
    // never survive as a logged-in session without a new password being set.
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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        Loading...
      </div>
    );
  }

  // Show the Auth screen if nobody is logged in, OR if a password reset is
  // still unfinished. The recovery session grants no access to the app.
  if (!session || recovering) return <Auth />;

  return (
    <div>
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
      <DutyRota />
    </div>
  );
}