'use strict';
const test = require('node:test');
const assert = require('node:assert');
const vm = require('../renderer/data/video-models');
const agents = require('../main/agents');

test('three tiers, Seedance 2.5 is the default Best', () => {
  assert.deepStrictEqual(vm.tiers.map(t => t.id), ['best', 'great', 'good']);
  assert.strictEqual(vm.DEFAULT, 'best');
  assert.strictEqual(vm.byId('best').endpoint, 'bytedance/seedance-2.5/image-to-video');
  assert.strictEqual(vm.byId('nonsense').id, 'best');
  for (const t of vm.tiers) assert.match(t.perClip, /^\$\d/), assert.match(t.perVideo, /^\$\d/);
  assert.ok(vm.byId('best').perSecond > vm.byId('great').perSecond);
});

test('the agent prompt names the chosen model and asks before clips', () => {
  const p = agents.systemPrompt({ projectDir: '/p', videoModel: 'great' });
  assert.match(p, /the person chose Great, Kling 4\.0/);
  assert.match(p, /Best = Seedance 2\.5/);
  assert.match(p, /wait for their go-ahead/);
  assert.match(agents.systemPrompt({ projectDir: '/p' }), /the person chose Best, Seedance 2\.5/);
});
