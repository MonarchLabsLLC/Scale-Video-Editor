const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const toolkit = require('../main/toolkit');

const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'verify-install.txt'), 'utf8');

test('parse reads every row, its section, status and fix', () => {
  const { rows, summary } = toolkit.parse(sample, '/Users/me');
  assert.ok(rows.length > 40);
  assert.match(summary, /OK/);
  const by = name => rows.find(r => r.part === name);
  assert.equal(by('FFmpeg').status, 'ok');
  assert.equal(by('FFmpeg').section, 'Base software');
  assert.equal(by('skill: hyperframes').section, 'Skills');
  assert.equal(by('Herk Edit Kit').status, 'optional');
  assert.equal(by('Herk Edit Kit').fix, 'step:herk');
  assert.equal(by('Sound effect set').fix, 'step:hyperframes');
  const key = by('ElevenLabs key (voiceover)');
  assert.equal(key.status, 'nokey');
  assert.equal(key.fix, undefined);
  assert.match(key.youRun, /^security add-generic-password /);
  assert.match(by('Your ElevenLabs voice ID').file, /voice\.json$/);
  assert.ok(!rows.some(r => r.detail.includes('/Users/me/')), 'home folder shown as ~');
});

test('only known install steps become fixes', () => {
  const t = '| X | MISSING | run: ./install.sh evil; rm -rf ~ |\n| Y | MISSING | run: ./install.sh whisperx |\n| Z | MISMATCH | run: bash tools/filmcraft-update.sh |';
  const { rows } = toolkit.parse(t, '/Users/me');
  assert.equal(rows[0].fix, undefined);
  assert.equal(rows[1].fix, 'step:whisperx');
  assert.equal(rows[2].fix, 'filmcraft-update');
  assert.deepEqual(toolkit.FIXES['step:whisperx'].args, ['install.sh', 'whisperx']);
  assert.equal(toolkit.FIXES['step:evil'], undefined);
});

test('runFix refuses a fix that is not on the list', async () => {
  await assert.rejects(toolkit.runFix('rm -rf', '', () => {}), /not one the editor runs/);
});
