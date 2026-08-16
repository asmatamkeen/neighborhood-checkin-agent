import React, { useEffect, useState, useCallback } from 'react';
import { fetchCheckIns, markDone } from './api.js';

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

function EscalationTimeline({ status, escalationLog }) {
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

function CheckInCard({ item, onMarkDone, marking }) {
  const isDone = item.status === 'done';
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
        <span>
          Volunteer: <strong>{item.volunteerName}</strong>
        </span>
        <span>Assigned {timeAgo(item.assignedAt)}</span>
      </div>

      {!isDone && (
        <EscalationTimeline status={item.status} escalationLog={item.escalationLog} />
      )}

      {!isDone && (
        <div style={{ marginTop: 16 }}>
          <button
            className="btn btn-primary"
            disabled={marking}
            onClick={() => onMarkDone(item.checkInId)}
          >
            {marking ? 'Marking done…' : 'Mark check-in done'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [markingId, setMarkingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchCheckIns();
      setData(res);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [load]);

  const handleMarkDone = async (checkInId) => {
    setMarkingId(checkInId);
    try {
      await markDone(checkInId);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setMarkingId(null);
    }
  };

  const checkIns = data?.checkIns || [];
  const counts = {
    pending: checkIns.filter((c) => c.status === 'pending' || c.status === 'reminder_sent').length,
    escalated: checkIns.filter((c) => c.status.startsWith('escalated')).length,
    done: checkIns.filter((c) => c.status === 'done').length,
  };

  return (
    <div className="app">
      <header className="header">
        <p className="eyebrow">Green Park Colony · Wellness Check-Ins</p>
        <h1 className="title">Today's check-ins</h1>
        <p className="subtitle">
          Every resident is assigned a volunteer each morning. If a check-in isn't confirmed in
          time, the agent escalates on its own — first a reminder, then the secretary, then the
          joint secretary, then the emergency contact.
        </p>
      </header>

      <div className="stats">
        <div className="stat">
          <div className="stat-num">{checkIns.length}</div>
          <div className="stat-label">Total today</div>
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

      {error && <p className="state-message">Couldn't load check-ins: {error}</p>}
      {!error && !data && <p className="state-message">Loading today's check-ins…</p>}
      {!error && data && checkIns.length === 0 && (
        <p className="state-message">No check-ins assigned yet today.</p>
      )}

      <div className="list">
        {checkIns.map((item) => (
          <CheckInCard
            key={item.checkInId}
            item={item}
            onMarkDone={handleMarkDone}
            marking={markingId === item.checkInId}
          />
        ))}
      </div>

      <p className="footnote">
        Neighborhood Safety Check-In Agent — built with Strands Agents SDK for the AWS Agents for
        Humans hackathon. Resident data shown here is synthetic, for demonstration purposes.
      </p>
    </div>
  );
}
