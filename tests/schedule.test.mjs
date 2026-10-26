// Schedule: soonest first, today vs past, group labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apptGroup, sortAppointments } from '../js/logic.js';

const at = (h, m = 0) => new Date(2026, 9, 25, h, m); // 25 Oct 2026, local time
const ids = (list) => list.map((a) => a.id);

test('an empty list gives nothing upcoming and nothing past', () => {
  assert.deepEqual(sortAppointments([], at(12)), { upcoming: [], past: [] });
});

test('upcoming is earliest first across days and times', () => {
  const appts = [
    { id: 'nov', date: '2026-11-02', time: '08:00' },
    { id: 'oct27-pm', date: '2026-10-27', time: '16:30' },
    { id: 'oct27-am', date: '2026-10-27', time: '07:15' },
    { id: 'dec', date: '2026-12-01' },
    { id: 'jan', date: '2027-01-03', time: '09:00' },
  ];
  assert.deepEqual(ids(sortAppointments(appts, at(12)).upcoming), ['oct27-am', 'oct27-pm', 'nov', 'dec', 'jan']);
});

test('an untimed appointment sorts first on its day', () => {
  const appts = [{ id: 't', date: '2026-10-28', time: '09:00' }, { id: 'u', date: '2026-10-28' }];
  assert.deepEqual(ids(sortAppointments(appts, at(12)).upcoming), ['u', 't']);
});

test('today: a timed appointment turns past once its minute has gone', () => {
  const a = [{ id: 'x', date: '2026-10-25', time: '14:30' }];
  assert.deepEqual(ids(sortAppointments(a, at(14, 29)).upcoming), ['x']);
  assert.deepEqual(ids(sortAppointments(a, at(14, 30)).upcoming), ['x'], 'still upcoming at its start minute');
  assert.deepEqual(ids(sortAppointments(a, at(14, 31)).past), ['x']);
});

test('today: an untimed appointment stays upcoming all day, then is past tomorrow', () => {
  const a = [{ id: 'allday', date: '2026-10-25' }];
  assert.deepEqual(ids(sortAppointments(a, at(23, 59)).upcoming), ['allday']);
  assert.deepEqual(ids(sortAppointments(a, new Date(2026, 9, 26, 0, 0)).past), ['allday']);
});

test('past is most recent first and never mixed into upcoming', () => {
  const appts = [
    { id: 'old', date: '2025-01-01' },
    { id: 'recent', date: '2026-10-24', time: '18:00' },
    { id: 'morning', date: '2026-10-25', time: '08:00' },
    { id: 'next', date: '2026-10-26' },
  ];
  const { upcoming, past } = sortAppointments(appts, at(12));
  assert.deepEqual(ids(past), ['morning', 'recent', 'old']);
  assert.deepEqual(ids(upcoming), ['next']);
});

test('sorting does not reorder or change the stored list', () => {
  const appts = [{ id: 'b', date: '2026-12-01' }, { id: 'a', date: '2026-11-01' }];
  const copy = structuredClone(appts);
  sortAppointments(appts, at(12));
  assert.deepEqual(appts, copy);
});

test('the year boundary sorts by date, not by text of the month', () => {
  const appts = [{ id: 'jan', date: '2027-01-02' }, { id: 'dec', date: '2026-12-31' }];
  assert.deepEqual(ids(sortAppointments(appts, new Date(2026, 11, 30, 9)).upcoming), ['dec', 'jan']);
});

test('groups: Today, This week up to 7 days out, then Later', () => {
  const now = at(9);
  assert.equal(apptGroup({ date: '2026-10-25' }, now), 'Today');
  assert.equal(apptGroup({ date: '2026-10-26' }, now), 'This week');
  assert.equal(apptGroup({ date: '2026-11-01' }, now), 'This week');
  assert.equal(apptGroup({ date: '2026-11-02' }, now), 'Later');
  assert.equal(apptGroup({ date: '2027-10-25' }, now), 'Later');
});

test('the week window crosses month and year ends', () => {
  const now = new Date(2026, 11, 28, 9);
  assert.equal(apptGroup({ date: '2027-01-04' }, now), 'This week');
  assert.equal(apptGroup({ date: '2027-01-05' }, now), 'Later');
});
