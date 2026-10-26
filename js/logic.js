// Pure logic, no DOM: shared by the app and the Node tests in tests/.

export const STORE_VERSION = 1;
export const emptyData = () => ({ version: STORE_VERSION, meds: [], appts: [], doses: [], checks: {} });

/** Local calendar date as YYYY-MM-DD (not UTC, so "today" flips at local midnight). */
export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Hex SHA-256 of salt + ":" + pin, via Web Crypto (browser and Node 20+). */
export async function hashPin(pin, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newSalt() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const validPin = (pin) => /^\d{4,8}$/.test(pin);

/** Appointment start as a sortable "YYYY-MM-DDTHH:MM" string (no time sorts as start of day). */
const apptStamp = (a) => `${a.date}T${a.time || '00:00'}`;

/**
 * Splits appointments into upcoming (earliest first) and past (most recent first).
 * An appointment is past once its day is over, or its time has passed today.
 */
export function sortAppointments(appts, now = new Date()) {
  const today = dateKey(now);
  const nowStamp = `${today}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const isPast = (a) => a.date < today || (a.date === today && a.time && apptStamp(a) < nowStamp);
  const byStamp = (x, y) => apptStamp(x).localeCompare(apptStamp(y));
  return {
    upcoming: appts.filter((a) => !isPast(a)).sort(byStamp),
    past: appts.filter(isPast).sort((x, y) => byStamp(y, x)),
  };
}

/** Group label for an upcoming appointment: Today, This week (next 7 days) or Later. */
export function apptGroup(a, now = new Date()) {
  const today = dateKey(now);
  if (a.date === today) return 'Today';
  const week = new Date(now); week.setDate(week.getDate() + 7);
  return a.date <= dateKey(week) ? 'This week' : 'Later';
}

/** Today's check-offs; a new date has none, so the list resets each day. */
export const checksFor = (data, key) => data.checks[key] || {};

export function toggleCheck(data, key, doseId, done) {
  const day = { ...checksFor(data, key) };
  if (done) day[doseId] = true; else delete day[doseId];
  return { ...data, checks: pruneChecks({ ...data.checks, [key]: day }, key) };
}

/** Keeps the last `keep` days of check-offs so storage does not grow forever. */
export function pruneChecks(checks, todayKey, keep = 30) {
  const cutoff = new Date(`${todayKey}T00:00`); cutoff.setDate(cutoff.getDate() - keep);
  const min = dateKey(cutoff);
  return Object.fromEntries(Object.entries(checks).filter(([k]) => k >= min));
}

export const sortDoses = (doses) => [...doses].sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || a.name.localeCompare(b.name));

/** Validates an imported backup and returns clean data, or throws with a reason. */
export function parseBackup(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('Not a valid JSON file.'); }
  const d = raw && raw.app === 'care-reminder' ? raw.data : raw;
  if (!d || typeof d !== 'object') throw new Error('No Care Reminder data in this file.');
  for (const k of ['meds', 'appts', 'doses']) {
    if (d[k] !== undefined && !Array.isArray(d[k])) throw new Error(`"${k}" must be a list.`);
  }
  const ok = (list) => (list || []).filter((x) => x && typeof x.id === 'string' && typeof (x.name ?? x.title) === 'string');
  const checks = d.checks && typeof d.checks === 'object' && !Array.isArray(d.checks) ? d.checks : {};
  return { version: STORE_VERSION, meds: ok(d.meds), appts: ok(d.appts), doses: ok(d.doses), checks };
}

export const makeBackup = (data, now = new Date()) =>
  JSON.stringify({ app: 'care-reminder', exportedAt: now.toISOString(), data }, null, 2);
