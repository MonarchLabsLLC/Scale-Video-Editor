'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const knowledge = require('../main/knowledge');

test('brand knowledge: save, list, rename, attach to a project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sve-k-'));
  knowledge.setRoot(path.join(root, 'Brand Knowledge'));
  const a = knowledge.saveText({ text: '# Acme Plumbing\n\nAcme Plumbing fixes leaks the same day in Tampa, Florida, for busy homeowners.' });
  assert.strictEqual(a.name, 'Acme Plumbing');
  assert.ok(a.words > 5 && a.summary.startsWith('Acme Plumbing fixes'));
  const b = knowledge.saveText({ name: 'Avatar', text: 'Homeowners aged 35 to 60.' });
  assert.strictEqual(knowledge.list().length, 2);
  knowledge.update(b.id, { name: 'Customer avatar' });
  assert.ok(knowledge.list().some(k => k.name === 'Customer avatar'));
  const proj = path.join(root, 'proj');
  fs.mkdirSync(proj);
  const got = knowledge.copyInto([a.uid, b.uid, 'missing'], proj);
  assert.strictEqual(got.length, 2);
  assert.ok(fs.readFileSync(path.join(proj, got[0].file), 'utf8').includes('Tampa'));
  assert.deepStrictEqual(knowledge.copyInto([], proj), []);
  assert.strictEqual(fs.readdirSync(path.join(proj, 'knowledge')).length, 0);
  assert.throws(() => knowledge.saveText({ text: '   ' }));
});

test('every viral format has a sample script with blanks and no nested brackets', () => {
  const d = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'viral', 'viral.json'), 'utf8'));
  assert.strictEqual(d.formats.length, 11);
  for (const f of d.formats) {
    assert.ok(/\[[^\]]+\]/.test(f.sample), f.id);
    for (const line of f.sample.split('\n')) assert.ok(!/\[[^\]]*\[/.test(line), `${f.id}: ${line}`);
  }
});
