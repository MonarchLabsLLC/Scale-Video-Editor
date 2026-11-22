const test = require('node:test');
const assert = require('node:assert');
const brief = require('../renderer/lib/brief');

const sample = 'Turn this recording into a Short.\nRecording: [file]\nLength: [30 / 45 / 60] seconds, vertical.\nMusic: [yes / no]   Sound effects: [yes / no]\nText on screen: [low / medium / high / you decide]\nGive me [5] clips.\n\nScript:\n[paste your script]';

test('parses each blank into a question with a label and type', () => {
  const q = brief.parse(sample);
  assert.deepStrictEqual(q.map(x => [x.label, x.type]), [
    ['Recording', 'file'],
    ['Length', 'choice'],
    ['Music', 'choice'],
    ['Sound effects', 'choice'],
    ['Text on screen', 'choice'],
    ['Give me', 'short'],
    ['Script', 'long']
  ]);
  assert.deepStrictEqual(q[1].options, ['30', '45', '60']);
});

test('fast answers pick "you decide" when offered, else the first option', () => {
  const q = brief.parse(sample);
  assert.strictEqual(brief.fastAnswer(q[1]), '30');
  assert.strictEqual(brief.fastAnswer(q[4]), 'you decide');
});

test('missing lists only the file and long blanks that are empty', () => {
  const q = brief.parse(sample);
  assert.deepStrictEqual(brief.missing(q, { 0: '/tmp/a.mov' }).map(x => x.label), ['Script']);
});

test('fill puts answers into the blanks in order', () => {
  const q = brief.parse(sample);
  const out = brief.fill(sample, q, { 0: '/tmp/a.mov', 1: '45', 6: 'Hello world' });
  assert.match(out, /Recording: \/tmp\/a\.mov/);
  assert.match(out, /Length: 45 seconds/);
  assert.match(out, /Music: yes   Sound effects: yes/);
  assert.match(out, /Text on screen: you decide/);
  assert.match(out, /Give me you choose clips/);
  assert.match(out, /Script:\nHello world$/);
  assert.doesNotMatch(out, /\[/);
});

test('every built-in format brief parses', () => {
  global.window = {};
  require('../renderer/data/formats.js');
  for (const f of global.window.SVE_FORMATS) {
    const q = brief.parse(f.brief);
    assert.ok(q.length > 0, f.id);
    assert.doesNotMatch(brief.fill(f.brief, q, {}), /\[[^\]]+\]/, f.id);
  }
});
