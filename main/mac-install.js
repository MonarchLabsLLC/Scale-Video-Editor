// In-place updates for a Mac copy that is not signed with a Developer ID.
//
// macOS's own updater (Squirrel.Mac) refuses to install into such a copy, so the editor does
// the same job itself, the way command-line tools update:
//
//   1. download the new release's .zip and check its SHA-512 against latest-mac.yml,
//   2. unpack it with ditto and check the new app: same bundle id, the expected version and a
//      valid code signature (ad hoc is fine),
//   3. after the editor quits, a small shell script swaps the old .app for the new one (and
//      puts the old one back if the swap fails), then opens the new version.
//
// A copy that runs from the .dmg, from a translocated (quarantined) location or from a folder
// the user cannot write to cannot replace itself; canReplace() says so and why.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');

const run = (cmd, args, timeout = 120_000) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) { err.stderr = String(stderr || '').trim(); reject(err); } else resolve(String(stdout).trim());
  });
});

// The .app bundle that holds this process: .../Name.app/Contents/MacOS/Name -> .../Name.app
const bundleOf = execPath => path.resolve(execPath, '..', '..', '..');

const plistValue = (app, key) => run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, path.join(app, 'Contents', 'Info.plist')], 10_000);

function canReplace(target) {
  if (!target.endsWith('.app')) return { ok: false, reason: 'not-bundle' };
  if (target.startsWith('/Volumes/')) return { ok: false, reason: 'dmg' };
  if (target.includes('/AppTranslocation/')) return { ok: false, reason: 'translocated' };
  try { fs.accessSync(path.dirname(target), fs.constants.W_OK); fs.accessSync(target, fs.constants.W_OK); }
  catch { return { ok: false, reason: 'read-only' }; }
  return { ok: true };
}

// Stream a URL to a file, hashing as it goes. onProgress gets a number from 0 to 100.
async function download(fetchFn, url, file, { size = 0, onProgress = () => {} } = {}) {
  const res = await fetchFn(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || size;
  const hash = crypto.createHash('sha512');
  const out = fs.createWriteStream(file);
  let got = 0;
  let last = -1;
  try {
    for await (const chunk of res.body) {
      const buf = Buffer.from(chunk);
      hash.update(buf);
      got += buf.length;
      if (!out.write(buf)) await new Promise(r => out.once('drain', r));
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct !== last) { last = pct; onProgress(pct); }
    }
  } finally {
    await new Promise(r => out.end(r));
  }
  return hash.digest('base64');
}

// Download, check and unpack the update. Returns the path of the new, checked .app.
async function stage({ fetchFn, url, sha512, size, version, workDir, currentApp, onProgress }) {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  const zip = path.join(workDir, 'update.zip');
  const digest = await download(fetchFn, url, zip, { size, onProgress });
  if (sha512 && digest !== sha512) throw new Error('the download did not match its checksum');

  const unpacked = path.join(workDir, 'new');
  await run('/usr/bin/ditto', ['-x', '-k', zip, unpacked]);
  fs.rmSync(zip, { force: true });
  const name = fs.readdirSync(unpacked).find(n => n.endsWith('.app'));
  if (!name) throw new Error('the download has no app in it');
  const app = path.join(unpacked, name);

  const [wantId, id, gotVersion] = await Promise.all([
    plistValue(currentApp, 'CFBundleIdentifier'),
    plistValue(app, 'CFBundleIdentifier'),
    plistValue(app, 'CFBundleShortVersionString')
  ]);
  if (id !== wantId) throw new Error('the download is a different app');
  if (version && gotVersion !== version) throw new Error(`the download is version ${gotVersion}, not ${version}`);
  try { await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]); }
  catch { throw new Error('the downloaded app failed its code signature check'); }
  await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', app]).catch(() => {});
  return app;
}

// Runs after the editor quits: wait for it to exit, swap the bundles, open the new one.
const SWAP_SCRIPT = `#!/bin/sh
pid="$1"; new="$2"; target="$3"; relaunch="$4"; work="$5"
i=0
while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 600 ]; do sleep 0.1; i=$((i+1)); done
backup="$work/previous.app"
rm -rf "$backup"
if mv "$target" "$backup"; then
  if mv "$new" "$target"; then
    rm -rf "$backup"
    echo installed > "$work/result"
  else
    mv "$backup" "$target"
    echo failed > "$work/result"
  fi
else
  echo failed > "$work/result"
fi
if [ "$relaunch" = "1" ]; then open "$target"; fi
`;

// Start the swap in a detached process. The caller quits the app right after.
function install({ staged, target, workDir, relaunch, pid = process.pid }) {
  const script = path.join(workDir, 'install.sh');
  fs.writeFileSync(script, SWAP_SCRIPT, { mode: 0o755 });
  fs.rmSync(path.join(workDir, 'result'), { force: true });
  const child = spawn('/bin/sh', [script, String(pid), staged, target, relaunch ? '1' : '0', workDir], { detached: true, stdio: 'ignore' });
  child.unref();
  return child;
}

const defaultWorkDir = () => path.join(os.tmpdir(), 'scale-video-editor-update');

module.exports = { bundleOf, canReplace, download, stage, install, defaultWorkDir, SWAP_SCRIPT };
