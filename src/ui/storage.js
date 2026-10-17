// Speicher-Seite. Nutzt Helfer aus renderer.js ($, esc, fmtSize, confirmDialog, openRun, setProgress, waitDone, drives, loadDrives).
const cats = [];
const catState = new Map(); // id → { on, size, count, scanning, done }
let cleanLoaded = false;
let cleanBusy = false;
let adminFlag = true;
let large = [];
const largeSel = new Set();
let largeScanning = false;

window.api.isAdmin().then((a) => { adminFlag = a; });

document.addEventListener('page', (e) => {
  if (e.detail === 'clean' && !cleanLoaded) { cleanLoaded = true; initClean(); }
  if (e.detail === 'clean') renderDrives();
});
document.addEventListener('drives', () => { if (cleanLoaded) renderDrives(); });

const size0 = (v) => (fmtSize(v) === '—' ? '0 B' : fmtSize(v));
const CHECK_SVG = '<span class="done-mark"><svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg></span>';
const CAT_ICONS = {
  temp: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  recycle: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  wu: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  browser: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  shader: '<rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  crash: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v3M12 18h.01"/>',
  thumbs: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  winold: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  dism: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
};
const skelList = (n) => Array.from({ length: n }, (_, i) => `<div class="skel-row stagger" style="${stag(i)}"><span class="skel" style="width:18px;height:18px"></span><span style="flex:1;display:grid;gap:6px"><span class="skel" style="width:${30 + ((i * 29) % 35)}%"></span><span class="skel" style="width:${50 + ((i * 17) % 30)}%;height:8px"></span></span><span class="skel" style="width:60px"></span></div>`).join('');

// ---------- Laufwerke ----------
function renderDrives() {
  $('#driveCards').innerHTML = drives.map((d, i) => {
    const used = d.size ? (d.size - d.free) / d.size : 0;
    return `<div class="drive lift stagger${$('#largeDrive').value === d.letter ? ' active' : ''}" data-l="${d.letter}" style="${stag(i)}" tabindex="0">
      <div class="drive-top"><div class="drive-ico">${d.letter}:</div><div><b>${esc(d.label || (d.system ? 'System' : 'Lokaler Datenträger'))}</b><span class="muted">${d.system ? 'Windows-Laufwerk' : 'Laufwerk ' + d.letter + ':'}</span></div></div>
      <div class="drive-bar"><i data-w="${used.toFixed(4)}" class="${used > 0.9 ? 'full' : ''}"></i></div>
      <div class="drive-foot"><span>${fmtSize(d.free)} frei</span><span>${fmtSize(d.size)} gesamt</span></div></div>`;
  }).join('');
  const cur = $('#largeDrive').value;
  $('#largeDrive').innerHTML = drives.map((d) => `<option value="${d.letter}">${d.letter}:</option>`).join('');
  if (cur) $('#largeDrive').value = cur;
  // Füllstand per scaleX (kein Layout-Animieren)
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll('.drive-bar i').forEach((i) => { i.style.transform = `scaleX(${i.dataset.w})`; })));
}
function pickDrive(l) {
  $('#largeDrive').value = l;
  document.querySelectorAll('.drive').forEach((d) => d.classList.toggle('active', d.dataset.l === l));
}
$('#driveCards').addEventListener('click', (e) => { const d = e.target.closest('.drive'); if (d) pickDrive(d.dataset.l); });
$('#driveCards').addEventListener('keydown', (e) => { const d = e.target.closest('.drive'); if (d && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pickDrive(d.dataset.l); } });
$('#largeDrive').addEventListener('change', (e) => pickDrive(e.target.value));

// ---------- Kategorien ----------
async function initClean() {
  const list = await window.api.cleanCats();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('cleanSel')); } catch {}
  for (const c of list) {
    cats.push(c);
    catState.set(c.id, { on: Array.isArray(saved) ? saved.includes(c.id) : c.def, size: 0, count: 0, scanning: true });
  }
  $('#catGrid').innerHTML = cats.map((c, i) => `
    <div class="cat lift stagger" data-id="${c.id}" style="${stag(i)}" role="checkbox" tabindex="0">
      <div class="cat-ico"><svg viewBox="0 0 24 24">${CAT_ICONS[c.id] || CAT_ICONS.temp}</svg></div>
      <div><h3>${esc(c.name)}${c.admin && !adminFlag ? '<span class="tag">Admin</span>' : ''}</h3><p>${esc(c.desc)}</p></div>
      <span class="check"><input type="checkbox" tabindex="-1"><span></span></span>
      <div class="cat-size"><b></b><span class="muted"></span></div>
    </div>`).join('');
  cats.forEach((c) => updateCat(c.id));
  scanCats();
}

function scanCats() {
  for (const s of catState.values()) { s.scanning = true; s.done = false; }
  cats.forEach((c) => updateCat(c.id));
  updateCleanBar();
  window.api.cleanScan();
}
$('#cleanRescan').onclick = () => !cleanBusy && scanCats();


window.api.on('clean:size', ({ id, size, count }) => {
  const s = catState.get(id);
  if (!s) return;
  const prev = s.size || 0;
  Object.assign(s, { size, count, scanning: false });
  updateCat(id);
  const b = document.querySelector(`.cat[data-id="${id}"] .cat-size b`);
  if (b && size !== null) animateNumber(b, prev, size, size0, 800);
  updateCleanBar();
});

function updateCat(id) {
  const s = catState.get(id);
  const el = document.querySelector(`.cat[data-id="${id}"]`);
  if (!el) return;
  el.classList.toggle('on', s.on);
  el.classList.toggle('scanning', s.scanning);
  el.classList.toggle('done', !!s.done);
  el.setAttribute('aria-checked', s.on);
  el.querySelector('input').checked = s.on;
  const b = el.querySelector('.cat-size b');
  if (s.scanning) b.innerHTML = '<span class="skel"></span>';
  else if (s.size === null) b.textContent = 'Variabel';
  else if (!s.size) b.textContent = '0 B';
  const m = el.querySelector('.cat-size .muted');
  if (s.done) m.innerHTML = CHECK_SVG;
  else m.textContent = s.scanning || s.size === null ? '' : `${s.count} Element${s.count === 1 ? '' : 'e'}`;
}

function toggleCat(id) {
  const s = catState.get(id);
  s.on = !s.on;
  updateCat(id);
  updateCleanBar();
  try { localStorage.setItem('cleanSel', JSON.stringify(cats.filter((c) => catState.get(c.id).on).map((c) => c.id))); } catch {}
}
$('#catGrid').addEventListener('click', (e) => { const c = e.target.closest('.cat'); if (c) { e.preventDefault(); toggleCat(c.dataset.id); } });
$('#catGrid').addEventListener('keydown', (e) => { const c = e.target.closest('.cat'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleCat(c.dataset.id); } });

function updateCleanBar() {
  const on = cats.filter((c) => catState.get(c.id).on);
  $('#cleanCount').textContent = on.length;
  $('#cleanSize').textContent = fmtSize(on.reduce((s, c) => s + (catState.get(c.id).size || 0), 0));
  $('#cleanGo').disabled = !on.length || cleanBusy || on.some((c) => catState.get(c.id).scanning);
}

$('#cleanGo').onclick = async () => {
  const on = cats.filter((c) => catState.get(c.id).on);
  const ok = await confirmDialog('Speicher bereinigen?', `<ul>${on.map((c) => {
    const s = catState.get(c.id);
    return `<li>${esc(c.name)} – ${s.size === null ? 'variabel' : fmtSize(s.size)}</li>`;
  }).join('')}</ul>Gesperrte Dateien (z. B. von offenen Programmen) werden übersprungen.`);
  if (!ok) return;
  cleanBusy = true; updateCleanBar();
  openRun('Speicher wird bereinigt');
  addLog({ level: 'head', msg: `Starte Bereinigung (${on.length} Bereiche)` });
  const res = await window.api.cleanRun(on.map((c) => c.id));
  let total = 0;
  for (const [id, r] of Object.entries(res)) { total += r.freed; catState.get(id).done = true; updateCat(id); }
  setProgress(100, `${fmtSize(total) === '—' ? '0 B' : fmtSize(total)} freigegeben`, '');
  addLog({ level: 'ok', msg: `Bereinigung fertig: ${fmtSize(total)} freigegeben` });
  toast(`Bereinigung fertig · ${size0(total)} freigegeben`, 'success');
  await waitDone();
  $('#runOverlay').classList.remove('open');
  cleanBusy = false;
  loadDrives();
  setTimeout(scanCats, 900); // Häkchen kurz stehen lassen
};

// ---------- Große Dateien ----------
const fmtDay = (ms) => new Date(ms).toLocaleDateString('de-DE');
window.api.on('large:progress', ({ dir, files, found }) => {
  if (!largeScanning) return;
  $('#largeStatus').innerHTML = `<div class="spinner"></div><span>${files.toLocaleString('de-DE')} Dateien geprüft · ${found} Treffer · ${esc(dir)}</span>`;
});

$('#largeGo').onclick = async () => {
  if (largeScanning) { window.api.largeCancel(); return; }
  const drive = $('#largeDrive').value;
  if (!drive) return;
  largeScanning = true;
  largeSel.clear(); updateTrash();
  $('#largeGo').innerHTML = 'Abbrechen';
  $('#largeList').innerHTML = '';
  $('#largeStatus').innerHTML = `<div class="spinner"></div><span>Starte Suche auf ${drive}: …</span>`;
  const list = await window.api.largeScan(drive, +$('#largeMin').value * 1048576);
  largeScanning = false;
  $('#largeGo').innerHTML = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>Suchen';
  if (!list) { $('#largeStatus').textContent = 'Suche abgebrochen.'; return; }
  large = list;
  const total = list.reduce((s, f) => s + f.size, 0);
  $('#largeStatus').textContent = list.length ? `${list.length} Dateien · zusammen ${fmtSize(total)}` : 'Keine Dateien in dieser Größe gefunden.';
  renderLarge();
};

function renderLarge() {
  const max = large[0] ? large[0].size : 1;
  $('#largeList').innerHTML = large.map((f, i) => {
    const cut = f.path.lastIndexOf('\\');
    return `<div class="lf stagger" data-i="${i}" style="${stag(i)}">
      <label class="check"><input type="checkbox" ${largeSel.has(f.path) ? 'checked' : ''} aria-label="${esc(f.path.slice(cut + 1))} auswählen"><span></span></label>
      <div class="nm"><b>${esc(f.path.slice(cut + 1))}</b><span>${esc(f.path.slice(0, cut))}</span><div class="lf-bar" style="width:${Math.max(2, (f.size / max) * 100)}%"></div></div>
      <span class="sz">${fmtSize(f.size)}</span>
      <span class="dt">${fmtDay(f.mtime)}</span>
      <button class="rel" title="Im Explorer zeigen" aria-label="Im Explorer zeigen"><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></button>
    </div>`;
  }).join('');
}
$('#largeList').addEventListener('change', (e) => {
  const f = large[e.target.closest('.lf').dataset.i];
  e.target.checked ? largeSel.add(f.path) : largeSel.delete(f.path);
  updateTrash();
});
$('#largeList').addEventListener('click', (e) => {
  const b = e.target.closest('.rel');
  if (b) window.api.reveal(large[b.closest('.lf').dataset.i].path);
});

function updateTrash() {
  const size = large.filter((f) => largeSel.has(f.path)).reduce((s, f) => s + f.size, 0);
  $('#largeTrash').hidden = !largeSel.size;
  $('#largeTrash').textContent = `${largeSel.size} Datei${largeSel.size === 1 ? '' : 'en'} (${fmtSize(size)}) in Papierkorb`;
}

$('#largeTrash').onclick = async () => {
  const paths = [...largeSel];
  const ok = await confirmDialog(`${paths.length} Datei${paths.length === 1 ? '' : 'en'} in den Papierkorb?`,
    `<ul>${paths.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>Du kannst sie aus dem Papierkorb wiederherstellen. Platz wird erst frei, wenn du ihn leerst.`);
  if (!ok) return;
  const moved = await window.api.trash(paths);
  toast(`${moved} Datei${moved === 1 ? '' : 'en'} in den Papierkorb verschoben`, moved === paths.length ? 'success' : 'danger');
  // Nur wirklich verschobene Dateien entfernen
  const rows = [...document.querySelectorAll('.lf')];
  const gone = new Set();
  for (const p of paths) {
    const i = large.findIndex((f) => f.path === p);
    if (i >= 0) { gone.add(p); rows[i]?.classList.add('gone'); }
  }
  largeSel.clear(); updateTrash();
  setTimeout(() => { large = large.filter((f) => !gone.has(f.path)); renderLarge(); loadDrives(); }, 400);
};

// ---------- Reste deinstallierter Apps ----------
let orphans = [];
const orphSel = new Set();
let orphBusy = false;
const KIND = { dir: 'Ordner', file: 'Datei', reg: 'Registry' };

$('#orphGo').onclick = async () => {
  if (orphBusy) return;
  orphBusy = true;
  $('#orphGo').disabled = true;
  $('#orphList').innerHTML = '';
  orphSel.clear(); updateOrph();
  $('#orphStatus').innerHTML = '<div class="spinner"></div><span>Vergleiche Ordner, Registry und Verknüpfungen mit den installierten Apps …</span>';
  $('#orphList').innerHTML = skelList(6);
  try {
    orphans = await window.api.orphans();
  } catch (e) {
    orphans = [];
    addLog({ level: 'err', msg: 'Reste-Suche fehlgeschlagen: ' + e.message });
  }
  for (const o of orphans) if (o.sure) orphSel.add(o.id);
  const total = orphans.reduce((s, o) => s + o.size, 0);
  $('#orphStatus').textContent = orphans.length ? `${orphans.length} mögliche Reste · zusammen ${fmtSize(total) === '—' ? '0 B' : fmtSize(total)}` : 'Keine Reste gefunden – alles sauber.';
  renderOrph();
  orphBusy = false;
  $('#orphGo').disabled = false;
};

function renderOrph() {
  const groups = {};
  for (const o of orphans) (groups[o.group] ||= []).push(o);
  let n = 0;
  $('#orphList').innerHTML = Object.entries(groups).map(([g, list]) => {
    const all = list.every((o) => orphSel.has(o.id));
    const sure = list[0].sure;
    return `<div class="og-head" data-g="${esc(g)}">
      <label class="check"><input type="checkbox" ${all ? 'checked' : ''} aria-label="${esc(g)} auswählen"><span></span></label>
      ${esc(g)} <span class="muted">(${list.length})</span>
      <span class="sure ${sure ? 'hi' : 'lo'}">${sure ? 'sicher' : 'bitte prüfen'}</span></div>` +
      list.map((o) => {
        const name = o.path.split('\\').pop();
        const sub = o.note ? (o.kind === 'file' ? 'Ziel fehlt: ' + o.note : o.note) : o.path;
        return `<div class="lf stagger" data-id="${o.id}" style="${stag(n++)}">
          <label class="check"><input type="checkbox" ${orphSel.has(o.id) ? 'checked' : ''} aria-label="${esc(name)} auswählen"><span></span></label>
          <div class="nm"><b><span class="k ${o.kind}">${KIND[o.kind]}</span>${esc(name)}</b><span title="${esc(o.path)}">${esc(sub)}</span></div>
          <span class="sz">${o.kind === 'reg' ? '' : fmtSize(o.size)}</span>
          <span class="dt">${o.mtime ? fmtDay(o.mtime) : ''}</span><span></span>
        </div>`;
      }).join('');
  }).join('');
  updateOrph();
}

$('#orphList').addEventListener('change', (e) => {
  const head = e.target.closest('.og-head');
  if (head) {
    for (const o of orphans) if (o.group === head.dataset.g) e.target.checked ? orphSel.add(o.id) : orphSel.delete(o.id);
    renderOrph();
    return;
  }
  const id = e.target.closest('.lf').dataset.id;
  e.target.checked ? orphSel.add(id) : orphSel.delete(id);
  updateOrph();
});

function updateOrph() {
  const size = orphans.filter((o) => orphSel.has(o.id)).reduce((s, o) => s + o.size, 0);
  $('#orphDel').hidden = !orphSel.size;
  $('#orphDel').textContent = `${orphSel.size} Reste löschen${size ? ` (${fmtSize(size)})` : ''}`;
}

$('#orphDel').onclick = async () => {
  const chosen = orphans.filter((o) => orphSel.has(o.id));
  const ok = await confirmDialog(`${chosen.length} Reste endgültig löschen?`,
    `<ul>${chosen.map((o) => `<li>${esc(o.path)}</li>`).join('')}</ul>Ordner und Registry-Schlüssel werden <b>nicht</b> in den Papierkorb verschoben.`);
  if (!ok) return;
  openRun('Entferne Reste');
  const r = await window.api.deleteLeftovers(chosen.map((o) => o.id));
  setProgress(100, `${r.ok} Elemente gelöscht · ${size0(r.freed)} freigegeben${r.failed ? ` · ${r.failed} Fehler` : ''}`, '');
  toast(`${r.ok} Reste gelöscht · ${size0(r.freed)} freigegeben`, r.failed ? 'danger' : 'success');
  await waitDone();
  $('#runOverlay').classList.remove('open');
  const ids = new Set(chosen.map((o) => o.id));
  document.querySelectorAll('#orphList .lf').forEach((row) => { if (ids.has(row.dataset.id)) row.classList.add('gone'); });
  setTimeout(() => {
    orphans = orphans.filter((o) => !ids.has(o.id));
    orphSel.clear();
    renderOrph();
    loadDrives();
  }, 400);
};
