import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import Auth from './Auth';
import DutyRota from './DutyRotaOriginal';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>Loading...</div>;

  return session ? (
    <div>
      <div style={{ background: 'white', padding: '15px 20px', borderBottom: '1px solid #ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '20px' }}>📋 DutyRota</h1>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', color: '#666' }}>{session.user.email}</span>
          <button onClick={() => supabase.auth.signOut()} style={{ padding: '8px 16px', background: '#E4604E', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>Logout</button>
        </div>
      </div>
      <DutyRota />
    </div>
  ) : (
    <Auth />
  );
}