// BEST-OF-AI-DEV template v1. Run with: node scripts/test/run.mjs
// Tests scripts/check/gate.mjs, the runner every pr-checks gate goes through (RULES.md R15),
// in scratch repos. Plain node and git, so it runs the same on Windows and Linux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutGitEnv } from '../lib/git-env.mjs';

const gateFile = fileURLToPath(new URL('../check/gate.mjs', import.meta.url));
const workflows = ['../../.github/workflows/pr-checks.yml', '../../../.github/workflows/pr-checks.yml']
  .map((p) => fileURLToPath(new URL(p, import.meta.url)))
  // The second path is BEST-OF-AI-DEV's root copy; a repo made from the template has only one.
  .filter((p, i) => i === 0 || existsSync(p));

const PASS = 'process.exit(0);\n';
const FAIL = 'process.exit(1);\n';

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: withoutGitEnv() });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

// Base: strict.mjs and other.mjs both fail. The head commit applies `head` on top.
function scratch(head) {
  const dir = mkdtempSync(join(tmpdir(), 'bod-gate-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'test');
  const check = join(dir, 'scripts', 'check');
  mkdirSync(check, { recursive: true });
  writeFileSync(join(check, 'strict.mjs'), FAIL);
  writeFileSync(join(check, 'other.mjs'), FAIL);
  writeFileSync(join(check, 'ok.mjs'), PASS);
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  const base = git(dir, 'rev-parse', 'HEAD');
  // What the workflow's `git archive` step extracts.
  const baseChecks = join(dir, 'tmp', 'base');
  mkdirSync(baseChecks, { recursive: true });
  for (const f of ['strict.mjs', 'other.mjs', 'ok.mjs']) writeFileSync(join(baseChecks, f), readFileSync(join(check, f)));
  for (const [file, text] of Object.entries(head)) writeFileSync(join(dir, file), text);
  git(dir, 'add', '--', ...Object.keys(head));
  git(dir, 'commit', '-qm', 'head');
  return { dir, base, head: git(dir, 'rev-parse', 'HEAD'), baseChecks };
}

function gate({ head, checker, labels = '', body = '' }) {
  const repo = scratch(head);
  try {
    const r = spawnSync(process.execPath, [gateFile, checker], {
      cwd: repo.dir,
      encoding: 'utf8',
      env: {
        ...withoutGitEnv(),
        BASE_SHA: repo.base,
        HEAD_SHA: repo.head,
        SCRIPTS: 'scripts',
        BASE_CHECKS: repo.baseChecks,
        PR_LABELS: labels,
        PR_BODY: body,
      },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
}

const loosen = { 'scripts/check/strict.mjs': PASS };
const LINE = 'x\nChecker change: loosen strict';

test('without the label, a PR that loosens a checker still gets the base copy', () => {
  assert.equal(gate({ head: loosen, checker: 'strict.mjs' }).status, 1);
});

test('label, line and a diff to that checker turn its failure into a warning', () => {
  const r = gate({ head: loosen, checker: 'strict.mjs', labels: 'docs,checker-change', body: LINE });
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /::warning::checker-change/);
});

test('the label does not soften a checker the PR leaves alone', () => {
  const r = gate({ head: loosen, checker: 'other.mjs', labels: 'checker-change', body: LINE });
  assert.equal(r.status, 1, r.out);
});

test('the PR copy of the changed checker must pass too', () => {
  const r = gate({ head: { 'scripts/check/strict.mjs': 'process.exit(3);\n' }, checker: 'strict.mjs', labels: 'checker-change', body: LINE });
  assert.equal(r.status, 3, r.out);
});

test('the label without a Checker change line fails, even on a passing gate', () => {
  const r = gate({ head: loosen, checker: 'ok.mjs', labels: 'checker-change', body: 'no reason' });
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /::error::/);
});

test('the label on a PR that changes no checker fails', () => {
  const r = gate({ head: { 'README.md': 'x\n' }, checker: 'ok.mjs', labels: 'checker-change', body: LINE });
  assert.equal(r.status, 1, r.out);
});

test('a passing base checker passes', () => {
  assert.equal(gate({ head: { 'README.md': 'x\n' }, checker: 'ok.mjs' }).status, 0);
});

for (const wf of workflows) {
  test(`${relative(process.cwd(), wf)}: sends every gate through the base gate.mjs`, () => {
    const text = readFileSync(wf, 'utf8');
    const runs = text.split(/\r?\n/).filter((l) => /^\s*run: node /.test(l));
    assert.ok(runs.length >= 3, 'expected the gate steps');
    for (const l of runs) assert.match(l, /run: node "\$GATE" [\w-]+\.mjs/, l);
    assert.match(text, /GATE=\$RUNNER_TEMP\/base\/\$SCRIPTS\/check\/gate\.mjs/);
  });
}
