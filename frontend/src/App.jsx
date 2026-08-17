import React, { useEffect, useState, useCallback } from 'react';
import { fetchCheckIns, fetchPeople, markDone, reassignCheckIn, addResident, addPerson } from './api.js';
import PersonPicker from './PersonPicker.jsx';
import PinPrompt from './PinPrompt.jsx';
import SetupPin from './SetupPin.jsx';

const STAGES = ['pending', 'reminder_sent', 'escalated_secretary', 'escalated_joint_secretary', 'escalated_emergency'];

const STAGE_LABELS = {
  pending: 'assigned',
  reminder_sent: 'reminder',
  escalated_secretary: 'secretary',
  escalated_joint_secretary: 'joint sec.',
  escalated_emergency: 'emergency',
};

const STATUS_LABELS = {
  pending: 'pending',
  reminder_sent: 'reminder sent',
  escalated_secretary: 'with secretary',
  escalated_joint_secretary: 'with joint secretary',
  escalated_emergency: 'emergency contacted',
  done: 'done',
};

function stageDotClass(stage, currentIndex, stageIndex) {
  if (stageIndex > currentIndex) return 'timeline-dot';
  if (stage === 'escalated_secretary' || stage === 'escalated_joint_secretary') return 'timeline-dot filled warn';
  if (stage === 'escalated_emergency') return 'timeline-dot filled danger';
  return 'timeline-dot filled';
}

function EscalationTimeline({ status }) {
  const currentIndex = status === 'done' ? STAGES.length - 1 : STAGES.indexOf(status);
  return (
    <div className="timeline" aria-label="Escalation progress">
      {STAGES.map((stage, i) => (
        <React.Fragment key={stage}>
          <div className="timeline-step">
            <span className={stageDotClass(stage, currentIndex, i)} />
            <span>{STAGE_LABELS[stage]}</span>
          </div>
          {i < STAGES.length - 1 && <span className="timeline-connector" />}
        </React.Fragment>
      ))}
    </div>
  );
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
}

function CheckInCard({ item, showVolunteer, isVolunteerView, currentUser, onMarkDone, onReassign, volunteersList, busy, errorMsg }) {
  const isDone = item.status === 'done';
  const [showPin, setShowPin] = useState(false);
  const [showReassign, setShowReassign] = useState(false);
  const [newVolunteerId, setNewVolunteerId] = useState('');
  const [reassignPin, setReassignPin] = useState(false);

  return (
    <div className="card">
      <div className="card-top">
        <div>
          <p className="resident-name">{item.residentName}</p>
          <p className="resident-unit">{item.residentUnit}</p>
        </div>
        <span className={`badge badge-${item.status}`}>{STATUS_LABELS[item.status] || item.status}</span>
      </div>

      <div className="meta-row">
        {showVolunteer && (
          <span>
            Volunteer: <strong>{item.volunteerName}</strong>
          </span>
        )}
        <span>Assigned {timeAgo(item.assignedAt)}</span>
      </div>

      {!isDone && <EscalationTimeline status={item.status} />}

      {errorMsg && <p className="pin-error">{errorMsg}</p>}

      {!isDone && isVolunteerView && (
        <div style={{ marginTop: 16 }}>
          {!showPin ? (
            <button className="btn btn-primary" onClick={() => setShowPin(true)}>
              Mark check-in done
            </button>
          ) : (
            <PinPrompt
              label="Enter today's code (texted to the resident or their family)"
              busy={busy}
              onCancel={() => setShowPin(false)}
              onConfirm={(otp) => onMarkDone(item.checkInId, otp, () => setShowPin(false))}
            />
          )}
        </div>
      )}

      {!isDone && !isVolunteerView && (
        <div style={{ marginTop: 16 }}>
          {!showReassign ? (
            <button className="btn btn-done" onClick={() => setShowReassign(true)}>
              Reassign volunteer
            </button>
          ) : (
            <div>
              <select
                className="pin-input"
                style={{ marginBottom: 8 }}
                value={newVolunteerId}
                onChange={(e) => setNewVolunteerId(e.target.value)}
              >
                <option value="">Choose a volunteer…</option>
                {volunteersList
                  .filter((v) => v.role === 'volunteer')
                  .map((v) => (
                    <option key={v.volunteerId} value={v.volunteerId}>
                      {v.name}
                    </option>
                  ))}
              </select>
              {newVolunteerId && (
                <PinPrompt
                  label={`Enter your admin PIN (${currentUser.name}) to confirm reassignment`}
                  busy={busy}
                  onCancel={() => {
                    setShowReassign(false);
                    setNewVolunteerId('');
                  }}
                  onConfirm={(adminPin) =>
                    onReassign(item.checkInId, newVolunteerId, adminPin, () => {
                      setShowReassign(false);
                      setNewVolunteerId('');
                    })
                  }
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AddResidentForm({ currentUser, onAdd }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '', unit: '', preferredTime: '18:00', preferredMethod: 'visit',
    notes: '', residentPhone: '', emergencyContactName: '', emergencyContactPhone: '',
  });
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (adminPin) => {
    setBusy(true);
    setError(null);
    try {
      await addResident({ ...form, actingPersonId: currentUser.volunteerId, adminPin });
      setForm({ name: '', unit: '', preferredTime: '18:00', preferredMethod: 'visit', notes: '', residentPhone: '', emergencyContactName: '', emergencyContactPhone: '' });
      setShowPin(false);
      setOpen(false);
      onAdd();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        + Add resident
      </button>
    );
  }

  return (
    <div className="card">
      <p className="resident-name" style={{ marginBottom: 12 }}>Add a resident</p>
      <div className="form-grid">
        <input className="pin-input" placeholder="Full name" value={form.name} onChange={update('name')} />
        <input className="pin-input" placeholder="Unit / house no." value={form.unit} onChange={update('unit')} />
        <input className="pin-input" placeholder="Preferred time (e.g. 18:00)" value={form.preferredTime} onChange={update('preferredTime')} />
        <select className="pin-input" value={form.preferredMethod} onChange={update('preferredMethod')}>
          <option value="visit">Visit</option>
          <option value="call">Call</option>
        </select>
        <input className="pin-input" placeholder="Resident's own phone (optional)" value={form.residentPhone} onChange={update('residentPhone')} />
        <input className="pin-input" placeholder="Emergency contact name" value={form.emergencyContactName} onChange={update('emergencyContactName')} />
        <input className="pin-input" placeholder="Emergency contact phone" value={form.emergencyContactPhone} onChange={update('emergencyContactPhone')} />
        <input className="pin-input" placeholder="Notes (optional)" value={form.notes} onChange={update('notes')} style={{ gridColumn: '1 / -1' }} />
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 8 }}>
        Each morning, a fresh check-in code is texted to the resident's own phone if given, otherwise to the emergency contact.
      </p>
      {error && <p className="pin-error">{error}</p>}
      {!showPin ? (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            disabled={!form.name || !form.unit || !form.emergencyContactName || !form.emergencyContactPhone}
            onClick={() => setShowPin(true)}
          >
            Continue
          </button>
          <button className="btn btn-done" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <PinPrompt label="Enter your PIN to confirm" busy={busy} onCancel={() => setShowPin(false)} onConfirm={submit} />
        </div>
      )}
    </div>
  );
}

function AddVolunteerForm({ currentUser, onAdd }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', role: 'volunteer', newAdminPin: '' });
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const update = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const needsPin = form.role === 'secretary' || form.role === 'joint_secretary';

  const submit = async (adminPin) => {
    setBusy(true);
    setError(null);
    try {
      await addPerson({ ...form, actingPersonId: currentUser.volunteerId, adminPin });
      setForm({ name: '', phone: '', role: 'volunteer', newAdminPin: '' });
      setShowPin(false);
      setOpen(false);
      onAdd();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        + Add volunteer
      </button>
    );
  }

  return (
    <div className="card">
      <p className="resident-name" style={{ marginBottom: 12 }}>Add a volunteer</p>
      <div className="form-grid">
        <input className="pin-input" placeholder="Full name" value={form.name} onChange={update('name')} />
        <input className="pin-input" placeholder="Phone number" value={form.phone} onChange={update('phone')} />
        <select className="pin-input" value={form.role} onChange={update('role')}>
          <option value="volunteer">Volunteer</option>
          <option value="joint_secretary">Joint Secretary</option>
        </select>
        {needsPin && (
          <input
            className="pin-input"
            placeholder="Set their admin PIN (4 digits)"
            maxLength={4}
            value={form.newAdminPin}
            onChange={(e) => setForm({ ...form, newAdminPin: e.target.value.replace(/\D/g, '') })}
          />
        )}
      </div>
      {error && <p className="pin-error">{error}</p>}
      {!showPin ? (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary"
            disabled={!form.name || !form.phone || (needsPin && form.newAdminPin.length !== 4)}
            onClick={() => setShowPin(true)}
          >
            Continue
          </button>
          <button className="btn btn-done" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <PinPrompt label="Enter your admin PIN to confirm" busy={busy} onCancel={() => setShowPin(false)} onConfirm={submit} />
        </div>
      )}
    </div>
  );
}

function Dashboard({ currentUser, onSwitchUser }) {
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [cardErrors, setCardErrors] = useState({});
  const [showAdmin, setShowAdmin] = useState(false);

  const load = useCallback(async () => {
    try {
      const [checkinsRes, peopleRes] = await Promise.all([fetchCheckIns(), fetchPeople()]);
      setData(checkinsRes);
      setPeople(peopleRes.people);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const handleMarkDone = async (checkInId, pin, closePrompt) => {
    setBusyId(checkInId);
    setCardErrors((e) => ({ ...e, [checkInId]: null }));
    try {
      await markDone(checkInId, pin);
      closePrompt();
      await load();
    } catch (e) {
      setCardErrors((prev) => ({ ...prev, [checkInId]: e.message }));
    } finally {
      setBusyId(null);
    }
  };

  const handleReassign = async (checkInId, newVolunteerId, pin, closePrompt) => {
    setBusyId(checkInId);
    setCardErrors((e) => ({ ...e, [checkInId]: null }));
    try {
      await reassignCheckIn(checkInId, newVolunteerId, currentUser.volunteerId, pin);
      closePrompt();
      await load();
    } catch (e) {
      setCardErrors((prev) => ({ ...prev, [checkInId]: e.message }));
    } finally {
      setBusyId(null);
    }
  };

  const isVolunteer = currentUser.role === 'volunteer';
  const isSecretaryRole = currentUser.role === 'secretary' || currentUser.role === 'joint_secretary';
  const allCheckIns = data?.checkIns || [];
  const checkIns = isVolunteer
    ? allCheckIns.filter((c) => c.assignedVolunteerId === currentUser.volunteerId)
    : allCheckIns;

  const counts = {
    pending: checkIns.filter((c) => c.status === 'pending' || c.status === 'reminder_sent').length,
    escalated: checkIns.filter((c) => c.status.startsWith('escalated')).length,
    done: checkIns.filter((c) => c.status === 'done').length,
  };

  return (
    <div className="app">
      <header className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p className="eyebrow">Green Park Colony · Wellness Check-Ins</p>
            <h1 className="title">
              {isVolunteer ? `Hi, ${currentUser.name}` : `${currentUser.name}'s oversight view`}
            </h1>
          </div>
          <button className="btn btn-done" onClick={onSwitchUser}>
            Switch person
          </button>
        </div>
        <p className="subtitle">
          {isVolunteer
            ? "Here's who you're checking on today. If you don't mark a visit done in time, the agent reminds you, then escalates."
            : "Every resident's check-in status today, and where the agent has escalated any that were missed."}
        </p>
      </header>

      <div className="stats">
        <div className="stat">
          <div className="stat-num">{checkIns.length}</div>
          <div className="stat-label">{isVolunteer ? 'Assigned to you' : 'Total today'}</div>
        </div>
        <div className="stat">
          <div className="stat-num">{counts.pending}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat">
          <div className="stat-num">{counts.escalated}</div>
          <div className="stat-label">Escalated</div>
        </div>
        <div className="stat">
          <div className="stat-num">{counts.done}</div>
          <div className="stat-label">Completed</div>
        </div>
      </div>

      {isSecretaryRole && (
        <div style={{ marginBottom: 24 }}>
          <button className="btn btn-primary" onClick={() => setShowAdmin((s) => !s)}>
            {showAdmin ? 'Hide admin panel' : 'Open admin panel'}
          </button>
          {showAdmin && (
            <div style={{ display: 'flex', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
              <AddResidentForm currentUser={currentUser} onAdd={load} />
              <AddVolunteerForm currentUser={currentUser} onAdd={load} />
            </div>
          )}
        </div>
      )}

      {error && <p className="state-message">Couldn't load data: {error}</p>}
      {!error && !data && <p className="state-message">Loading today's check-ins…</p>}
      {!error && data && checkIns.length === 0 && (
        <p className="state-message">
          {isVolunteer ? "You're not assigned any check-ins today." : 'No check-ins assigned yet today.'}
        </p>
      )}

      <div className="list">
        {checkIns.map((item) => (
          <CheckInCard
            key={item.checkInId}
            item={item}
            showVolunteer={!isVolunteer}
            isVolunteerView={isVolunteer}
            currentUser={currentUser}
            onMarkDone={handleMarkDone}
            onReassign={handleReassign}
            volunteersList={people}
            busy={busyId === item.checkInId}
            errorMsg={cardErrors[item.checkInId]}
          />
        ))}
      </div>

      <p className="footnote">
        Neighborhood Safety Check-In Agent — built with Strands Agents SDK for the AWS Agents for
        Humans hackathon. Resident data shown here is synthetic, for demonstration purposes. PINs
        are a lightweight demo safeguard, not production-grade authentication.
      </p>
    </div>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    const saved = localStorage.getItem('checkin-current-user');
    return saved ? JSON.parse(saved) : null;
  });
  const [needsPinSetup, setNeedsPinSetup] = useState(false);
  const [checkedPin, setCheckedPin] = useState(false);

  useEffect(() => {
    if (!currentUser) {
      setCheckedPin(false);
      return;
    }
    const isSecretaryRole = currentUser.role === 'secretary' || currentUser.role === 'joint_secretary';
    if (!isSecretaryRole) {
      setNeedsPinSetup(false);
      setCheckedPin(true);
      return;
    }
    // Re-check against the live list in case their PIN status changed since picking them.
    fetchPeople()
      .then((res) => {
        const fresh = res.people.find((p) => p.volunteerId === currentUser.volunteerId);
        setNeedsPinSetup(fresh ? !fresh.hasAdminPin : false);
        setCheckedPin(true);
      })
      .catch(() => setCheckedPin(true));
  }, [currentUser]);

  const handleSelect = (person) => {
    setCurrentUser(person);
    localStorage.setItem('checkin-current-user', JSON.stringify(person));
  };

  const handleSwitchUser = () => {
    setCurrentUser(null);
    localStorage.removeItem('checkin-current-user');
  };

  if (!currentUser) {
    return <PersonPicker onSelect={handleSelect} />;
  }

  if (!checkedPin) {
    return (
      <div className="app">
        <p className="state-message">Loading…</p>
      </div>
    );
  }

  if (needsPinSetup) {
    return <SetupPin currentUser={currentUser} onDone={() => setNeedsPinSetup(false)} />;
  }

  return <Dashboard currentUser={currentUser} onSwitchUser={handleSwitchUser} />;
}
