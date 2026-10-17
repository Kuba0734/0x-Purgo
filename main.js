const { app, BrowserWindow, ipcMain, nativeImage, shell } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const core = require('./uninstaller');
const cleaner = require('./cleaner');
const opt = require('./optimizer');

let win;
let isAdmin = false;
const leftovers = new Map(); // id → gefundenes Element; der Renderer schickt nur IDs zurück
let leftoverSeq = 0;
let appIndex = new Map(); // key → App aus dem letzten Scan; der Renderer schickt nur Keys
let driveLetters = [];
let largeFiles = new Set(); // Pfade aus der letzten Suche nach großen Dateien
let largeToken = { cancel: false };
let current = null; // { ctl, skip() } der gerade laufenden Deinstallation

opt.setBackupDir(app.getPath('userData'));
let bloatIndex = new Map();
let startupIndex = new Map();
cleaner.setExclude([path.dirname(process.execPath), process.env.PORTABLE_EXECUTABLE_DIR]);

async function getDrives() {
  const r = await new Promise((res) => execFile('powershell.exe', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress"],
  { windowsHide: true }, (e, out) => res(e ? '' : out.trim())));
  const list = r ? [].concat(JSON.parse(r)) : [];
  const drives = list.map((d) => ({ letter: d.DeviceID[0], label: d.VolumeName || '', size: d.Size, free: d.FreeSpace, system: d.DeviceID === (process.env.SystemDrive || 'C:') }));
  driveLetters = drives.map((d) => d.letter);
  core.setDrives(driveLetters);
  return drives;
}

const send = (ch, data) => win && !win.isDestroyed() && win.webContents.send(ch, data);
const log = (level, msg) => send('log', { level, msg, t: Date.now() });

function checkAdmin() {
  return new Promise((r) => execFile('net', ['session'], { windowsHide: true }, (e) => r(!e)));
}

async function relaunchElevated() {
  const args = app.isPackaged ? [] : [app.getAppPath()];
  const argList = args.map((a) => `'"${a.replace(/'/g, "''")}"'`).join(',');
  // Portable-EXE entpackt sich nach %TEMP% und räumt beim Beenden auf → die äußere EXE neu starten
  // (kein requireAdministrator im Manifest: damit scheitern die Sandbox-Unterprozesse von Electron)
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const cmd = `Start-Process -FilePath '${exe.replace(/'/g, "''")}' ${argList ? `-ArgumentList ${argList}` : ''} -Verb RunAs`;
  return new Promise((r) => execFile('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true }, (e) => r(!e)));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 980, minHeight: 640,
    backgroundColor: '#09090b', show: false, icon: path.join(__dirname, 'src', 'ui', 'icon.png'),
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#09090b', symbolColor: '#a1a1aa', height: 52 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'ui', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('console-message', (_e, level, msg) => level >= 2 && console.error('[renderer]', msg));
}

app.whenReady().then(async () => {
  isAdmin = await checkAdmin();
  if (!isAdmin && !process.argv.includes('--no-elevate') && (await relaunchElevated())) return app.quit();
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// ---------- IPC ----------
ipcMain.handle('admin', () => isAdmin);

ipcMain.handle('drives', getDrives);

ipcMain.handle('apps:list', async () => {
  if (!driveLetters.length) await getDrives();
  const reg = await core.listApps();
  const extra = await core.findUnregistered(reg, driveLetters).catch((e) => (log('err', e.message), []));
  const apps = [...reg, ...extra].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  appIndex = new Map(apps.map((a) => [a.key, a]));
  log('info', `${apps.length} Apps gefunden (${extra.length} ohne Registry-Eintrag)`);
  // Fehlende Größen im Hintergrund berechnen
  (async () => {
    for (const a of apps) {
      if (a.size > 0 || !a.location || !fs.existsSync(a.location)) continue;
      const size = await core.pathSize(a.location);
      if (size) send('size', { key: a.key, size });
    }
  })();
  return apps;
});

ipcMain.handle('apps:icon', async (_e, a) => {
  try {
    if (a.type === 'store') {
      const img = a.icon && nativeImage.createFromPath(a.icon);
      return img && !img.isEmpty() ? img.resize({ width: 64 }).toDataURL() : null;
    }
    // Reihenfolge: DisplayIcon → Haupt-EXE im Installationsordner → MSI-Icon-Cache → Uninstaller-EXE
    const guid = ((a.uninstall || '').match(/{[0-9A-F-]{36}}/i) || [])[0];
    const msiDir = guid && path.join(process.env.WINDIR, 'Installer', guid);
    const msiIcon = msiDir && fs.existsSync(msiDir) && (fs.readdirSync(msiDir).find((f) => /.(ico|exe)$/i.test(f)) || '');
    const candidates = [
      (a.icon || '').split(',')[0].replace(/"/g, '').trim(),
      a.location && fs.existsSync(a.location) && (await core.mainExe(a.location.replace(/"/g, ''))),
      msiIcon && path.join(msiDir, msiIcon),
      core.exePath(a.uninstall),
    ];
    const p = candidates.find((c) => c && !/msiexec/i.test(c) && fs.existsSync(c));
    if (!p) return null;
    if (/.(ico|png)$/i.test(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img.resize({ width: 64 }).toDataURL();
    }
    return (await app.getFileIcon(p, { size: 'large' })).toDataURL();
  } catch { return null; }
});

ipcMain.handle('run', async (_e, keys, opts) => {
  const apps = keys.map((k) => appIndex.get(k)).filter(Boolean);
  const results = [];
  const found = [];
  const n = apps.length;
  for (let i = 0; i < n; i++) {
    const a = apps[i];
    const prog = (frac, text) => send('progress', { pct: ((i + frac) / n) * 100, text, key: a.key, index: i, total: n });
    log('head', `[${i + 1}/${n}] ${a.name}`);
    prog(0.05, `Deinstalliere ${a.name} …`);
    let r;
    // Bei Dialog-Uninstallern das eigene Fenster aus dem Weg nehmen, sonst liegt der Dialog dahinter
    const ctl = { onInteractive: (on) => { if (!win || win.isDestroyed()) return; if (on) win.minimize(); else { win.restore(); win.focus(); } } };
    const skipped = new Promise((res) => { current = { ctl, skip: res }; });
    try {
      r = await Promise.race([core.uninstall(a, opts.silent, log, ctl), skipped]);
    } catch (e) { r = { ok: false, msg: e.message }; }
    current = null;
    if (r.skipped) {
      log('warn', `${a.name} übersprungen`);
      results.push({ key: a.key, ok: false, msg: r.msg });
      prog(1, `${a.name} übersprungen`);
      continue;
    }
    log(r.ok ? 'ok' : 'err', r.ok ? `${a.name} deinstalliert${r.msg ? ` – ${r.msg}` : ''}` : `${a.name}: ${r.msg}`);
    results.push({ key: a.key, ok: r.ok, msg: r.msg });

    if (opts.leftovers) {
      prog(0.75, `Suche Reste von ${a.name} …`);
      const items = await core.findLeftovers(a).catch((e) => (log('err', e.message), []));
      for (const it of items) {
        const id = String(++leftoverSeq);
        leftovers.set(id, it);
        found.push({ id, app: a.name, ...it });
        log('find', `${it.kind === 'reg' ? 'Registry' : it.kind === 'dir' ? 'Ordner' : 'Datei'}: ${it.path}`);
      }
      if (!items.length) log('info', 'Keine Reste gefunden');
    }
    prog(1, `${a.name} fertig`);
  }
  return { results, leftovers: found };
});

ipcMain.handle('skip', () => {
  if (!current) return;
  const { ctl, skip } = current;
  ctl.skip = true;
  ctl.onInteractive?.(false);
  // Uninstaller samt Kindprozessen beenden, damit nichts im Hintergrund weiterläuft
  if (ctl.proc && ctl.proc.pid) execFile('taskkill', ['/T', '/F', '/PID', String(ctl.proc.pid)], { windowsHide: true }, () => {});
  skip({ ok: false, skipped: true, msg: 'Übersprungen' });
});

ipcMain.handle('orphans:scan', async () => {
  if (!appIndex.size) log('warn', 'App-Liste noch nicht geladen – Reste-Suche wartet');
  while (!appIndex.size) await new Promise((r) => setTimeout(r, 500));
  log('info', 'Suche Reste bereits deinstallierter Apps …');
  const items = await core.findOrphans([...appIndex.values()], log);
  log('ok', `${items.length} mögliche Reste gefunden`);
  return items.map((it) => {
    const id = String(++leftoverSeq);
    leftovers.set(id, it);
    return { id, ...it };
  });
});

ipcMain.handle('leftovers:delete', async (_e, ids) => {
  let ok = 0, freed = 0;
  for (let i = 0; i < ids.length; i++) {
    const it = leftovers.get(ids[i]);
    if (!it) continue;
    send('progress', { pct: (i / ids.length) * 100, text: `Lösche ${it.path}` });
    try {
      await core.deleteItem(it);
      ok++; freed += it.size;
      log('ok', `Gelöscht: ${it.path}`);
    } catch (e) { log('err', `Fehler bei ${it.path}: ${e.message}`); }
    leftovers.delete(ids[i]);
  }
  send('progress', { pct: 100, text: 'Bereinigung abgeschlossen' });
  return { ok, failed: ids.length - ok, freed };
});

// ---------- Speicher ----------
ipcMain.handle('clean:cats', () => cleaner.CATS.map(({ id, name, icon, desc, def, admin }) => ({ id, name, icon, desc, def, admin })));

ipcMain.handle('clean:scan', async () => {
  await Promise.all(cleaner.CATS.map(async (c) => {
    const r = await cleaner.scan(c).catch(() => ({ size: 0, count: 0 }));
    send('clean:size', { id: c.id, ...r });
  }));
});

ipcMain.handle('clean:run', async (_e, ids) => {
  const cats = cleaner.CATS.filter((c) => ids.includes(c.id));
  const res = {};
  for (let i = 0; i < cats.length; i++) {
    const c = cats[i];
    send('progress', { pct: (i / cats.length) * 100, text: `Bereinige ${c.name} …`, index: i, total: cats.length });
    log('head', `[${i + 1}/${cats.length}] ${c.name}`);
    if (c.admin && !isAdmin) { log('err', 'Übersprungen: braucht Adminrechte'); continue; }
    try {
      res[c.id] = await cleaner.clean(c, log);
      log('ok', `${c.name}: ${(res[c.id].freed / 1048576).toFixed(1)} MB freigegeben`);
    } catch (e) { log('err', `${c.name}: ${e.message}`); }
  }
  send('progress', { pct: 100, text: 'Bereinigung abgeschlossen' });
  return res;
});

ipcMain.handle('large:scan', async (_e, drive, minBytes) => {
  if (!driveLetters.includes(drive)) return [];
  largeToken.cancel = true;
  const token = (largeToken = { cancel: false });
  log('info', `Suche Dateien ≥ ${Math.round(minBytes / 1048576)} MB auf ${drive}: …`);
  const list = await cleaner.findLarge(drive, minBytes, (p) => send('large:progress', p), token);
  if (token.cancel) return null;
  largeFiles = new Set(list.map((f) => f.path));
  log('ok', `${list.length} große Dateien gefunden`);
  return list;
});
ipcMain.handle('large:cancel', () => { largeToken.cancel = true; });
ipcMain.handle('large:reveal', (_e, p) => largeFiles.has(p) && shell.showItemInFolder(p));
ipcMain.handle('large:trash', async (_e, paths) => {
  let ok = 0;
  for (const p of paths) {
    if (!largeFiles.has(p)) continue;
    try { await shell.trashItem(p); ok++; largeFiles.delete(p); log('ok', `In Papierkorb: ${p}`); } catch (e) { log('err', `${p}: ${e.message}`); }
  }
  return ok;
});

// ---------- Optimieren ----------
ipcMain.handle('opt:bloat', async () => {
  const list = await opt.listBloat(isAdmin);
  bloatIndex = new Map(list.map((b) => [b.id, b]));
  return list;
});
ipcMain.handle('opt:bloatRemove', async (_e, ids, prevent) => {
  const items = ids.map((id) => bloatIndex.get(id)).filter(Boolean);
  const res = {};
  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    send('progress', { pct: (i / items.length) * 100, text: `Entferne ${b.name} …`, index: i, total: items.length });
    log('head', `[${i + 1}/${items.length}] ${b.name}`);
    const r = await opt.removeBloat(b, { admin: isAdmin, prevent }, log).catch((e) => ({ ok: false, msg: e.message }));
    log(r.ok ? 'ok' : 'err', r.ok ? `${b.name} entfernt` : `${b.name}: ${r.msg}`);
    res[b.id] = r.ok;
  }
  send('progress', { pct: 100, text: 'Fertig' });
  return res;
});
ipcMain.handle('opt:tweaks', async () => {
  const states = await opt.tweakStates();
  return opt.TWEAKS.map(({ id, group, name, desc, admin, restartExplorer }) => ({ id, group, name, desc, admin, restartExplorer: !!restartExplorer, on: !!states[id] }));
});
ipcMain.handle('opt:tweak', async (_e, id, on) => {
  const t = opt.TWEAKS.find((x) => x.id === id);
  if (!t) return { ok: false };
  if (t.admin && !isAdmin) { log('err', `${t.name}: braucht Adminrechte`); return { ok: false }; }
  try {
    await (on ? opt.applyTweak(id, log) : opt.revertTweak(id, log));
    log('ok', `${t.name}: ${on ? 'aktiviert' : 'zurückgesetzt'}`);
    return { ok: true };
  } catch (e) {
    log('err', `${t.name}: ${e.message}`);
    return { ok: false };
  }
});
ipcMain.handle('opt:restartExplorer', async () => { await opt.restartExplorer(); log('info', 'Explorer neu gestartet'); });
ipcMain.handle('opt:startup', async () => {
  const list = await opt.listStartup();
  startupIndex = new Map(list.map((e, i) => [String(i), e]));
  return list.map((e, i) => ({ id: String(i), ...e }));
});
ipcMain.handle('opt:startupSet', async (_e, id, enabled) => {
  const e = startupIndex.get(id);
  if (!e) return false;
  try {
    await opt.setStartup(e, enabled);
    log('ok', `Autostart ${e.name}: ${enabled ? 'an' : 'aus'}`);
    return true;
  } catch (err) {
    log('err', `Autostart ${e.name}: ${err.message}${/HKEY_LOCAL_MACHINE/.test(e.approved) && !isAdmin ? ' (braucht Adminrechte)' : ''}`);
    return false;
  }
});
