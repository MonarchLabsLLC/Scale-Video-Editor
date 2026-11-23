const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');

// The updater requires electron only to open the download page; stub it for Node.
const load = Module._load;
Module._load = function (req, ...rest) { return req === 'electron' ? { shell: { openExternal() {} } } : load.call(this, req, ...rest); };
const updater = require('../main/updater');
Module._load = load;

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' }).trim();
const fakeApp = { isPackaged: false, getVersion: () => '0.0.1', relaunch() {}, exit() {} };

test('a source copy that is behind main updates and asks for a restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sve-upd-'));
  const remote = path.join(root, 'remote.git');
  const seed = path.join(root, 'seed');
  const copy = path.join(root, 'copy');
  git(root, 'init', '--bare', '-b', 'main', remote);
  git(root, 'clone', '-q', remote, seed);
  fs.writeFileSync(path.join(seed, 'a.txt'), 'one');
  git(seed, 'add', '.'); git(seed, 'commit', '-qm', 'one'); git(seed, 'push', '-q', 'origin', 'HEAD:main');
  git(root, 'clone', '-q', '-b', 'main', remote, copy);
  fs.writeFileSync(path.join(seed, 'a.txt'), 'two');
  git(seed, 'commit', '-qam', 'two'); git(seed, 'push', '-q', 'origin', 'HEAD:main');

  updater.init(fakeApp, () => {}, { dir: copy });
  const checked = await updater.check();
  assert.equal(checked.mode, 'source');
  assert.equal(checked.status, 'available');
  assert.equal(checked.behind, 1);

  const applied = await updater.apply();
  assert.equal(applied.status, 'ready');
  assert.equal(fs.readFileSync(path.join(copy, 'a.txt'), 'utf8'), 'two');

  fs.writeFileSync(path.join(copy, 'a.txt'), 'local work');
  fs.writeFileSync(path.join(seed, 'a.txt'), 'three');
  git(seed, 'commit', '-qam', 'three'); git(seed, 'push', '-q', 'origin', 'HEAD:main');
  await updater.check();
  const blocked = await updater.apply();
  assert.equal(blocked.status, 'blocked');
  assert.equal(fs.readFileSync(path.join(copy, 'a.txt'), 'utf8'), 'local work');
  fs.rmSync(root, { recursive: true, force: true });
});

/* ---------- unsigned Mac copies update in place ---------- */

const EventEmitter = require('node:events');
const crypto = require('node:crypto');
const macInstall = require('../main/mac-install');
const onMac = { skip: process.platform !== 'darwin' && 'needs macOS (ditto, codesign, PlistBuddy)' };

// A tiny ad hoc signed .app with a bundle id and a version, like the real one.
function makeBundle(dir, version) {
  const app = path.join(dir, 'Scale Video Editor.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>gg.scale.videoeditor.test</string>
<key>CFBundleExecutable</key><string>run</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>`);
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'run'), '#!/bin/sh\necho ' + version + '\n', { mode: 0o755 });
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app], { stdio: 'ignore' });
  return app;
}
const versionOf = app => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' }).trim();
const waitFor = async (fn, ms = 15000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 50)); } };

function fakeFeed(zip, version, sha512) {
  const info = { version, files: [{ url: 'Scale-Video-Editor-mac.zip', sha512, size: fs.statSync(zip).size }] };
  const up = new EventEmitter();
  up.checkForUpdates = async () => { up.updateInfoAndProvider = { info, provider: { resolveFiles: () => [{ url: new URL('http://feed.test/Scale-Video-Editor-mac.zip') }] } }; up.emit('checking-for-update'); up.emit('update-available', info); return { downloadPromise: null }; };
  const fetched = [];
  const fetch = async url => { fetched.push(String(url)); return new Response(fs.readFileSync(zip), { headers: { 'content-length': String(fs.statSync(zip).size) } }); };
  return { up, fetch, fetched };
}

function setup(version = '0.2.0', { badHash = false, feedVersion = version } = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'sve-mac-'));
  fs.mkdirSync(path.join(root, 'Applications')); fs.mkdirSync(path.join(root, 'build'));
  const target = makeBundle(path.join(root, 'Applications'), '0.1.0');
  const built = makeBundle(path.join(root, 'build'), version);
  const zip = path.join(root, 'update.zip');
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', built, zip]);
  const sha = badHash ? 'AAAA' : crypto.createHash('sha512').update(fs.readFileSync(zip)).digest('base64');
  const feed = fakeFeed(zip, feedVersion, sha);
  const work = path.join(root, 'work');
  updater.init({ ...fakeApp, isPackaged: true, on() {} }, () => {}, { selfUpdate: false, autoUpdater: feed.up, fetch: feed.fetch, workDir: work, target });
  return { root, target, work, feed };
}

test('an unsigned Mac copy downloads, checks and swaps in the new version, with no web page', onMac, async () => {
  const { root, target, work, feed } = setup('0.2.0');
  await updater.check();
  await waitFor(() => updater.get().status === 'ready');
  assert.equal(feed.up.autoDownload, false, 'macOS own updater is not used');
  assert.deepEqual(feed.fetched, ['http://feed.test/Scale-Video-Editor-mac.zip']);
  assert.match(updater.get().message, /Version 0\.2\.0 is ready/);

  // A second check while the update waits does not download again.
  await updater.check();
  assert.equal(feed.fetched.length, 1);

  // The swap waits for the editor to quit; a short-lived process stands in for the editor.
  const editor = require('node:child_process').spawn('/bin/sleep', ['0.5']);
  macInstall.install({ staged: path.join(work, 'new', 'Scale Video Editor.app'), target, workDir: work, relaunch: false, pid: editor.pid });
  await waitFor(() => fs.existsSync(path.join(work, 'result')));
  assert.equal(fs.readFileSync(path.join(work, 'result'), 'utf8').trim(), 'installed');
  assert.equal(versionOf(target), '0.2.0');
  assert.ok(!fs.existsSync(path.join(work, 'previous.app')), 'the old copy is removed');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a download that fails its checksum is not installed and can be retried', onMac, async () => {
  const { root, target } = setup('0.2.0', { badHash: true });
  await updater.check();
  await waitFor(() => updater.get().status === 'available');
  assert.match(updater.get().message, /did not download \(the download did not match its checksum\)/);
  assert.equal(versionOf(target), '0.1.0');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a download with the wrong version is refused', onMac, async () => {
  const { root, target } = setup('0.3.0', { feedVersion: '0.4.0' });
  await updater.check();
  await waitFor(() => updater.get().status === 'available');
  assert.match(updater.get().message, /is version 0\.3\.0, not 0\.4\.0/);
  assert.equal(versionOf(target), '0.1.0');
  fs.rmSync(root, { recursive: true, force: true });
});

test('a copy running from the disk image is told to move to Applications', onMac, async () => {
  assert.deepEqual(macInstall.canReplace('/Volumes/Scale Video Editor/Scale Video Editor.app'), { ok: false, reason: 'dmg' });
  assert.deepEqual(macInstall.canReplace('/private/var/folders/x/AppTranslocation/ABC/d/Scale Video Editor.app'), { ok: false, reason: 'translocated' });
});

test('the fallback never opens an empty releases page and never shows file paths', async () => {
  const up = new EventEmitter();
  up.checkForUpdates = async () => { const e = new Error('Cannot find latest-mac.yml in the latest release artifacts (https://github.com/x/releases/download/v1/latest-mac.yml): HttpError: 404'); up.emit('error', e); throw e; };
  updater.init({ ...fakeApp, isPackaged: true, on() {} }, () => {}, { selfUpdate: true, autoUpdater: up });
  const opened = [];
  Module._load = function (req, ...rest) { return req === 'electron' ? { shell: { openExternal: u => opened.push(u) } } : load.call(this, req, ...rest); };
  try {
    const s = await updater.check();
    assert.equal(s.status, 'error');
    assert.doesNotMatch(s.message, /https?:|\/Users|file:/);
    await updater.apply();
  } finally { Module._load = load; }
  assert.deepEqual(opened, [], 'no page is opened when no release was found');
});
