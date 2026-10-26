// Today tab: check-offs keyed by local date, so each new day starts unchecked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksFor, dateKey, emptyData, pruneChecks, sortDoses, toggleCheck } from '../js/logic.js';
import { loadData, saveData } from '../js/store.js';
import { MemoryStorage } from './helpers/memory-storage.mjs';

test('dateKey is the local calendar date, padded', () => {
  assert.equal(dateKey(new Date(2026, 2, 7, 0, 0)), '2026-03-07');
  assert.equal(dateKey(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31');
});

test('the key changes at local midnight', () => {
  assert.notEqual(dateKey(new Date(2026, 9, 25, 23, 59)), dateKey(new Date(2026, 9, 26, 0, 0)));
});

test('ticking doses today does not carry over to tomorrow', () => {
  let d = emptyData();
  d = toggleCheck(d, '2026-10-25', 'am', true);
  d = toggleCheck(d, '2026-10-25', 'pm', true);
  assert.deepEqual(checksFor(d, '2026-10-25'), { am: true, pm: true });
  assert.deepEqual(checksFor(d, '2026-10-26'), {});
  d = toggleCheck(d, '2026-10-26', 'am', true);
  assert.deepEqual(checksFor(d, '2026-10-25'), { am: true, pm: true }, 'yesterday is kept as history');
  assert.deepEqual(checksFor(d, '2026-10-26'), { am: true });
});

test('unticking removes the dose; ticking twice is the same as once', () => {
  let d = toggleCheck(emptyData(), '2026-10-25', 'am', true);
  d = toggleCheck(d, '2026-10-25', 'am', true);
  assert.deepEqual(checksFor(d, '2026-10-25'), { am: true });
  d = toggleCheck(d, '2026-10-25', 'am', false);
  assert.deepEqual(checksFor(d, '2026-10-25'), {});
  d = toggleCheck(d, '2026-10-25', 'never-ticked', false);
  assert.deepEqual(checksFor(d, '2026-10-25'), {});
});

test('toggleCheck returns new data and leaves the old object alone', () => {
  const before = emptyData();
  const after = toggleCheck(before, '2026-10-25', 'am', true);
  assert.deepEqual(before.checks, {});
  assert.notEqual(after, before);
});

test('check-offs survive a save and reload, then reset the next day', () => {
  const s = new MemoryStorage();
  saveData(s, toggleCheck(emptyData(), dateKey(new Date(2026, 9, 25, 8)), 'am', true));
  const d = loadData(s);
  assert.deepEqual(checksFor(d, dateKey(new Date(2026, 9, 25, 21))), { am: true });
  assert.deepEqual(checksFor(d, dateKey(new Date(2026, 9, 26, 0, 1))), {});
});

test('pruneChecks keeps the last 30 days and drops older ones', () => {
  const checks = { '2026-09-24': { a: true }, '2026-09-25': { b: true }, '2026-10-25': { c: true } };
  assert.deepEqual(Object.keys(pruneChecks(checks, '2026-10-25')), ['2026-09-25', '2026-10-25']);
  assert.deepEqual(Object.keys(pruneChecks(checks, '2026-10-25', 1)), ['2026-10-25']);
});

test('toggling prunes old history so storage does not grow forever', () => {
  const d = { ...emptyData(), checks: { '2025-01-01': { x: true } } };
  assert.deepEqual(Object.keys(toggleCheck(d, '2026-10-25', 'am', true).checks), ['2026-10-25']);
});

test('doses list by time, then name; untimed doses go last', () => {
  const list = [{ name: 'Zinc' }, { name: 'b', time: '08:00' }, { name: 'A', time: '08:00' }, { name: 'Night', time: '21:00' }, { name: 'Alpha' }];
  assert.deepEqual(sortDoses(list).map((x) => x.name), ['A', 'b', 'Night', 'Alpha', 'Zinc']);
  assert.equal(list[0].name, 'Zinc', 'input order is unchanged');
});
