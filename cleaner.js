// Speicheroptimierung: feste Kategorien mit sicheren Zielen + Suche nach großen Dateien. Kein Electron-Import.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { pathSize } = require('./uninstaller');

const E = process.env;
const W = E.WINDIR || 'C:\\Windows';
const L = E.LOCALAPPDATA || '';
const R = E.APPDATA || '';
const PD = E.ProgramData || 'C:\\ProgramData';
const SYS = E.SystemDrive || 'C:';

const sh = (file, args) => new Promise((res) => execFile(file, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (e, out) => res({ ok: !e, out: out || '' })));
const ps = (cmd) => sh('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd]);

const chromium = (userData) => ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'Service Worker\\CacheStorage', 'Service Worker\\ScriptCache']
  .map((c) => path.join(userData, '*', c)).concat([path.join(userData, 'ShaderCache'), path.join(userData, 'GrShaderCache')]);
const opera = (n) => [path.join(L, 'Opera Software', n, 'Cache'), path.join(R, 'Opera Software', n, 'Code Cache'), path.join(R, 'Opera Software', n, 'GPUCache')];

// Ziel: Ordnerpfad (Inhalt wird geleert, '*' als Platzhalter erlaubt), optional `match` für bestimmte Dateien, `whole` = Ordner selbst löschen
const CATS = [
  { id: 'temp', name: 'Temporäre Dateien', icon: '🧊', def: true, desc: 'Benutzer- und Windows-Temp-Ordner. Gesperrte Dateien werden übersprungen.',
    targets: [E.TEMP, path.join(W, 'Temp')] },
  { id: 'recycle', name: 'Papierkorb', icon: '🗑️', def: false, desc: 'Papierkorb auf allen Laufwerken leeren. Endgültig.', special: 'recycle' },
  { id: 'wu', name: 'Windows-Update-Cache', icon: '🔄', def: true, admin: true, desc: 'Bereits installierte Update-Downloads und Übermittlungsoptimierung.',
    services: ['wuauserv', 'bits', 'dosvc'],
    targets: [path.join(W, 'SoftwareDistribution', 'Download'), path.join(W, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache')] },
  { id: 'browser', name: 'Browser-Caches', icon: '🌐', def: true, desc: 'Chrome, Edge, Brave, Vivaldi, Opera, Firefox. Logins, Cookies und Verlauf bleiben. Browser vorher schließen.',
    targets: [...chromium(path.join(L, 'Google', 'Chrome', 'User Data')), ...chromium(path.join(L, 'Microsoft', 'Edge', 'User Data')),
      ...chromium(path.join(L, 'BraveSoftware', 'Brave-Browser', 'User Data')), ...chromium(path.join(L, 'Vivaldi', 'User Data')),
      ...opera('Opera Stable'), ...opera('Opera GX Stable'), path.join(L, 'Mozilla', 'Firefox', 'Profiles', '*', 'cache2')] },
  { id: 'shader', name: 'GPU-/Shader-Caches', icon: '🎮', def: true, desc: 'NVIDIA, AMD, Intel und DirectX. Spiele bauen den Cache beim nächsten Start neu auf.',
    targets: [path.join(L, 'NVIDIA', 'DXCache'), path.join(L, 'NVIDIA', 'GLCache'), path.join(L, 'NVIDIA Corporation', 'NV_Cache'), path.join(PD, 'NVIDIA Corporation', 'NV_Cache'),
      path.join(L, 'AMD', 'DxCache'), path.join(L, 'AMD', 'DxcCache'), path.join(L, 'AMD', 'GLCache'), path.join(L, 'AMD', 'VkCache'),
      path.join(L, 'D3DSCache'), path.join(L, 'Intel', 'ShaderCache')] },
  { id: 'crash', name: 'Absturzberichte & Logs', icon: '📋', def: true, desc: 'Crash-Dumps, Windows-Fehlerberichte, Speicherabbilder, alte CBS-Logs.',
    targets: [path.join(L, 'CrashDumps'), path.join(W, 'Minidump'), { dir: W, match: /^MEMORY\.DMP$/i }, path.join(W, 'LiveKernelReports'),
      path.join(PD, 'Microsoft', 'Windows', 'WER', 'ReportArchive'), path.join(PD, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
      path.join(L, 'Microsoft', 'Windows', 'WER', 'ReportArchive'), path.join(L, 'Microsoft', 'Windows', 'WER', 'ReportQueue'),
      { dir: path.join(W, 'Logs', 'CBS'), match: /^CbsPersist.*\.(log|cab)$/i }] },
  { id: 'thumbs', name: 'Thumbnail- & Icon-Cache', icon: '🖼️', def: false, desc: 'Explorer wird kurz neu gestartet (Taskleiste blinkt). Vorschaubilder werden neu erzeugt.',
    explorer: true, targets: [{ dir: path.join(L, 'Microsoft', 'Windows', 'Explorer'), match: /^(thumbcache|iconcache)_.*\.db$/i }] },
  { id: 'winold', name: 'Windows.old', icon: '🪟', def: false, admin: true, desc: 'Alte Windows-Installation nach einem Upgrade. Danach kein Zurück zur vorherigen Version.',
    targets: [{ whole: path.join(SYS + '\\', 'Windows.old') }] },
  { id: 'dism', name: 'Alte Systemkomponenten', icon: '🧩', def: false, admin: true, desc: 'DISM-Komponentenbereinigung. Dauert einige Minuten, installierte Updates lassen sich danach nicht mehr entfernen.',
    special: 'dism' },
];

let EXCLUDE = [];
const setExclude = (paths) => { EXCLUDE = paths.filter(Boolean).map((p) => path.resolve(p).toLowerCase()); };

// "C:\a\*\b" → alle passenden Pfade
function expand(p) {
  let cur = [''];
  for (const seg of p.split('\\')) {
    if (!seg.includes('*')) { cur = cur.map((c) => (c ? c + '\\' + seg : seg)); continue; }
    const re = new RegExp('^' + seg.replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
    cur = cur.flatMap((c) => { try { return fs.readdirSync(c + '\\').filter((n) => re.test(n)).map((n) => c + '\\' + n); } catch { return []; } });
  }
  return cur;
}

// Alle konkret zu löschenden Pfade einer Kategorie
function entries(cat) {
  const out = [];
  for (const t of cat.targets || []) {
    if (!t) continue;
    if (t.whole) { if (fs.existsSync(t.whole)) out.push(t.whole); continue; }
    const dir = typeof t === 'string' ? t : t.dir;
    const match = typeof t === 'string' ? null : t.match; // String hat selbst eine .match-Methode
    for (const d of expand(dir)) {
      let names = [];
      try { names = fs.readdirSync(d); } catch { continue; }
      for (const n of names) {
        const p = path.join(d, n);
        const low = p.toLowerCase();
        // eigene entpackte Portable-EXE in %TEMP% nicht anfassen
        if ((!match || match.test(n)) && !EXCLUDE.some((x) => x === low || x.startsWith(low + '\\'))) out.push(p);
      }
    }
  }
  return out;
}

async function scan(cat) {
  if (cat.special === 'recycle') {
    const r = await ps('$s=0;$n=0;(New-Object -ComObject Shell.Application).NameSpace(10).Items()|%{$s+=$_.Size;$n++};"$s $n"');
    const [size, count] = r.out.trim().split(' ').map(Number);
    return { size: size || 0, count: count || 0 };
  }
  if (cat.special === 'dism') return { size: null, count: 0 };
  let size = 0;
  const list = entries(cat);
  for (const p of list) size += await pathSize(p);
  return { size, count: list.length };
}

const freeBytes = async () => { try { const s = await fsp.statfs(SYS + '\\'); return s.bavail * s.bsize; } catch { return 0; } };

async function clean(cat, log) {
  if (cat.special === 'recycle') {
    const before = (await scan(cat)).size;
    await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue');
    return { freed: before - (await scan(cat)).size, failed: 0 };
  }
  if (cat.special === 'dism') {
    const before = await freeBytes();
    log('info', 'DISM /StartComponentCleanup /ResetBase – das kann mehrere Minuten dauern …');
    const code = await new Promise((res) => {
      const p = spawn('dism.exe', ['/Online', '/Cleanup-Image', '/StartComponentCleanup', '/ResetBase'], { windowsHide: true });
      let last = '';
      p.stdout.on('data', (d) => { const m = String(d).match(/(\d+[.,]\d)%/); if (m && m[1] !== last) { last = m[1]; log('info', `DISM: ${m[1]} %`); } });
      p.on('error', () => res(-1));
      p.on('exit', res);
    });
    if (code !== 0) log('err', `DISM beendet mit Code ${code}${code === 740 ? ' (Adminrechte nötig)' : ''}`);
    return { freed: Math.max(0, (await freeBytes()) - before), failed: code === 0 ? 0 : 1 };
  }

  for (const s of cat.services || []) await sh('net', ['stop', s]);
  if (cat.explorer) { await sh('taskkill', ['/f', '/im', 'explorer.exe']); await new Promise((r) => setTimeout(r, 800)); }
  let freed = 0, failed = 0;
  try {
    for (const p of entries(cat)) {
      if (cat.id === 'winold') {
        log('info', 'Übernehme Besitz von Windows.old …');
        await sh('takeown', ['/F', p, '/R', '/A']);
        await sh('icacls', [p, '/grant', '*S-1-5-32-544:F', '/T', '/C', '/Q']);
      }
      const size = await pathSize(p);
      try {
        await fsp.rm(p, { recursive: true, force: true });
        freed += size;
      } catch {
        // teilweise gelöscht zählt trotzdem
        const rest = await pathSize(p);
        freed += size - rest;
        failed++;
      }
    }
  } finally {
    for (const s of [...(cat.services || [])].reverse()) await sh('net', ['start', s]);
    if (cat.explorer) spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref();
  }
  if (failed) log('warn', `${cat.name}: ${failed} Elemente gesperrt/in Benutzung, übersprungen`);
  return { freed, failed };
}

// ---------- Große Dateien ----------
const SKIP_DIRS = /^(\$recycle\.bin|system volume information|winsxs|windowsapps|\$windows\.~bt|\$windows\.~ws|config\.msi)$/i;
const SKIP_FILES = /^(pagefile|hiberfil|swapfile)\.sys$|^dumpstack\.log/i;

async function findLarge(drive, minBytes, onProgress, token) {
  const root = drive + ':\\';
  const winDir = W.toLowerCase();
  const found = [];
  let files = 0, last = 0;
  const stack = [root];
  while (stack.length && !token.cancel) {
    const dir = stack.pop();
    if (dir.toLowerCase() === winDir) continue;
    let list;
    try { list = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of list) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (!SKIP_DIRS.test(e.name)) stack.push(full); continue; }
      files++;
      if (SKIP_FILES.test(e.name)) continue;
      try {
        const st = await fsp.stat(full);
        if (st.size >= minBytes) found.push({ path: full, size: st.size, mtime: st.mtimeMs });
      } catch {}
    }
    if (Date.now() - last > 200) { last = Date.now(); onProgress({ dir, files, found: found.length }); }
  }
  return found.sort((a, b) => b.size - a.size).slice(0, 300);
}

module.exports = { CATS, scan, clean, findLarge, expand, entries, setExclude };
