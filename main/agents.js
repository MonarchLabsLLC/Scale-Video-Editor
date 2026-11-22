// Agent runner. The editor does not ship its own AI: it runs the person's own coding agent CLI
// (Claude Code or Codex) in the project folder, one turn at a time, and reads its JSON event
// stream. Each engine's events are turned into one small shared shape for the chat panel:
//   { kind: 'session', id }            the agent's session id, used to continue the chat
//   { kind: 'text', text }             something the agent says
//   { kind: 'thinking', text }         reasoning summary, shown dimmed
//   { kind: 'tool', name, detail }     the agent started a tool call
//   { kind: 'tool-result', ok, detail }
//   { kind: 'notice', text }
//   { kind: 'done', ok, error }

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const exe = process.platform === 'win32' ? '.cmd' : '';

const ENGINES = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    vendor: 'Anthropic',
    bin: 'claude',
    installHint: 'npm install -g @anthropic-ai/claude-code',
    docs: 'https://docs.claude.com/en/docs/claude-code',
    models: [
      { id: '', label: 'Default' },
      { id: 'opus', label: 'Opus' },
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'haiku', label: 'Haiku' }
    ]
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    bin: 'codex',
    installHint: 'npm install -g @openai/codex',
    docs: 'https://developers.openai.com/codex/cli',
    models: [{ id: '', label: 'Default' }]
  }
};

function extraBinDirs() {
  const h = os.homedir();
  return [
    path.join(h, '.local', 'bin'),
    path.join(h, '.claude', 'local'),
    path.join(h, '.npm-global', 'bin'),
    path.join(h, '.bun', 'bin'),
    path.join(h, '.volta', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    process.platform === 'win32' && path.join(process.env.APPDATA || '', 'npm')
  ].filter(Boolean);
}

function which(bin) {
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...extraBinDirs()];
  const names = process.platform === 'win32' ? [bin + '.cmd', bin + '.exe', bin] : [bin];
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(d, n);
      try { if (d && fs.statSync(p).isFile()) return p; } catch { /* not here */ }
    }
  }
  return null;
}

function versionOf(file) {
  return new Promise(resolve => {
    execFile(file, ['--version'], { timeout: 10000, shell: process.platform === 'win32' }, (err, stdout) => {
      const m = String(stdout || '').match(/(\d+\.\d+\.\d+)/);
      resolve(err ? null : (m ? m[1] : String(stdout).trim().slice(0, 40)));
    });
  });
}

async function detect() {
  const out = [];
  for (const e of Object.values(ENGINES)) {
    const file = which(e.bin);
    out.push({
      id: e.id, name: e.name, vendor: e.vendor, models: e.models, installHint: e.installHint, docs: e.docs,
      installed: Boolean(file), version: file ? await versionOf(file) : null
    });
  }
  return out;
}

function systemPrompt({ projectDir, toolkitDir, filmcraft }) {
  const lines = [
    'You are the agent inside Scale Video Editor, a desktop app where a person chats with you while a video is made.',
    `The project folder is: ${projectDir}`,
    'Put every finished video, still and caption file in the "exports" folder of the project. The editor previews what lands there.',
    'Put working files in the "work" folder. Put media the person gives you in "media".',
    filmcraft
      ? 'FilmCraft, the video editor, is open and connected. Use the "filmcraft" MCP server to edit its timeline: command_list to find commands, command_run to run them, project_inspect and sequence_inspect to check the result, render_frame to look at a frame. Never use screen clicking for FilmCraft.'
      : 'FilmCraft is not connected right now. If the task needs the timeline editor, say so in one sentence and ask the person to click Connect FilmCraft.',
    toolkitDir
      ? `The Scale Video Toolkit is installed at ${toolkitDir}. Read its CLAUDE.md first: it says which tool to use for each kind of video.`
      : 'The Scale Video Toolkit is not installed. Use the tools you have.',
    'Rules: do not play sound out loud, do not open new windows, do not publish or upload anything, and do not run anything that costs money without asking first.',
    'Look at frames of anything you render before you call it done, and say plainly what you did not check.',
    'Keep replies short. The person sees your messages in a chat panel beside the preview.'
  ];
  return lines.join('\n');
}

function mcpLauncher(ctx) {
  // The editor's own binary runs the launcher script in Node mode, so no separate Node install is needed.
  return { command: process.execPath, args: [ctx.mcpScript], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

function claudeArgs(ctx) {
  const mcp = mcpLauncher(ctx);
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (ctx.filmcraft) {
    args.push('--mcp-config', JSON.stringify({ mcpServers: { filmcraft: { type: 'stdio', ...mcp } } }));
  }
  args.push('--append-system-prompt', systemPrompt(ctx));
  if (ctx.model) args.push('--model', ctx.model);
  if (ctx.access === 'full') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--permission-mode', 'acceptEdits',
      '--allowedTools', 'mcp__filmcraft', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Skill', 'TodoWrite', 'Task');
  }
  if (ctx.resume) args.push('--resume', ctx.resume);
  if (ctx.toolkitDir) args.push('--add-dir', ctx.toolkitDir);
  return args;
}

function tomlString(s) {
  return JSON.stringify(String(s));
}

function codexArgs(ctx) {
  const mcp = mcpLauncher(ctx);
  const cfg = [];
  const c = v => cfg.push('-c', v);
  if (ctx.filmcraft) {
    c(`mcp_servers.filmcraft.command=${tomlString(mcp.command)}`);
    c(`mcp_servers.filmcraft.args=[${mcp.args.map(tomlString).join(',')}]`);
    c('mcp_servers.filmcraft.env={ELECTRON_RUN_AS_NODE="1"}');
    c('mcp_servers.filmcraft.tool_timeout_sec=600');
    c('mcp_servers.filmcraft.default_tools_approval_mode="approve"');
  }
  c(`developer_instructions=${tomlString(systemPrompt(ctx))}`);
  if (ctx.model) cfg.push('-m', ctx.model);
  const full = ctx.access === 'full';
  const access = full
    ? ['--dangerously-bypass-approvals-and-sandbox']
    : ['-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"', '-c', 'sandbox_workspace_write.network_access=true'];
  if (ctx.resume) {
    return ['exec', 'resume', '--json', '--skip-git-repo-check', ...access, ...cfg, ctx.resume, '-'];
  }
  return ['exec', '--json', '--skip-git-repo-check', '-C', ctx.projectDir, ...access, ...cfg, '-'];
}

function short(v, n = 160) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function toolDetail(name, input) {
  if (!input || typeof input !== 'object') return '';
  if (input.command) return short(input.command);
  if (input.file_path) return short(input.file_path);
  if (input.pattern) return short(input.pattern);
  if (input.id) return short(input.id + (input.params ? ' ' + JSON.stringify(input.params) : ''));
  if (input.url) return short(input.url);
  return short(input);
}

function parseClaude(ev) {
  const out = [];
  if (ev.type === 'system' && ev.subtype === 'init') out.push({ kind: 'session', id: ev.session_id });
  if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
    for (const part of ev.message.content) {
      if (part.type === 'text' && part.text) out.push({ kind: 'text', text: part.text });
      else if (part.type === 'thinking' && part.thinking) out.push({ kind: 'thinking', text: part.thinking });
      else if (part.type === 'tool_use') out.push({ kind: 'tool', name: part.name, detail: toolDetail(part.name, part.input) });
    }
  }
  if (ev.type === 'user' && ev.message && Array.isArray(ev.message.content)) {
    for (const part of ev.message.content) {
      if (part.type === 'tool_result') {
        const text = Array.isArray(part.content) ? part.content.map(x => x.text || '').join(' ') : part.content;
        out.push({ kind: 'tool-result', ok: !part.is_error, detail: short(text, 220) });
      }
    }
  }
  if (ev.type === 'result') {
    if (ev.session_id) out.push({ kind: 'session', id: ev.session_id });
    out.push({ kind: 'done', ok: !ev.is_error, error: ev.is_error ? short(ev.result || ev.subtype, 400) : null });
  }
  return out;
}

function parseCodex(ev) {
  const out = [];
  const item = ev.item || {};
  switch (ev.type) {
    case 'thread.started':
      out.push({ kind: 'session', id: ev.thread_id });
      break;
    case 'item.started':
      if (item.type === 'command_execution') out.push({ kind: 'tool', name: 'Shell', detail: short(item.command) });
      if (item.type === 'mcp_tool_call') out.push({ kind: 'tool', name: `${item.server}.${item.tool}`, detail: short(item.arguments || '') });
      if (item.type === 'web_search') out.push({ kind: 'tool', name: 'Web search', detail: short(item.query || '') });
      break;
    case 'item.completed':
      if (item.type === 'agent_message' && item.text) out.push({ kind: 'text', text: item.text });
      else if (item.type === 'reasoning' && item.text) out.push({ kind: 'thinking', text: item.text });
      else if (item.type === 'command_execution') out.push({ kind: 'tool-result', ok: item.exit_code === 0, detail: short(item.aggregated_output || '', 220) });
      else if (item.type === 'mcp_tool_call') out.push({ kind: 'tool-result', ok: item.status !== 'failed', detail: short(item.error ? item.error.message : '', 220) });
      else if (item.type === 'file_change') out.push({ kind: 'tool', name: 'Edit', detail: short((item.changes || []).map(c => c.path).join(', ')) });
      else if (item.type === 'error') out.push({ kind: 'notice', text: short(item.message, 300) });
      break;
    case 'turn.completed':
      out.push({ kind: 'done', ok: true });
      break;
    case 'turn.failed':
      out.push({ kind: 'done', ok: false, error: short(ev.error && ev.error.message, 400) });
      break;
    case 'error':
      out.push({ kind: 'notice', text: short(ev.message, 300) });
      break;
  }
  return out;
}

// Runs one turn. Returns a handle with stop(). onEvent receives the shared event shape.
function runTurn(ctx, prompt, onEvent) {
  const engine = ENGINES[ctx.engine];
  if (!engine) throw new Error(`Unknown agent: ${ctx.engine}`);
  const file = which(engine.bin);
  if (!file) {
    onEvent({ kind: 'done', ok: false, error: `${engine.name} is not installed. Install it with: ${engine.installHint}` });
    return { stop() {} };
  }
  const args = ctx.engine === 'claude' ? claudeArgs(ctx) : codexArgs(ctx);
  const parse = ctx.engine === 'claude' ? parseClaude : parseCodex;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(file, args, { cwd: ctx.projectDir, env, shell: process.platform === 'win32', windowsHide: true });
  let buf = '';
  let finished = false;
  let stderr = '';
  const emit = e => {
    if (e.kind === 'done') {
      if (finished) return;
      finished = true;
    }
    onEvent(e);
  };
  child.stdout.on('data', chunk => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      for (const e of parse(ev)) emit(e);
    }
  });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-4000); });
  child.on('error', err => emit({ kind: 'done', ok: false, error: err.message }));
  child.on('close', code => {
    if (!finished) {
      const tail = stderr.trim().split('\n').slice(-3).join(' ');
      emit({ kind: 'done', ok: code === 0, error: code === 0 ? null : (tail || `${engine.name} stopped (exit ${code}).`) });
    }
  });
  child.stdin.end(prompt);
  return {
    stop() {
      if (!child.killed) child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 3000);
    }
  };
}

module.exports = { ENGINES, detect, runTurn, claudeArgs, codexArgs, parseClaude, parseCodex, systemPrompt, which };
