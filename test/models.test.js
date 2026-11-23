'use strict';
const test = require('node:test');
const assert = require('node:assert');
const models = require('../main/models');

test('Claude: newest version per family, Fable only when the plan offers it', () => {
  const json = {
    additionalModelOptionsCache: [{ value: 'claude-fable-5-2[1m]', label: 'Fable' }],
    additionalModelCostsCache: { 'claude-opus-4-8': {}, 'claude-opus-5-5': {}, 'claude-sonnet-5-5': {}, 'claude-haiku-4-5-20251001': {}, 'claude-haiku-5-5': {}, 'claude-fable-5-2': {} }
  };
  const l = models.parseClaude(json, 'opus');
  assert.deepStrictEqual(l.models.map(m => [m.id, m.label]), [['fable', 'Fable 5.2'], ['opus', 'Opus 5.5'], ['sonnet', 'Sonnet 5.5'], ['haiku', 'Haiku 5.5']]);
  assert.ok(l.effortFlag);
  assert.deepStrictEqual(l.models[1].efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepStrictEqual(l.models[3].efforts, []);
  const noFable = models.parseClaude({ additionalModelCostsCache: { 'claude-fable-5-2': {} } }, '');
  assert.ok(!noFable.models.some(m => m.id === 'fable'));
  assert.strictEqual(models.parseClaude({}, '').models[0].label, 'Opus (newest)');
});

test('Codex: hidden models are left out, efforts come from the catalog', () => {
  const l = models.parseCodex({ models: [
    { slug: 'gpt-6.2-sol', display_name: 'GPT-6.2-Sol', visibility: 'list', default_reasoning_level: 'low', supported_reasoning_levels: [{ effort: 'high' }, { effort: 'low' }, { effort: 'medium' }] },
    { slug: 'secret', visibility: 'hide', supported_reasoning_levels: [] }
  ] }, 'model = "gpt-6.2-sol"\nmodel_reasoning_effort = "high"\n');
  assert.deepStrictEqual(l.models.map(m => m.id), ['gpt-6.2-sol']);
  assert.deepStrictEqual(l.models[0].efforts, ['low', 'medium', 'high']);
  assert.strictEqual(l.fallback, 'Codex setting (gpt-6.2-sol, high)');
});

test('Cursor: effort variants become one model', () => {
  const l = models.parseCursor(['Available models', '', 'auto - Auto (current, default)',
    'claude-opus-5-5-low - Claude Opus 5.5 1M Low', 'claude-opus-5-5-medium - Claude Opus 5.5 1M',
    'claude-opus-5-5-high - Claude Opus 5.5 1M High', 'claude-opus-5-5-xhigh-fast - Claude Opus 5.5 1M Extra High Fast',
    'gpt-5.3-codex - Codex 5.3', 'gpt-5.3-codex-high - Codex 5.3 High', 'grok-4.7-low-fast - Grok 4.7  Low Fast​​'].join('\n'));
  const by = Object.fromEntries(l.models.map(m => [m.id, m]));
  assert.strictEqual(by.auto.label, 'Auto');
  assert.deepStrictEqual(by['claude-opus-5-5'].efforts, ['low', 'medium', 'high']);
  assert.strictEqual(by['claude-opus-5-5'].label, 'Claude Opus 5.5 1M');
  assert.strictEqual(by['claude-opus-5-5-fast'].variants.xhigh, 'claude-opus-5-5-xhigh-fast');
  assert.deepStrictEqual(by['gpt-5.3-codex'].efforts, ['', 'high']);
  assert.strictEqual(by['grok-4.7-fast'].label, 'Grok 4.7 Fast');
});

test('resolve: Cursor variants become the real id; bad values are dropped', async () => {
  const fakeEngine = { id: 'cursor', name: 'Cursor' };
  const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sve-models-'));
  fs.writeFileSync(path.join(dir, 'm.json'), JSON.stringify({
    cursor: models.parseCursor('claude-opus-5-5-low - A Low\nclaude-opus-5-5-high - A High'),
    claude: models.parseClaude({}, '')
  }));
  models.setCacheFile(path.join(dir, 'm.json'));
  assert.deepStrictEqual(models.resolve('cursor', { model: 'claude-opus-5-5', effort: 'high' }), { model: 'claude-opus-5-5-high', effort: '' });
  assert.deepStrictEqual(models.resolve('claude', { model: 'opus', effort: 'medium' }), { model: 'opus', effort: 'medium' });
  assert.deepStrictEqual(models.resolve('claude', { model: 'haiku', effort: 'high' }), { model: 'haiku', effort: '' });
  assert.deepStrictEqual(models.resolve('claude', { model: 'opus; rm -rf /', effort: 'high' }), { model: '', effort: 'high' });
  assert.ok(fakeEngine);
});
