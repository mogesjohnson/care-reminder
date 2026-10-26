import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addedLines, scanLines } from '../check/secrets.mjs';
import { withoutGitEnv } from '../lib/git-env.mjs';

// Fake values are assembled at runtime so this file never contains one.
const fake = {
  github: 'ghp' + '_' + 'a'.repeat(36),
  aws: 'AKIA' + 'B'.repeat(16),
  xai: 'xai' + '-' + 'c'.repeat(44),
  jwt: 'eyJ' + 'a'.repeat(20) + '.eyJ' + 'b'.repeat(30) + '.' + 'c'.repeat(30),
  pem: '-----BEGIN ' + 'RSA PRIVATE KEY-----',
};

const scan = (text, file = 'src/a.ts') => scanLines(file, [[1, text]]).map((f) => f.rule);

test('catches common token shapes', () => {
  for (const [kind, value] of Object.entries(fake)) assert.equal(scan(`const k = "${value}";`).length, 1, kind);
});

test('catches personal paths but not placeholders', () => {
  const users = 'Users';
  assert.deepEqual(scan(`cd C:\\${users}\\Jane Doe\\code`), ['personal Windows path']);
  assert.deepEqual(scan(`see /${users}/jane/dev/x`), ['personal home path']);
  assert.deepEqual(scan('cd C:\\Users\\<you>\\code'), []);
  assert.deepEqual(scan('personal paths (`C:\\Users\\...`)'), []);
  assert.deepEqual(scan('runs-on /home/runner/work'), []);
  const home = 'home';
  for (const p of [`/${users}/Jane/dev`, `/${users.toUpperCase()}/jane/x`, `/${home}/Bob/src`, `/${home}/userbob/x`, `"/${home}/jane.doe/x"`]) {
    assert.deepEqual(scan(`cd ${p}`), ['personal home path'], p);
  }
  for (const p of [`/${home}/user/x`, `/${home}/Runner/work`, `/${users}/<you>/x`, `/${home}/$USER/x`]) {
    assert.deepEqual(scan(`cd ${p}`), [], p);
  }
  assert.deepEqual(scan('path: "$env:USERPROFILE\\code"'), []);
});

test('flags files that should never be committed', () => {
  assert.equal(scanLines('.env', []).length, 1);
  assert.equal(scanLines('apps/api/.env.local', []).length, 1);
  assert.equal(scanLines('certs/server.pem', []).length, 1);
  assert.equal(scanLines('.env.example', []).length, 0);
  assert.equal(scanLines('Certs/Server.P12', []).length, 1, 'case-insensitive');
  assert.equal(scanLines('.ENV', []).length, 1, 'case-insensitive');
  assert.equal(scanLines('.env.Example', []).length, 0);
});

test('gitleaks:allow skips a known test value', () => {
  assert.deepEqual(scan(`const k = "${fake.aws}"; // gitleaks:allow`), []);
});

test('reads only added lines with their numbers from a -U0 diff', () => {
  const diff = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -3,0 +4,2 @@', '+one', '-gone', '+two'].join('\n');
  assert.deepEqual(addedLines(diff, ['x']).get('x'), [[4, 'one'], [5, 'two']]);
});

test('an added line that starts with "++ " is content, not a header', () => {
  const diff = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -0,0 +1,2 @@', '+++ token', '+--- rule'].join('\n');
  assert.deepEqual(addedLines(diff, ['x']).get('x'), [[1, '++ token'], [2, '--- rule']]);
});

test('names come from the -z list: spaces, binary and empty files', () => {
  const diff = [
    'diff --git a/my file.txt b/my file.txt', 'new file mode 100644', '--- /dev/null', '+++ b/my file.txt\t', '@@ -0,0 +1 @@', '+hi',
    'diff --git a/cert.p12 b/cert.p12', 'new file mode 100644', 'Binary files /dev/null and b/cert.p12 differ',
    'diff --git a/.env b/.env', 'new file mode 100644', 'index 0000000..e69de29',
  ].join('\n');
  const files = addedLines(diff, ['my file.txt', 'cert.p12', '.env']);
  assert.deepEqual([...files.keys()], ['my file.txt', 'cert.p12', '.env']);
  assert.deepEqual(files.get('my file.txt'), [[1, 'hi']]);
  assert.throws(() => addedLines(diff, ['my file.txt']), /more files/);
});

test('--staged blocks secret files even when binary or empty, and odd names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bod secrets '));
  const env = { ...withoutGitEnv(), SECRETS_SKIP_GITLEAKS: '1' };
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8', env });
  try {
    git('init', '-q');
    writeFileSync(join(dir, 'cert.p12'), Buffer.from([0x30, 0x82, 0, 0, 1, 2]));
    writeFileSync(join(dir, '.env'), '');
    writeFileSync(join(dir, 'my notes.txt'), '++ ' + fake.aws + '\n');
    writeFileSync(join(dir, 'clean.txt'), 'nothing here\n');
    git('add', '-A');
    const script = fileURLToPath(new URL('../check/secrets.mjs', import.meta.url));
    const r = spawnSync(process.execPath, [script, '--staged'], { cwd: dir, encoding: 'utf8', env });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /secrets: cert\.p12: file that should never be committed/);
    assert.match(r.stderr, /secrets: \.env: file that should never be committed/);
    assert.match(r.stderr, /secrets: my notes\.txt:1: AWS access key/);
    assert.doesNotMatch(r.stderr, /clean\.txt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
