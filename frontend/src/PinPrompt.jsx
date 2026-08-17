import React, { useState } from 'react';

export default function PinPrompt({ label, onConfirm, onCancel, busy }) {
  const [pin, setPin] = useState('');

  return (
    <div className="pin-prompt">
      <p className="pin-label">{label}</p>
      <div className="pin-row">
        <input
          className="pin-input"
          type="password"
          inputMode="numeric"
          maxLength={4}
          placeholder="4-digit PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          autoFocus
        />
        <button
          className="btn btn-primary"
          disabled={pin.length !== 4 || busy}
          onClick={() => onConfirm(pin)}
        >
          {busy ? 'Checking…' : 'Confirm'}
        </button>
        <button className="btn btn-done" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
