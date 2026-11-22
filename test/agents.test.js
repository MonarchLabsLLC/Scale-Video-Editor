const test = require('node:test');
const assert = require('node:assert');
const agents = require('../main/agents');

const ctx = { projectDir: '/tmp/p', filmcraft: true, mcpScript: '/app/main/filmcraft-mcp.js', access: 'standard', toolkitDir: null };

test('Claude args: print mode, stream JSON, FilmCraft MCP, resume', () => {
  const a = agents.claudeArgs({ ...ctx, resume: 'abc' });
  assert.deepStrictEqual(a.slice(0, 4), ['-p', '--output-format', 'stream-json', '--verbose']);
  const mcp = JSON.parse(a[a.indexOf('--mcp-config') + 1]);
  assert.deepStrictEqual(mcp.mcpServers.filmcraft.args, ['/app/main/filmcraft-mcp.js']);
  assert.strictEqual(mcp.mcpServers.filmcraft.env.ELECTRON_RUN_AS_NODE, '1');
  assert.strictEqual(a[a.indexOf('--resume') + 1], 'abc');
  assert.ok(a.includes('acceptEdits'));
  assert.ok(!a.includes('--dangerously-skip-permissions'));
  assert.ok(agents.claudeArgs({ ...ctx, access: 'full' }).includes('--dangerously-skip-permissions'));
});

test('Claude args leave the MCP out when FilmCraft is not connected', () => {
  assert.ok(!agents.claudeArgs({ ...ctx, filmcraft: false }).includes('--mcp-config'));
});

test('Codex args: exec JSON in the project, sandbox, MCP, and resume form', () => {
  const a = agents.codexArgs(ctx);
  assert.deepStrictEqual(a.slice(0, 5), ['exec', '--json', '--skip-git-repo-check', '-C', '/tmp/p']);
  assert.strictEqual(a[a.length - 1], '-');
  assert.ok(a.includes('mcp_servers.filmcraft.args=["/app/main/filmcraft-mcp.js"]'));
  assert.ok(a.includes('sandbox_mode="workspace-write"'));
  const r = agents.codexArgs({ ...ctx, resume: 'th_1' });
  assert.deepStrictEqual(r.slice(0, 2), ['exec', 'resume']);
  assert.strictEqual(r[r.length - 2], 'th_1');
  assert.ok(agents.codexArgs({ ...ctx, access: 'full' }).includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('parseClaude maps init, text, tool use, tool result and result', () => {
  assert.deepStrictEqual(agents.parseClaude({ type: 'system', subtype: 'init', session_id: 's1' }), [{ kind: 'session', id: 's1' }]);
  const ev = agents.parseClaude({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }, { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } });
  assert.deepStrictEqual(ev, [{ kind: 'text', text: 'Hi' }, { kind: 'tool', name: 'Bash', detail: 'ls' }]);
  const tr = agents.parseClaude({ type: 'user', message: { content: [{ type: 'tool_result', is_error: true, content: 'nope' }] } });
  assert.deepStrictEqual(tr, [{ kind: 'tool-result', ok: false, detail: 'nope' }]);
  const done = agents.parseClaude({ type: 'result', is_error: false, session_id: 's1', result: 'ok' });
  assert.deepStrictEqual(done, [{ kind: 'session', id: 's1' }, { kind: 'done', ok: true, error: null }]);
});

test('parseCodex maps thread, commands, messages and turn end', () => {
  assert.deepStrictEqual(agents.parseCodex({ type: 'thread.started', thread_id: 't1' }), [{ kind: 'session', id: 't1' }]);
  assert.deepStrictEqual(agents.parseCodex({ type: 'item.started', item: { type: 'command_execution', command: 'ls' } }), [{ kind: 'tool', name: 'Shell', detail: 'ls' }]);
  assert.deepStrictEqual(agents.parseCodex({ type: 'item.completed', item: { type: 'agent_message', text: 'Done' } }), [{ kind: 'text', text: 'Done' }]);
  assert.deepStrictEqual(agents.parseCodex({ type: 'turn.completed' }), [{ kind: 'done', ok: true }]);
  assert.deepStrictEqual(agents.parseCodex({ type: 'turn.failed', error: { message: 'x' } }), [{ kind: 'done', ok: false, error: 'x' }]);
});
