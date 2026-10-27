// Zero-dependency Chrome DevTools Protocol driver for the phone e2e tests (Node 22+: global fetch and WebSocket).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, extname, join, normalize, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
export const ROOT = resolve(import.meta.dirname, '../..');
export const PIN = '2468';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  const fixed = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  const onPath = (process.env.PATH ?? '').split(delimiter).flatMap((d) => names.map((n) => join(d, n)));
  return [...fixed, ...onPath].find((p) => p && existsSync(p));
}

/** Serves the repo root on 127.0.0.1 (a secure context, so the service worker and crypto.subtle work). */
export async function startServer() {
  const server = createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html');
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT + sep) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => { server.closeAllConnections(); if (server.listening) server.close(); } };
}

/** Launches headless Chrome with a phone viewport and returns helpers bound to one page. */
export async function launch(chromePath, { width = 412, height = 915, scale = 3.5 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'care-e2e-'));
  const proc = spawn(chromePath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise((ok, fail) => {
    let log = '';
    proc.stderr.on('data', (d) => { log += d; const m = /ws:\/\/127\.0\.0\.1:(\d+)\//.exec(log); if (m) ok(m[1]); });
    proc.on('exit', () => fail(new Error(`Chrome exited early:\n${log}`)));
  });
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map(); const handlers = {};
  ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result); } else handlers[m.method]?.(m.params);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, what = expression, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (await evaluate(`Boolean(${expression})`).catch(() => false)) return;
    throw new Error(`Timed out waiting for ${what}`);
  };
  const loaded = `document.readyState === 'complete' && document.getElementById('lock')`;
  const dialogs = [];
  handlers['Page.javascriptDialogOpening'] = (p) => { dialogs.push(p.message); send('Page.handleJavaScriptDialog', { accept: true }); };
  await Promise.all(['Page', 'Runtime', 'DOM', 'Network'].map((d) => send(`${d}.enable`)));
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: true });
  await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });

  const q = JSON.stringify;
  const page = {
    send, evaluate, waitFor, dialogs,
    goto: async (url) => { await send('Page.navigate', { url }); await waitFor(loaded, 'page load'); },
    reload: async () => { await send('Page.reload'); await waitFor(loaded, 'reload'); },
    click: (sel) => evaluate(`document.querySelector(${q(sel)}).click()`),
    fill: (sel, value) => evaluate(`(() => { const e = document.querySelector(${q(sel)}); e.value = ${q(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`),
    text: (sel) => evaluate(`document.querySelector(${q(sel)}).textContent`),
    async screenshot(file) { writeFileSync(file, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); },
    async setFile(sel, file) {
      const { root } = await send('DOM.getDocument');
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
      await send('DOM.setFileInputFiles', { nodeId, files: [file] });
    },
    async close() { ws.close(); proc.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); },
  };

  /** App helpers: PIN setup or unlock, tab switching, and the shared add form flow. */
  page.unlock = async () => {
    if (await evaluate(`!document.getElementById('pin2Wrap').hidden`)) await page.fill('#pin2', PIN);
    await page.fill('#pin', PIN);
    await evaluate(`document.getElementById('lockForm').requestSubmit()`);
    await waitFor(`!document.getElementById('app').hidden`, 'app to unlock');
  };
  page.tab = async (name) => { await page.click(`[data-tab=${name}]`); await waitFor(`!document.getElementById('tab-${name}').hidden`, `${name} tab`); };
  page.submitEditor = async (fields) => {
    await waitFor(`document.getElementById('editor').open`, 'editor to open');
    for (const [name, value] of Object.entries(fields)) await page.fill(`#editorForm [name=${name}]`, value);
    await evaluate(`document.getElementById('editorForm').requestSubmit()`);
    await waitFor(`!document.getElementById('editor').open`, 'editor to close');
  };
  page.add = async (tab, fields) => { await page.tab(tab); await page.click(`#tab-${tab} [data-act=add]`); await page.submitEditor(fields); };
  return page;
}
