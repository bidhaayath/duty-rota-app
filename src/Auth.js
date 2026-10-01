import React, { useState, useEffect } from 'react';
import supabase from './supabaseClient';
import LogoMark from './LogoMark';

// ── Liquid glass styling ─────────────────────────────────────────
// Frosted panels over drifting colour. All CSS — no images — so it stays
// sharp on any screen and costs nothing to load.

const BRAND = {
  teal: '#0F8B7E', deepTeal: '#0B6A60', ink: '#123038',
  orange: '#E89B4C', blue: '#4C9BDE', green: '#82C25E', purple: '#A99BD4',
};

const page = {
  position: 'relative',
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '20px',
  overflow: 'hidden',
  background: 'linear-gradient(145deg, #0C5F6B 0%, #12798A 34%, #2A6FA8 68%, #4A5FA8 100%)',
  fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
};

const card = {
  position: 'relative',
  zIndex: 2,
  width: '100%',
  maxWidth: '410px',
  padding: '34px 32px 30px',
  boxSizing: 'border-box',
  borderRadius: '22px',
  background: 'rgba(255,255,255,0.13)',
  border: '1px solid rgba(255,255,255,0.28)',
  backdropFilter: 'blur(30px) saturate(165%)',
  WebkitBackdropFilter: 'blur(30px) saturate(165%)',
  boxShadow: '0 18px 50px rgba(6,48,44,0.30), inset 0 1px 0 rgba(255,255,255,0.40)',
  color: '#fff',
};

const input = {
  width: '100%',
  padding: '13px 15px',
  marginBottom: '11px',
  borderRadius: '12px',
  border: '1px solid rgba(255,255,255,0.30)',
  background: 'rgba(255,255,255,0.16)',
  color: '#fff',
  boxSizing: 'border-box',
  fontSize: '14.5px',
  fontFamily: 'inherit',
  outline: 'none',
};

const primaryBtn = (loading) => ({
  width: '100%',
  padding: '13px',
  background: loading ? 'rgba(255,255,255,0.45)' : '#fff',
  color: loading ? 'rgba(18,48,56,0.55)' : BRAND.deepTeal,
  border: 'none',
  borderRadius: '12px',
  fontWeight: 700,
  cursor: loading ? 'not-allowed' : 'pointer',
  fontSize: '14.5px',
  fontFamily: 'inherit',
  boxShadow: loading ? 'none' : '0 6px 18px rgba(3,40,36,0.28)',
});

const linkBtn = {
  background: 'none',
  border: 'none',
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '13px',
  padding: 0,
  fontFamily: 'inherit',
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
};

const errBox = {
  background: 'rgba(255,138,120,0.20)', color: '#FFE6E1',
  border: '1px solid rgba(255,160,145,0.45)',
  padding: '11px 13px', borderRadius: '12px',
  marginBottom: '15px', fontSize: '12.5px', lineHeight: 1.6,
};
const okBox = {
  background: 'rgba(150,235,205,0.18)', color: '#E4FFF6',
  border: '1px solid rgba(160,240,215,0.45)',
  padding: '12px 13px', borderRadius: '12px',
  marginBottom: '15px', fontSize: '12.5px', lineHeight: 1.6,
};

// How long someone must wait before asking for another sign-up code.
// Supabase itself refuses a resend within about a minute, so the button
// simply counts down instead of letting them hit that error.
const RESEND_WAIT_SECONDS = 60;

/* Slow-drifting colour behind the glass. Nothing here is interactive, and
   it is switched off for anyone who prefers reduced motion. */
function GlassBackdrop() {
  /* Defined orbs, not a wash. Each has a soft highlight so it reads as a
     sphere, and the blur is light enough that the glass has something real
     to refract. Hues stay in the teal-blue-violet family — orange against
     teal is near-complementary and turns muddy where they overlap. */
  const orb = (c1, c2) =>
    `radial-gradient(circle at 32% 28%, ${c1} 0%, ${c2} 58%, rgba(255,255,255,0) 72%)`;
  return (
    <>
      <style>{`
        @keyframes edrDriftA { 0%,100% { transform: translate(0,0) scale(1); }
                               50%     { transform: translate(5vw,-4vh) scale(1.08); } }
        @keyframes edrDriftB { 0%,100% { transform: translate(0,0) scale(1); }
                               50%     { transform: translate(-5vw,5vh) scale(1.05); } }
        @keyframes edrDriftC { 0%,100% { transform: translate(0,0) scale(1); }
                               50%     { transform: translate(3vw,6vh) scale(0.94); } }
        .edr-orb { position: absolute; border-radius: 50%; pointer-events: none; }
        .edr-in::placeholder { color: rgba(255,255,255,0.66); }
        .edr-in:focus { border-color: rgba(255,255,255,0.78);
                        background: rgba(255,255,255,0.26);
                        box-shadow: 0 0 0 4px rgba(255,255,255,0.15); }
        .edr-in:-webkit-autofill { -webkit-text-fill-color: #fff;
                        transition: background-color 9999s ease-in-out 0s; }
        .edr-btn { transition: transform 140ms ease, box-shadow 140ms ease; }
        .edr-btn:hover:not(:disabled) { transform: translateY(-1px); }
        .edr-btn:active:not(:disabled) { transform: translateY(0) scale(0.995); }
        .edr-link:hover { opacity: 0.82; }
        @media (prefers-reduced-motion: reduce) {
          .edr-orb { animation: none !important; }
          .edr-btn { transition: none; }
        }
      `}</style>
      <div className="edr-orb" style={{
        width: 480, height: 480, top: '-9%', left: '4%', filter: 'blur(14px)',
        background: orb('rgba(150,220,255,0.95)', 'rgba(64,142,214,0.72)'),
        animation: 'edrDriftA 24s ease-in-out infinite',
      }} />
      <div className="edr-orb" style={{
        width: 300, height: 300, top: '38%', left: '-6%', filter: 'blur(10px)',
        background: orb('rgba(190,235,225,0.92)', 'rgba(46,154,150,0.70)'),
        animation: 'edrDriftC 30s ease-in-out infinite',
      }} />
      <div className="edr-orb" style={{
        width: 400, height: 400, bottom: '-12%', right: '6%', filter: 'blur(14px)',
        background: orb('rgba(198,186,240,0.92)', 'rgba(122,104,200,0.70)'),
        animation: 'edrDriftB 28s ease-in-out infinite',
      }} />
      <div className="edr-orb" style={{
        width: 180, height: 180, top: '14%', right: '16%', filter: 'blur(8px)',
        background: orb('rgba(170,230,205,0.95)', 'rgba(96,190,150,0.68)'),
        animation: 'edrDriftA 33s ease-in-out infinite',
      }} />
      <div className="edr-orb" style={{
        width: 130, height: 130, bottom: '18%', left: '22%', filter: 'blur(7px)',
        background: orb('rgba(255,214,160,0.85)', 'rgba(232,155,76,0.55)'),
        animation: 'edrDriftB 26s ease-in-out infinite',
      }} />
    </>
  );
}

// A password-reset link comes back with type=recovery in the URL hash,
// e.g.  https://yoursite.app/#access_token=...&type=recovery
// We check this directly because the PASSWORD_RECOVERY event can fire
// before this component has mounted and started listening.
const urlParams = () => {
  const hash = (window.location.hash || '').replace(/^#/, '');
  const search = (window.location.search || '').replace(/^\?/, '');
  return new URLSearchParams(hash || search);
};
const isRecoveryUrl = () => {
  const p = urlParams();
  return p.get('type') === 'recovery' && !p.get('error');
};
// A recovery started but not finished (survives a page refresh)
const recoveryPending = () => {
  if (isRecoveryUrl()) return true;
  try { return sessionStorage.getItem('dutyrota:recovering') === '1'; } catch { return false; }
};
// Supabase puts failures in the URL too, e.g. error_code=otp_expired
const urlError = () => {
  const p = urlParams();
  if (!p.get('error')) return '';
  const code = p.get('error_code') || '';
  if (/expired/i.test(code) || /expired/i.test(p.get('error_description') || '')) {
    return 'That password reset link has expired or was already used. ' +
      'Reset links can only be opened once, and some email apps open them automatically. ' +
      'Request a new link below and click it as soon as it arrives.';
  }
  return (p.get('error_description') || 'That link is not valid.').replace(/\+/g, ' ');
};

export default function Auth() {
  const startingError = urlError();
  // mode: 'login' | 'signup' | 'verify' | 'forgot' | 'reset'
  const [mode, setMode] = useState(
    recoveryPending() ? 'reset' : startingError ? 'forgot' : 'login'
  );
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(startingError);
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

  // Count down the "Send a new code" wait, one second at a time.
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const switchMode = (m) => {
    // Leaving the reset screen without setting a password? The recovery link
    // signed us in — end that session so it can never act as a free login.
    if (mode === 'reset' && m !== 'reset') {
      try { sessionStorage.removeItem('dutyrota:recovering'); } catch { /* ignore */ }
      supabase.auth.signOut();
    }
    // Drop any error/token junk from the URL so it does not resurface
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    setMode(m);
    setError('');
    setNotice('');
    setPassword('');
    setPassword2('');
    setCode('');
  };

  // Move to the "enter your code" screen, keeping the email they typed.
  const goToVerify = (message) => {
    setMode('verify');
    setCode('');
    setPassword('');
    setPassword2('');
    setResendIn(RESEND_WAIT_SECONDS);
    setNotice(message);
  };

  const handleLogin = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Signed up but never entered their code: send a fresh one and take
      // them straight to the code screen instead of a dead end.
      if (/email not confirmed/i.test(error.message)) {
        const { error: resendError } = await supabase.auth.resend({ type: 'signup', email });
        goToVerify(
          'Your email address is not confirmed yet. We have sent a 6-digit code to ' + email +
          '. Enter it below to finish. If you do not see the email within a few minutes, ' +
          'check your Junk or Spam folder.'
        );
        if (resendError) {
          setNotice('');
          throw new Error(
            'Your email address is not confirmed yet, and we could not send a new code just now. ' +
            'If you already have a code from an earlier email, enter it below, or wait a minute ' +
            'and tap "Send a new code".'
          );
        }
        return;
      }
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
    // will switch screens automatically — nothing more to do here.
    if (data.session) return;

    // With confirmation ON, Supabase does not say "already exists" (so
    // strangers cannot test which emails are registered). Instead it returns
    // a user with no identities and sends no email. Catch that here so the
    // person is not left waiting for a code that will never come.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      throw new Error('An account already exists for this email. Try logging in instead.');
    }

    goToVerify(
      'We have sent a 6-digit code to ' + email + '. Enter it below to finish creating your account. ' +
      'If you do not see the email within a few minutes, check your Junk or Spam folder.'
    );
  };

  const handleVerify = async () => {
    const token = code.replace(/\D/g, '');
    if (token.length !== 6) throw new Error('Enter the 6-digit code from the email.');

    // 'email' is Supabase's current name for this check; 'signup' is the
    // older name. Try the current one first and fall back once, so the code
    // works whichever one this project expects.
    let { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) {
      const retry = await supabase.auth.verifyOtp({ email, token, type: 'signup' });
      if (!retry.error) error = null;
    }
    if (error) {
      if (/expired|invalid/i.test(error.message)) {
        throw new Error(
          'That code is incorrect or has expired. Check the newest email from us, ' +
          'or tap "Send a new code".'
        );
      }
      throw error;
    }
    // Verifying signs them in. App.js sees the new session and opens the app.
    setNotice('Email confirmed. Taking you to your rota…');
  };

  const resendCode = async () => {
    if (resendIn > 0 || loading || !email) return;
    setError('');
    setNotice('');
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error) {
      setError(
        /seconds|rate|too many/i.test(error.message)
          ? 'Please wait a minute before asking for another code.'
          : 'We could not send a new code: ' + error.message
      );
      return;
    }
    setCode('');
    setResendIn(RESEND_WAIT_SECONDS);
    setNotice(
      'A new code has been sent to ' + email + '. Only the newest code will work. ' +
      'Check your Junk or Spam folder if it does not arrive within a few minutes.'
    );
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
    // The reset link must have signed us in. If not, the link was invalid/expired.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      throw new Error(
        'This reset link is no longer valid. Request a new one and click it as soon as it arrives.'
      );
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    // Recovery finished successfully — release the lock
    try { sessionStorage.removeItem('dutyrota:recovering'); } catch { /* ignore */ }
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
      else if (mode === 'verify') await handleVerify();
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
    verify: 'Confirm your email',
    forgot: 'Reset your password',
    reset: 'Choose a new password',
  };
  const buttonText = {
    login: 'Log in',
    signup: 'Create account',
    verify: 'Confirm email',
    forgot: 'Send reset link',
    reset: 'Save new password',
  };

  return (
    <div style={page}>
      <GlassBackdrop />
      <div style={card}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '22px' }}>
          <LogoMark size={62} />
          <h1 style={{
            margin: '12px 0 2px', fontSize: '23px', fontWeight: 700,
            letterSpacing: '-0.3px', color: '#fff', textAlign: 'center',
          }}>Easy Duty Rota</h1>
          <p style={{
            margin: 0, fontSize: '11.5px', letterSpacing: '1.4px',
            textTransform: 'uppercase', color: 'rgba(255,255,255,0.62)', textAlign: 'center',
          }}>The Smarter Way to Roster</p>
          <p style={{
            margin: '16px 0 0', fontSize: '14px',
            color: 'rgba(255,255,255,0.90)', textAlign: 'center', fontWeight: 600,
          }}>{titles[mode]}</p>
        </div>

        {error && <div style={errBox}>⚠ {error}</div>}
        {notice && <div style={okBox}>✓ {notice}</div>}

        <form onSubmit={submit}>
          {mode !== 'reset' && mode !== 'verify' && (
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="edr-in" style={input}
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
              className="edr-in" style={{ ...input, marginBottom: mode === 'login' ? '8px' : '20px' }}
            />
          )}

          {mode === 'verify' && (
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              maxLength={6}
              autoFocus
              className="edr-in"
              style={{
                ...input, marginBottom: '20px', textAlign: 'center',
                fontSize: '22px', fontWeight: 700, letterSpacing: '6px',
              }}
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
                className="edr-in" style={{ ...input, marginBottom: '20px' }}
              />
            </>
          )}

          {mode === 'login' && (
            <div style={{ textAlign: 'right', marginBottom: '18px' }}>
              <button type="button" onClick={() => switchMode('forgot')} className="edr-link" style={{ ...linkBtn, fontWeight: 500, color: 'rgba(255,255,255,0.72)' }}>
                Forgot password?
              </button>
            </div>
          )}

          {mode === 'forgot' && (
            <p style={{ fontSize: '12.5px', color: 'rgba(255,255,255,0.78)', margin: '0 0 18px', lineHeight: 1.6 }}>
              Enter your email and we will send you a link to choose a new password.
            </p>
          )}

          <button type="submit" className="edr-btn" disabled={loading} style={primaryBtn(loading)}>
            {loading ? 'Please wait…' : buttonText[mode]}
          </button>
          {mode === 'signup' && (
            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.72)', margin: '14px 0 0', lineHeight: 1.6, textAlign: 'center' }}>
              By creating an account you agree to our{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: '#fff', fontWeight: 600 }}>Terms of Service</a>
              {' '}and{' '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: '#fff', fontWeight: 600 }}>Privacy Policy</a>.
            </p>
          )}
        </form>

        {mode === 'verify' && (
          <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: 'rgba(255,255,255,0.80)', lineHeight: 1.9 }}>
            Didn't get it?{' '}
            <button
              type="button"
              onClick={resendCode}
              disabled={resendIn > 0 || loading}
              className="edr-link"
              style={{
                ...linkBtn,
                opacity: resendIn > 0 || loading ? 0.55 : 1,
                cursor: resendIn > 0 || loading ? 'not-allowed' : 'pointer',
              }}
            >
              {resendIn > 0 ? `Send a new code (${resendIn}s)` : 'Send a new code'}
            </button>
            <br />
            Wrong email?{' '}
            <button type="button" onClick={() => switchMode('signup')} className="edr-link" style={linkBtn}>
              Start again
            </button>
          </div>
        )}

        {mode === 'login' && (
          <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: 'rgba(255,255,255,0.80)' }}>
            Don't have an account?{' '}
            <button onClick={() => switchMode('signup')} className="edr-link" style={linkBtn}>Sign up</button>
          </p>
        )}

        {mode === 'signup' && (
          <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: 'rgba(255,255,255,0.80)' }}>
            Already have an account?{' '}
            <button onClick={() => switchMode('login')} className="edr-link" style={linkBtn}>Log in</button>
          </p>
        )}

        {mode === 'forgot' && (
          <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: 'rgba(255,255,255,0.80)' }}>
            Remembered it?{' '}
            <button onClick={() => switchMode('login')} className="edr-link" style={linkBtn}>Back to log in</button>
          </p>
        )}

        {mode === 'reset' && (
          <p style={{ textAlign: 'center', marginTop: '20px', fontSize: '13px', color: 'rgba(255,255,255,0.80)' }}>
            Link not working?{' '}
            <button onClick={() => switchMode('forgot')} className="edr-link" style={linkBtn}>Send a new one</button>
          </p>
        )}
      </div>
    </div>
  );
}