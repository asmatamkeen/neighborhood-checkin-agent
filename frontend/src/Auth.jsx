import React, { useState } from 'react';
import { signUp, confirmSignUp, resendCode, signIn } from './auth.js';

export default function Auth({ onSignedIn }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup' | 'verify'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  const submitSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      onSignedIn();
    } catch (e) {
      setError(e.message);
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
      </div>

      <p className="footnote">
        Neighborhood Safety Check-In Agent — built with Strands Agents SDK for the AWS Agents for
        Humans hackathon.
      </p>
    </div>
  );
}
