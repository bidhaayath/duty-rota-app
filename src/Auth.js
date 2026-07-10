import React, { useState, useEffect } from 'react';
import supabase from './supabaseClient';

// ── shared styles ────────────────────────────────────────────────
const page = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0F8B7E',
  fontFamily: 'Arial, sans-serif',
  padding: '20px',
};
const card = {
  background: 'white',
  padding: '40px',
  borderRadius: '8px',
  width: '100%',
  maxWidth: '400px',
  boxShadow: '0 5px 20px rgba(0,0,0,0.2)',
  boxSizing: 'border-box',
};
const input = {
  width: '100%',
  padding: '10px',
  marginBottom: '10px',
  border: '1px solid #ddd',
  borderRadius: '4px',
  boxSizing: 'border-box',
  fontSize: '14px',
};
const primaryBtn = (loading) => ({
  width: '100%',
  padding: '12px',
  background: loading ? '#7FC0B8' : '#0F8B7E',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  fontWeight: 'bold',
  cursor: loading ? 'not-allowed' : 'pointer',
  fontSize: '14px',
});
const linkBtn = {
  background: 'none',
  border: 'none',
  color: '#0F8B7E',
  cursor: 'pointer',
  fontWeight: 'bold',
  fontSize: '13px',
  padding: 0,
};
const errBox = {
  background: '#fee', color: '#c33', padding: '10px', borderRadius: '4px',
  marginBottom: '15px', fontSize: '12.5px', lineHeight: 1.5,
};
const okBox = {
  background: '#E6F4F1', color: '#0B6A60', padding: '12px', borderRadius: '4px',
  marginBottom: '15px', fontSize: '12.5px', lineHeight: 1.5,
};

// A password-reset link comes back with type=recovery in the URL hash,
// e.g.  https://yoursite.app/#access_token=...&type=recovery
// We check this directly because the PASSWORD_RECOVERY event can fire
// before this component has mounted and started listening.
const isRecoveryUrl = () => {
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  return /type=recovery/.test(hash) || /type=recovery/.test(search);
};

export default function Auth() {
  // mode: 'login' | 'signup' | 'forgot' | 'reset'
  const [mode, setMode] = useState(isRecoveryUrl() ? 'reset' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Belt and braces: also catch the event, in case it fires after we mount.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setMode('reset');
        setError('');
        setNotice('');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const switchMode = (m) => {
    setMode(m);
    setError('');
    setNotice('');
    setPassword('');
    setPassword2('');
  };

  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Friendlier wording than Supabase's default
      if (/invalid login credentials/i.test(error.message)) {
        throw new Error('Email or password is incorrect. Try again, or use "Forgot password?" below.');
      }
      throw error;
    }
  };

  const handleSignUp = async () => {
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) {
      if (/already registered|already exists/i.test(error.message)) {
        throw new Error('An account already exists for this email. Try logging in instead.');
      }
      throw error;
    }
    // If email confirmation is OFF, Supabase returns a session and App.js
    // will switch screens automatically. If it is ON, tell them to check email.
    if (!data.session) {
      setNotice(
        'Account created. Check your email for a confirmation link to finish signing up. ' +
        'If you do not see it within a few minutes, look in your spam or junk folder.'
      );
      setPassword('');
    }
  };

  const handleForgot = async () => {
    if (!email.trim()) throw new Error('Enter the email address you signed up with.');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
    setNotice(
      'If an account exists for ' + email + ', a password reset link has been sent. ' +
      'Open the link on this device, then choose a new password. ' +
      'Check your spam or junk folder if it does not arrive within a few minutes.'
    );
  };

  const handleReset = async () => {
    if (password.length < 6) throw new Error('Password must be at least 6 characters.');
    if (password !== password2) throw new Error('The two passwords do not match.');
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    // Clear type=recovery from the URL so a refresh does not reopen this screen
    window.history.replaceState(null, '', window.location.pathname);
    setNotice('Password updated. Taking you to your rota…');
    // Tell App.js the recovery flow is finished
    window.dispatchEvent(new Event('dutyrota:recovery-done'));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    try {
      if (mode === 'login') await handleLogin();
      else if (mode === 'signup') await handleSignUp();
      else if (mode === 'forgot') await handleForgot();
      else if (mode === 'reset') await handleReset();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const titles = {
    login: 'Log in',
    signup: 'Create your account',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
  };
  const buttonText = {
    login: 'Log in',
    signup: 'Create account',
    forgot: 'Send reset link',
    reset: 'Save new password',
  };

  return (
    <div style={page}>
      <div style={card}>
        <h1 style={{ textAlign: 'center', color: '#333', margin: '0 0 6px', fontSize: '26px' }}>
          📋 DutyRota
        </h1>
        <p style={{ textAlign: 'center', color: '#777', fontSize: '13px', margin: '0 0 26px' }}>
          {titles[mode]}
        </p>

        {error && <div style={errBox}>⚠ {error}</div>}
        {notice && <div style={okBox}>✓ {notice}</div>}

        <form onSubmit={submit}>
          {mode !== 'reset' && (
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={input}
            />
          )}

          {(mode === 'login' || mode === 'signup') && (
            <input
              type="password"
              placeholder={mode === 'signup' ? 'Password (at least 6 characters)' : 'Password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              style={{ ...input, marginBottom: mode === 'login' ? '8px' : '20px' }}
            />
          )}

          {mode === 'reset' && (
            <>
              <input
                type="password"
                placeholder="New password (at least 6 characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                style={input}
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={password2}
                onChange={(e) => setPassword2(e.target.value)}
                required
                autoComplete="new-password"
                style={{ ...input, marginBottom: '20px' }}
              />
            </>
          )}

          {mode === 'login' && (
            <div style={{ textAlign: 'right', marginBottom: '18px' }}>
              <button type="button" onClick={() => switchMode('forgot')} style={{ ...linkBtn, fontWeight: 'normal', color: '#777' }}>
                Forgot password?
              </button>
            </div>
          )}

          {mode === 'forgot' && (
            <p style={{ fontSize: '12.5px', color: '#777', margin: '0 0 18px', lineHeight: 1.5 }}>
              Enter your email and we will send you a link to choose a new password.
            </p>
          )}

          <button type="submit" disabled={loading} style={primaryBtn(loading)}>
            {loading ? 'Please wait…' : buttonText[mode]}
          </button>
        </form>

        {mode === 'login' && (
          <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: '#555' }}>
            Don't have an account?{' '}
            <button onClick={() => switchMode('signup')} style={linkBtn}>Sign up</button>
          </p>
        )}

        {mode === 'signup' && (
          <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: '#555' }}>
            Already have an account?{' '}
            <button onClick={() => switchMode('login')} style={linkBtn}>Log in</button>
          </p>
        )}

        {mode === 'forgot' && (
          <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: '#555' }}>
            Remembered it?{' '}
            <button onClick={() => switchMode('login')} style={linkBtn}>Back to log in</button>
          </p>
        )}
      </div>
    </div>
  );
}