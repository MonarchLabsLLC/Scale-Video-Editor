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
//    new version in the background and installs it on restart. macOS's own updater works only
//    for an app signed with a Developer ID, so an unsigned Mac copy updates itself instead
//    (main/mac-install.js): it downloads the new .zip, checks it, and swaps the app on restart.
//
// The state goes to the window on every change, so the sidebar and Settings always agree.

const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawnSync } = require('node:child_process');

let REPO_DIR = path.join(__dirname, '..');
const REPO_URL = 'https://github.com/MonarchLabsLLC/Scale-Video-Editor';
const RELEASES_URL = `${REPO_URL}/releases/latest`;
const macInstall = require('./mac-install');

let app = null;
let send = () => {};
let releaseUpdater = null;
let selfUpdate = null; // can this release copy install updates by itself?
let injectedUpdater = null;
let fetchFn = null;      // for the Mac in-place download
let workDir = null;      // where the Mac in-place update is staged
let staged = null;       // { version, app } once a Mac in-place update is downloaded and checked
let macBusy = false;
let installing = false;
let targetOverride = null; // tests: the .app to replace
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

// macOS (Squirrel.Mac) installs an update only into an app signed with a Developer ID. An
// unsigned or ad hoc signed copy would download the whole update and then fail to install it.
function canSelfUpdate() {
  if (process.platform !== 'darwin') return true;
  const bundle = path.resolve(process.execPath, '..', '..', '..');
  const r = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', bundle], { encoding: 'utf8', timeout: 10_000 });
  return /Authority=Developer ID Application/.test(`${r.stdout || ''}${r.stderr || ''}`);
}

// One short line for the window: no file paths, no stack, no cache folders.
const shortError = err => {
  const m = String(err && err.message || err).split('\n')[0];
  if (/code signature|did not pass validation|code requirement/i.test(m)) return 'macOS would not accept the new version';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|fetch failed/i.test(m)) return 'no connection to GitHub';
  if (/HTTP 404|status 404|Cannot find latest|No published versions/i.test(m)) return 'no published release was found';
  const clean = m.replace(/(file:\/\/)?\/[^\s"')]+/g, '').replace(/\s+/g, ' ').trim();
  return clean.length > 90 ? clean.slice(0, 87) + '…' : clean || 'unknown problem';
};

const releasePage = () => state.latest ? `${REPO_URL}/releases/tag/v${state.latest}` : RELEASES_URL;

/* Mac copies without a Developer ID: download, check and stage the new app ourselves. */

function macFileUrl(updater, info) {
  const file = (info.files || []).find(f => /\.zip$/i.test(f.url));
  if (!file) throw new Error('this release has no Mac .zip');
  let url = null;
  try {
    const it = updater.updateInfoAndProvider;
    const hit = it && it.provider.resolveFiles(it.info).find(f => /\.zip$/i.test(String(f.url)));
    if (hit) url = String(hit.url);
  } catch {}
  return { url: url || `${REPO_URL}/releases/download/v${info.version}/${file.url}`, sha512: file.sha512, size: file.size };
}

async function macDownload(updater, info) {
  if (staged && staged.version === info.version) return set({ status: 'ready', latest: info.version, message: `Version ${info.version} is ready. Restart the editor to use it.` });
  if (macBusy) return state;
  const target = targetOverride || macInstall.bundleOf(process.execPath);
  const where = macInstall.canReplace(target);
  if (!where.ok) {
    return set({ status: 'manual', latest: info.version, message: where.reason === 'dmg' || where.reason === 'translocated'
      ? `Version ${info.version} is out. Move Scale Video Editor to your Applications folder and open it from there, so it can update itself.`
      : `Version ${info.version} is out, but this copy is in a folder it cannot change. Move it to your Applications folder.` });
  }
  macBusy = true;
  try {
    const file = macFileUrl(updater, info);
    set({ status: 'downloading', latest: info.version, message: `Version ${info.version} is downloading…` });
    const newApp = await macInstall.stage({
      fetchFn: fetchFn || ((...a) => require('electron').net.fetch(...a)),
      url: file.url, sha512: file.sha512, size: file.size, version: info.version,
      workDir: workDir || macInstall.defaultWorkDir(), currentApp: target,
      onProgress: pct => set({ status: 'downloading', message: `Downloading version ${info.version}: ${pct}%` })
    });
    staged = { version: info.version, app: newApp, target };
    return set({ status: 'ready', message: `Version ${info.version} is ready. Restart the editor to use it.` });
  } catch (err) {
    return set({ status: 'available', message: `Version ${info.version} did not download (${shortError(err)}). Click Update now to try again.` });
  } finally {
    macBusy = false;
  }
}

function macInstallStaged(relaunch) {
  if (!staged || installing) return false;
  installing = true;
  macInstall.install({ staged: staged.app, target: staged.target, workDir: path.dirname(path.dirname(staged.app)), relaunch });
  return true;
}

function loadReleaseUpdater() {
  if (releaseUpdater) return releaseUpdater;
  const autoUpdater = injectedUpdater || require('electron-updater').autoUpdater;
  if (selfUpdate === null) selfUpdate = canSelfUpdate();
  autoUpdater.autoDownload = selfUpdate;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', message: 'Checking for updates…' }));
  autoUpdater.on('update-not-available', () => set({ status: 'current', message: 'You have the latest version.', checkedAt: Date.now() }));
  autoUpdater.on('update-available', info => {
    if (selfUpdate) return set({ status: 'downloading', latest: info.version, message: `Version ${info.version} is downloading…` });
    set({ latest: info.version, checkedAt: Date.now() });
    return macDownload(autoUpdater, info);
  });
  autoUpdater.on('download-progress', p => set({ status: 'downloading', message: `Downloading version ${state.latest}: ${Math.round(p.percent)}%` }));
  autoUpdater.on('update-downloaded', info => set({ status: 'ready', latest: info.version, message: `Version ${info.version} is ready. Restart the editor to use it.` }));
  autoUpdater.on('error', err => {
    if (!selfUpdate) return; // the in-place Mac path reports its own errors
    if (state.latest) set({ status: 'manual', message: `The update could not install by itself (${shortError(err)}). Download version ${state.latest} instead.` });
    else set({ status: 'error', checkedAt: Date.now(), message: `Could not check for updates (${shortError(err)}).` });
  });
  // An update downloaded in place on a Mac is also installed when the editor quits.
  if (!selfUpdate && app && typeof app.on === 'function') app.on('will-quit', () => { macInstallStaged(false); });
  releaseUpdater = autoUpdater;
  return autoUpdater;
}

/* ---------- public ---------- */

function init(electronApp, sendToWindow, opts = {}) {
  app = electronApp;
  if (opts.dir) REPO_DIR = opts.dir;
  if (typeof opts.selfUpdate === 'boolean') selfUpdate = opts.selfUpdate;
  if (opts.autoUpdater) { injectedUpdater = opts.autoUpdater; releaseUpdater = null; }
  if (opts.fetch) fetchFn = opts.fetch;
  if (opts.workDir) workDir = opts.workDir;
  if (opts.target) targetOverride = opts.target;
  send = sendToWindow;
  staged = null; macBusy = false; installing = false;
  state = { ...state, status: 'idle', latest: '', message: '' };
  state.mode = detectMode();
  state.current = app.getVersion();
}

async function check() {
  if (state.status === 'downloading' || (state.status === 'ready' && staged)) return state;
  set({ status: 'checking', message: 'Checking for updates…' });
  try {
    if (state.mode === 'source') return await checkSource().finally(() => set({ checkedAt: Date.now() }));
    if (state.mode === 'release') {
      const result = await loadReleaseUpdater().checkForUpdates();
      // A failed download is already reported through the 'error' event.
      if (result && result.downloadPromise) result.downloadPromise.catch(() => {});
      return state;
    }
    return set({ status: 'unsupported', message: 'This copy was not installed from GitHub, so it cannot update itself.' });
  } catch (err) {
    if (state.status === 'manual' || state.status === 'downloading') return state;
    return set({ status: 'error', checkedAt: Date.now(), message: `Could not check for updates (${shortError(err.stderr || err)}).` });
  }
}

async function apply() {
  try {
    if (state.mode === 'source') return await applySource();
    if (state.mode === 'release') {
      if (state.status === 'ready') return state;
      // Never send anyone to an empty releases page: only open the page of a release we found.
      if (state.status === 'manual' && state.latest) { require('electron').shell.openExternal(releasePage()); return state; }
      if (state.status === 'available' && !selfUpdate && releaseUpdater && releaseUpdater.updateInfoAndProvider) {
        return macDownload(releaseUpdater, releaseUpdater.updateInfoAndProvider.info);
      }
      return check();
    }
    return state;
  } catch (err) {
    return set({ status: 'error', message: `The update did not finish (${shortError(err.stderr || err)}).` });
  }
}

function restart() {
  if (state.mode === 'release' && state.status === 'ready' && staged) { macInstallStaged(true); app.quit(); return; }
  if (state.mode === 'release' && state.status === 'ready' && releaseUpdater) { releaseUpdater.quitAndInstall(); return; }
  app.relaunch();
  app.exit(0);
}

module.exports = { init, check, apply, restart, get: () => state, RELEASES_URL };
