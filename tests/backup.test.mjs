// Export/import: round trip, and invalid or hostile JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, makeBackup, parseBackup, sortAppointments, sortDoses } from '../js/logic.js';
import { loadData, saveData } from '../js/store.js';
import { MemoryStorage } from './helpers/memory-storage.mjs';

const now = new Date(Date.UTC(2026, 9, 25, 16, 0));
const sample = () => ({
  ...emptyData(),
  meds: [{ id: 'm1', name: 'Example med', kind: 'Medication', dose: '10 mg', how: 'Daily', current: true, notes: 'with food' }],
  appts: [{ id: 'a1', title: 'Checkup', date: '2026-11-01', time: '09:30', place: 'Clinic', notes: '' }],
  doses: [{ id: 'd1', name: 'Example med', amount: '1 tablet', time: '08:00' }],
  checks: { '2026-10-25': { d1: true } },
});

test('export is labelled JSON with a timestamp and the data', () => {
  const b = JSON.parse(makeBackup(sample(), now));
  assert.equal(b.app, 'care-reminder');
  assert.equal(b.exportedAt, '2026-10-25T16:00:00.000Z');
  assert.deepEqual(b.data, sample());
});

test('export then import gives back the same data', () => {
  assert.deepEqual(parseBackup(makeBackup(sample(), now)), sample());
});

test('a full device round trip: save, export, reset, import, reload', () => {
  const a = new MemoryStorage(); saveData(a, sample());
  const file = makeBackup(loadData(a), now);
  const b = new MemoryStorage(); saveData(b, parseBackup(file));
  assert.deepEqual(loadData(b), sample());
});

test('a bare data object (no wrapper) also imports', () => {
  assert.deepEqual(parseBackup(JSON.stringify(sample())), sample());
});

test('not JSON at all is rejected', () => {
  for (const t of ['', 'nope', '{', '<html></html>', '{"meds": [}']) assert.throws(() => parseBackup(t), /valid JSON/, t);
});

test('JSON with no data object is rejected', () => {
  for (const t of ['null', '3', '"text"', 'true', '{"app":"care-reminder","data":null}', '{"app":"care-reminder","data":5}']) {
    assert.throws(() => parseBackup(t), /No Care Reminder data/, t);
  }
});

test('lists that are not lists are rejected', () => {
  assert.throws(() => parseBackup('{"meds": 3}'), /"meds" must be a list/);
  assert.throws(() => parseBackup('{"appts": {"0": {}}}'), /"appts" must be a list/);
  assert.throws(() => parseBackup('{"doses": "x"}'), /"doses" must be a list/);
});

test('items without a string id and name/title are dropped', () => {
  const d = parseBackup(JSON.stringify({ meds: [null, 1, 'x', [], {}, { id: 1, name: 'n' }, { id: 'ok', name: 'Keep' }, { id: 'x', name: 5 }] }));
  assert.deepEqual(d.meds, [{ id: 'ok', name: 'Keep' }]);
});

test('bad checks become empty instead of breaking the Today tab', () => {
  for (const checks of [null, 5, 'x', [1, 2]]) assert.deepEqual(parseBackup(JSON.stringify({ checks })).checks, {}, JSON.stringify(checks));
});

test('the version is always set to the current one', () => {
  assert.equal(parseBackup('{"version": 999}').version, emptyData().version);
});

test('a __proto__ key does not pollute Object.prototype', () => {
  const evil = '{"__proto__": {"polluted": true}, "meds": [{"id": "m", "name": "A", "__proto__": {"polluted": true}}], "checks": {"__proto__": {"polluted": true}}}';
  const d = parseBackup(evil);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(d.meds.length, 1);
});

test('a very large backup still parses', () => {
  const meds = Array.from({ length: 5000 }, (_, i) => ({ id: `m${i}`, name: `Med ${i}` }));
  assert.equal(parseBackup(JSON.stringify({ meds })).meds.length, 5000);
});

test('ids that could break out of an HTML attribute are dropped on import', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const d = parseBackup(JSON.stringify({
    meds: [{ id: evil, name: 'A' }, { id: 'ok-1', name: 'B' }],
    doses: [{ id: "x' onmouseover='1", name: 'C' }, { id: '', name: 'D' }, { id: 'a'.repeat(65), name: 'E' }],
    appts: [{ id: '0b8e4c2a-6f1d-4e3b-9a7c-2d5f8e1b3c4a', title: 'F', date: '2026-11-01' }],
  }));
  assert.deepEqual(d.meds.map((x) => x.id), ['ok-1']);
  assert.deepEqual(d.doses, []);
  assert.equal(d.appts.length, 1, 'randomUUID ids still import');
});

test('wrong field types are dropped so the tabs cannot crash', () => {
  const d = parseBackup(JSON.stringify({
    meds: [{ id: 'm1', title: 'no name' }, { id: 'm2', name: 'A', dose: 10, current: 'yes', notes: 'ok', extra: { deep: 1 } }],
    doses: [{ id: 'd1', name: 'B', time: 800 }, { id: 'd2', name: 'C', time: '8:00' }, { id: 'd3', name: 'D', time: '' }, { id: 'd4', name: ['E'] }],
    appts: [{ id: 'a1', title: 'F', date: 20990101 }, { id: 'a2', title: 'G', date: '2099-01-01', time: 9, place: null }, { id: 'a3', name: 'no title', date: '2099-01-01' }],
    checks: { '2026-10-25': { d1: true, d2: 'yes', 'x y': true }, 'not-a-date': { d1: true }, '2026-10-24': 5 },
  }));
  assert.deepEqual(d.meds, [{ id: 'm2', name: 'A', notes: 'ok' }]);
  assert.deepEqual(d.doses, [{ id: 'd1', name: 'B' }, { id: 'd2', name: 'C' }, { id: 'd3', name: 'D', time: '' }]);
  assert.deepEqual(d.appts, [{ id: 'a2', title: 'G', date: '2099-01-01' }]);
  assert.deepEqual(d.checks, { '2026-10-25': { d1: true } });
  assert.doesNotThrow(() => { sortDoses(d.doses); sortAppointments(d.appts); [...d.meds].sort((a, b) => a.name.localeCompare(b.name)); });
});

test('bad data already saved on the device is cleaned on load', () => {
  const s = new MemoryStorage();
  s.setItem('care-reminder:data', JSON.stringify({ meds: null, doses: [{ id: 'd', name: 'B', time: 800 }, { id: 'e', name: 'C' }], appts: 'x' }));
  const d = loadData(s);
  assert.deepEqual(d.meds, []);
  assert.deepEqual(d.appts, []);
  assert.deepEqual(sortDoses(d.doses).map((x) => x.id), ['d', 'e']);
});
