const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const winspawn = require('../main/winspawn');

const SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*
`;

// An npm install in a folder with a space in its name, like nvm under "Author Software".
function fakeInstall() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sve spaced '));
  const bin = path.join(dir, 'node_modules', '@openai', 'codex', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'codex.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
  fs.writeFileSync(path.join(dir, 'codex.cmd'), SHIM);
  fs.copyFileSync(process.execPath, path.join(dir, 'node.exe'));
  return dir;
}

test('winspawn: macOS and Linux start the file as it is', () => {
  assert.deepStrictEqual(winspawn.prepare('/usr/local/bin/codex', ['login'], 'darwin'), { file: '/usr/local/bin/codex', args: ['login'], options: {} });
});

test('winspawn: a Windows .exe starts directly, with no shell', () => {
  const r = winspawn.prepare('C:\\Users\\a b\\.local\\bin\\claude.exe', ['-p'], 'win32');
  assert.strictEqual(r.file, 'C:\\Users\\a b\\.local\\bin\\claude.exe');
  assert.deepStrictEqual(r.args, ['-p']);
});

test('winspawn: cmd.exe arguments are quoted and their line breaks removed', () => {
  assert.strictEqual(winspawn.quoteForCmd('a b', false), '^"a^ b^"');
  assert.ok(!winspawn.quoteForCmd('one\ntwo', false).includes('\n'));
});

test('winspawn: an npm shim in a folder with a space runs its node script directly', { skip: process.platform !== 'win32' }, () => {
  const dir = fakeInstall();
  const shim = path.join(dir, 'codex.cmd');
  const args = ['login', 'status', 'line one\nline "two" & 100%'];
  const r = winspawn.prepare(shim, args);
  assert.strictEqual(r.file, path.join(dir, 'node.exe'));
  assert.strictEqual(r.args[0], path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'));
  const out = execFileSync(r.file, r.args, { encoding: 'utf8', ...r.options });
  assert.deepStrictEqual(JSON.parse(out), args);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('winspawn: a .cmd that is not an npm shim still runs through cmd.exe with a space in its path', { skip: process.platform !== 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sve spaced '));
  const bat = path.join(dir, 'echo args.cmd');
  fs.writeFileSync(bat, '@echo off\r\necho %1\r\n');
  const r = winspawn.prepare(bat, ['hello & world']);
  const out = execFileSync(r.file, r.args, { encoding: 'utf8', ...r.options });
  assert.strictEqual(out.trim(), '"hello & world"');
  fs.rmSync(dir, { recursive: true, force: true });
});
