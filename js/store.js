// Storage and PIN lock, no DOM. `storage` is anything shaped like localStorage
// (getItem/setItem/removeItem), so Node tests can pass an in-memory fake.
import { cleanData, emptyData, hashPin, newSalt, validPin } from './logic.js';

export const DATA_KEY = 'care-reminder:data';
export const AUTH_KEY = 'care-reminder:auth';

/** Saved data, cleaned like an import; missing or unreadable data gives an empty app. */
export function loadData(storage) {
  try {
    const raw = JSON.parse(storage.getItem(DATA_KEY));
    return raw && typeof raw === 'object' ? cleanData(raw) : emptyData();
  } catch { return emptyData(); }
}

export function saveData(storage, data) {
  storage.setItem(DATA_KEY, JSON.stringify(data));
  return data;
}

/** The stored { salt, hash } record, or null when no PIN is set yet. */
export function readAuth(storage) {
  try { return JSON.parse(storage.getItem(AUTH_KEY)); } catch { return null; }
}

/** Stores a salted hash of a new PIN (never the PIN itself). */
export async function setPin(storage, pin, salt = newSalt()) {
  if (!validPin(pin)) throw new Error('Use 4 to 8 digits.');
  storage.setItem(AUTH_KEY, JSON.stringify({ salt, hash: await hashPin(pin, salt) }));
}

/** True only when a PIN is set and `pin` hashes to it with the stored salt. */
export async function verifyPin(storage, pin) {
  const a = readAuth(storage);
  if (!a || !validPin(pin)) return false;
  return (await hashPin(pin, a.salt)) === a.hash;
}

/** Forgot-PIN reset: erases the PIN and all data, and returns a fresh empty data set. */
export function resetApp(storage) {
  storage.removeItem(DATA_KEY);
  storage.removeItem(AUTH_KEY);
  return emptyData();
}

/** Whether the browser promised not to evict our storage; asks once if not yet granted. */
export async function persistStatus(nav) {
  try { return Boolean((await nav?.storage?.persisted?.()) || (await nav?.storage?.persist?.())); } catch { return false; }
}
