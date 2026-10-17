const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtSize = (b) => {
  if (!b) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), 4);
  return (b / 1024 ** i).toFixed(i ? 1 : 0).replace('.', ',') + ' ' + u[i];
};
const fmtDate = (d) => (/^\d{8}$/.test(d || '') ? `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}` : '—');
const driveOf = (a) => ((a.location || (a.uninstall || '').replace(/^"/, '') || a.icon || '').match(/^([a-z]):/i) || [])[1]?.toUpperCase() || '';
// Staffelung: max. 10 Elemente, Rest erscheint sofort mit
const stag = (i) => `--i:${Math.min(i, 10)}`;
const reduced = () => document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const EMPTY_DETAILS = '<div class="empty-details"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M9 12h6M12 9v6"/></svg><p>Wähle eine App für Details</p></div>';

// Zahl animiert hochzählen (nur Textinhalt, kein Layout)
function animateNumber(el, from, to, fmt = (v) => String(Math.round(v)), ms = 700) {
  if (!el) return;
  if (reduced() || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  el._anim = t0;
  const step = (t) => {
    if (el._anim !== t0) return; // neuere Animation hat übernommen
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = fmt(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const TOAST_ICONS = {
  success: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  danger: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
};
function toast(msg, type = 'info', ms = 4200) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.setAttribute('role', type === 'danger' ? 'alert' : 'status');
  el.innerHTML = `${TOAST_ICONS[type] || TOAST_ICONS.info}<span>${esc(msg)}</span><i class="toast-bar" style="animation-duration:${ms}ms"></i>`;
  $('#toasts').appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  let left = ms, started = Date.now(), timer;
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 320); };
  const arm = () => { started = Date.now(); timer = setTimeout(close, left); };
  el.addEventListener('mouseenter', () => { clearTimeout(timer); left -= Date.now() - started; });
  el.addEventListener('mouseleave', arm);
  el.addEventListener('click', close);
  arm();
}

const skelRows = (n) => Array.from({ length: n }, (_, i) => `
  <div class="row skeleton stagger" style="${stag(i)}">
    <span class="skel" style="width:18px;height:18px"></span>
    <div class="app-cell"><span class="skel round" style="width:30px;height:30px"></span><span class="skel" style="width:${45 + ((i * 37) % 40)}%"></span></div>
    <span class="skel" style="width:60%"></span><span class="skel" style="width:50%"></span><span class="skel" style="width:60%"></span><span class="skel" style="width:70%;margin-left:auto"></span>
  </div>`).join('');

let apps = [];
const selected = new Set();
const icons = new Map();
let filter = 'all';
let focused = null;
let busy = false;

// ---------- Einstellungen merken ----------
for (const id of ['optLeftovers', 'optSilent']) {
  try { const v = localStorage.getItem(id); if (v !== null) $('#' + id).checked = v === '1'; } catch {}
  $('#' + id).addEventListener('change', (e) => { try { localStorage.setItem(id, e.target.checked ? '1' : '0'); } catch {} });
}

// ---------- Log ----------
let logN = 0;
function addLog({ level, msg, t }) {
  const time = new Date(t || Date.now()).toLocaleTimeString('de-DE');
  const html = `<div class="l ${level}"><span class="t">${time}</span><span>${esc(msg)}</span></div>`;
  for (const el of [$('#log'), $('#runOverlay').classList.contains('open') && $('#runLog')]) {
    if (!el) continue;
    el.insertAdjacentHTML('beforeend', html);
    el.scrollTop = el.scrollHeight;
  }
  $('#logCount').textContent = ++logN;
}
window.api.on('log', addLog);
$('#logClose').onclick = () => $('#logPanel').classList.remove('open');
$('#logClear').onclick = () => { $('#log').innerHTML = ''; logN = 0; $('#logCount').textContent = 0; };

// ---------- Liste ----------
function visible() {
  const q = $('#search').value.trim().toLowerCase();
  const sort = $('#sort').value;
  return apps
    .filter((a) => (filter === 'all' || a.type === filter) && (!$('#driveFilter').value || driveOf(a) === $('#driveFilter').value) && (!q || `${a.name} ${a.publisher}`.toLowerCase().includes(q)))
    .sort((a, b) =>
      sort === 'size' ? b.size - a.size
        : sort === 'date' ? (b.installDate || '').localeCompare(a.installDate || '')
          : sort === 'publisher' ? (a.publisher || '~').localeCompare(b.publisher || '~', 'de')
            : a.name.localeCompare(b.name, 'de'));
}

function iconHtml(a) {
  const src = icons.get(a.key);
  return `<div class="ico">${src ? `<img src="${src}" alt="">` : esc(a.name.trim()[0] || '?')}</div>`;
}

function render() {
  const list = visible();
  $('#list').innerHTML = list.map((a, i) => `
    <div class="row stagger${selected.has(a.key) ? ' sel' : ''}${focused === a.key ? ' focus' : ''}" data-key="${esc(a.key)}" style="${stag(i)}">
      <label class="check"><input type="checkbox" ${selected.has(a.key) ? 'checked' : ''} aria-label="${esc(a.name)} auswählen"><span></span></label>
      <div class="app-cell">${iconHtml(a)}<span class="name">${esc(a.name)}</span>${a.type === 'store' ? '<span class="tag">Store</span>' : a.type === 'portable' ? `<span class="tag">${esc(a.source)}</span>` : ''}</div>
      <span class="cell">${esc(a.publisher || '—')}</span>
      <span class="cell">${esc(a.version || '—')}</span>
      <span class="cell">${fmtDate(a.installDate)}</span>
      <span class="size${!a.size && a.location ? ' calc' : ''}">${fmtSize(a.size)}</span>
    </div>`).join('');
  $('#cAll').textContent = apps.length;
  $('#cWin').textContent = apps.filter((a) => a.type === 'win32').length;
  $('#cStore').textContent = apps.filter((a) => a.type === 'store').length;
  $('#cPort').textContent = apps.filter((a) => a.type === 'portable').length;
  updateSel();
}

function updateSel() {
  const list = visible();
  const n = selected.size;
  const cnt = $('#selCount');
  if (cnt.textContent !== String(n)) { cnt.textContent = n; cnt.classList.remove('bump'); void cnt.offsetWidth; cnt.classList.add('bump'); }
  $('#selSize').textContent = fmtSize(apps.filter((a) => selected.has(a.key)).reduce((s, a) => s + (a.size || 0), 0));
  $('#goBtn').disabled = !n || busy;
  const visSel = list.filter((a) => selected.has(a.key)).length;
  $('#selAll').checked = list.length > 0 && visSel === list.length;
  $('#selAll').indeterminate = visSel > 0 && visSel < list.length;
}

$('#list').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row || e.target.closest('.check')) return;
  showDetails(row.dataset.key);
});
$('#list').addEventListener('change', (e) => {
  const row = e.target.closest('.row');
  const key = row.dataset.key;
  e.target.checked ? selected.add(key) : selected.delete(key);
  row.classList.toggle('sel', e.target.checked);
  updateSel();
});
$('#selAll').addEventListener('change', (e) => {
  for (const a of visible()) e.target.checked ? selected.add(a.key) : selected.delete(a.key);
  render();
});
$('#search').addEventListener('input', render);
$('#sort').addEventListener('change', render);
$('#driveFilter').addEventListener('change', render);
$('#filters').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
  filter = c.dataset.f;
  render();
});

function showDetails(key) {
  const a = apps.find((x) => x.key === key);
  if (!a) return;
  focused = key;
  document.querySelectorAll('.row').forEach((r) => r.classList.toggle('focus', r.dataset.key === key));
  const kv = [
    ['Typ', a.type === 'store' ? 'Microsoft Store / UWP' : a.type === 'portable' ? `Ohne Registry-Eintrag (${a.source})` : 'Desktop-Programm'],
    ['Laufwerk', driveOf(a) && driveOf(a) + ':'],
    ['Herausgeber', a.publisher], ['Version', a.version], ['Installiert am', fmtDate(a.installDate)],
    ['Speicherort', a.location], ['Deinstallation', a.type === 'store' ? 'Remove-AppxPackage' : a.type === 'portable' ? 'Ordner wird gelöscht' : (a.msi ? 'Windows Installer (MSI)' : 'EXE-Uninstaller') + (a.quiet ? ' · Silent verfügbar' : '')],
    ['Befehl', a.type === 'store' ? a.key : a.uninstall], ['Website', a.url], ['Registry', a.type === 'store' ? a.keyName : a.key],
  ].filter(([, v]) => v);
  $('#details').innerHTML = `<div class="d-in">
    <div class="d-head">${iconHtml(a)}<div><h3>${esc(a.name)}</h3><span class="muted">${esc(a.publisher || '')}</span></div></div>
    <div class="d-size">${fmtSize(a.size)}</div>
    <dl class="kv">${kv.map(([k, v]) => `<div><dt>${k}</dt><dd>${['Befehl', 'Registry', 'Speicherort'].includes(k) ? `<code>${esc(v)}</code>` : esc(v)}</dd></div>`).join('')}</dl>
  </div>`;
}

// ---------- Laden ----------
async function load() {
  $('#list').innerHTML = skelRows(9);
  $('#refresh').classList.add('spin');
  try {
    apps = await window.api.listApps();
  } catch (e) {
    addLog({ level: 'err', msg: 'Scan fehlgeschlagen: ' + e.message });
    apps = [];
  }
  for (const k of [...selected]) if (!apps.some((a) => a.key === k)) selected.delete(k);
  render();
  $('#refresh').classList.remove('spin');
  // Icons nachladen, ohne die Liste zu blockieren
  for (const a of apps) {
    if (icons.has(a.key)) continue;
    window.api.icon(a).then((src) => {
      if (!src) return;
      icons.set(a.key, src);
      const ico = document.querySelector(`.row[data-key="${CSS.escape(a.key)}"] .ico`);
      if (ico) ico.innerHTML = `<img src="${src}" alt="">`;
    });
  }
}
window.api.on('size', ({ key, size }) => {
  const a = apps.find((x) => x.key === key);
  if (!a) return;
  a.size = size;
  const el = document.querySelector(`.row[data-key="${CSS.escape(key)}"] .size`);
  if (el) { el.textContent = fmtSize(size); el.classList.remove('calc'); }
  if (focused === key) showDetails(key);
  updateSel();
});
$('#refresh').onclick = () => !busy && load();

// ---------- Ablauf ----------
function confirmDialog(title, body) {
  return new Promise((resolve) => {
    $('#confTitle').textContent = title;
    $('#confBody').innerHTML = body;
    $('#confirmModal').classList.add('open');
    const done = (v) => { $('#confirmModal').classList.remove('open'); resolve(v); };
    $('#confYes').onclick = () => done(true);
    $('#confNo').onclick = () => done(false);
  });
}

function setProgress(pct, text, sub) {
  const p = Math.max(0, Math.min(100, pct));
  $('#barFill').style.transform = `scaleX(${p / 100})`;
  $('#barFill').classList.toggle('done', p >= 100);
  const pctEl = $('#pctTxt');
  animateNumber(pctEl, Number(pctEl.dataset.v || 0), p, undefined, 400);
  pctEl.dataset.v = p;
  if (text && $('#runText').textContent !== text) {
    const el = $('#runText');
    el.textContent = text;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  }
  if (sub !== undefined) $('#runSub').textContent = sub;
}
window.api.on('progress', ({ pct, text, index, total }) => setProgress(pct, text, total ? `App ${index + 1} von ${total}` : undefined));

function openRun(title) {
  $('#runTitle').textContent = title;
  $('#runLog').innerHTML = '';
  $('#pctTxt').dataset.v = 0;
  $('#pctTxt').textContent = '0';
  $('#runDone').hidden = true;
  setProgress(0, 'Starte …', '');
  $('#runOverlay').classList.add('open');
}
$('#runSkip').onclick = () => {
  window.api.skip();
  addLog({ level: 'warn', msg: 'Überspringe aktuelle App …' });
};
const waitDone = () => new Promise((r) => { $('#runDone').hidden = false; $('#runDone').onclick = r; });

function pickLeftovers(items) {
  return new Promise((resolve) => {
    const groups = {};
    for (const it of items) (groups[it.app] ||= []).push(it);
    $('#leftList').innerHTML = Object.entries(groups).map(([app, list]) => `
      <div class="lg"><h4>${esc(app)} <span class="muted">(${list.length})</span></h4>
      ${list.map((it, i) => `<label class="li stagger" style="${stag(i)}">
        <span class="check"><input type="checkbox" data-id="${it.id}" checked><span></span></span>
        <span class="k ${it.kind}">${it.kind === 'reg' ? 'Registry' : it.kind === 'dir' ? 'Ordner' : 'Datei'}</span>
        <span class="p">${esc(it.path)}</span><span class="s">${it.kind === 'reg' ? '' : fmtSize(it.size)}</span></label>`).join('')}</div>`).join('');
    const sync = () => {
      const ids = [...document.querySelectorAll('#leftList input:checked')].map((x) => x.dataset.id);
      $('#leftCount').textContent = ids.length;
      $('#leftSize').textContent = fmtSize(items.filter((i) => ids.includes(i.id)).reduce((s, i) => s + i.size, 0));
      $('#leftGo').disabled = !ids.length;
      return ids;
    };
    $('#leftList').onchange = sync;
    sync();
    $('#leftModal').classList.add('open');
    const done = (v) => { $('#leftModal').classList.remove('open'); resolve(v); };
    $('#leftGo').onclick = () => done(sync());
    $('#leftSkip').onclick = () => done([]);
  });
}

$('#goBtn').onclick = async () => {
  const chosen = apps.filter((a) => selected.has(a.key));
  if (!chosen.length) return;
  const opts = { leftovers: $('#optLeftovers').checked, silent: $('#optSilent').checked };
  const ok = await confirmDialog(`${chosen.length} App${chosen.length > 1 ? 's' : ''} deinstallieren?`,
    `<ul>${chosen.map((a) => `<li>${esc(a.name)}</li>`).join('')}</ul>
     ${opts.leftovers ? 'Danach werden zugehörige Dateien, Ordner und Registry-Einträge gesucht – du bekommst vorher eine Vorschau.' : 'Restedateien werden nicht entfernt.'}`);
  if (!ok) return;

  busy = true; updateSel();
  openRun('Deinstallation läuft');
  addLog({ level: 'head', msg: `Starte Bulk-Deinstallation (${chosen.length} Apps, ${opts.silent ? 'still' : 'mit Dialog'})` });
  $('#runSkip').hidden = false;
  const { results, leftovers } = await window.api.run(chosen.map((a) => a.key), opts);
  $('#runSkip').hidden = true;

  const okKeys = new Set(results.filter((r) => r.ok).map((r) => r.key));
  for (const r of results) {
    const row = document.querySelector(`.row[data-key="${CSS.escape(r.key)}"]`);
    if (row) row.classList.add(r.ok ? 'removing' : 'failed');
  }
  const failed = results.length - okKeys.size;
  setProgress(100, `${okKeys.size} deinstalliert${failed ? `, ${failed} fehlgeschlagen` : ''}`, '');
  if (okKeys.size) toast(`${okKeys.size} App${okKeys.size === 1 ? '' : 's'} deinstalliert`, 'success');
  if (failed) toast(`${failed} App${failed === 1 ? '' : 's'} nicht deinstalliert – Details im Log`, 'danger');

  if (leftovers.length) {
    $('#runOverlay').classList.remove('open');
    const ids = await pickLeftovers(leftovers);
    if (ids.length) {
      openRun('Entferne Reste');
      const r = await window.api.deleteLeftovers(ids);
      setProgress(100, `${r.ok} Elemente gelöscht · ${fmtSize(r.freed)} freigegeben${r.failed ? ` · ${r.failed} Fehler` : ''}`, '');
      addLog({ level: r.failed ? 'warn' : 'ok', msg: `Bereinigung: ${r.ok} gelöscht, ${r.failed} Fehler, ${fmtSize(r.freed)} frei` });
      toast(`Reste entfernt · ${fmtSize(r.freed) === '—' ? '0 B' : fmtSize(r.freed)} freigegeben`, r.failed ? 'danger' : 'success');
      await waitDone();
    }
  } else {
    await waitDone();
  }
  $('#runOverlay').classList.remove('open');
  for (const k of okKeys) selected.delete(k);
  apps = apps.filter((a) => !okKeys.has(a.key));
  if (okKeys.has(focused)) { focused = null; $('#details').innerHTML = EMPTY_DETAILS; }
  busy = false;
  loadDrives();
  setTimeout(render, 320); // Ausblend-Animation abwarten
};

// ---------- Tabs ----------
function moveInd() {
  const t = document.querySelector('.tab.active');
  $('#tabInd').style.transform = `translateX(${t.offsetLeft - 3}px) scaleX(${t.offsetWidth / 100})`;
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  if (t.classList.contains('active')) return;
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + t.dataset.page));
  moveInd();
  document.dispatchEvent(new CustomEvent('page', { detail: t.dataset.page }));
}));
// erste Position ohne Gleiten setzen; nach dem Laden der Schrift neu messen
$('#tabInd').style.transition = 'none';
moveInd();
requestAnimationFrame(() => { $('#tabInd').style.transition = ''; });
document.fonts.ready.then(moveInd);
addEventListener('resize', moveInd);

// Laufwerke für Filter (Speicher-Seite nutzt dieselbe Liste)
let drives = [];
async function loadDrives() {
  drives = await window.api.drives();
  const sel = $('#driveFilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">Alle Laufwerke</option>' + drives.map((d) => `<option value="${d.letter}">${d.letter}: ${esc(d.label || (d.system ? 'System' : 'Lokaler Datenträger'))} · ${fmtSize(d.free)} frei</option>`).join('');
  sel.value = cur;
  document.dispatchEvent(new Event('drives'));
}

// ---------- Einstellungen ----------
$('#setMotion').checked = document.documentElement.dataset.motion === 'reduced';
$('#setMotion').addEventListener('change', (e) => {
  if (e.target.checked) document.documentElement.dataset.motion = 'reduced';
  else delete document.documentElement.dataset.motion;
  try { localStorage.setItem('motion', e.target.checked ? 'reduced' : 'full'); } catch {}
});
$('#setBtn').onclick = (e) => { e.stopPropagation(); $('#logPanel').classList.remove('open'); $('#settingsPop').classList.toggle('open'); };
$('#logBtn').onclick = (e) => { e.stopPropagation(); $('#settingsPop').classList.remove('open'); $('#logPanel').classList.toggle('open'); };
// Klick daneben oder Esc schließt Popovers
document.addEventListener('click', (e) => {
  if (!e.target.closest('#settingsPop')) $('#settingsPop').classList.remove('open');
  if (!e.target.closest('#logPanel, #logBtn')) $('#logPanel').classList.remove('open');
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('#settingsPop').classList.remove('open'); $('#logPanel').classList.remove('open'); }
});

// ---------- Start ----------
loadDrives();
window.api.isAdmin().then((admin) => {
  const b = $('#adminBadge');
  b.textContent = admin ? 'Administrator' : 'Ohne Adminrechte';
  b.title = admin ? '' : 'Manche Apps und Optimierungen brauchen Adminrechte';
  b.className = 'badge' + (admin ? ' ok' : '');
});
load();
