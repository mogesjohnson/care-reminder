// End-to-end: a throwaway repo (with a space in its path, like a Windows user folder)
// gets the hooks, rejects a bad commit, accepts a good one, and the size gate counts lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutGitEnv } from '../lib/git-env.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

// withoutGitEnv: when this runs from a pre-push hook, GIT_DIR points at the real repo.
function run(cwd, cmd, args, env = {}) {
  // CI is cleared because setup-hooks.mjs skips itself in CI, and GITHUB_ACTIONS because
  // pr-size ignores SIZE_EXCEPTION there.
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...withoutGitEnv(), CI: '', GITHUB_ACTIONS: '', ...env } });
}

test('hooks and size gate work in a fresh repo with a spaced path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bod hooks '));
  try {
    cpSync(join(root, '.githooks'), join(dir, '.githooks'), { recursive: true });
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true });
    const g = (...a) => run(dir, 'git', a);
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 'test@example.invalid');
    g('config', 'user.name', 'test');
    assert.equal(run(dir, process.execPath, ['scripts/setup-hooks.mjs']).status, 0);
    assert.equal(g('config', 'core.hooksPath').stdout.trim(), '.githooks');

    writeFileSync(join(dir, 'leak.txt'), 'key=' + 'AKIA' + 'Q'.repeat(16) + '\n');
    g('add', '-A');
    const leak = run(dir, 'git', ['commit', '-q', '-m', 'chore: add scripts'], { SECRETS_SKIP_GITLEAKS: '1' });
    assert.notEqual(leak.status, 0, 'a staged secret must block the commit');
    assert.match(leak.stderr, /leak\.txt:1: AWS access key/);
    g('rm', '-q', '-f', 'leak.txt');
    const bad = g('commit', '-q', '-m', 'Added the scripts.');
    assert.notEqual(bad.status, 0, 'bad subject must be rejected');
    assert.match(bad.stderr, /commit-msg: rejected/);
    const good = g('commit', '-q', '-m', 'chore: add scripts');
    assert.equal(good.status, 0, good.stderr);

    g('switch', '-q', '-c', 'feat');
    writeFileSync(join(dir, 'a.txt'), 'x\n'.repeat(700));
    writeFileSync(join(dir, 'package-lock.json'), '{}\n'.repeat(5000));
    g('add', '-A');
    const big = g('commit', '-q', '-m', 'feat: add a big file');
    assert.equal(big.status, 0, big.stderr);
    const size = (env) => run(dir, process.execPath, ['scripts/check/pr-size.mjs', '--base', 'main'], env);
    const over = size({ SIZE_EXCEPTION: '' });
    assert.equal(over.status, 1);
    assert.match(over.stdout, /700 changed lines .* 1 excluded/);
    assert.equal(size({ SIZE_EXCEPTION: 'test of the exception path' }).status, 0);
    // pre-push input names the branch being pushed; it is checked even when HEAD is elsewhere.
    const feat = g('rev-parse', 'feat').stdout.trim();
    g('switch', '-q', 'main');
    const pushed = spawnSync(process.execPath, ['scripts/check/pr-size.mjs', '--base', 'main', '--stdin-refs'], {
      cwd: dir, encoding: 'utf8', env: { ...withoutGitEnv(), CI: '', GITHUB_ACTIONS: '' },
      input: `refs/heads/feat ${feat} refs/heads/feat ${'0'.repeat(40)}\n`,
    });
    assert.equal(pushed.status, 1, pushed.stdout);
    assert.match(pushed.stdout, /\[feat\]: 700 changed lines/);
    const first = run(dir, process.execPath, ['scripts/check/pr-size.mjs']);
    assert.equal(first.status, 2, 'no origin/main yet: blocked, not failed');
    assert.equal(first.stderr.trim().split('\n').length, 1, `one line, not a git stack: ${first.stderr}`);
    const usage = run(dir, process.execPath, ['scripts/check/pr-size.mjs', '--base']);
    assert.equal(usage.status, 2, 'a missing --base value is a usage error, not a git error');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('setup-hooks fails loudly but keeps .githooks when lefthook is missing', (t) => {
  if (spawnSync('lefthook', ['version'], { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0) {
    t.skip('lefthook is installed here');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'bod lefthook '));
  try {
    cpSync(join(root, '.githooks'), join(dir, '.githooks'), { recursive: true });
    cpSync(join(root, 'scripts'), join(dir, 'scripts'), { recursive: true });
    cpSync(join(root, 'optional', 'lefthook.yml'), join(dir, 'lefthook.yml'));
    run(dir, 'git', ['init', '-q', '-b', 'main']);
    const r = run(dir, process.execPath, ['scripts/setup-hooks.mjs']);
    assert.equal(r.status, 1, 'a missing lefthook must not pass silently');
    assert.match(r.stderr, /lefthook is not installed/);
    assert.match(r.stderr, /R3/);
    assert.doesNotMatch(r.stderr + r.stdout, /npm i -D lefthook/);
    assert.equal(run(dir, 'git', ['config', 'core.hooksPath']).stdout.trim(), '.githooks', 'hooks stay active');
    const ci = run(dir, process.execPath, ['scripts/setup-hooks.mjs'], { CI: 'true' });
    assert.equal(ci.status, 0);
    assert.match(ci.stdout, /CI is set, skipped/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
