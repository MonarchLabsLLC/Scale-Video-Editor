const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const projects = require('../main/projects');

test('duplicate copies the files with a fresh chat, and rename refuses a taken name', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sve-proj-'));
  projects.setRoot(root);
  const a = projects.create({ name: 'Launch film', engine: 'codex' });
  fs.writeFileSync(path.join(a.dir, 'exports', 'cut.mp4'), 'video');
  projects.appendChat(a.id, { role: 'user', text: 'hi' });
  projects.update(a.id, { session: 'abc' });

  const b = projects.duplicate(a.id);
  assert.equal(b.name, 'Launch film copy');
  assert.equal(b.session, null);
  assert.equal(b.engine, 'codex');
  assert.equal(fs.readFileSync(path.join(b.dir, 'exports', 'cut.mp4'), 'utf8'), 'video');
  assert.deepEqual(projects.readChat(b.id), []);
  assert.equal(projects.readChat(a.id).length, 1);
  assert.equal(projects.duplicate(a.id).name, 'Launch film copy 2');

  assert.throws(() => projects.rename(a.id, 'Launch film copy'), /already exists/);
  assert.equal(projects.rename(a.id, 'Promo').name, 'Promo');
  fs.rmSync(root, { recursive: true, force: true });
});
