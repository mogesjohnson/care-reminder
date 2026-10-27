// Storage layer: load/save through an in-memory localStorage, and the storage-persist status.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData } from '../js/logic.js';
import { AUTH_KEY, DATA_KEY, loadData, persistStatus, saveData, saveErrorMessage, trySaveData } from '../js/store.js';
import { MemoryStorage } from './helpers/memory-storage.mjs';

test('a fresh device loads empty data', () => {
  assert.deepEqual(loadData(new MemoryStorage()), emptyData());
});

test('saved data loads back unchanged under the data key only', () => {
  const s = new MemoryStorage();
  const d = { ...emptyData(), meds: [{ id: 'm1', name: 'Example med', current: true }], checks: { '2026-10-25': { d1: true } } };
  assert.equal(saveData(s, d), d);
  assert.equal(s.length, 1);
  assert.equal(s.key(0), DATA_KEY);
  assert.deepEqual(loadData(s), d);
});

test('corrupt or non-object stored data falls back to empty data', () => {
  for (const raw of ['{not json', 'null', '']) {
    const s = new MemoryStorage(); s.setItem(DATA_KEY, raw);
    assert.deepEqual(loadData(s), emptyData(), `raw ${JSON.stringify(raw)}`);
  }
});

test('older saves missing a list get the empty list filled in', () => {
  const s = new MemoryStorage(); s.setItem(DATA_KEY, JSON.stringify({ meds: [{ id: 'm1', name: 'A' }] }));
  const d = loadData(s);
  assert.deepEqual(d.doses, []);
  assert.deepEqual(d.appts, []);
  assert.deepEqual(d.checks, {});
  assert.equal(d.meds.length, 1);
});

test('a failed write throws instead of pretending to save', () => {
  const s = new MemoryStorage({ failWrites: true });
  assert.throws(() => saveData(s, emptyData()), { name: 'QuotaExceededError' });
  assert.equal(s.getItem(DATA_KEY), null);
});

test('saving data never touches the PIN record', () => {
  const s = new MemoryStorage(); s.setItem(AUTH_KEY, '{"salt":"s","hash":"h"}');
  saveData(s, emptyData());
  assert.equal(s.getItem(AUTH_KEY), '{"salt":"s","hash":"h"}');
});

test('persistStatus reports granted, asks when not yet granted, and survives missing APIs', async () => {
  let asked = 0;
  const nav = (persisted, persist) => ({ storage: { persisted: async () => persisted, persist: async () => { asked += 1; return persist; } } });
  assert.equal(await persistStatus(nav(true, false)), true);
  assert.equal(asked, 0);
  assert.equal(await persistStatus(nav(false, true)), true);
  assert.equal(await persistStatus(nav(false, false)), false);
  assert.equal(asked, 2);
  assert.equal(await persistStatus({}), false);
  assert.equal(await persistStatus(undefined), false);
  assert.equal(await persistStatus({ storage: { persisted: async () => { throw new Error('denied'); } } }), false);
});

test('trySaveData reports a full-storage failure instead of throwing', () => {
  const s = new MemoryStorage({ failWrites: true });
  const errors = [];
  assert.equal(trySaveData(s, emptyData(), (m) => errors.push(m)), false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /storage is full/);
  assert.equal(s.getItem(DATA_KEY), null);
});

test('trySaveData reports blocked storage and tolerates a missing handler', () => {
  const blocked = { setItem() { throw Object.assign(new Error('denied'), { name: 'SecurityError' }); } };
  const errors = [];
  assert.equal(trySaveData(blocked, emptyData(), (m) => errors.push(m)), false);
  assert.match(errors[0], /blocked storage/);
  assert.equal(trySaveData(blocked, emptyData()), false);
  assert.match(saveErrorMessage(undefined), /^Not saved/);
});

test('trySaveData saves and returns true when storage works', () => {
  const s = new MemoryStorage();
  let called = false;
  assert.equal(trySaveData(s, emptyData(), () => { called = true; }), true);
  assert.equal(called, false);
  assert.deepEqual(loadData(s), emptyData());
});
