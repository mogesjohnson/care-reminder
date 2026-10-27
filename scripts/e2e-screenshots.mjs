// Writes docs/screenshots/{today,current,schedule,meds,settings}.png at 412x915 using example data only.
// Run with `npm run screenshots`. Needs Chrome (set CHROME_PATH if it is not found).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findChrome, launch, ROOT, startServer } from '../tests/e2e/cdp.mjs';

const chrome = findChrome();
if (!chrome) { console.error('Chrome not found. Set CHROME_PATH to its executable.'); process.exit(1); }
const out = join(ROOT, 'docs', 'screenshots');
mkdirSync(out, { recursive: true });
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const server = await startServer();
const p = await launch(chrome, { scale: 1 });
try {
  await p.goto(server.url);
  await p.unlock();
  for (const d of [{ name: 'Vitamin D 1000 IU', amount: '1 capsule', time: '08:00' }, { name: 'Multivitamin', amount: '1 tablet', time: '08:00' }, { name: 'Fish oil', amount: '2 softgels', time: '20:00' }]) await p.add('today', d);
  await p.click('#tab-today [data-dose]');
  await p.add('current', { name: 'Vitamin D 1000 IU', kind: 'Supplement', dose: '1000 IU', how: 'Every morning' });
  await p.add('current', { name: 'Sample medication', dose: '10 mg', how: 'Once a day with food' });
  await p.add('schedule', { title: 'Dentist checkup', date: inDays(3), time: '09:30', place: 'Main Street Clinic' });
  await p.add('schedule', { title: 'Annual checkup', date: inDays(30), time: '14:00', place: 'Example Health Center' });
  await p.add('meds', { name: 'Fish oil', kind: 'Supplement', dose: '1000 mg', how: 'Evening' });
  for (const tab of ['today', 'current', 'schedule', 'meds', 'settings']) {
    await p.tab(tab);
    await p.evaluate(`new Promise((r) => setTimeout(r, 400))`);
    await p.screenshot(join(out, `${tab}.png`));
    console.log(`saved docs/screenshots/${tab}.png`);
  }
} finally {
  await p.close();
  server.close();
}
