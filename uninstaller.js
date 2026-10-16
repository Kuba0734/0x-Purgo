// Kernlogik: Apps auflisten, deinstallieren, Reste finden und löschen. Kein Electron-Import, damit test.js es laden kann.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const env = process.env;
const WINDIR = (env.WINDIR || 'C:\\Windows').toLowerCase();

// ---------- PowerShell ----------
function ps(script) {
  const full = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' + script;
  return new Promise((resolve, reject) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(full, 'utf16le').toString('base64')],
      { maxBuffer: 128 * 1024 * 1024, windowsHide: true },
      (err, out, errOut) => (err ? reject(new Error((errOut || err.message).trim())) : resolve(out)));
  });
}
const psJson = async (script) => {
  const out = (await ps(script)).trim();
  if (!out) return [];
  const v = JSON.parse(out);
  return Array.isArray(v) ? v : [v];
};

// ---------- App-Liste ----------
const LIST_SCRIPT = String.raw`
$ErrorActionPreference='SilentlyContinue'
$res = New-Object System.Collections.ArrayList
$roots = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall','HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall','HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
foreach ($r in $roots) { foreach ($k in (Get-ChildItem $r)) {
  $v = Get-ItemProperty $k.PSPath
  if (!$v.DisplayName -or $v.SystemComponent -eq 1 -or $v.ParentKeyName -or $v.ReleaseType -or !($v.UninstallString -or $v.QuietUninstallString)) { continue }
  [void]$res.Add([pscustomobject]@{ type='win32'; key=$k.Name; keyName=$k.PSChildName; name=[string]$v.DisplayName; publisher=[string]$v.Publisher;
    version=[string]$v.DisplayVersion; installDate=[string]$v.InstallDate; location=[string]$v.InstallLocation; icon=[string]$v.DisplayIcon;
    size=[int64]$v.EstimatedSize*1024; uninstall=[string]$v.UninstallString; quiet=[string]$v.QuietUninstallString; msi=($v.WindowsInstaller -eq 1); url=[string]$v.URLInfoAbout })
}}
$start = @{}; foreach ($s in (Get-StartApps)) { $f = ($s.AppID -split '!')[0]; if (!$start[$f]) { $start[$f] = $s.Name } }
foreach ($p in (Get-AppxPackage | Where-Object { !$_.IsFramework -and !$_.NonRemovable -and !$_.IsResourcePackage -and $_.SignatureKind -ne 'System' })) {
  $n = $start[$p.PackageFamilyName]; $logo = $null
  try {
    [xml]$m = Get-Content -LiteralPath (Join-Path $p.InstallLocation 'AppxManifest.xml') -Raw
    $d = $m.Package.Properties.DisplayName; if (!$n -and $d -and $d -notlike 'ms-resource:*') { $n = $d }
    $l = $m.Package.Properties.Logo
    if ($l) { $lp = Join-Path $p.InstallLocation $l; $logo = (Get-ChildItem -LiteralPath (Split-Path $lp) -Filter ([IO.Path]::GetFileNameWithoutExtension($lp) + '*' + [IO.Path]::GetExtension($lp)) | Sort-Object Length -Descending | Select-Object -First 1).FullName }
  } catch {}
  if (!$n) { $n = $p.Name }
  [void]$res.Add([pscustomobject]@{ type='store'; key=$p.PackageFullName; keyName=$p.PackageFamilyName; name=[string]$n; publisher=($p.Publisher -replace '^CN=([^,]+).*','$1');
    version=$p.Version.ToString(); installDate=(Get-Item -LiteralPath $p.InstallLocation).CreationTime.ToString('yyyyMMdd'); location=[string]$p.InstallLocation; icon=[string]$logo; size=0 })
}
$res | ConvertTo-Json -Depth 3 -Compress`;

async function listApps() {
  const apps = await psJson(LIST_SCRIPT);
  const seen = new Set();
  // gleiche App kann in 32/64-Bit-Zweig doppelt stehen
  return apps.filter((a) => {
    const id = a.type + '|' + a.name + '|' + a.version;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

async function dirSize(p) {
  let total = 0;
  const stack = [p];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(full);
      else { try { total += (await fsp.stat(full)).size; } catch {} }
    }
  }
  return total;
}
async function pathSize(p) {
  try {
    const st = await fsp.lstat(p);
    return st.isDirectory() ? dirSize(p) : st.size;
  } catch { return 0; }
}

// ---------- Deinstallieren ----------
function exePath(cmd) {
  const s = (cmd || '').trim();
  if (s.startsWith('"')) return s.slice(1, s.indexOf('"', 1));
  const m = s.match(/^(.*?\.exe)/i);
  return m ? m[1] : s.split(' ')[0];
}
// Unquotierte Pfade mit Leerzeichen würden in cmd.exe brechen
function quoteExe(cmd) {
  const s = (cmd || '').trim();
  if (s.startsWith('"')) return s;
  const exe = exePath(s);
  return `"${exe}"${s.slice(exe.length)}`;
}

function isNsis(exe) {
  try {
    if (fs.statSync(exe).size > 40 * 1024 * 1024) return false;
    return fs.readFileSync(exe).includes('Nullsoft');
  } catch { return false; }
}

function buildCommand(app, silent, nsisCheck = isNsis) {
  const u = app.uninstall || '';
  const guid = (u.match(/\{[0-9A-F-]{36}\}/i) || [])[0] || (/^\{[0-9A-F-]{36}\}$/i.test(app.keyName) ? app.keyName : null);
  if ((app.msi || /msiexec/i.test(u)) && guid) {
    return { kind: 'MSI', silent, cmd: `msiexec.exe /x ${guid}${silent ? ' /qn /norestart' : ''}` };
  }
  if (silent && app.quiet) return { kind: 'Quiet-String', silent: true, cmd: quoteExe(app.quiet) };
  const base = quoteExe(u);
  if (silent && /_is1$/i.test(app.keyName)) {
    return { kind: 'Inno Setup', silent: true, cmd: `${base} /VERYSILENT /SUPPRESSMSGBOXES /NORESTART` };
  }
  if (silent && nsisCheck(exePath(u))) {
    const loc = (app.location || '').replace(/[\\"]+$/, '');
    // _?= lässt NSIS synchron laufen (sonst kopiert es sich nach %TEMP% und kehrt sofort zurück)
    return { kind: 'NSIS', silent: true, cmd: `${base} /S${loc ? ` _?=${loc}` : ''}` };
  }
  return { kind: 'Standard', silent: false, cmd: base };
}

// Start-Process statt cmd: zeigt bei Bedarf die UAC-Abfrage (cmd scheitert still mit 740)
// und -Wait wartet auch auf Kindprozesse, die NSIS/Inno nach %TEMP% kopieren
function run(cmd, ctl = {}) {
  const s = cmd.trim();
  const exe = exePath(s);
  const args = s.slice(s.startsWith('"') ? exe.length + 2 : exe.length).trim();
  const q = (v) => "'" + v.replace(/'/g, "''") + "'";
  const script = `$p = Start-Process -FilePath ${q(exe)}${args ? ' -ArgumentList ' + q(args) : ''} -Wait -PassThru -ErrorAction Stop; exit $p.ExitCode`;
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    ctl.proc = p;
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { ctl.err = e.message; resolve(-1); });
    p.on('exit', (code) => { if (err.trim()) ctl.err = err.trim().split(/\r?\n/)[0]; resolve(code); });
  });
}
const regExists = (key) => new Promise((r) => execFile('reg.exe', ['query', key], { windowsHide: true }, (e) => r(!e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function killFromLocation(loc, log) {
  if (!loc || !isSafePath(loc)) return;
  const out = await ps(`$ErrorActionPreference='SilentlyContinue'; $l='${loc.replace(/'/g, "''").replace(/\\+$/, '')}\\*'; Get-Process | Where-Object { $_.Path -like $l } | ForEach-Object { $_.Name; Stop-Process -Id $_.Id -Force }`).catch(() => '');
  const names = out.split(/\r?\n/).filter(Boolean);
  if (names.length) log('warn', `Beendete Prozesse: ${[...new Set(names)].join(', ')}`);
}

// ctl.skip = true (von außen gesetzt) bricht das Warten ab; ctl.proc ist der laufende Uninstaller
async function uninstall(app, silent, log, ctl = {}) {
  if (app.type === 'store') {
    log('info', `Remove-AppxPackage ${app.key}`);
    try {
      await ps(`$ErrorActionPreference='Stop'; Remove-AppxPackage -Package '${app.key.replace(/'/g, "''")}'`);
      return { ok: true };
    } catch (e) { return { ok: false, msg: e.message.split('\n')[0] }; }
  }
  await killFromLocation(app.location, log);
  if (app.type === 'portable') {
    // Kein Uninstaller vorhanden: Ordner + Launcher-Manifest (Steam .acf / Epic .item) direkt löschen
    for (const p of [app.location, ...(app.extraFiles || [])]) {
      if (!isSafePath(p)) return { ok: false, msg: `Geschützter Pfad: ${p}` };
      log('info', `Lösche ${p}`);
      try { await fsp.rm(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch (e) { return { ok: false, msg: e.message }; }
    }
    return { ok: true };
  }
  const c = buildCommand(app, silent);
  log('info', `Methode: ${c.kind}${c.silent ? ' (still)' : ' (mit Dialog)'}`);
  if (silent && !c.silent) log('warn', 'Kein stiller Modus bekannt – der Hersteller-Dialog wird geöffnet');
  log('cmd', c.cmd);
  if (!c.silent) { log('info', 'Bitte den Uninstaller-Dialog bedienen (Fenster wird minimiert) …'); ctl.onInteractive?.(true); }
  const code = await run(c.cmd, ctl);
  if (!c.silent) ctl.onInteractive?.(false);
  if (ctl.err && !ctl.skip) log('err', `Start fehlgeschlagen: ${ctl.err}`);
  if (ctl.skip) return { ok: false, skipped: true, msg: 'Übersprungen' };
  log('info', `Uninstaller beendet mit Code ${code}`);
  // Viele Uninstaller starten einen Kindprozess und kehren sofort zurück → warten bis der Registry-Eintrag weg ist
  const deadline = Date.now() + (c.silent ? 120e3 : 600e3);
  let gone = !(await regExists(app.key));
  if (!gone) log('info', 'Warte auf Abschluss der Deinstallation …');
  while (!gone && !ctl.skip && Date.now() < deadline) { await sleep(1500); gone = !(await regExists(app.key)); }
  if (ctl.skip) return { ok: false, skipped: true, msg: 'Übersprungen' };
  if (gone) return { ok: true, msg: code === 3010 ? 'Neustart erforderlich' : '' };
  return { ok: false, msg: code === 1602 ? 'Vom Benutzer abgebrochen' : `Eintrag noch vorhanden (Code ${code})` };
}

// ---------- Reste ----------
const PUB_STOP = /\b(inc|llc|ltd|gmbh|corp|corporation|co|company|software|technologies|limited|ag|sa|srl|bv)\b\.?/g;
function clean(s) {
  return (s || '').toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/\bv?\d+(\.\d+)+\b|\b(x64|x86|amd64|arm64|64-bit|32-bit|64bit|32bit|version)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function nameVariants(app) {
  const pub = clean((app.publisher || '').toLowerCase().replace(PUB_STOP, ''));
  const n = clean(app.name);
  const set = new Set([n]);
  if (pub && n.startsWith(pub) && n.length - pub.length >= 3) set.add(n.slice(pub.length));
  const loc = clean(path.basename((app.location || '').replace(/[\\/"]+$/, '')));
  if (loc && loc.length >= 3 && (n.includes(loc) || loc.includes(n))) set.add(loc);
  return [...set].filter((v) => v.length >= 3);
}

const BASES = [
  env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.ProgramData, env.APPDATA, env.LOCALAPPDATA,
  env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.USERPROFILE && path.join(env.USERPROFILE, 'AppData', 'LocalLow'),
].filter(Boolean);
const LINK_DIRS = [
  env.APPDATA && path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  env.ProgramData && path.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  env.USERPROFILE && path.join(env.USERPROFILE, 'Desktop'),
  env.PUBLIC && path.join(env.PUBLIC, 'Desktop'),
].filter(Boolean);
const norm = (p) => path.resolve(p).toLowerCase().replace(/\\+$/, '');
let DRIVE_BASES = []; // Wurzeln aller Festplatten, gesetzt über setDrives()
const allBases = () => [...BASES, ...DRIVE_BASES];
function setDrives(letters) {
  const known = new Set(BASES.map(norm));
  DRIVE_BASES = letters.flatMap((l) => [`${l}:\\`, `${l}:\\Program Files`, `${l}:\\Program Files (x86)`, `${l}:\\Games`])
    .filter((p) => !known.has(norm(p)) && fs.existsSync(p));
}
const PROTECTED = new Set([...BASES, ...LINK_DIRS, env.USERPROFILE, env.PUBLIC, env.SystemDrive + '\\', env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Packages'),
  env.USERPROFILE && path.join(env.USERPROFILE, 'Documents'), env.USERPROFILE && path.join(env.USERPROFILE, 'AppData'),
  path.join(env.SystemDrive || 'C:', 'Users')].filter(Boolean).map(norm));

// Darf dieser Pfad gelöscht werden? Muss unterhalb eines bekannten Basisordners liegen und darf nie ein Systemordner sein.
function isSafePath(p) {
  if (!p || !path.isAbsolute(p)) return false;
  const n = norm(p);
  if (PROTECTED.has(n) || n === WINDIR || n.startsWith(WINDIR + '\\')) return false;
  if (n.includes('\\windowsapps') || DENY.has(clean(path.basename(n)))) return false;
  const roots = [...allBases(), ...LINK_DIRS, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Packages')].filter(Boolean).map(norm);
  if (roots.includes(n)) return false;
  return roots.some((r) => n.startsWith(r + '\\'));
}

// Ordner-/Schlüsselnamen, die nie gelöscht werden, egal wie die App heißt
const DENY = new Set(['microsoft', 'classes', 'policies', 'wow6432node', 'clients', 'registeredapplications', 'windows', 'odbc',
  'commonfiles', 'microsoftshared', 'windowsapps', 'packages', 'programs', 'temp', 'microsoftnet', 'windowsdefender', 'windowsnt', 'packagecache',
  'users', 'programfiles', 'programfilesx86', 'programdata', 'recovery', 'systemvolumeinformation', 'recyclebin', 'perflogs', 'boot', 'efi',
  'documentsandsettings', 'windowsold', 'games', 'steamlibrary', 'steamapps', 'common', 'epicgames', 'xboxgames', 'modifiablewindowsapps']);
const REG_DENY = DENY;
const REG_ROOTS = ['HKEY_CURRENT_USER\\Software', 'HKEY_LOCAL_MACHINE\\SOFTWARE', 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node'];
function isSafeReg(k) {
  const parts = (k || '').split('\\');
  if (!REG_ROOTS.some((r) => k.toLowerCase().startsWith(r.toLowerCase() + '\\'))) return /\\CurrentVersion\\Uninstall\\.+/i.test(k);
  return parts.length >= 3 && !REG_DENY.has(parts[parts.length - 1].toLowerCase()) && !REG_DENY.has(clean(parts[parts.length - 1]));
}

async function findLeftovers(app) {
  const found = new Map();
  const add = async (kind, p) => {
    if (found.has(p.toLowerCase())) return;
    if (kind === 'reg' ? !isSafeReg(p) : !isSafePath(p)) return;
    found.set(p.toLowerCase(), { kind, path: p, size: kind === 'reg' ? 0 : await pathSize(p) });
  };
  const exists = (p) => fs.existsSync(p);

  if (app.type === 'store') {
    const pk = path.join(env.LOCALAPPDATA, 'Packages', app.keyName);
    if (exists(pk)) await add('dir', pk);
    return [...found.values()];
  }

  const names = nameVariants(app);
  const pub = clean((app.publisher || '').toLowerCase().replace(PUB_STOP, ''));
  const matches = (entry) => names.includes(clean(entry.replace(/\.lnk$/i, '')));

  const loc = (app.location || '').replace(/[\\"]+$/, '');
  if (loc && exists(loc)) await add('dir', loc);

  const scan = async (dir, linksOnly) => {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (linksOnly && e.isFile() && !/\.lnk$/i.test(e.name)) continue;
      if (matches(e.name)) await add(e.isDirectory() ? 'dir' : 'file', full);
      else if (e.isDirectory() && pub && clean(e.name) === pub) await scan(full, linksOnly); // Hersteller-Unterordner
    }
  };
  for (const b of allBases()) await scan(b, false);
  for (const d of LINK_DIRS) await scan(d, true);

  // Registry: Kinder von Software-Wurzeln (+ Hersteller-Schlüssel) nach Namen abgleichen
  const regScript = `$ErrorActionPreference='SilentlyContinue'; $pub=${JSON.stringify(pub)}
foreach ($r in 'HKCU:\\Software','HKLM:\\SOFTWARE','HKLM:\\SOFTWARE\\WOW6432Node') { foreach ($k in (Get-ChildItem $r)) {
  $k.Name; if ($pub -and (($k.PSChildName.ToLower() -replace '[^a-z0-9]','') -eq $pub)) { (Get-ChildItem $k.PSPath).Name } } }`;
  const keys = (await ps(regScript).catch(() => '')).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const k of keys) if (matches(k.split('\\').pop())) await add('reg', k);
  if (app.type === 'win32' && (await regExists(app.key))) await add('reg', app.key);

  // Unterpfade von bereits gefundenen Ordnern weglassen
  const items = [...found.values()];
  return items.filter((i) => !items.some((o) => o !== i && o.kind === i.kind && i.path.toLowerCase().startsWith(o.path.toLowerCase() + '\\')));
}

async function deleteItem(item) {
  if (item.kind === 'reg') {
    if (!isSafeReg(item.path)) throw new Error('Geschützter Schlüssel');
    await new Promise((res, rej) => execFile('reg.exe', ['delete', item.path, '/f'], { windowsHide: true }, (e, o, err) => (e ? rej(new Error((err || e.message).trim())) : res())));
    return;
  }
  if (!isSafePath(item.path)) throw new Error('Geschützter Pfad');
  await fsp.rm(item.path, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
}

// ---------- Apps ohne Registry-Eintrag (Steam, Epic, Ordner mit EXE) ----------
async function readdirSafe(d) { try { return await fsp.readdir(d, { withFileTypes: true }); } catch { return []; } }
async function mainExe(dir) {
  let best = null;
  const consider = async (d) => {
    for (const e of await readdirSafe(d)) {
      if (!e.isFile() || !/\.exe$/i.test(e.name) || /unins|setup|crash|updat|helper|redist|install/i.test(e.name)) continue;
      const full = path.join(d, e.name);
      const size = (await fsp.stat(full).catch(() => ({ size: 0 }))).size;
      if (!best || size > best.size) best = { path: full, size };
    }
  };
  await consider(dir);
  if (!best) for (const e of await readdirSafe(dir)) if (e.isDirectory()) await consider(path.join(dir, e.name));
  return best && best.path;
}

async function findUnregistered(apps, letters) {
  const out = [];
  const names = new Set(apps.map((a) => clean(a.name)));
  const locs = apps.map((a) => (a.location || '').replace(/"/g, '')).filter((l) => l.length > 3).map(norm);
  // nested=true: Ordner darf in einem registrierten Ordner liegen (z. B. Spiele unter dem Launcher-Ordner)
  const add = async (o, nested) => {
    if (!o.name || !o.location || !fs.existsSync(o.location) || names.has(clean(o.name)) || !isSafePath(o.location)) return;
    const n = norm(o.location);
    if (locs.some((l) => l === n || l.startsWith(n + '\\') || (!nested && n.startsWith(l + '\\')))) return;
    names.add(clean(o.name)); locs.push(n);
    const st = await fsp.stat(o.location).catch(() => null);
    out.push({
      type: 'portable', key: 'dir:' + o.location, keyName: '', name: o.name, publisher: o.source, source: o.source, version: o.version || '',
      installDate: st ? st.birthtime.toISOString().slice(0, 10).replace(/-/g, '') : '', location: o.location, size: o.size || 0,
      icon: o.icon || (await mainExe(o.location)) || '', uninstall: '', extraFiles: o.extraFiles || [],
    });
  };

  const epicDir = path.join(env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  for (const e of await readdirSafe(epicDir)) {
    if (!/\.item$/i.test(e.name)) continue;
    try {
      const m = JSON.parse(await fsp.readFile(path.join(epicDir, e.name), 'utf8'));
      await add({ name: m.DisplayName, location: m.InstallLocation, version: m.AppVersionString, size: m.InstallSize, source: 'Epic Games',
        icon: m.LaunchExecutable && path.join(m.InstallLocation, m.LaunchExecutable), extraFiles: [path.join(epicDir, e.name)] }, true);
    } catch {}
  }

  const steamApp = apps.find((a) => /^steam$/i.test(a.name));
  const steamRoot = (steamApp && steamApp.location ? steamApp.location : path.join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam')).replace(/"/g, '');
  const libs = new Map([[norm(steamRoot), steamRoot]]);
  try {
    const vdf = await fsp.readFile(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) { const p = m[1].replace(/\\\\/g, '\\'); libs.set(norm(p), p); }
  } catch {}
  for (const lib of libs.values()) {
    const sa = path.join(lib, 'steamapps');
    for (const e of await readdirSafe(sa)) {
      if (!/^appmanifest_\d+\.acf$/i.test(e.name)) continue;
      const txt = await fsp.readFile(path.join(sa, e.name), 'utf8').catch(() => '');
      const get = (k) => (txt.match(new RegExp(`"${k}"\\s+"([^"]*)"`, 'i')) || [])[1];
      if (!get('installdir')) continue;
      await add({ name: get('name'), location: path.join(sa, 'common', get('installdir')), size: +get('SizeOnDisk') || 0, source: 'Steam', extraFiles: [path.join(sa, e.name)] }, true);
    }
  }

  const sys = (env.SystemDrive || 'C:')[0].toUpperCase();
  for (const l of letters) {
    const roots = l === sys ? [`${l}:\\Games`] : [`${l}:\\`, `${l}:\\Games`, `${l}:\\Program Files`, `${l}:\\Program Files (x86)`];
    for (const r of roots) {
      for (const e of await readdirSafe(r)) {
        if (!e.isDirectory() || /^[$.]/.test(e.name) || DENY.has(clean(e.name))) continue;
        const loc = path.join(r, e.name);
        if (fs.existsSync(path.join(loc, 'steamapps'))) continue; // Steam-Bibliothek, Spiele kommen oben
        const exe = await mainExe(loc);
        if (exe) await add({ name: e.name, location: loc, source: 'Ordner', icon: exe });
      }
    }
  }
  return out;
}

// ---------- Reste bereits deinstallierter Apps ----------
// Ordner-/Schlüsselnamen von System, Treibern und Entwickler-Tools, die nie als Rest gelten
const ORPHAN_SKIP = new Set(['packages', 'programs', 'temp', 'npm', 'npmcache', 'pip', 'nodegyp', 'yarn', 'pnpm', 'cache', 'caches', 'crashdumps',
  'd3dscache', 'connecteddevicesplatform', 'comms', 'history', 'publishers', 'virtualstore', 'placeholdertilelogofolder', 'peerdistrepub',
  'ssh', 'usoshared', 'usoprivate', 'softwaredistribution', 'microsofthelp', 'nvidia', 'nvidiacorporation', 'amd', 'ati', 'intel', 'realtek',
  'dell', 'hp', 'lenovo', 'asus', 'msi', 'khronos', 'appdatalow', 'elevateddiagnostics', 'iconcache', 'fontcache', 'gtk', 'bulkuninstaller', 'purgo',
  'electron', 'squirreltemp', 'regid199106commicrosoft', 'wsl', 'docker', 'chromium', 'policies', 'sysinternals', 'classes',
  // Windows-/Framework-Komponenten in Program Files ohne eigenen Uninstall-Eintrag
  'dotnet', 'internetexplorer', 'msbuild', 'referenceassemblies', 'nuget', 'uninstallinformation', 'difx', 'windowsmail', 'windowsmediaplayer',
  'windowsphotoviewer', 'windowsportabledevices', 'windowssidebar', 'windowspowershell', 'windowsdefenderadvancedthreatprotection', 'iis',
  'iisexpress', 'microsoftsqlserver', 'microsoftvisualstudio', 'commonfiles', 'easyanticheat', 'easyanticheateos', 'battleye', 'git', 'packagecache']);

async function findOrphans(apps, log = () => {}) {
  // PowerShell-Fehler nicht verschlucken: einmal wiederholen, sonst im Log melden
  const psTry = (script, what) => ps(script).catch(() => ps(script))
    .catch((e) => { log('warn', `${what} fehlgeschlagen: ${e.message.split('\n')[0]}`); return ''; });
  const out = [];
  const known = [];
  for (const a of apps) {
    known.push(...nameVariants(a), clean((a.publisher || '').toLowerCase().replace(PUB_STOP, '')),
      clean(path.basename((a.location || '').replace(/[\\/"]+$/, ''))));
  }
  const kv = [...new Set(known.filter((v) => v.length >= 3))];
  const locs = apps.map((a) => (a.location || '').replace(/"/g, '')).filter((l) => l.length > 3).map(norm);
  // gehört der Name zu irgendeiner installierten App (oder ist er zu kurz/generisch)?
  const owned = (name) => {
    const c = clean(name);
    if (c.length < 3 || DENY.has(c) || ORPHAN_SKIP.has(c) || /^(microsoft|windows|nvidia|amd|intel)/.test(c)) return true;
    return kv.some((v) => v === c || (c.length >= 4 && v.includes(c)) || (v.length >= 4 && c.includes(v)));
  };
  const cutoff = Date.now() - 14 * 864e5; // kürzlich benutzte Ordner gehören vermutlich zu etwas Aktivem

  // 1) Ordner in AppData, ProgramData und Program Files
  const bases = [...new Map([...BASES, ...DRIVE_BASES.filter((b) => /\\program files/i.test(b))].map((b) => [norm(b), b])).values()];
  for (const b of bases) {
    for (const e of await readdirSafe(b)) {
      if (!e.isDirectory() || /^[$.]/.test(e.name) || owned(e.name)) continue;
      const full = path.join(b, e.name);
      const n = norm(full);
      if (!isSafePath(full) || locs.some((l) => l === n || l.startsWith(n + '\\'))) continue;
      const st = await fsp.stat(full).catch(() => null);
      if (!st || st.mtimeMs > cutoff) continue;
      out.push({ kind: 'dir', group: 'Verwaiste Ordner', path: full, size: await pathSize(full), mtime: st.mtimeMs, sure: false });
    }
  }

  // 2) Registry: HKCU\Software ohne passende App
  const keys = (await psTry(`$ErrorActionPreference='SilentlyContinue'; (Get-ChildItem 'HKCU:\\Software').Name`, 'Registry-Suche')).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const k of keys) {
    if (!owned(k.split('\\').pop()) && isSafeReg(k)) out.push({ kind: 'reg', group: 'Verwaiste Registry-Schlüssel', path: k, size: 0, sure: false });
  }

  // 3) Verknüpfungen, deren Ziel nicht mehr existiert
  const lnkScript = `$ErrorActionPreference='SilentlyContinue'; $w = New-Object -ComObject WScript.Shell
foreach ($d in ${LINK_DIRS.map((d) => `'${d.replace(/'/g, "''")}'`).join(',')}) { Get-ChildItem -LiteralPath $d -Recurse -Filter *.lnk | ForEach-Object { $_.FullName + '|' + $w.CreateShortcut($_.FullName).TargetPath } }`;
  for (const line of (await psTry(lnkScript, 'Verknüpfungs-Suche')).split(/\r?\n/)) {
    const [lnk, target] = line.trim().split('|');
    // nur lokale Dateiziele prüfen (keine URLs, Shell-Ordner, Netzlaufwerke)
    if (lnk && /^[a-z]:\\/i.test(target || '') && !fs.existsSync(target) && isSafePath(lnk)) {
      out.push({ kind: 'file', group: 'Kaputte Verknüpfungen', path: lnk, size: 0, sure: true, note: target });
    }
  }

  // 4) Uninstall-Einträge, deren Programm schon weg ist
  for (const a of apps) {
    if (a.type !== 'win32' || a.msi || /msiexec/i.test(a.uninstall)) continue;
    const exe = exePath(a.quiet || a.uninstall);
    const loc = (a.location || '').replace(/"/g, '');
    if (/^[a-z]:\\/i.test(exe) && !fs.existsSync(exe) && (!loc || !fs.existsSync(loc)) && isSafeReg(a.key)) {
      out.push({ kind: 'reg', group: 'Kaputte Programm-Einträge', path: a.key, size: 0, sure: true, note: a.name });
    }
  }
  return out;
}

module.exports = { findOrphans, mainExe, setDrives, findUnregistered, listApps, pathSize, uninstall, findLeftovers, deleteItem, buildCommand, clean, nameVariants, isSafePath, isSafeReg, exePath, quoteExe };
