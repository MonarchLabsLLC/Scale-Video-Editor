// Updates for Scale Video Editor.
//
// Two ways the editor can be installed, so two ways to update it:
//
//  - "source": cloned from GitHub and run with `npm start` (what the install prompt does).
//    Checking runs `git fetch`; updating runs `git pull --ff-only` on main, then `npm install`
//    when package.json or package-lock.json changed. It never discards local work: it refuses
//    when the folder has uncommitted changes or is on another branch.
//
//  - "release": a .dmg, .exe or .AppImage from GitHub Releases. electron-updater downloads the
//    new version in the background and installs it on restart. macOS only allows this for a
//    code-signed app; if the update cannot be installed, the editor offers the download page.
//
// The state goes to the window on every change, so the sidebar and Settings always agree.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

let REPO_DIR = path.join(__dirname, '..');
const RELEASES_URL = 'https://github.com/MonarchLabsLLC/Scale-Video-Editor/releases/latest';

let app = null;
let send = () => {};
let releaseUpdater = null;
let state = { mode: 'none', status: 'idle', current: '', latest: '', behind: 0, message: '', checkedAt: 0 };

function set(patch) {
  state = { ...state, ...patch };
  send(state);
  return state;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: REPO_DIR, timeout: opts.timeout || 60_000, maxBuffer: 8 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (err) { err.stderr = String(stderr || '').trim(); reject(err); } else resolve(String(stdout).trim());
    });
  });
}
const git = (...args) => run('git', args);

function detectMode() {
  if (app.isPackaged) return 'release';
  if (fs.existsSync(path.join(REPO_DIR, '.git'))) return 'source';
  return 'none';
}

/* ---------- source installs (git) ---------- */

async function checkSource() {
  const head = await git('rev-parse', '--short', 'HEAD');
  set({ current: `${app.getVersion()} (${head})` });
  await run('git', ['fetch', '--quiet', 'origin', 'main'], { timeout: 30_000 });
  const behind = Number(await git('rev-list', '--count', 'HEAD..origin/main')) || 0;
  const latest = await git('rev-parse', '--short', 'origin/main');
  return set({ status: behind ? 'available' : 'current', behind, latest, message: behind ? `${behind} new change${behind === 1 ? '' : 's'} on GitHub.` : 'You have the latest version.' });
}

async function applySource() {
  const branch = await git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') return set({ status: 'blocked', message: `This copy is on the branch "${branch}", not main. Switch to main to update here.` });
  const dirty = await git('status', '--porcelain', '--untracked-files=no');
  if (dirty) return set({ status: 'blocked', message: 'This copy has changes that are not committed. Commit or stash them, then update.' });
  set({ status: 'downloading', message: 'Getting the new version…' });
  const before = await git('rev-parse', 'HEAD');
  await run('git', ['pull', '--ff-only', '--quiet', 'origin', 'main'], { timeout: 120_000 });
  const changed = await git('diff', '--name-only', before, 'HEAD');
  if (/^package(-lock)?\.json$/m.test(changed)) {
    set({ message: 'Installing new dependencies…' });
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { timeout: 600_000 });
  }
  const head = await git('rev-parse', '--short', 'HEAD');
  return set({ status: 'ready', behind: 0, current: `${app.getVersion()} (${head})`, message: 'Updated. Restart the editor to use the new version.' });
}

/* ---------- release installs (electron-updater) ---------- */

function loadReleaseUpdater() {
  if (releaseUpdater) return releaseUpdater;
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', message: 'Checking for updates…' }));
  autoUpdater.on('update-not-available', () => set({ status: 'current', message: 'You have the latest version.', checkedAt: Date.now() }));
  autoUpdater.on('update-available', info => set({ status: 'downloading', latest: info.version, message: `Version ${info.version} is downloading…` }));
  autoUpdater.on('download-progress', p => set({ status: 'downloading', message: `Downloading version ${state.latest}: ${Math.round(p.percent)}%` }));
  autoUpdater.on('update-downloaded', info => set({ status: 'ready', latest: info.version, message: `Version ${info.version} is ready. Restart the editor to use it.` }));
  autoUpdater.on('error', err => set({ status: 'manual', message: `The update could not install by itself (${String(err && err.message || err).split('\n')[0]}). Download the new version instead.` }));
  releaseUpdater = autoUpdater;
  return autoUpdater;
}

/* ---------- public ---------- */

function init(electronApp, sendToWindow, opts = {}) {
  app = electronApp;
  if (opts.dir) REPO_DIR = opts.dir;
  send = sendToWindow;
  state.mode = detectMode();
  state.current = app.getVersion();
}

async function check() {
  if (state.status === 'downloading') return state;
  set({ status: 'checking', message: 'Checking for updates…' });
  try {
    if (state.mode === 'source') return await checkSource().finally(() => set({ checkedAt: Date.now() }));
    if (state.mode === 'release') { await loadReleaseUpdater().checkForUpdates(); return state; }
    return set({ status: 'unsupported', message: 'This copy was not installed from GitHub, so it cannot update itself.' });
  } catch (err) {
    return set({ status: 'error', checkedAt: Date.now(), message: `Could not check for updates: ${(err.stderr || err.message || String(err)).split('\n')[0]}` });
  }
}

async function apply() {
  try {
    if (state.mode === 'source') return await applySource();
    if (state.mode === 'release') {
      if (state.status === 'ready') return state;
      if (state.status === 'manual') { require('electron').shell.openExternal(RELEASES_URL); return state; }
      return check();
    }
    return state;
  } catch (err) {
    return set({ status: 'error', message: `The update did not finish: ${(err.stderr || err.message || String(err)).split('\n')[0]}` });
  }
}

function restart() {
  if (state.mode === 'release' && state.status === 'ready' && releaseUpdater) { releaseUpdater.quitAndInstall(); return; }
  app.relaunch();
  app.exit(0);
}

module.exports = { init, check, apply, restart, get: () => state, RELEASES_URL };
