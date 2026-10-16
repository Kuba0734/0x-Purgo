// Optimierung: Bloatware, Registry-Tweaks mit Rückgängig, Energieplan, Autostart. Kein Electron-Import.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const E = process.env;
const run = (file, args) => new Promise((res) => execFile(file, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (e, out, err) => res({ ok: !e, out: out || '', err: (err || (e && e.message) || '').trim() })));
const ps = async (script) => {
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
    Buffer.from('[Console]::OutputEncoding=[Text.Encoding]::UTF8;' + script, 'utf16le').toString('base64')]);
  return r;
};
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// ---------- Bloatware ----------
const BLOAT = [
  // Store-Apps
  ['Microsoft.BingNews', 'Microsoft News', 'Store-Apps', true],
  ['Microsoft.BingWeather', 'Wetter', 'Store-Apps', true],
  ['Microsoft.BingSearch', 'Bing-Suche', 'Store-Apps', true],
  ['Microsoft.MicrosoftSolitaireCollection', 'Solitaire Collection', 'Store-Apps', true],
  ['Microsoft.GetHelp', 'Hilfe anfordern', 'Store-Apps', true],
  ['Microsoft.Getstarted', 'Tipps', 'Store-Apps', true],
  ['Microsoft.WindowsFeedbackHub', 'Feedback-Hub', 'Store-Apps', true],
  ['Microsoft.WindowsMaps', 'Karten', 'Store-Apps', true],
  ['Microsoft.People', 'Kontakte', 'Store-Apps', true],
  ['Microsoft.ZuneVideo', 'Filme & TV', 'Store-Apps', true],
  ['Microsoft.MicrosoftOfficeHub', 'Office-Hub / Microsoft 365', 'Store-Apps', true],
  ['Microsoft.SkypeApp', 'Skype', 'Store-Apps', true],
  ['Microsoft.MixedReality.Portal', 'Mixed Reality-Portal', 'Store-Apps', true],
  ['Microsoft.3DBuilder', '3D Builder', 'Store-Apps', true],
  ['Microsoft.Microsoft3DViewer', '3D-Viewer', 'Store-Apps', true],
  ['Microsoft.Print3D', 'Print 3D', 'Store-Apps', true],
  ['Microsoft.Todos', 'Microsoft To Do', 'Store-Apps', false],
  ['Microsoft.PowerAutomateDesktop', 'Power Automate', 'Store-Apps', true],
  ['MicrosoftCorporationII.QuickAssist', 'Remotehilfe', 'Store-Apps', false],
  ['MicrosoftCorporationII.MicrosoftFamily', 'Family Safety', 'Store-Apps', true],
  ['microsoft.windowscommunicationsapps', 'Mail & Kalender', 'Store-Apps', false],
  ['Microsoft.XboxApp', 'Xbox Console Companion', 'Store-Apps', false],
  ['Microsoft.GamingApp', 'Xbox App', 'Store-Apps', false],
  ['Microsoft.XboxGamingOverlay', 'Xbox Game Bar', 'Store-Apps', false],
  ['Microsoft.XboxSpeechToTextOverlay', 'Xbox Sprache-zu-Text', 'Store-Apps', false],
  // Microsoft-Extras
  ['MSTeams', 'Microsoft Teams (privat)', 'Microsoft-Extras', true],
  ['MicrosoftTeams', 'Microsoft Teams (Chat)', 'Microsoft-Extras', true],
  ['Clipchamp.Clipchamp', 'Clipchamp', 'Microsoft-Extras', true],
  ['Microsoft.Copilot', 'Copilot', 'Microsoft-Extras', true],
  ['Microsoft.Windows.Ai.Copilot.Provider', 'Copilot-Anbieter', 'Microsoft-Extras', true],
  ['Microsoft.OutlookForWindows', 'Outlook (neu)', 'Microsoft-Extras', false],
  ['Microsoft.Windows.DevHome', 'Dev Home', 'Microsoft-Extras', true],
  ['Microsoft.YourPhone', 'Smartphone-Link', 'Microsoft-Extras', false],
  // Drittanbieter (von Windows vorinstalliert)
  ['*CandyCrush*', 'Candy Crush', 'Drittanbieter', true],
  ['king.com.*', 'King-Spiele', 'Drittanbieter', true],
  ['*Disney*', 'Disney+', 'Drittanbieter', true],
  ['*Facebook*', 'Facebook', 'Drittanbieter', true],
  ['*Instagram*', 'Instagram', 'Drittanbieter', true],
  ['*TikTok*', 'TikTok', 'Drittanbieter', true],
  ['*Twitter*', 'X / Twitter', 'Drittanbieter', true],
  ['*LinkedIn*', 'LinkedIn', 'Drittanbieter', true],
  ['*AmazonPrimeVideo*', 'Prime Video', 'Drittanbieter', true],
  ['Amazon.com.Amazon', 'Amazon', 'Drittanbieter', true],
  ['*Duolingo*', 'Duolingo', 'Drittanbieter', true],
  ['*Hulu*', 'Hulu', 'Drittanbieter', true],
  ['*McAfee*', 'McAfee (Store)', 'Drittanbieter', true],
  ['*Netflix*', 'Netflix', 'Drittanbieter', false],
  ['SpotifyAB.SpotifyMusic', 'Spotify (Store-Version)', 'Drittanbieter', false],
].map(([match, name, group, def]) => ({ id: match, match, name, group, def }));

function oneDriveSetup() {
  const L = E.LOCALAPPDATA || '';
  const cands = [];
  for (const base of [path.join(L, 'Microsoft', 'OneDrive'), path.join(E.ProgramFiles || '', 'Microsoft OneDrive')]) {
    try { for (const d of fs.readdirSync(base)) cands.push(path.join(base, d, 'OneDriveSetup.exe')); } catch {}
  }
  cands.push(path.join(E.WINDIR, 'System32', 'OneDriveSetup.exe'), path.join(E.WINDIR, 'SysWOW64', 'OneDriveSetup.exe'));
  return cands.filter((c) => fs.existsSync(c)).sort().reverse()[0];
}
const oneDriveInstalled = () => [path.join(E.LOCALAPPDATA || '', 'Microsoft', 'OneDrive', 'OneDrive.exe'), path.join(E.ProgramFiles || '', 'Microsoft OneDrive', 'OneDrive.exe')].some((p) => fs.existsSync(p));

async function listBloat(admin) {
  const r = await ps(`$ErrorActionPreference='SilentlyContinue'; (Get-AppxPackage ${admin ? '-AllUsers' : ''} | Select-Object -ExpandProperty Name | Sort-Object -Unique) -join "\`n"`);
  const names = r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const b of BLOAT) {
    const re = new RegExp('^' + b.match.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
    const hits = names.filter((n) => re.test(n));
    if (hits.length) out.push({ ...b, packages: hits });
  }
  if (oneDriveInstalled()) out.push({ id: 'onedrive', name: 'OneDrive', group: 'Microsoft-Extras', def: false, packages: ['OneDrive'], note: 'Deine Dateien im OneDrive-Ordner bleiben erhalten.' });
  return out;
}

async function removeBloat(item, { admin, prevent }, log) {
  if (item.id === 'onedrive') {
    await run('taskkill', ['/f', '/im', 'OneDrive.exe']);
    const setup = oneDriveSetup();
    if (!setup) return { ok: false, msg: 'OneDriveSetup.exe nicht gefunden' };
    log('cmd', `"${setup}" /uninstall`);
    const r = await run(setup, ['/uninstall', ...(/program files/i.test(setup) ? ['/allusers'] : [])]);
    // aus dem Explorer-Navigationsbereich entfernen
    await run('reg', ['add', 'HKCU\\Software\\Classes\\CLSID\\{018D5C66-4533-4307-9B53-224DE2ED1FE6}', '/v', 'System.IsPinnedToNameSpaceTree', '/t', 'REG_DWORD', '/d', '0', '/f']);
    if (prevent && admin) await run('reg', ['add', 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\OneDrive', '/v', 'DisableFileSyncNGSC', '/t', 'REG_DWORD', '/d', '1', '/f']);
    return r.ok || !oneDriveInstalled() ? { ok: true } : { ok: false, msg: r.err };
  }
  const all = admin ? ' -AllUsers' : '';
  let script = `$ErrorActionPreference='Stop'; Get-AppxPackage${all} -Name ${q(item.match)} | Remove-AppxPackage${all}`;
  if (prevent && admin) script += `; Get-AppxProvisionedPackage -Online | Where-Object { $_.DisplayName -like ${q(item.match)} } | Remove-AppxProvisionedPackage -Online | Out-Null`;
  const r = await ps(script);
  return r.ok ? { ok: true } : { ok: false, msg: r.err.split(/\r?\n/)[0] };
}

// ---------- Tweaks ----------
// r(k, n, t, on, off): Registry-Wert; off = null → Wert löschen. delKey: beim Zurücksetzen ganzen Schlüssel löschen.
const r = (k, n, t, on, off = null, extra = {}) => ({ k, n, t, on, off, ...extra });
const CU = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion';
const CDM = CU + '\\ContentDeliveryManager';
const ADV = CU + '\\Explorer\\Advanced';
const svc = (name, label, desc) => ({ id: 'svc-' + name, group: 'Dienste', name: label, desc, service: name,
  regs: [r('HKLM\\SYSTEM\\CurrentControlSet\\Services\\' + name, 'Start', 'REG_DWORD', 4, 3)] });

const TWEAKS = [
  { id: 'consumer', group: 'Bloatware', name: 'Automatische App-Installation verhindern', desc: 'Windows installiert keine „vorgeschlagenen“ Apps (Candy Crush & Co.) mehr nach.',
    regs: [r('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\CloudContent', 'DisableWindowsConsumerFeatures', 'REG_DWORD', 1),
      r(CDM, 'SilentInstalledAppsEnabled', 'REG_DWORD', 0, 1), r(CDM, 'OemPreInstalledAppsEnabled', 'REG_DWORD', 0, 1), r(CDM, 'PreInstalledAppsEnabled', 'REG_DWORD', 0, 1)] },

  { id: 'telemetry', group: 'Datenschutz', name: 'Telemetrie minimieren', desc: 'Diagnosedaten auf Minimum, keine Feedback-Abfragen, keine personalisierten Erlebnisse, Tracking-Dienst aus.',
    service: 'DiagTrack',
    regs: [r('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection', 'AllowTelemetry', 'REG_DWORD', 0),
      r('HKCU\\Software\\Microsoft\\Siuf\\Rules', 'NumberOfSIUFInPeriod', 'REG_DWORD', 0),
      r(CU + '\\Privacy', 'TailoredExperiencesWithDiagnosticDataEnabled', 'REG_DWORD', 0, 1),
      r('HKLM\\SYSTEM\\CurrentControlSet\\Services\\DiagTrack', 'Start', 'REG_DWORD', 4, 2)] },
  { id: 'ads', group: 'Datenschutz', name: 'Werbung & Tipps aus', desc: 'Werbe-ID, Startmenü-Vorschläge, Sperrbildschirm-Tipps, Empfehlungen und Sync-Werbung im Explorer.',
    regs: [r(CU + '\\AdvertisingInfo', 'Enabled', 'REG_DWORD', 0, 1),
      ...['SubscribedContent-338388Enabled', 'SubscribedContent-338389Enabled', 'SubscribedContent-353694Enabled', 'SubscribedContent-353696Enabled',
        'SubscribedContent-310093Enabled', 'SubscribedContent-338393Enabled', 'SystemPaneSuggestionsEnabled', 'SoftLandingEnabled', 'RotatingLockScreenOverlayEnabled']
        .map((n) => r(CDM, n, 'REG_DWORD', 0, 1)),
      r(ADV, 'Start_IrisRecommendations', 'REG_DWORD', 0, 1), r(ADV, 'ShowSyncProviderNotifications', 'REG_DWORD', 0, 1)] },
  { id: 'bing', group: 'Datenschutz', name: 'Bing-Websuche im Startmenü aus', desc: 'Die Suche im Startmenü durchsucht nur noch deinen PC.',
    regs: [r(CU + '\\Search', 'BingSearchEnabled', 'REG_DWORD', 0, 1), r('HKCU\\Software\\Policies\\Microsoft\\Windows\\Explorer', 'DisableSearchBoxSuggestions', 'REG_DWORD', 1)] },
  { id: 'ai', group: 'Datenschutz', name: 'Copilot, Recall & Widgets aus', desc: 'Copilot-Knopf und KI-Schnappschüsse (Recall) deaktivieren, Widgets/News aus der Taskleiste entfernen.',
    regs: [r('HKCU\\Software\\Policies\\Microsoft\\Windows\\WindowsCopilot', 'TurnOffWindowsCopilot', 'REG_DWORD', 1), r(ADV, 'ShowCopilotButton', 'REG_DWORD', 0, 1),
      r('HKCU\\Software\\Policies\\Microsoft\\Windows\\WindowsAI', 'DisableAIDataAnalysis', 'REG_DWORD', 1),
      r('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI', 'DisableAIDataAnalysis', 'REG_DWORD', 1),
      r('HKLM\\SOFTWARE\\Policies\\Microsoft\\Dsh', 'AllowNewsAndInterests', 'REG_DWORD', 0)] },

  { id: 'power', group: 'Leistung', name: 'Energieplan „Ultimative Leistung“', desc: 'Kein Heruntertakten im Leerlauf. Mehr Stromverbrauch – auf Laptops nicht empfohlen.', special: 'power' },
  { id: 'gaming', group: 'Leistung', name: 'Gaming-Tweaks', desc: 'Spielmodus an, GPU-Planung (HAGS) an, Xbox Game Bar-Aufnahme aus, Mausbeschleunigung aus. Teilweise erst nach Neustart aktiv.',
    regs: [r('HKCU\\Software\\Microsoft\\GameBar', 'AutoGameModeEnabled', 'REG_DWORD', 1), r('HKCU\\Software\\Microsoft\\GameBar', 'AllowAutoGameMode', 'REG_DWORD', 1),
      r('HKLM\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers', 'HwSchMode', 'REG_DWORD', 2, 1),
      r('HKCU\\System\\GameConfigStore', 'GameDVR_Enabled', 'REG_DWORD', 0, 1), r(CU + '\\GameDVR', 'AppCaptureEnabled', 'REG_DWORD', 0, 1),
      r('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR', 'AllowGameDVR', 'REG_DWORD', 0),
      r('HKCU\\Control Panel\\Mouse', 'MouseSpeed', 'REG_SZ', '0', '1'), r('HKCU\\Control Panel\\Mouse', 'MouseThreshold1', 'REG_SZ', '0', '6'),
      r('HKCU\\Control Panel\\Mouse', 'MouseThreshold2', 'REG_SZ', '0', '10')] },
  { id: 'visual', group: 'Leistung', name: 'Visuelle Effekte reduzieren', desc: 'Keine Fenster-/Taskleisten-Animationen, keine Transparenz, Menüs ohne Verzögerung. Explorer-Neustart nötig.',
    restartExplorer: true,
    regs: [r(CU + '\\Explorer\\VisualEffects', 'VisualFXSetting', 'REG_DWORD', 3, 0), r('HKCU\\Control Panel\\Desktop', 'MenuShowDelay', 'REG_SZ', '0', '400'),
      r('HKCU\\Control Panel\\Desktop\\WindowMetrics', 'MinAnimate', 'REG_SZ', '0', '1'), r(ADV, 'TaskbarAnimations', 'REG_DWORD', 0, 1),
      r(CU + '\\Themes\\Personalize', 'EnableTransparency', 'REG_DWORD', 0, 1), r('HKCU\\Software\\Microsoft\\Windows\\DWM', 'EnableAeroPeek', 'REG_DWORD', 0, 1)] },

  { id: 'ext', group: 'Explorer', name: 'Dateiendungen anzeigen', desc: 'Zeigt z. B. „.exe“ und „.pdf“ – schützt vor getarnten Dateien.', restartExplorer: true,
    regs: [r(ADV, 'HideFileExt', 'REG_DWORD', 0, 1)] },
  { id: 'hidden', group: 'Explorer', name: 'Versteckte Dateien anzeigen', desc: 'Zeigt versteckte Ordner wie AppData an.', restartExplorer: true,
    regs: [r(ADV, 'Hidden', 'REG_DWORD', 1, 2)] },
  { id: 'ctxmenu', group: 'Explorer', name: 'Klassisches Rechtsklick-Menü', desc: 'Windows 11 zeigt sofort das volle Kontextmenü statt „Weitere Optionen anzeigen“.', restartExplorer: true,
    regs: [r('HKCU\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\\InprocServer32', '', 'REG_SZ', '', null,
      { delKey: 'HKCU\\Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}' })] },

  svc('Fax', 'Fax', 'Faxdienst – nur nötig, wenn du ein Faxmodem nutzt.'),
  svc('RemoteRegistry', 'Remote-Registrierung', 'Erlaubt Fernzugriff auf die Registry. Sicherheitsrisiko, meist unnötig.'),
  svc('dmwappushservice', 'WAP-Push (Telemetrie)', 'Hilfsdienst für Diagnosedaten.'),
  svc('MapsBroker', 'Offline-Karten', 'Lädt Kartenmaterial herunter – unnötig ohne Karten-App.'),
  svc('RetailDemo', 'Einzelhandels-Demo', 'Nur für Vorführgeräte im Laden.'),
  svc('WMPNetworkSvc', 'Mediaplayer-Netzwerkfreigabe', 'Teilt Mediathek im Netzwerk.'),
  svc('XblGameSave', 'Xbox Live Spielstände', 'Nur für Xbox-/Game-Pass-Spiele nötig.'),
  svc('XblAuthManager', 'Xbox Live Anmeldung', 'Nur für Xbox-/Game-Pass-Spiele nötig.'),
  svc('XboxNetApiSvc', 'Xbox Live Netzwerk', 'Nur für Xbox-/Game-Pass-Spiele nötig.'),
];
// HKLM und auch HKCU\Software\Policies sind nur mit Adminrechten schreibbar
for (const t of TWEAKS) t.admin = !!t.regs && t.regs.some((x) => x.k.startsWith('HKLM') || /\\Policies\\/i.test(x.k));

// ---------- Registry-Helfer ----------
async function readRegs(list) {
  const file = path.join(os.tmpdir(), `bu-reg-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(list.map((x) => ({ k: x.k, n: x.n }))));
  const res = await ps(`$ErrorActionPreference='SilentlyContinue'
$items = Get-Content -LiteralPath ${q(file)} -Raw | ConvertFrom-Json
$out = foreach ($i in $items) {
  $v = $null; $has = $false
  $key = Get-Item -LiteralPath ('Registry::' + $i.k)
  if ($key) { $names = $key.GetValueNames(); if ($names -contains $i.n) { $has = $true; $v = $key.GetValue($i.n, $null, 'DoNotExpandEnvironmentNames') } }
  if ($v -is [byte[]]) { $v = ($v | ForEach-Object { $_.ToString('x2') }) -join '' }
  [pscustomobject]@{ has = $has; v = $v }
}
ConvertTo-Json @($out) -Compress`);
  try { fs.unlinkSync(file); } catch {}
  return JSON.parse(res.out.trim() || '[]');
}
async function writeReg(x, value) {
  const vn = x.n === '' ? ['/ve'] : ['/v', x.n];
  if (value === null || value === undefined) {
    if (x.delKey) return run('reg', ['delete', x.delKey, '/f']);
    return run('reg', ['delete', x.k, ...vn, '/f']);
  }
  return run('reg', ['add', x.k, ...vn, '/t', x.t, '/d', String(value), '/f']);
}

// ---------- Rückgängig ----------
let backupFile = path.join(os.tmpdir(), 'purgo-backup.json');
const setBackupDir = (dir) => { backupFile = path.join(dir, 'optimize-backup.json'); };
const loadBackup = () => { try { return JSON.parse(fs.readFileSync(backupFile, 'utf8')); } catch { return {}; } };
const saveBackup = (b) => { fs.mkdirSync(path.dirname(backupFile), { recursive: true }); fs.writeFileSync(backupFile, JSON.stringify(b, null, 1)); };

const ULTIMATE = 'e9a42b02-d5df-448d-aa00-03f14749eb61';
const HIGH = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e';
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const activeScheme = async () => { const o = (await run('powercfg', ['/getactivescheme'])).out; return { guid: (o.match(GUID) || [])[0], name: (o.match(/\((.*)\)/) || [])[1] || '' }; };

async function tweakStates() {
  const regTweaks = TWEAKS.filter((t) => t.regs);
  const flat = regTweaks.flatMap((t) => t.regs);
  const vals = await readRegs(flat);
  const states = {};
  let i = 0;
  for (const t of regTweaks) {
    // Ausschnitt pro Tweak: every() bricht früh ab und darf den Zähler nicht verschieben
    const mine = vals.slice(i, i + t.regs.length);
    i += t.regs.length;
    states[t.id] = t.regs.every((x, j) => mine[j] && mine[j].has && String(mine[j].v) === String(x.on));
  }
  const s = await activeScheme();
  const b = loadBackup();
  states.power = !!(b.power && b.power.created && s.guid === b.power.created) || /ultimat/i.test(s.name);
  return states;
}

async function applyTweak(id, log) {
  const t = TWEAKS.find((x) => x.id === id);
  if (!t) throw new Error('Unbekannte Optimierung');
  const backup = loadBackup();
  if (t.special === 'power') {
    const cur = await activeScheme();
    let dup = await run('powercfg', ['-duplicatescheme', ULTIMATE]);
    let guid = (dup.out.match(GUID) || [])[0];
    if (!guid) { log('warn', '„Ultimative Leistung“ nicht verfügbar – nutze „Höchstleistung“'); guid = HIGH; }
    const r2 = await run('powercfg', ['/setactive', guid]);
    if (!r2.ok) throw new Error(r2.err || 'powercfg fehlgeschlagen');
    backup.power = { prev: cur.guid, created: guid !== HIGH ? guid : null };
    saveBackup(backup);
    return;
  }
  if (!backup[id]) {
    const vals = await readRegs(t.regs);
    backup[id] = vals.map((v) => (v && v.has ? v.v : null));
    saveBackup(backup);
  }
  const errs = [];
  for (const x of t.regs) {
    const res = await writeReg(x, x.on);
    if (!res.ok) errs.push(`${x.k}\\${x.n}: ${res.err.split(/\r?\n/)[0]}`);
  }
  if (t.service) await run('net', ['stop', t.service]);
  if (errs.length) throw new Error(errs.join(' · '));
}

async function revertTweak(id, log) {
  const t = TWEAKS.find((x) => x.id === id);
  if (!t) throw new Error('Unbekannte Optimierung');
  const backup = loadBackup();
  if (t.special === 'power') {
    const b = backup.power || {};
    await run('powercfg', ['/setactive', b.prev || BALANCED]);
    if (b.created) await run('powercfg', ['/delete', b.created]);
    delete backup.power;
    saveBackup(backup);
    return;
  }
  const old = backup[id];
  if (!old) log('info', 'Kein gesicherter Ursprungszustand – setze Windows-Standardwerte');
  const errs = [];
  for (let i = 0; i < t.regs.length; i++) {
    const x = t.regs[i];
    const res = await writeReg(x, old ? old[i] : x.off);
    if (!res.ok && !/nicht finden|unable to find|cannot find/i.test(res.err)) errs.push(`${x.k}\\${x.n}: ${res.err.split(/\r?\n/)[0]}`);
  }
  delete backup[id];
  saveBackup(backup);
  if (t.service) {
    const st = await readRegs([{ k: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\' + t.service, n: 'Start' }]);
    if (st[0] && st[0].v === 2) await run('net', ['start', t.service]);
  }
  if (errs.length) throw new Error(errs.join(' · '));
}

function restartExplorer() {
  return run('taskkill', ['/f', '/im', 'explorer.exe']).then(() => {
    spawn('explorer.exe', [], { detached: true, stdio: 'ignore' }).unref();
  });
}

// ---------- Autostart ----------
const A = '\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\';
async function listStartup() {
  const res = await ps(`$ErrorActionPreference='SilentlyContinue'
$A='${A}'
function St($hive, $sub, $n) { $k = Get-Item -LiteralPath ("Registry::$hive$A$sub"); if ($k) { $b = $k.GetValue($n); if ($b -is [byte[]]) { return (($b[0] -band 1) -eq 0) } }; return $true }
$res = @()
foreach ($s in @(@('HKEY_CURRENT_USER','\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','Run','Benutzer'), @('HKEY_LOCAL_MACHINE','\\Software\\Microsoft\\Windows\\CurrentVersion\\Run','Run','Alle Benutzer'), @('HKEY_LOCAL_MACHINE','\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run','Run32','Alle Benutzer (32-Bit)'))) {
  $k = Get-Item -LiteralPath ('Registry::' + $s[0] + $s[1]); if (!$k) { continue }
  foreach ($n in $k.GetValueNames()) { if (!$n) { continue }
    $res += [pscustomobject]@{ name = $n; cmd = [string]$k.GetValue($n); source = $s[3]; approved = $s[0] + $A + $s[2]; value = $n; enabled = (St $s[0] $s[2] $n) } }
}
$sh = New-Object -ComObject WScript.Shell
foreach ($f in @(@([Environment]::GetFolderPath('Startup'), 'HKEY_CURRENT_USER', 'Autostart-Ordner'), @([Environment]::GetFolderPath('CommonStartup'), 'HKEY_LOCAL_MACHINE', 'Autostart-Ordner (alle)'))) {
  Get-ChildItem -LiteralPath $f[0] -File | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object {
    $t = if ($_.Extension -eq '.lnk') { $sh.CreateShortcut($_.FullName).TargetPath } else { $_.FullName }
    $res += [pscustomobject]@{ name = $_.BaseName; cmd = [string]$t; source = $f[2]; approved = $f[1] + $A + 'StartupFolder'; value = $_.Name; enabled = (St $f[1] 'StartupFolder' $_.Name) } }
}
ConvertTo-Json @($res) -Compress`);
  return JSON.parse(res.out.trim() || '[]');
}
// Gleiches Format wie der Task-Manager: 02… = an, 03… = aus
async function setStartup(entry, enabled) {
  const res = await run('reg', ['add', entry.approved, '/v', entry.value, '/t', 'REG_BINARY', '/d', (enabled ? '02' : '03') + '0'.repeat(22), '/f']);
  if (!res.ok) throw new Error(res.err.split(/\r?\n/)[0]);
}

module.exports = { BLOAT, TWEAKS, listBloat, removeBloat, tweakStates, applyTweak, revertTweak, restartExplorer, listStartup, setStartup, setBackupDir, readRegs };
