import { getCurrentIdToken } from './auth.js';

export const API_BASE = import.meta.env.VITE_API_BASE || 'REPLACE_WITH_YOUR_API_URL';

async function authedFetch(path, options = {}) {
  const token = await getCurrentIdToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: token } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function fetchMyProfile() {
  return authedFetch('/me');
}

export function fetchCheckIns() {
  return authedFetch('/checkins');
}

export function fetchPeople() {
  return authedFetch('/people');
}

export function markDone(checkInId, otp) {
  return authedFetch(`/checkins/${checkInId}`, {
    method: 'POST',
    body: JSON.stringify({ otp }),
  });
}

export function reassignCheckIn(checkInId, newVolunteerId) {
  return authedFetch(`/checkins/${checkInId}/reassign`, {
    method: 'POST',
    body: JSON.stringify({ newVolunteerId }),
  });
}

export function addResident(payload) {
  return authedFetch('/residents', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function addPerson(payload) {
  return authedFetch('/people', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function runAssignmentNow() {
  return authedFetch('/run-assignment', { method: 'POST' });
}
