const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const agents = require('../main/agents');

test('every agent has a runner, a sign-in and an install hint', () => {
  for (const id of ['claude', 'codex', 'cursor', 'grok', 'antigravity', 'opencode']) {
    const e = agents.ENGINES[id];
    assert.ok(e, id);
    assert.ok(e.login, `${id} login`);
    assert.ok(e.installHint, `${id} install`);
  }
});

test('sign-in status is read from each CLI', () => {
  const { claude, codex, cursor } = agents.ENGINES;
  assert.deepEqual(claude.status.parse('{"loggedIn": true, "authMethod": "claude.ai", "subscriptionType": "max"}'), { connected: true, detail: 'max' });
  assert.equal(claude.status.parse('{"loggedIn": false}').connected, false);
  assert.equal(claude.status.parse('not json'), null);
  assert.equal(codex.status.parse('Logged in using ChatGPT').connected, true);
  assert.equal(codex.status.parse('Not logged in').connected, false);
  assert.equal(cursor.status.parse('Not logged in').connected, false);
  assert.equal(cursor.status.parse('✓ Logged in as me@example.com').connected, true);
});

test('cursor gets FilmCraft through .cursor/mcp.json and runs headless', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sve-cur-'));
  const args = agents.cursorArgs({ projectDir: dir, filmcraft: true, mcpScript: '/x/filmcraft-mcp.js', access: 'standard' });
  assert.ok(args.includes('-p') && args.includes('stream-json') && !args.includes('--force'));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.cursor', 'mcp.json'), 'utf8'));
  assert.ok(cfg.mcpServers.filmcraft.args[0].endsWith('filmcraft-mcp.js'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the generic parser reads Cursor, OpenCode and Antigravity events', () => {
  assert.deepEqual(agents.parseGeneric({ type: 'system', subtype: 'init', session_id: 's1' })[0], { kind: 'session', id: 's1' });
  const tool = agents.parseGeneric({ type: 'tool_call', subtype: 'started', tool_call: { shellToolCall: { args: { command: 'ls' } } } });
  assert.equal(tool[0].name, 'shell');
  const oc = agents.parseGeneric({ type: 'text', sessionID: 'oc1', part: { text: 'Hello' } });
  assert.ok(oc.some(e => e.kind === 'text' && e.text === 'Hello'));
  assert.ok(oc.some(e => e.kind === 'session' && e.id === 'oc1'));
  const done = agents.parseGeneric({ status: 'success', num_turns: 2, conversation_id: 'c' });
  assert.ok(done.some(e => e.kind === 'done' && e.ok));
});
