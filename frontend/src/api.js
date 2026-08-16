// Set this to your API Gateway URL after deploying the infra stack.
// Example: https://u3i91e02zi.execute-api.ap-south-1.amazonaws.com/prod
export const API_BASE = import.meta.env.VITE_API_BASE || 'https://u3i91e02zi.execute-api.ap-south-1.amazonaws.com/prod';

export async function fetchCheckIns() {
  const res = await fetch(`${API_BASE}/checkins`);
  if (!res.ok) throw new Error('Failed to load check-ins');
  return res.json();
}

export async function fetchPeople() {
  const res = await fetch(`${API_BASE}/people`);
  if (!res.ok) throw new Error('Failed to load people');
  return res.json();
}

export async function markDone(checkInId) {
  const res = await fetch(`${API_BASE}/checkins/${checkInId}`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to mark check-in done');
  return res.json();
}
