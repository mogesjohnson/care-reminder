// Care Reminder UI. All data lives in this browser's localStorage; nothing leaves the device.
import { apptGroup, checksFor, dateKey, makeBackup, parseBackup, sortAppointments, sortDoses, toggleCheck, validPin } from './logic.js';
import { loadData, persistStatus, readAuth, resetApp, setPin, trySaveData, verifyPin } from './store.js';

const $ = (id) => document.getElementById(id);
let data = loadData(localStorage);
let showPast = false;
let persisted = null;

// A failed write keeps the old data, re-renders to undo the UI change, and shows why.
function save(next) { const ok = trySaveData(localStorage, next, (msg) => toast(msg, 5000)); if (ok) data = next; render(); return ok; }
const uid = () => crypto.randomUUID();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer;
function toast(msg, ms = 1800) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }
const fmtTime = (t) => (t ? new Date(`2000-01-01T${t}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
const fmtDate = (d) => new Date(`${d}T00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

// ---- Lock screen ----
function showLock() {
  const setup = !readAuth(localStorage);
  $('app').hidden = true; $('lock').hidden = false;
  $('lockHint').textContent = setup ? 'Choose a 4 to 8 digit PIN for this device.' : 'Enter your PIN to open.';
  $('pinLabel').textContent = setup ? 'New PIN' : 'PIN';
  $('pin2Wrap').hidden = !setup; $('pin2').required = setup;
  $('lockSubmit').textContent = setup ? 'Set PIN' : 'Unlock';
  $('pin').value = ''; $('pin2').value = ''; $('lockError').textContent = '';
}
function unlock() { $('lock').hidden = true; $('app').hidden = false; render(); }
$('lockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('pin').value;
  if (!validPin(pin)) { $('lockError').textContent = 'Use 4 to 8 digits.'; return; }
  if (!readAuth(localStorage)) {
    if (pin !== $('pin2').value) { $('lockError').textContent = 'The PINs do not match.'; return; }
    await setPin(localStorage, pin);
    unlock(); return;
  }
  if (await verifyPin(localStorage, pin)) unlock();
  else { $('lockError').textContent = 'Wrong PIN.'; $('pin').value = ''; }
});
function resetAll() {
  if (!confirm('Reset Care Reminder? This erases the PIN and ALL your data on this device. Export a backup first if you need it.')) return;
  data = resetApp(localStorage); showLock(); toast('App reset');
}
$('resetBtn').addEventListener('click', resetAll);
$('lockBtn').addEventListener('click', showLock);

// ---- Tabs ----
let tab = 'today';
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));

// ---- Editor dialog: one form, built from a field list ----
let onSave = null;
function openEditor(title, fields, values, save) {
  $('editorTitle').textContent = title;
  $('editorFields').innerHTML = fields.map((f) => {
    const v = values[f.name] ?? f.value ?? '';
    if (f.type === 'checkbox') return `<label class="inline"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}>${f.label}</label>`;
    if (f.type === 'select') return `<label class="field">${f.label}<select name="${f.name}">${f.options.map((o) => `<option value="${o}" ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
    if (f.type === 'textarea') return `<label class="field">${f.label}<textarea name="${f.name}" rows="2">${esc(v)}</textarea></label>`;
    return `<label class="field">${f.label}<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${f.required ? 'required' : ''}></label>`;
  }).join('');
  onSave = (form) => save(Object.fromEntries(fields.map((f) => [f.name, f.type === 'checkbox' ? form.elements[f.name].checked : form.elements[f.name].value.trim()])));
  $('editor').showModal();
  $('editorFields').querySelector('input,select,textarea')?.focus();
}
$('editorForm').addEventListener('submit', (e) => { e.preventDefault(); if (onSave?.(e.target) !== false) $('editor').close(); });
$('editorCancel').addEventListener('click', () => $('editor').close());

function crud(listKey, fields, label) {
  return {
    add: (defaults = {}) => openEditor(`Add ${label}`, fields, defaults, (v) => save({ ...data, [listKey]: [...data[listKey], { id: uid(), ...v }] })),
    edit: (id) => openEditor(`Edit ${label}`, fields, data[listKey].find((x) => x.id === id), (v) => save({ ...data, [listKey]: data[listKey].map((x) => (x.id === id ? { ...x, ...v } : x)) })),
    del: (id) => { const x = data[listKey].find((i) => i.id === id); if (confirm(`Delete "${x.name || x.title}"?`)) { if (save({ ...data, [listKey]: data[listKey].filter((i) => i.id !== id) })) toast('Deleted'); } },
  };
}
const medFields = [
  { name: 'name', label: 'Name', required: true },
  { name: 'kind', label: 'Type', type: 'select', options: ['Medication', 'Supplement'] },
  { name: 'dose', label: 'Dose (e.g. 10 mg)' },
  { name: 'how', label: 'When / how often' },
  { name: 'current', label: 'Taking it now', type: 'checkbox', value: true },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];
const meds = crud('meds', medFields, 'medication');
const appts = crud('appts', [
  { name: 'title', label: 'What', required: true }, { name: 'date', label: 'Date', type: 'date', required: true },
  { name: 'time', label: 'Time', type: 'time' }, { name: 'place', label: 'Where' }, { name: 'notes', label: 'Notes', type: 'textarea' },
], 'appointment');
const doses = crud('doses', [
  { name: 'name', label: 'Pill or supplement', required: true }, { name: 'amount', label: 'Amount (e.g. 1 tablet)' }, { name: 'time', label: 'Time', type: 'time' },
], 'dose');

const actions = (kind, id) => `<div class="row"><button class="btn secondary small" data-act="edit" data-kind="${kind}" data-id="${esc(id)}">Edit</button><button class="btn danger small" data-act="del" data-kind="${kind}" data-id="${esc(id)}">Delete</button></div>`;
const head = (text, kind) => `<div class="panel-head"><p>${text}</p><button class="btn primary" data-act="add" data-kind="${kind}">+ Add</button></div>`;
const empty = (text) => `<div class="empty">${text}</div>`;
const medCard = (m) => `<article class="card"><h3>${esc(m.name)}</h3><p class="meta"><span class="tag">${esc(m.kind || 'Medication')}</span>${m.current ? '<span class="tag">Current</span>' : ''}${esc([m.dose, m.how].filter(Boolean).join(' · '))}</p>${m.notes ? `<p>${esc(m.notes)}</p>` : ''}${actions('med', m.id)}</article>`;

const views = {
  today() {
    const key = dateKey(); const done = checksFor(data, key); const list = sortDoses(data.doses);
    const n = list.filter((d) => done[d.id]).length;
    return `${head(`${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · ${n} of ${list.length} taken`, 'dose')}
      ${list.length ? `<div class="progress"><span style="width:${list.length ? (100 * n) / list.length : 0}%"></span></div>` : ''}
      ${list.map((d) => `<article class="card ${done[d.id] ? 'done' : ''}"><label class="check"><input type="checkbox" data-dose="${esc(d.id)}" ${done[d.id] ? 'checked' : ''}><span><strong>${esc(d.name)}</strong><br><span class="meta">${esc([fmtTime(d.time), d.amount].filter(Boolean).join(' · '))}</span></span></label>${actions('dose', d.id)}</article>`).join('')
      || empty('No daily doses yet. Tap “+ Add” to list the pills you take each day. Check-offs reset every morning.')}`;
  },
  current() {
    const list = data.meds.filter((m) => m.current);
    return head('What you are taking now.', 'current') + (list.map(medCard).join('') || empty('Nothing marked as current. Add one, or tick “Taking it now” on the Meds tab.'));
  },
  schedule() {
    const { upcoming, past } = sortAppointments(data.appts);
    let group = ''; let html = head('Soonest first.', 'appt');
    html += `<label class="inline"><input type="checkbox" id="showPast" ${showPast ? 'checked' : ''}>Show past appointments (${past.length})</label>`;
    for (const a of upcoming) {
      const g = apptGroup(a); if (g !== group) { group = g; html += `<h2 class="group-title">${g}</h2>`; }
      html += apptCard(a, false);
    }
    if (!upcoming.length) html += empty('No upcoming appointments.');
    if (showPast && past.length) html += `<h2 class="group-title">Past</h2>${past.map((a) => apptCard(a, true)).join('')}`;
    return html;
  },
  meds() {
    const list = [...data.meds].sort((a, b) => a.name.localeCompare(b.name));
    return head('Every medication and supplement.', 'med') + (list.map(medCard).join('') || empty('No medications or supplements yet.'));
  },
  settings() {
    return `<div class="section"><h2>Storage</h2><p id="persistStatus">${persisted === null ? 'Checking…' : persisted ? '✅ Persistent storage granted: the browser will not clear this data on its own.' : '⚠️ Persistent storage not granted: the browser may clear data if the phone runs low on space. Install the app to the home screen and export backups.'}</p>
      <p class="meta">${data.meds.length} meds, ${data.appts.length} appointments, ${data.doses.length} daily doses. Stored only in this browser on this device.</p></div>
      <div class="section"><h2>Backup</h2><div class="row"><button class="btn primary" id="exportBtn">Export JSON</button><label class="btn secondary" for="importFile">Import JSON</label><input type="file" id="importFile" accept="application/json,.json" hidden></div></div>
      <div class="section"><h2>Lock</h2><p class="note">The PIN is a local lock, not real security. Data is not encrypted and there is no server or account.</p>
      <div class="row"><button class="btn secondary" id="lockNow">Lock now</button><button class="btn danger" id="resetApp">Reset app (erase everything)</button></div></div>`;
  },
};
const apptCard = (a, past) => `<article class="card ${past ? 'past' : ''}"><h3>${esc(a.title)}</h3><p class="meta">${esc([fmtDate(a.date), fmtTime(a.time), a.place].filter(Boolean).join(' · '))}</p>${a.notes ? `<p>${esc(a.notes)}</p>` : ''}${actions('appt', a.id)}</article>`;

const kinds = { med: meds, current: meds, appt: appts, dose: doses };
function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => (b.dataset.tab === tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== `tab-${tab}`; });
  const panel = $(`tab-${tab}`);
  $('title').textContent = panel.dataset.title;
  panel.innerHTML = views[tab]();
}
$('main').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (b) { const k = kinds[b.dataset.kind]; if (b.dataset.act === 'add') k.add(b.dataset.kind === 'current' ? { current: true } : b.dataset.kind === 'med' ? { current: false } : {}); else k[b.dataset.act](b.dataset.id); return; }
  if (e.target.id === 'exportBtn') exportData();
  if (e.target.id === 'lockNow') showLock();
  if (e.target.id === 'resetApp') resetAll();
});
$('main').addEventListener('change', (e) => {
  if (e.target.dataset.dose) save(toggleCheck(data, dateKey(), e.target.dataset.dose, e.target.checked));
  if (e.target.id === 'showPast') { showPast = e.target.checked; render(); }
  if (e.target.id === 'importFile' && e.target.files[0]) importData(e.target.files[0]);
});

function exportData() {
  const url = URL.createObjectURL(new Blob([makeBackup(data)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `care-reminder-${dateKey()}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Backup exported');
}
async function importData(file) {
  try {
    const next = parseBackup(await file.text());
    if (!confirm(`Replace current data with this backup (${next.meds.length} meds, ${next.appts.length} appointments, ${next.doses.length} doses)?`)) return;
    if (save(next)) toast('Backup imported');
  } catch (err) { alert(`Import failed: ${err.message}`); }
}

// ---- Persistence and offline ----
(async () => {
  persisted = await persistStatus(navigator);
  if (!$('app').hidden) render();
})();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
let lastDay = dateKey();
setInterval(() => { if (dateKey() !== lastDay) { lastDay = dateKey(); if (!$('app').hidden) render(); } }, 60000);
showLock();
