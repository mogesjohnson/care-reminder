// App logic tests: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apptGroup, checksFor, dateKey, emptyData, hashPin, makeBackup, parseBackup, pruneChecks, sortAppointments, sortDoses, toggleCheck, validPin } from '../js/logic.js';

const now = new Date(2026, 9, 25, 12, 0); // 25 Oct 2026, 12:00 local

test('dateKey uses the local date', () => {
  assert.equal(dateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('hashPin is salted, stable and not the PIN', async () => {
  const a = await hashPin('1234', 'salt1');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await hashPin('1234', 'salt1'));
  assert.notEqual(a, await hashPin('1234', 'salt2'));
  assert.ok(!a.includes('1234'));
  assert.ok(validPin('1234') && validPin('12345678') && !validPin('12a4') && !validPin('123'));
});

test('appointments sort earliest first and past ones split off', () => {
  const appts = [
    { id: 'c', title: 'Later', date: '2026-12-01' },
    { id: 'b', title: 'Next week', date: '2026-10-30', time: '09:00' },
    { id: 'a2', title: 'Today pm', date: '2026-10-25', time: '15:00' },
    { id: 'a1', title: 'Today am', date: '2026-10-25', time: '08:00' },
    { id: 'p', title: 'Yesterday', date: '2026-10-24' },
    { id: 'p2', title: 'Last month', date: '2026-09-01' },
  ];
  const { upcoming, past } = sortAppointments(appts, now);
  assert.deepEqual(upcoming.map((a) => a.id), ['a2', 'b', 'c']);
  assert.deepEqual(past.map((a) => a.id), ['a1', 'p', 'p2']);
  assert.deepEqual(upcoming.map((a) => apptGroup(a, now)), ['Today', 'This week', 'Later']);
});

test('check-offs are keyed by date, so a new day starts empty', () => {
  let d = emptyData();
  d = toggleCheck(d, '2026-10-25', 'dose1', true);
  assert.deepEqual(checksFor(d, '2026-10-25'), { dose1: true });
  assert.deepEqual(checksFor(d, '2026-10-26'), {});
  d = toggleCheck(d, '2026-10-25', 'dose1', false);
  assert.deepEqual(checksFor(d, '2026-10-25'), {});
});

test('old check-off days are pruned', () => {
  const kept = pruneChecks({ '2026-08-01': { x: true }, '2026-10-20': { y: true } }, '2026-10-25');
  assert.deepEqual(Object.keys(kept), ['2026-10-20']);
});

test('doses sort by time, untimed last', () => {
  const s = sortDoses([{ name: 'B' }, { name: 'C', time: '20:00' }, { name: 'A', time: '08:00' }]);
  assert.deepEqual(s.map((x) => x.name), ['A', 'C', 'B']);
});

test('backup round-trips and rejects bad files', () => {
  const d = { ...emptyData(), meds: [{ id: 'm1', name: 'Example vitamin' }], appts: [{ id: 'a1', title: 'Checkup', date: '2026-11-01' }] };
  assert.deepEqual(parseBackup(makeBackup(d, now)), d);
  assert.throws(() => parseBackup('nope'), /JSON/);
  assert.throws(() => parseBackup('{"meds": 3}'), /list/);
});
