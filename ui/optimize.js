// Optimieren-Seite. Nutzt Helfer aus renderer.js ($, esc, hue, confirmDialog, openRun, setProgress, waitDone, addLog).
let optLoaded = false;
let bloat = [];
const bloatSel = new Set();
let tweaks = [];
let startup = [];
const GROUP_INFO = {
  Bloatware: null, // erscheint im Bloatware-Abschnitt
  Datenschutz: 'Weniger Daten an Microsoft, keine Werbung im System.',
  Leistung: 'Schnellere Reaktion und mehr Leistung in Spielen.',
  Explorer: 'Praktischere Einstellungen für den Datei-Explorer.',
  Dienste: 'Hintergrunddienste, die die meisten nicht brauchen. Wirkt vollständig nach einem Neustart.',
};

document.addEventListener('page', (e) => {
  if (e.detail === 'opt' && !optLoaded) { optLoaded = true; loadBloat(); loadTweaks(); loadStartup(); }
});

// ---------- Fortschritts-Ring ----------
function updateScore() {
  const on = tweaks.filter((t) => t.on).length;
  const pct = tweaks.length ? on / tweaks.length : 0;
  $('#optRing').style.strokeDashoffset = 314.2 * (1 - pct);
  $('#optRing').style.opacity = pct > 0 ? 1 : 0;
  $('#optScore').textContent = tweaks.length ? `${on}/${tweaks.length}` : '–';
  $('#optSummary').textContent = tweaks.length ? `${on} von ${tweaks.length} Optimierungen aktiv` : '';
}

// ---------- Bloatware ----------
async function loadBloat() {
  bloat = await window.api.optBloat();
  bloatSel.clear();
  for (const b of bloat) if (b.def) bloatSel.add(b.id);
  renderBloat();
}
function renderBloat() {
  if (!bloat.length) {
    $('#bloatBox').innerHTML = '<div class="large-status muted">Keine bekannte Bloatware gefunden – sauber!</div>';
    updateBloat();
    return;
  }
  const groups = {};
  for (const b of bloat) (groups[b.group] ||= []).push(b);
  let n = 0;
  $('#bloatBox').innerHTML = Object.entries(groups).map(([g, list]) => `<div class="bg-title">${esc(g)}</div>` + list.map((b) => `
    <label class="bl${bloatSel.has(b.id) ? ' on' : ''}" data-id="${esc(b.id)}" style="animation-delay:${n++ * 25}ms">
      <span class="check"><input type="checkbox" ${bloatSel.has(b.id) ? 'checked' : ''}><span></span></span>
      <span class="n">${esc(b.name)}<small>${esc(b.note || b.packages.join(', '))}</small></span>
    </label>`).join('')).join('');
  updateBloat();
}
$('#bloatBox').addEventListener('change', (e) => {
  const el = e.target.closest('.bl');
  if (!el) return;
  e.target.checked ? bloatSel.add(el.dataset.id) : bloatSel.delete(el.dataset.id);
  el.classList.toggle('on', e.target.checked);
  updateBloat();
});
function updateBloat() {
  $('#bloatGo').disabled = !bloatSel.size;
  $('#bloatGo').textContent = bloatSel.size ? `${bloatSel.size} entfernen` : 'Ausgewählte entfernen';
}
$('#bloatGo').onclick = async () => {
  const chosen = bloat.filter((b) => bloatSel.has(b.id));
  const prevent = $('#bloatPrevent').checked;
  const ok = await confirmDialog(`${chosen.length} App${chosen.length === 1 ? '' : 's'} entfernen?`,
    `<ul>${chosen.map((b) => `<li>${esc(b.name)}</li>`).join('')}</ul>${prevent ? 'Die Apps werden auch aus dem Windows-Image entfernt, damit sie nicht zurückkommen (braucht Adminrechte).' : ''}`);
  if (!ok) return;
  openRun('Entferne Bloatware');
  const res = await window.api.optBloatRemove(chosen.map((b) => b.id), prevent);
  // „Neuinstallation verhindern“ schaltet zusätzlich die Richtlinie gegen automatische App-Installationen ein
  if (prevent && tweaks.some((t) => t.id === 'consumer' && !t.on)) await setTweak('consumer', true);
  const done = Object.values(res).filter(Boolean).length;
  setProgress(100, `${done} von ${chosen.length} entfernt`, '');
  await waitDone();
  $('#runOverlay').classList.remove('open');
  document.querySelectorAll('.bl').forEach((el) => { if (res[el.dataset.id]) el.classList.add('gone'); });
  setTimeout(() => {
    bloat = bloat.filter((b) => !res[b.id]);
    for (const id of Object.keys(res)) if (res[id]) bloatSel.delete(id);
    renderBloat();
  }, 400);
};

// ---------- Tweaks ----------
async function loadTweaks() {
  tweaks = await window.api.optTweaks();
  const groups = {};
  for (const t of tweaks) (groups[t.group] ||= []).push(t);
  let n = 0;
  $('#tweakGroups').innerHTML = Object.entries(groups).map(([g, list]) => `
    ${GROUP_INFO[g] === null ? '' : `<div class="sec-head"><div><h2>${esc(g)}</h2><p class="muted">${esc(GROUP_INFO[g] || '')}</p></div></div>`}
    <div class="tw-grid"${GROUP_INFO[g] === null ? ' style="margin-top:12px"' : ''}>${list.map((t) => `
      <div class="tw${t.on ? ' on' : ''}" data-id="${t.id}" style="animation-delay:${n++ * 30}ms">
        <div><h3>${esc(t.name)}${t.admin ? '<span class="tag">Admin</span>' : ''}</h3><p>${esc(t.desc)}</p></div>
        <label class="sw"><input type="checkbox" ${t.on ? 'checked' : ''} aria-label="${esc(t.name)}"><span class="track"><span class="thumb"></span></span></label>
      </div>`).join('')}</div>`).join('');
  // Bloatware-Richtlinie direkt unter die Bloatware-Liste
  const bw = $('#tweakGroups .tw[data-id="consumer"]');
  if (bw) $('#bloatBox').after(bw.parentElement);
  updateScore();
}

async function setTweak(id, on) {
  const t = tweaks.find((x) => x.id === id);
  const el = document.querySelector(`.tw[data-id="${id}"]`);
  el.classList.add('busy');
  const r = await window.api.optTweak(id, on);
  el.classList.remove('busy');
  if (r.ok) {
    t.on = on;
    if (t.restartExplorer) $('#optExplorer').hidden = false;
  }
  el.classList.toggle('on', t.on);
  el.querySelector('input').checked = t.on;
  updateScore();
}
document.addEventListener('change', (e) => {
  const el = e.target.closest('.tw');
  if (el && e.target.matches('.sw input')) setTweak(el.dataset.id, e.target.checked);
});
$('#optExplorer').onclick = async () => {
  await window.api.optRestartExplorer();
  $('#optExplorer').hidden = true;
};

// ---------- Autostart ----------
const exeOf = (cmd) => { const s = (cmd || '').trim(); return s.startsWith('"') ? s.slice(1, s.indexOf('"', 1)) : (s.match(/^(.*?\.exe)/i) || [s])[0]; };
async function loadStartup() {
  startup = await window.api.optStartup();
  startup.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name, 'de'));
  const on = startup.filter((s) => s.enabled).length;
  $('#startupList').innerHTML = startup.length ? startup.map((s, i) => `
    <div class="su${s.enabled ? '' : ' off'}" data-id="${s.id}" style="animation-delay:${Math.min(i, 30) * 20}ms">
      <div class="ico" style="--c:hsl(${hue(s.name)} 55% 42%)">${esc(s.name.trim()[0] || '?')}</div>
      <div class="nm"><b>${esc(s.name)}</b><span title="${esc(s.cmd)}">${esc(s.cmd)}</span></div>
      <span class="src">${esc(s.source)}</span>
      <label class="sw"><input type="checkbox" ${s.enabled ? 'checked' : ''} aria-label="${esc(s.name)} beim Start"><span class="track"><span class="thumb"></span></span></label>
    </div>`).join('') : '<div class="large-status muted">Keine Autostart-Einträge.</div>';
  addLog({ level: 'info', msg: `${startup.length} Autostart-Einträge, ${on} aktiv` });
  for (const s of startup) {
    window.api.icon({ type: 'win32', key: 'su' + s.id, icon: exeOf(s.cmd), uninstall: '' }).then((src) => {
      const ico = src && document.querySelector(`.su[data-id="${s.id}"] .ico`);
      if (ico) ico.innerHTML = `<img src="${src}" alt="">`;
    });
  }
}
$('#startupList').addEventListener('change', async (e) => {
  const row = e.target.closest('.su');
  if (!row) return;
  row.classList.add('busy');
  const ok = await window.api.optStartupSet(row.dataset.id, e.target.checked);
  row.classList.remove('busy');
  if (!ok) e.target.checked = !e.target.checked;
  row.classList.toggle('off', !e.target.checked);
});
