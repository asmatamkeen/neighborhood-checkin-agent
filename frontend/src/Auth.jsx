import React, { useState } from 'react';
import { signUp, confirmSignUp, resendCode, signIn, forgotPassword, confirmForgotPassword } from './auth.js';
import { checkLockout, recordFailedSignIn, clearFailedSignIns } from './api.js';

export default function Auth({ onSignedIn }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'verify' | 'forgot' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  const submitSignIn = async () => {
    setError(null);
    if (!email) {
      setError('Enter your email');
      return;
    }
    setBusy(true);
    try {
      // Refuse before even trying if this account is temporarily locked.
      const lock = await checkLockout(email);
      if (lock.locked) {
        setError(
          `Too many failed attempts. Try again in ${lock.minutesLeft} minute${lock.minutesLeft === 1 ? '' : 's'}, or use "Forgot password?" below.`
        );
        setBusy(false);
        return;
      }

      await signIn(email, password);
      await clearFailedSignIns(email).catch(() => {}); // best-effort cleanup
      onSignedIn();
    } catch (e) {
      // Only count genuinely wrong credentials — not network blips or
      // "account needs a password reset" style errors.
      const isWrongCredentials = /incorrect|not authorized/i.test(e.message || '');
      if (isWrongCredentials) {
        try {
          const result = await recordFailedSignIn(email);
          if (result.locked) {
            setError(
              `Too many failed attempts. Try again in ${result.minutesLeft} minutes, or use "Forgot password?" below.`
            );
          } else {
            setError(
              `${e.message} ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left before a short lockout.`
            );
          }
        } catch {
          setError(e.message);
        }
      } else {
        setError(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const submitSignUp = async () => {
    setError(null);
    if (!email || password.length < 8) {
      setError('Enter your email and an 8+ character password');
      return;
    }
    setBusy(true);
    try {
      await signUp(email, password);
      setMode('verify');
      setInfo(`We sent a code to ${email}. Enter it below to finish creating your account.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitVerify = async () => {
    setError(null);
    if (code.length < 4) {
      setError('Enter the code from your email');
      return;
    }
    setBusy(true);
    try {
      await confirmSignUp(email, code);
      await signIn(email, password);
      onSignedIn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setInfo(null);
    try {
      await resendCode(email);
      setInfo('Sent a new code — check your email.');
    } catch (e) {
      setError(e.message);
    }
  };

  const submitForgot = async () => {
    setError(null);
    if (!email) {
      setError('Enter your email first');
      return;
    }
    setBusy(true);
    try {
      await forgotPassword(email);
      setMode('reset');
      setInfo(`We sent a reset code to ${email}. Enter it below with your new password.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    setError(null);
    if (code.length < 4 || newPassword.length < 8) {
      setError('Enter the code and a new password (8+ characters)');
      return;
    }
    setBusy(true);
    try {
      await confirmForgotPassword(email, code, newPassword);
      setPassword(newPassword);
      // Resetting the password is a legitimate recovery — clear any lockout.
      await clearFailedSignIns(email).catch(() => {});
      await signIn(email, newPassword);
      onSignedIn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'verify') {
    return (
      <div className="app">
        <header className="header">
          <p className="eyebrow">Green Park Colony · Wellness Check-Ins</p>
          <h1 className="title">Check your email</h1>
          <p className="subtitle">{info}</p>
        </header>

        <div className="card" style={{ maxWidth: 380 }}>
          <p className="pin-label">Verification code</p>
          <input
            className="pin-input"
            style={{ marginBottom: 10 }}
            inputMode="numeric"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            autoFocus
          />
          {error && <p className="pin-error">{error}</p>}
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" disabled={busy} onClick={submitVerify}>
              {busy ? 'Verifying…' : 'Verify & sign in'}
            </button>
          </div>
          <button className="btn btn-done" style={{ marginTop: 10 }} onClick={handleResend}>
            Resend code
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'forgot') {
    return (
      <div className="app">
        <header className="header">
          <p className="eyebrow">Green Park Colony · Wellness Check-Ins</p>
          <h1 className="title">Reset your password</h1>
          <p className="subtitle">Enter your email and we'll send you a reset code.</p>
        </header>

        <div className="card" style={{ maxWidth: 380 }}>
          <p className="pin-label">Email</p>
          <input
            className="pin-input"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
          {error && <p className="pin-error">{error}</p>}
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" disabled={busy} onClick={submitForgot}>
              {busy ? 'Sending…' : 'Send reset code'}
            </button>
          </div>
          <button className="btn btn-done" style={{ marginTop: 10 }} onClick={() => setMode('signin')}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'reset') {
    return (
      <div className="app">
        <header className="header">
          <p className="eyebrow">Green Park Colony · Wellness Check-Ins</p>
          <h1 className="title">Set a new password</h1>
          <p className="subtitle">{info}</p>
        </header>

        <div className="card" style={{ maxWidth: 380 }}>
          <p className="pin-label">Reset code</p>
          <input
            className="pin-input"
            style={{ marginBottom: 10 }}
            inputMode="numeric"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <p className="pin-label">New password</p>
          <input
            className="pin-input"
            type="password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          {error && <p className="pin-error">{error}</p>}
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" disabled={busy} onClick={submitReset}>
              {busy ? 'Saving…' : 'Set password & sign in'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <p className="eyebrow">Green Park Colony · Wellness Check-Ins</p>
        <h1 className="title">{mode === 'signup' ? 'Create your account' : 'Sign in'}</h1>
        <p className="subtitle">
          {mode === 'signup'
            ? "Use the email your secretary registered for you. If it's not recognized, ask them to add you first."
            : 'Sign in with your email and password.'}
        </p>
      </header>

      <div className="card" style={{ maxWidth: 380 }}>
        <p className="pin-label">Email</p>
        <input
          className="pin-input"
          style={{ marginBottom: 10 }}
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <p className="pin-label">Password</p>
        <input
          className="pin-input"
          type="password"
          placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <p className="pin-error">{error}</p>}
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={mode === 'signup' ? submitSignUp : submitSignIn}
          >
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </div>
        <button
          className="btn btn-done"
          style={{ marginTop: 10 }}
          onClick={() => {
            setMode(mode === 'signup' ? 'signin' : 'signup');
            setError(null);
          }}
        >
          {mode === 'signup' ? 'Already have an account? Sign in' : 'First time here? Create an account'}
        </button>
        {mode === 'signin' && (
          <button
            className="btn btn-done"
            style={{ marginTop: 8 }}
            onClick={() => {
              setMode('forgot');
              setError(null);
            }}
          >
            Forgot password?
          </button>
        )}
      </div>

      <p className="footnote">
        Neighborhood Safety Check-In Agent — built with Strands Agents SDK for the AWS Agents for
        Humans hackathon.
      </p>
    </div>
  );
}
