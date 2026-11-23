'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('../main/filmcraft');

function fakeApp(dir) {
  if (process.platform === 'darwin') {
    const app = path.join(dir, 'FilmCraft.app');
    fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'FilmCraft'), '');
    return app;
  }
  const app = path.join(dir, process.platform === 'win32' ? 'filmcraft.exe' : 'filmcraft');
  fs.writeFileSync(app, '');
  return app;
}

test('a chosen FilmCraft app is used first, and cleared again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sve-fc-'));
  const app = fakeApp(dir);
  assert.ok(fc.validApp(app));
  fc.setPaths({ app });
  assert.strictEqual(fc.findApp(), app);
  fc.setPaths({});
  assert.notStrictEqual(fc.findApp(), app);
});

test('the CLI is not taken for the app, and the CLI next to the app is found', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sve-fc-'));
  const exe = process.platform === 'win32' ? '.exe' : '';
  const cli = path.join(dir, 'filmcraft-cli' + exe);
  fs.writeFileSync(cli, '');
  assert.strictEqual(fc.validApp(cli), false);
  assert.strictEqual(fc.validApp(path.join(dir, 'missing.app')), false);
  if (process.platform !== 'darwin') assert.strictEqual(fc.cliNextTo(fakeApp(dir)), cli);
});
