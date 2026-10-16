// Selbsttest der Sicherheits- und Befehlslogik: node test.js
const assert = require('assert');
const path = require('path');
const c = require('./uninstaller');
const env = process.env;

// Geschützte Pfade dürfen nie gelöscht werden
for (const p of [env.ProgramFiles, env['ProgramFiles(x86)'], env.APPDATA, env.LOCALAPPDATA, env.ProgramData, env.USERPROFILE, env.WINDIR,
  'C:\\', path.join(env.WINDIR, 'System32'), path.join(env.ProgramFiles, 'Common Files'), path.join(env.ProgramData, 'Microsoft'),
  path.join(env.LOCALAPPDATA, 'Microsoft'), path.join(env.ProgramFiles, 'WindowsApps', 'x'), path.join(env.USERPROFILE, 'Desktop'), 'relative\\path']) {
  assert.strictEqual(c.isSafePath(p), false, 'darf nicht löschbar sein: ' + p);
}
assert.ok(c.isSafePath(path.join(env.ProgramFiles, '7-Zip')));
assert.ok(c.isSafePath(path.join(env.APPDATA, 'discord')));

assert.strictEqual(c.isSafeReg('HKEY_CURRENT_USER\\Software\\Microsoft'), false);
assert.strictEqual(c.isSafeReg('HKEY_LOCAL_MACHINE\\SOFTWARE'), false);
assert.strictEqual(c.isSafeReg('HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node'), false);
assert.strictEqual(c.isSafeReg('HKEY_CLASSES_ROOT\\foo'), false);
assert.ok(c.isSafeReg('HKEY_CURRENT_USER\\Software\\7-Zip'));

// Namensabgleich
assert.strictEqual(c.clean('7-Zip 23.01 (x64)'), '7zip');
assert.deepStrictEqual(c.nameVariants({ name: 'Mozilla Firefox (x64 de)', publisher: 'Mozilla' }), ['mozillafirefox', 'firefox']);
assert.ok(!c.nameVariants({ name: 'Google Chrome', publisher: 'Google LLC' }).includes('google'));

// Befehle
const no = () => false, yes = () => true;
assert.strictEqual(c.buildCommand({ uninstall: 'MsiExec.exe /I{11111111-2222-3333-4444-555555555555}', msi: true }, true, no).cmd,
  'msiexec.exe /x {11111111-2222-3333-4444-555555555555} /qn /norestart');
assert.strictEqual(c.buildCommand({ uninstall: '"C:\\P F\\unins000.exe"', keyName: 'App_is1' }, true, no).cmd, '"C:\\P F\\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART');
assert.strictEqual(c.buildCommand({ uninstall: 'C:\\P F\\uninst.exe', location: 'C:\\P F\\', keyName: 'x' }, true, yes).cmd, '"C:\\P F\\uninst.exe" /S _?=C:\\P F');
assert.strictEqual(c.buildCommand({ uninstall: '"C:\\a\\u.exe" /x', quiet: '"C:\\a\\u.exe" /q', keyName: 'x' }, false, no).cmd, '"C:\\a\\u.exe" /x');
assert.strictEqual(c.buildCommand({ uninstall: '"C:\\a\\u.exe" /x', quiet: '"C:\\a\\u.exe" /q', keyName: 'x' }, true, no).cmd, '"C:\\a\\u.exe" /q');

console.log('alle Tests ok');
