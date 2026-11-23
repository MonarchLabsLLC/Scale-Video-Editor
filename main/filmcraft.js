// FilmCraft connection: find the app and its CLI, start the app with its control bridge,
// check the bridge, render Program frames, and check GitHub for a newer release.
// FilmCraft is never modified. Everything goes through its public CLI, bridge and MCP.
// The control token is read from the control file and passed only through environment
// variables to child processes. It is never logged, printed or sent to the window.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');

const RELEASES_API = 'https://api.github.com/repos/storytold/filmcraft/releases/latest';
const RELEASES_PAGE = 'https://github.com/storytold/filmcraft/releases/latest';
const DEFAULT_PORT = 9876;
const exe = process.platform === 'win32' ? '.exe' : '';

function controlFile() {
  return path.join(os.homedir(), '.config', 'filmcraft', 'control.env');
}

// Reads the control file. Makes one (port + random token, owner-only) when it is missing,
// in the same format the FilmCraft helper scripts use, so both stay compatible.
function readControl({ create = false } = {}) {
  const file = controlFile();
  if (!fs.existsSync(file)) {
    if (!create) return null;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const token = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, `FILMCRAFT_CONTROL_TOKEN=${token}\nFILMCRAFT_CONTROL_PORT=${DEFAULT_PORT}\n`, { mode: 0o600 });
  }
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return {
    port: Number(out.FILMCRAFT_CONTROL_PORT) || DEFAULT_PORT,
    token: out.FILMCRAFT_CONTROL_TOKEN || ''
  };
}

function onPath(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    const p = path.join(d, name + exe);
    if (d && fs.existsSync(p)) return p;
  }
  return null;
}

function findCli() {
  const candidates = [
    onPath('filmcraft-cli'),
    path.join(os.homedir(), '.local', 'bin', 'filmcraft-cli' + exe),
    path.join(os.homedir(), '.cargo', 'bin', 'filmcraft-cli' + exe),
    '/opt/homebrew/bin/filmcraft-cli',
    '/usr/local/bin/filmcraft-cli',
    process.platform === 'win32' && path.join(process.env.LOCALAPPDATA || '', 'Programs', 'FilmCraft', 'filmcraft-cli.exe')
  ];
  return candidates.find(p => p && fs.existsSync(p)) || null;
}

function findApp() {
  if (process.platform === 'darwin') {
    const p = ['/Applications/FilmCraft.app', path.join(os.homedir(), 'Applications', 'FilmCraft.app')].find(fs.existsSync);
    return p || null;
  }
  if (process.platform === 'win32') {
    const p = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'FilmCraft', 'FilmCraft.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'FilmCraft', 'FilmCraft.exe')
    ].find(fs.existsSync);
    return p || null;
  }
  return onPath('filmcraft') || onPath('FilmCraft') || null;
}

function run(file, args, opts = {}) {
  return new Promise(resolve => {
    execFile(file, args, { timeout: opts.timeout || 20000, env: opts.env || process.env, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

function portOpen(port, host = '127.0.0.1', timeout = 800) {
  return new Promise(resolve => {
    const s = net.connect({ port, host });
    const done = ok => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

function cliEnv(control) {
  return { ...process.env, FILMCRAFT_CONTROL_TOKEN: control ? control.token : '' };
}

async function version(cli) {
  if (!cli) return null;
  const r = await run(cli, ['--version'], { timeout: 8000 });
  const m = r.stdout.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : null;
}

function newer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

let latestCache = null;
async function latestRelease() {
  if (latestCache && Date.now() - latestCache.at < 30 * 60 * 1000) return latestCache.value;
  try {
    const res = await fetch(RELEASES_API, { headers: { 'User-Agent': 'scale-video-editor', Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const value = { version: String(j.tag_name || '').replace(/^v/, ''), url: j.html_url || RELEASES_PAGE };
    latestCache = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

async function status() {
  const cli = findCli();
  const app = findApp();
  const control = readControl();
  const bridge = control ? await portOpen(control.port) : false;
  const cliVersion = await version(cli);
  // Never hold the status for GitHub: wait at most 1.5 s, then use what came back last time.
  const latest = await Promise.race([latestRelease(), new Promise(r => setTimeout(() => r(latestCache ? latestCache.value : null), 1500))]);
  return {
    installed: Boolean(cli || app),
    cli: Boolean(cli),
    app: Boolean(app),
    cliVersion,
    latest: latest ? latest.version : null,
    releasesPage: latest ? latest.url : RELEASES_PAGE,
    updateAvailable: Boolean(cliVersion && latest && latest.version && newer(latest.version, cliVersion)),
    bridge,
    port: control ? control.port : DEFAULT_PORT,
    appRunningWithoutBridge: !bridge && await appRunning()
  };
}

async function appRunning() {
  if (process.platform === 'win32') {
    const r = await run('tasklist', ['/FI', 'IMAGENAME eq FilmCraft.exe'], { timeout: 5000 });
    return /FilmCraft\.exe/i.test(r.stdout);
  }
  const r = await run('pgrep', ['-x', 'FilmCraft'], { timeout: 5000 });
  return r.ok && r.stdout.trim().length > 0;
}

// Starts FilmCraft with its control bridge. Refuses when FilmCraft is already open without
// the bridge, because restarting it could lose unsaved work: the person must quit it first.
async function startBridge(projectFile) {
  const control = readControl({ create: true });
  if (await portOpen(control.port)) return { ok: true, already: true };
  if (await appRunning()) {
    return { ok: false, reason: 'FilmCraft is open without its control bridge. Save your work, quit FilmCraft, then click Connect again.' };
  }
  const app = findApp();
  if (!app) return { ok: false, reason: 'FilmCraft is not installed.' };
  const args = ['--control', String(control.port)];
  if (projectFile) args.push(projectFile); else args.push('--empty');
  const env = { ...process.env, FILMCRAFT_CONTROL_TOKEN: control.token };
  // The token goes in the environment, never on the command line, where other processes can read it.
  const bin = process.platform === 'darwin' ? path.join(app, 'Contents', 'MacOS', 'FilmCraft') : app;
  spawn(bin, args, { detached: true, stdio: 'ignore', env }).unref();
  for (let i = 0; i < 40; i++) {
    if (await portOpen(control.port)) return { ok: true };
    await new Promise(r => setTimeout(r, 750));
  }
  return { ok: false, reason: 'FilmCraft started, but its control bridge did not answer.' };
}

function bridgeArgs(control) {
  return ['--bridge', `127.0.0.1:${control.port}`];
}

async function inspectSequence() {
  const cli = findCli();
  const control = readControl();
  if (!cli || !control) return null;
  const r = await run(cli, [...bridgeArgs(control), 'inspect', 'sequence'], { env: cliEnv(control), timeout: 15000 });
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

// Renders one Program frame of the live app's active sequence to a PNG and returns its path.
async function renderFrame(seconds, outDir) {
  const cli = findCli();
  const control = readControl();
  if (!cli || !control) return { ok: false, reason: 'FilmCraft is not connected.' };
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `frame-${Date.now()}.png`);
  const r = await run(cli, [...bridgeArgs(control), 'render', '--seconds', String(Math.max(0, seconds || 0)), '--out', out, '--scale', '0.5', '--allow-offline'],
    { env: cliEnv(control), timeout: 60000 });
  if (!fs.existsSync(out)) return { ok: false, reason: (r.stderr || r.stdout).trim().split('\n').slice(-1)[0] || 'No frame came back.' };
  return { ok: true, file: out };
}

module.exports = {
  controlFile, readControl, findCli, findApp, status, startBridge, inspectSequence, renderFrame,
  portOpen, newer, RELEASES_PAGE
};
