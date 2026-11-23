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
