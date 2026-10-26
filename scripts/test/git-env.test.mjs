// Regression: tests and hook checks run from a hook must never touch the real repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutGitEnv } from '../lib/git-env.mjs';
import { checkEnv } from '../hooks/run-checks.mjs';

test('withoutGitEnv drops every GIT_* variable and keeps the rest', () => {
  const env = withoutGitEnv({ GIT_DIR: '/r/.git', GIT_INDEX_FILE: 'i', git_work_tree: 'w', PATH: '/bin', GITHUB_TOKEN: 't' });
  assert.deepEqual(env, { PATH: '/bin', GITHUB_TOKEN: 't' });
});

test('only checks that ask for it get the hook git variables', () => {
  const env = { GIT_INDEX_FILE: '.git/next-index', PATH: '/bin' };
  assert.equal(checkEnv({ name: 'secrets', gitEnv: true }, env).GIT_INDEX_FILE, '.git/next-index');
  assert.equal(checkEnv({ name: 'tests' }, env).GIT_INDEX_FILE, undefined);
});

test('the hooks test leaves the repo named by GIT_DIR alone', () => {
  const decoy = mkdtempSync(join(tmpdir(), 'bod decoy '));
  const git = (...a) => spawnSync('git', ['-C', decoy, ...a], { encoding: 'utf8', env: withoutGitEnv() });
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'owner');
    // What git exports to a pre-push hook in a linked worktree.
    const env = { ...process.env, GIT_DIR: join(decoy, '.git'), GIT_INDEX_FILE: join(decoy, '.git', 'index') };
    delete env.NODE_TEST_CONTEXT; // otherwise the nested node --test does not run its tests
    const hooksTest = fileURLToPath(new URL('./hooks.test.mjs', import.meta.url));
    const r = spawnSync(process.execPath, ['--test', hooksTest], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /# pass [1-9]/, 'the nested hooks tests did not run');
    assert.equal(git('config', 'user.name').stdout.trim(), 'owner', 'user.name was overwritten');
    assert.notEqual(git('config', 'core.bare').stdout.trim(), 'true', 'core.bare was set');
    assert.equal(git('symbolic-ref', 'HEAD').stdout.trim(), 'refs/heads/main', 'HEAD was moved');
  } finally {
    rmSync(decoy, { recursive: true, force: true });
  }
});
