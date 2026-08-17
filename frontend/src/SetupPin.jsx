import React, { useState } from 'react';
import { setAdminPin } from './api.js';

export default function SetupPin({ currentUser, onDone }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (pin.length !== 4) {
      setError('PIN must be 4 digits');
      return;
    }
    if (pin !== confirmPin) {
      setError("PINs don't match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await setAdminPin(currentUser.volunteerId, pin);
      onDone();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <p className="eyebrow">Green Park Colony · Wellness Check-Ins</p>
        <h1 className="title">Welcome, {currentUser.name}</h1>
        <p className="subtitle">
          This is your first time here. Set a 4-digit PIN — you'll enter it whenever you
          reassign a volunteer, add a resident, or add a new volunteer. Keep it to yourself.
        </p>
      </header>

      <div className="card" style={{ maxWidth: 360 }}>
        <p className="pin-label">Choose a PIN</p>
        <input
          className="pin-input"
          style={{ marginBottom: 10 }}
          type="password"
          inputMode="numeric"
          maxLength={4}
          placeholder="4-digit PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        <p className="pin-label">Confirm it</p>
        <input
          className="pin-input"
          type="password"
          inputMode="numeric"
          maxLength={4}
          placeholder="Re-enter PIN"
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
        />
        {error && <p className="pin-error">{error}</p>}
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>
            {busy ? 'Saving…' : 'Save PIN'}
          </button>
        </div>
      </div>
    </div>
  );
}
