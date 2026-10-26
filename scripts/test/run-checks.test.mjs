import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, verdict } from '../hooks/run-checks.mjs';

test('the floor checks always run first and use the scripts dir', () => {
  const pre = plan('pre-commit', 'template/scripts');
  assert.equal(pre[0].name, 'secrets');
  assert.equal(pre[0].run, 'node template/scripts/check/secrets.mjs --staged');
  assert.equal(plan('pre-push', 'scripts')[0].name, 'pr size');
  assert.deepEqual(plan('post-merge', 'scripts'), []);
});

test('only a declared blocked code counts as blocked', () => {
  assert.equal(verdict({}, 0), 'pass');
  assert.equal(verdict({}, 2), 'fail', 'eslint exits 2 on config errors; that must fail');
  assert.equal(verdict({ blockedExit: 2 }, 2), 'blocked');
  assert.equal(verdict({ blockedExit: 2 }, 1), 'fail');
});
