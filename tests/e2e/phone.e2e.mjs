// End-to-end check at a Galaxy S23 Ultra viewport (412x915). Run with `npm run test:e2e`.
// Skips itself when no Chrome is found, so `npm test` and machines without Chrome are unaffected.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChrome, launch, startServer } from './cdp.mjs';

const chrome = findChrome();
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
// Lets a test move "today" forward: reads a day offset from localStorage on every page load.
const CLOCK_SHIM = `(() => { const R = Date; const off = () => Number(localStorage.getItem('e2e:dayOffset') || 0) * 864e5;
  class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off()); } static now() { return R.now() + off(); } }
  globalThis.Date = D; })();`;

describe('care-reminder on a phone', { skip: chrome ? false : 'Chrome not found (set CHROME_PATH)' }, () => {
  let server, p, tmp;
  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'care-e2e-files-'));
    server = await startServer();
    p = await launch(chrome);
    await p.send('Page.addScriptToEvaluateOnNewDocument', { source: CLOCK_SHIM });
    await p.goto(server.url);
  });
  after(async () => { await p?.close(); server?.close(); rmSync(tmp, { recursive: true, force: true }); });

  it('sets a PIN, locks, rejects a wrong PIN and unlocks', async () => {
    assert.equal(await p.evaluate(`!document.getElementById('pin2Wrap').hidden`), true, 'first run asks to set a PIN');
    await p.unlock();
    await p.click('#lockBtn');
    await p.waitFor(`!document.getElementById('lock').hidden && document.getElementById('pin2Wrap').hidden`, 'lock screen');
    await p.fill('#pin', '1357');
    await p.evaluate(`document.getElementById('lockForm').requestSubmit()`);
    await p.waitFor(`document.getElementById('lockError').textContent === 'Wrong PIN.'`, 'wrong PIN error');
    assert.equal(await p.evaluate(`document.getElementById('app').hidden`), true);
    await p.unlock();
  });

  const tabs = [
    ['today', { name: 'Vitamin D', amount: '1 tablet', time: '08:00' }],
    ['current', { name: 'Metformin', dose: '500 mg', how: 'Twice a day' }],
    ['schedule', { title: 'Dentist checkup', date: inDays(7), time: '09:30', place: 'Main Street Clinic' }],
    ['meds', { name: 'Fish oil', kind: 'Supplement', dose: '1000 mg' }],
  ];
  for (const [tab, fields] of tabs) {
    it(`adds, edits and deletes an item on the ${tab} tab`, async () => {
      const key = fields.name ?? fields.title;
      const field = fields.name ? 'name' : 'title';
      const panel = (s) => `document.getElementById('tab-${tab}').textContent.includes(${JSON.stringify(s)})`;
      await p.add(tab, fields);
      await p.waitFor(panel(key), `${key} to render`);
      await p.click(`#tab-${tab} [data-act=edit]`);
      await p.submitEditor({ [field]: `${key} edited` });
      await p.waitFor(`${panel(`${key} edited`)}`, 'edited item');
      await p.click(`#tab-${tab} [data-act=del]`);
      await p.waitFor(`!${panel(key)}`, 'item deleted');
    });
  }

  it('clears the check-offs when the day changes', async () => {
    await p.add('today', { name: 'Aspirin', amount: '1 tablet', time: '07:00' });
    await p.click('#tab-today [data-dose]');
    await p.waitFor(`document.querySelector('#tab-today [data-dose]').checked`, 'dose checked');
    await p.evaluate(`localStorage.setItem('e2e:dayOffset', '1')`);
    await p.reload();
    await p.unlock();
    await p.waitFor(`document.querySelector('#tab-today [data-dose]') && !document.querySelector('#tab-today [data-dose]').checked`, 'dose unchecked next day');
    await p.evaluate(`localStorage.removeItem('e2e:dayOffset')`);
    await p.reload();
    await p.unlock();
    await p.waitFor(`document.querySelector('#tab-today [data-dose]').checked`, 'dose still checked on its own day');
  });

  it('exports a backup, resets the app and restores it by import', async () => {
    await p.add('meds', { name: 'Zinc', dose: '15 mg' });
    await p.tab('settings');
    await p.evaluate(`window.__blob = null; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__blob = b; return o(b); };`);
    await p.click('#exportBtn');
    await p.waitFor('window.__blob', 'export blob');
    const file = join(tmp, 'backup.json');
    writeFileSync(file, await p.evaluate('window.__blob.text()'));
    assert.match(readFileSync(file, 'utf8'), /Zinc/);
    await p.click('#resetApp');
    await p.waitFor(`!document.getElementById('lock').hidden && !document.getElementById('pin2Wrap').hidden`, 'reset to setup');
    await p.unlock();
    await p.tab('meds');
    assert.equal(await p.evaluate(`document.getElementById('tab-meds').textContent.includes('Zinc')`), false, 'reset erased data');
    await p.tab('settings');
    await p.setFile('#importFile', file);
    await p.tab('meds');
    await p.waitFor(`document.getElementById('tab-meds').textContent.includes('Zinc')`, 'imported data');
  });

  it('opens offline from the service worker cache', async () => {
    await p.evaluate(`navigator.serviceWorker.ready.then(() => true)`);
    await p.waitFor('navigator.serviceWorker.controller', 'page controlled by the service worker');
    server.close();
    await p.reload();
    await p.unlock();
    assert.equal(await p.evaluate(`document.getElementById('title').textContent`), "Today's pills");
  });
});
