'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sve-voices-'));
process.env.SVT_VOICE_CONFIG = path.join(dir, 'voice.json');
const voices = require('../main/voices');

test('voices: saves three slots and keeps the other fields', () => {
  fs.writeFileSync(process.env.SVT_VOICE_CONFIG, JSON.stringify({ voice_id: '', model: 'eleven_v3', stability: 0.4 }));
  const r = voices.set([
    { key: 'default', name: 'Mike', id: 'AbCdEfGhIjKlMnOp' },
    { key: 'alternate-2', name: 'Narrator', id: 'ZyXwVuTsRqPoNmLk' },
    { key: 'alternate-3', name: 'Ignored', id: '' }
  ]);
  assert.deepStrictEqual(r.slots.map(s => [s.key, s.name, s.id]), [['default', 'Mike', 'AbCdEfGhIjKlMnOp'], ['alternate-2', 'Narrator', 'ZyXwVuTsRqPoNmLk'], ['alternate-3', '', '']]);
  const raw = JSON.parse(fs.readFileSync(process.env.SVT_VOICE_CONFIG, 'utf8'));
  assert.strictEqual(raw.model, 'eleven_v3');
  assert.strictEqual(raw.stability, 0.4);
  assert.strictEqual(raw.voice_id, 'AbCdEfGhIjKlMnOp');
  assert.deepStrictEqual(raw.voices, { 'alternate-2': 'ZyXwVuTsRqPoNmLk' });
});

test('voices: rejects a bad voice ID', () => {
  assert.throws(() => voices.set([{ key: 'default', id: 'not an id!' }]), /voice ID/);
});

test('voices: tells the agent which voice to use', () => {
  const def = voices.forPrompt('');
  assert.match(def.line, /Default "Mike" voice: my-voice with no --voice/);
  assert.match(def.line, /Alternate 2 "Narrator" \(--voice alternate-2\)/);
  const alt = voices.forPrompt('alternate-2');
  assert.match(alt.line, /my-voice --voice alternate-2/);
  assert.strictEqual(voices.forPrompt('alternate-3').chosen.key, 'default');
});
