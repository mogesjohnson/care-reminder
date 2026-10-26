// Windows PowerShell 5.1 cannot be run in CI or on most agent boxes, so this catches the
// common breakages statically. test-windows.ps1 is the real test, on a Windows machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.ps1'));

/** Drops comments and string literals, roughly, so only code is checked. */
export function codeOnly(src) {
  return src
    .replace(/<#[\s\S]*?#>/g, '')
    .replace(/'[^'\n]*'/g, "''")
    .replace(/"(?:`.|[^"`\n])*"/g, '""')
    .replace(/#.*$/gm, '');
}

test('there are PowerShell scripts to check', () => {
  assert.ok(files.length >= 3, `found ${files.join(', ')}`);
});

for (const f of files) {
  test(`${f} stays Windows PowerShell 5.1 compatible`, () => {
    const raw = readFileSync(new URL(f, dir));
    // 5.1 reads a file without a BOM as the ANSI code page, which garbles non-ASCII text.
    const bad = raw.findIndex((b) => b > 0x7f);
    assert.equal(bad, -1, `non-ASCII byte at offset ${bad}`);
    const code = codeOnly(raw.toString('utf8'));
    for (const [re, why] of [
      [/&&|\|\|/, 'pipeline chain operators (&& ||) need PowerShell 7'],
      [/\?\?/, 'null-coalescing (??) needs PowerShell 7'],
      [/\?\./, 'null-conditional member access (?.) needs PowerShell 7'],
      [/ForEach-Object\s+-Parallel/i, 'ForEach-Object -Parallel needs PowerShell 7'],
    ]) {
      assert.doesNotMatch(code, re, why);
    }
  });
}

test('codeOnly ignores operators inside strings and comments', () => {
  assert.doesNotMatch(codeOnly('# a && b\n$x = "c && d"\n$y = \'e ?? f\''), /&&|\?\?/);
  assert.match(codeOnly('git fetch && git pull'), /&&/);
});
