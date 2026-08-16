import React, { useEffect, useState } from 'react';
import { fetchPeople } from './api.js';

const ROLE_LABELS = {
  volunteer: 'Volunteer',
  secretary: 'Secretary',
  joint_secretary: 'Joint Secretary',
};

export default function PersonPicker({ onSelect }) {
  const [people, setPeople] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchPeople()
      .then((res) => setPeople(res.people))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div className="app">
      <header className="header">
        <p className="eyebrow">Green Park Colony · Wellness Check-Ins</p>
        <h1 className="title">Who's checking in?</h1>
        <p className="subtitle">
          Pick your name to see the check-ins that matter to you. Volunteers see today's
          assignment; the secretary and joint secretary see everyone's status.
        </p>
      </header>

      {error && <p className="state-message">Couldn't load people: {error}</p>}
      {!error && !people && <p className="state-message">Loading…</p>}

      <div className="list">
        {people &&
          people.map((p) => (
            <button
              key={p.volunteerId}
              className="card picker-card"
              onClick={() => onSelect(p)}
              style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
            >
              <div className="card-top">
                <div>
                  <p className="resident-name">{p.name}</p>
                  <p className="resident-unit">{ROLE_LABELS[p.role] || p.role}</p>
                </div>
                <span className="badge badge-pending">select</span>
              </div>
            </button>
          ))}
      </div>

      <p className="footnote">
        This is a lightweight demo picker, not a real login. A production deployment would
        replace this with proper authentication.
      </p>
    </div>
  );
}
