// BEST-OF-AI-DEV template v1. Run with: node scripts/test/run.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compare, stripRepoSpecific } from '../check/template-sync.mjs';

/** A temp folder that is deleted when the test ends, pass or fail. */
function scratch(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('block form hides repo-specific text', () => {
  const a = 'x\n<!-- REPO-SPECIFIC: hint -->\nplaceholder\n<!-- /REPO-SPECIFIC -->\ny';
  const b = 'x\n<!-- REPO-SPECIFIC: hint -->\nreal content\nmore\n<!-- /REPO-SPECIFIC -->\ny';
  assert.equal(stripRepoSpecific(a), stripRepoSpecific(b));
});

test('tail form hides everything after the marker', () => {
  const a = '.env\n# REPO-SPECIFIC-BELOW: add entries\n';
  const b = '.env\n# REPO-SPECIFIC-BELOW: add entries\ndist-local/\n';
  assert.equal(stripRepoSpecific(a), stripRepoSpecific(b));
});

test('CRLF and LF compare equal', () => {
  assert.equal(stripRepoSpecific('a\r\nb'), stripRepoSpecific('a\nb'));
});

test('compare reports missing and drifted files, and skips optional ones', (t) => {
  const root = scratch(t, 'bod-sync-');
  const tpl = join(root, 'template');
  mkdirSync(join(tpl, 'sub'), { recursive: true });
  writeFileSync(join(tpl, 'same.md'), 'a');
  writeFileSync(join(tpl, 'sub', 'gone.md'), 'b');
  writeFileSync(join(tpl, 'edited.md'), 'c');
  writeFileSync(join(tpl, 'GEMINI.md'), 'optional');
  writeFileSync(join(root, 'same.md'), 'a');
  writeFileSync(join(root, 'edited.md'), 'changed');
  assert.deepEqual(compare(tpl, root), ['differs: edited.md', 'missing: sub/gone.md']);
});

test('compare skips prefixes the repo provides another way', (t) => {
  const tpl = scratch(t, 'bod-skip-t-');
  const r = scratch(t, 'bod-skip-r-');
  mkdirSync(join(tpl, 'scripts'));
  writeFileSync(join(tpl, 'scripts', 'x.mjs'), 'x');
  assert.deepEqual(compare(tpl, r), ['missing: scripts/x.mjs']);
  assert.deepEqual(compare(tpl, r, ['scripts/']), []);
});

test('seeded files must exist but may differ', (t) => {
  const root = scratch(t, 'bod-sync-seed-');
  const tpl = join(root, 'template');
  mkdirSync(tpl, { recursive: true });
  writeFileSync(join(tpl, 'package.json'), '{"name":"your-repo"}');
  assert.deepEqual(compare(tpl, root), ['missing: package.json']);
  writeFileSync(join(root, 'package.json'), '{"name":"real","dependencies":{}}');
  assert.deepEqual(compare(tpl, root), []);
});
