// In-memory stand-in for window.localStorage: string values, null for missing keys.
export class MemoryStorage {
  #m = new Map();
  constructor({ failWrites = false } = {}) { this.failWrites = failWrites; }
  get length() { return this.#m.size; }
  key(i) { return [...this.#m.keys()][i] ?? null; }
  getItem(k) { return this.#m.has(String(k)) ? this.#m.get(String(k)) : null; }
  setItem(k, v) {
    if (this.failWrites) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    this.#m.set(String(k), String(v));
  }
  removeItem(k) { this.#m.delete(String(k)); }
  clear() { this.#m.clear(); }
}
