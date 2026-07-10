import { useState, useEffect } from 'react';
import supabase from './supabaseClient';
import Auth from './Auth';
import DutyRota from './DutyRotaOriginal';

// A password-reset link signs the user in automatically. Without this check,
// App.js would see a valid session and jump straight to the rota, never giving
// them a chance to type a new password. So while type=recovery is in the URL,
// we keep showing the Auth screen.
const isRecoveryUrl = () => /type=recovery/.test(window.location.hash || '')
  || /type=recovery/.test(window.location.search || '');

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(isRecoveryUrl());

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(session);
    });

    // Auth.js fires this once the new password is saved
    const done = () => setRecovering(false);
    window.addEventListener('dutyrota:recovery-done', done);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('dutyrota:recovery-done', done);
    };
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        Loading...
      </div>
    );
  }

  // Show the Auth screen if nobody is logged in, OR if they are mid password reset
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