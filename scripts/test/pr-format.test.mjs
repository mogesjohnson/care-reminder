import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkBody, isRevertPr, parseLog, SECTIONS } from '../check/pr-format.mjs';
import { checkMessage, PR_EXEMPT } from '../check/commit-format.mjs';
import { withoutGitEnv } from '../lib/git-env.mjs';

const filled = `## Summary\n\nAdds x.\n\nTracking: none\n\n## Validation\n\n- pass: \`npm test\`\n- blocked: Actions billing\n\n## Size\n\npr-size: 10\n\n## Review checklist\n\n- [x] ok\n\n## Risks and follow-ups\n\nnone\n`;

test('a filled-in template body passes', () => {
  assert.deepEqual(checkBody(filled), []);
});

const template = readFileSync(new URL('../../.github/pull_request_template.md', import.meta.url), 'utf8');

test('the untouched PR template fails on every placeholder', () => {
  const problems = checkBody(template).join('\n');
  assert.match(problems, /Tracking:/);
  assert.match(problems, /at least one/);
  for (const s of ['Summary', 'Size', 'Risks and follow-ups']) assert.match(problems, new RegExp(`## ${s}" is still the template`));
});

test('adding only "Tracking: none" to the template is not enough', () => {
  const lazy = template.replace(/^Tracking:.*$/m, 'Tracking: none');
  assert.ok(checkBody(lazy).length >= 3, checkBody(lazy).join());
});

test('a status line needs evidence', () => {
  assert.match(checkBody(filled.replace('- blocked: Actions billing', '- not_run:')).join(), /no command or evidence/);
});

test('missing sections, status lines and closing keywords are reported', () => {
  assert.equal(checkBody('fixed it').length, SECTIONS.length + 2);
  assert.match(checkBody(filled.replace('- pass:', 'pass:').replace('- blocked:', 'blocked:')).join(), /at least one/);
  const moved = filled.replace('- pass: `npm test`\n- blocked: Actions billing', 'tested').replace('none\n', '- pass: in the wrong section\n');
  assert.match(checkBody(moved).join(), /at least one/, 'status lines must sit under Validation');
  assert.match(checkBody(`${filled}\nCloses #4`).join(), /closing keyword/);
  assert.deepEqual(checkBody(`${filled}\n<!-- closes #4 in a comment is ignored -->`), []);
  assert.deepEqual(checkBody(`${filled}\nIt rejects \`closes #12\` in commits.`), [], 'quoted examples are fine');
});

test('parses git log records', () => {
  const out = 'abc\0feat: a\n\nbody\n\x1e\ndef\0fix: b\n\x1e\n';
  assert.deepEqual(parseLog(out), [{ sha: 'abc', message: 'feat: a\n\nbody\n' }, { sha: 'def', message: 'fix: b\n' }]);
});

const script = fileURLToPath(new URL('../check/pr-format.mjs', import.meta.url));
const gate = (env) => spawnSync(process.execPath, [script, '--base', 'HEAD'], { encoding: 'utf8', env: { ...withoutGitEnv(), ...env } });

test('Dependabot PRs are skipped; others with its title are not', () => {
  const title = 'Bump lodash from 4.17.20 to 4.17.21';
  assert.equal(gate({ PR_AUTHOR: 'dependabot[bot]', PR_TITLE: title, PR_BODY: 'Bumps lodash.' }).status, 0);
  assert.equal(gate({ PR_AUTHOR: 'someone', PR_TITLE: title, PR_BODY: 'Bumps lodash.' }).status, 1);
});

const sha = 'a'.repeat(40);
const rev = { sha, message: `Revert "feat: add x"\n\nThis reverts commit ${sha}.\n` };
const plain = { sha, message: 'feat: add y\n\nRefs: #1\n' };

test('the revert exemption needs the title, the exact body and only revert commits', () => {
  const t = 'Revert "feat: add x"';
  assert.equal(isRevertPr(t, 'Reverts owner/repo#12', [rev], 'owner/repo'), true);
  assert.equal(isRevertPr(t, 'Reverts owner/repo#12\r\n', [rev], undefined), true, 'no repo known locally');
  assert.equal(isRevertPr('feat: add x', 'Reverts owner/repo#12', [rev], 'owner/repo'), false, 'needs a revert title');
  assert.equal(isRevertPr(t, 'Reverts owner/repo#12\n\nAlso adds y.', [rev], 'owner/repo'), false, 'body must be only the line');
  assert.equal(isRevertPr(t, 'Reverts other/repo#12', [rev], 'owner/repo'), false, 'must name this repo');
  assert.equal(isRevertPr(t, 'Reverts owner/repo#12', [rev, plain], 'owner/repo'), false, 'every commit must be a revert');
  assert.equal(isRevertPr(t, 'Reverts owner/repo#12', [], 'owner/repo'), false, 'no commits, no exemption');
  const sha256 = { sha, message: `Revert "feat: add x"\n\nThis reverts commit ${'b'.repeat(64)}.\n` };
  assert.equal(isRevertPr(t, 'Reverts owner/repo#12', [sha256], 'owner/repo'), true, 'SHA-256 repos too');
  const short = { sha, message: 'Revert "feat: add x"\n\nThis reverts commit abc1234.\n' };
  assert.equal(isRevertPr(t, 'Reverts owner/repo#12', [short], 'owner/repo'), false, 'a short sha is hand-written');
  const merge = { sha, message: `Revert "Merge pull request #12"\n\nThis reverts commit ${sha}, reversing\nchanges made to ${'c'.repeat(40)}.\n` };
  assert.equal(isRevertPr(t, 'Reverts owner/repo#12', [merge], 'owner/repo'), true, 'a reverted merge commit');
  const seen = [];
  const verify = (c, s) => (seen.push(s), false);
  assert.equal(isRevertPr(t, 'Reverts owner/repo#12', [rev], 'owner/repo', verify), false, 'git must confirm it');
  assert.deepEqual(seen, [sha]);
});

test('the revert exemption checks the reverted sha and the diff against git', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bod-revert-merge-'));
  try {
    const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: dir, env: withoutGitEnv(), encoding: 'utf8' }).trim();
    g('init', '-q', '-b', 'main');
    g('commit', '-q', '--allow-empty', '-m', 'chore: start', '-m', 'Refs: #1');
    g('switch', '-q', '-c', 'feat');
    writeFileSync(join(dir, 'x.txt'), 'x');
    g('add', 'x.txt');
    g('commit', '-q', '-m', 'feat: add x', '-m', 'Refs: #1');
    g('switch', '-q', 'main');
    g('merge', '-q', '--no-ff', '-m', 'Merge pull request #12 from owner/feat', 'feat');
    const merged = g('rev-parse', 'HEAD');
    const run = (base) => spawnSync(process.execPath, [script, '--base', base], { cwd: dir, encoding: 'utf8', env: { ...withoutGitEnv(), PR_TITLE: 'Revert "Merge pull request #12 from owner/feat"', PR_BODY: 'Reverts owner/repo#13', GITHUB_REPOSITORY: 'owner/repo' } });
    g('switch', '-q', '-c', 'real', merged);
    g('revert', '--no-edit', '-m', '1', merged);
    const real = run(merged);
    assert.equal(real.status, 0, `a real revert of a merged PR: ${real.stderr}\n${g('log', '-1', '--format=%B')}`);
    const forge = (name, file, target) => {
      g('switch', '-q', '-c', name, merged);
      writeFileSync(join(dir, file), 'y');
      g('add', file);
      g('commit', '-q', '-m', 'Revert "Merge pull request #12 from owner/feat"', '-m', `This reverts commit ${target}.`);
      return run(merged);
    };
    assert.equal(forge('other-diff', 'y.txt', merged).status, 1, 'the diff must undo the named commit');
    assert.equal(forge('no-such-sha', 'z.txt', 'c'.repeat(40)).status, 1, 'the named commit must be on the base');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a real git revert passes the gate with the generated body', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bod-revert-'));
  try {
    const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { cwd: dir, env: withoutGitEnv(), encoding: 'utf8' });
    g('init', '-q', '-b', 'main');
    g('commit', '-q', '--allow-empty', '-m', 'chore: start', '-m', 'Refs: #1');
    writeFileSync(join(dir, 'x.txt'), 'x');
    g('add', '.');
    g('commit', '-q', '-m', 'feat: add x', '-m', 'Refs: #1');
    g('revert', '--no-edit', 'HEAD');
    const run = (env, base = 'HEAD~1') => spawnSync(process.execPath, [script, '--base', base], { cwd: dir, encoding: 'utf8', env: { ...withoutGitEnv(), ...env } });
    assert.equal(run({ PR_TITLE: 'Revert "feat: add x"', PR_BODY: 'Reverts owner/repo#12', GITHUB_REPOSITORY: 'owner/repo' }).status, 0);
    const two = run({ PR_TITLE: 'Revert "feat: add x"', PR_BODY: 'Reverts owner/repo#12' }, 'HEAD~2');
    assert.equal(two.status, 1, 'a non-revert commit in the PR brings the body check back');
    assert.match(two.stderr, /Summary/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the PR gate rejects fixup!, squash! and Merge subjects', () => {
  for (const s of ['fixup! feat: add x', 'squash! feat: add x', 'Merge branch main into feat']) {
    assert.notDeepEqual(checkMessage(s, '#', PR_EXEMPT), [], s);
    assert.deepEqual(checkMessage(s), [], `${s} is still fine locally`);
  }
  assert.deepEqual(checkMessage('Revert "feat: add x"', '#', PR_EXEMPT), []);
});
