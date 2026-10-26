// PIN lock: salted SHA-256 hash, verify, wrong PIN and the forgot-PIN reset.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { emptyData, hashPin, newSalt, validPin } from '../js/logic.js';
import { AUTH_KEY, DATA_KEY, readAuth, resetApp, saveData, setPin, verifyPin } from '../js/store.js';
import { MemoryStorage } from './helpers/memory-storage.mjs';

test('hashPin is SHA-256 of "salt:pin" in lowercase hex', async () => {
  const want = createHash('sha256').update('abc:1234').digest('hex');
  assert.equal(await hashPin('1234', 'abc'), want);
});

test('newSalt is 16 random bytes in hex and differs each time', () => {
  const salts = new Set(Array.from({ length: 20 }, newSalt));
  assert.equal(salts.size, 20);
  for (const s of salts) assert.match(s, /^[0-9a-f]{32}$/);
});

test('validPin accepts 4 to 8 digits only', () => {
  for (const ok of ['0000', '1234', '12345678']) assert.ok(validPin(ok), ok);
  for (const bad of ['', '123', '123456789', '12a4', ' 1234', '1234 ', '१२३४', '12.4']) assert.ok(!validPin(bad), JSON.stringify(bad));
});

test('setPin stores a fresh salt and a hash, never the PIN', async () => {
  const s = new MemoryStorage();
  assert.equal(readAuth(s), null);
  await setPin(s, '24681357');
  const raw = s.getItem(AUTH_KEY);
  assert.ok(!raw.includes('24681357'));
  const a = readAuth(s);
  assert.deepEqual(Object.keys(a).sort(), ['hash', 'salt']);
  assert.equal(a.hash, await hashPin('24681357', a.salt));
  const s2 = new MemoryStorage(); await setPin(s2, '24681357');
  assert.notEqual(readAuth(s2).hash, a.hash, 'same PIN, different salt, different hash');
});

test('setPin rejects an invalid PIN and stores nothing', async () => {
  const s = new MemoryStorage();
  await assert.rejects(setPin(s, '12'), /4 to 8 digits/);
  assert.equal(s.getItem(AUTH_KEY), null);
});

test('verifyPin accepts the right PIN and rejects wrong ones', async () => {
  const s = new MemoryStorage(); await setPin(s, '2468', 'fixed-salt');
  assert.equal(await verifyPin(s, '2468'), true);
  for (const bad of ['2469', '0000', '24680', '246', '', 'abcd']) assert.equal(await verifyPin(s, bad), false, bad);
});

test('verifyPin is false when no PIN is set or the record is corrupt', async () => {
  assert.equal(await verifyPin(new MemoryStorage(), '1234'), false);
  const s = new MemoryStorage(); s.setItem(AUTH_KEY, '{oops');
  assert.equal(readAuth(s), null);
  assert.equal(await verifyPin(s, '1234'), false);
  s.setItem(AUTH_KEY, '{}');
  assert.equal(await verifyPin(s, '1234'), false);
});

test('changing the salt or hash in storage locks the old PIN out', async () => {
  const s = new MemoryStorage(); await setPin(s, '1357');
  const a = readAuth(s);
  s.setItem(AUTH_KEY, JSON.stringify({ ...a, salt: `${a.salt}x` }));
  assert.equal(await verifyPin(s, '1357'), false);
});

test('reset erases the PIN and all data, and a new PIN can be set', async () => {
  const s = new MemoryStorage();
  await setPin(s, '1111');
  saveData(s, { ...emptyData(), meds: [{ id: 'm1', name: 'A' }] });
  s.setItem('other-app', 'keep');
  assert.deepEqual(resetApp(s), emptyData());
  assert.equal(s.getItem(AUTH_KEY), null);
  assert.equal(s.getItem(DATA_KEY), null);
  assert.equal(s.getItem('other-app'), 'keep');
  assert.equal(await verifyPin(s, '1111'), false);
  await setPin(s, '2222');
  assert.equal(await verifyPin(s, '2222'), true);
});
