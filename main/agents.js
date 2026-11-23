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
    models: [{ id: '', label: 'Default' }],
    login: { args: ['login'], browser: true, plan: 'ChatGPT' },
    status: { args: ['login', 'status'], parse: out => /logged in/i.test(out) && !/not logged in/i.test(out) ? { connected: true, detail: (out.match(/using (.+)/i) || [])[1] || '' } : { connected: false } }
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    vendor: 'Cursor',
    bin: 'cursor-agent',
    installHint: 'curl https://cursor.com/install -fsS | bash',
    docs: 'https://cursor.com/cli',
    models: [{ id: '', label: 'Default' }],
    login: { args: ['login'], browser: true, plan: 'Cursor' },
    status: { args: ['status'], parse: out => /not logged in/i.test(out) ? { connected: false } : /logged in/i.test(out) ? { connected: true, detail: (out.match(/logged in as\s+(\S+)/i) || [])[1] || '' } : null }
  },
  grok: {
    id: 'grok',
    name: 'Grok Build',
    vendor: 'xAI',
    bin: 'grok',
    installHint: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    docs: 'https://docs.x.ai/build/overview',
    models: [{ id: '', label: 'Default' }],
    login: { args: ['login'], browser: true, plan: 'SuperGrok' },
    beta: true
  },
  antigravity: {
    id: 'antigravity',
    name: 'Antigravity',
    vendor: 'Google',
    bin: 'agy',
    installHint: 'Install the Antigravity CLI from antigravity.google',
    docs: 'https://antigravity.google/docs/cli/reference/',
    models: [{ id: '', label: 'Default' }],
    login: { terminal: 'agy', plan: 'Google' },
    beta: true
  },
  opencode: {
    id: 'opencode',
    name: 'OpenCode',
    vendor: 'OpenCode',
    bin: 'opencode',
    installHint: 'npm install -g opencode-ai',
    docs: 'https://opencode.ai/docs/cli',
    models: [{ id: '', label: 'Default' }],
    login: { terminal: 'opencode auth login', plan: 'your provider' },
    beta: true
  }
};
ENGINES.claude.login = { args: ['auth', 'login', '--claudeai'], browser: true, plan: 'Claude' };
ENGINES.claude.status = { args: ['auth', 'status'], parse: out => { try { const j = JSON.parse(out); return { connected: !!j.loggedIn, detail: j.subscriptionType || j.authMethod || '' }; } catch { return null; } } };

// The environment an agent runs in. Variables a parent Claude Code session sets would make a child
// think it is nested, so they are left out.
function agentEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];
  return env;
}

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

// Signed in? null when the agent has no way to tell from the command line.
function authOf(e, file) {
  if (!e.status) return Promise.resolve(null);
  return new Promise(resolve => {
    execFile(file, e.status.args, { timeout: 15000, env: agentEnv(), shell: process.platform === 'win32' }, (err, stdout, stderr) => {
      const out = `${stdout || ''}\n${stderr || ''}`.trim();
      try { resolve(e.status.parse(out)); } catch { resolve(null); }
    });
  });
}

async function detect() {
  return Promise.all(Object.values(ENGINES).map(async e => {
    const file = which(e.bin);
    const [version, auth] = file ? await Promise.all([versionOf(file), authOf(e, file)]) : [null, null];
    return {
      id: e.id, name: e.name, vendor: e.vendor, models: e.models, installHint: e.installHint, docs: e.docs, beta: !!e.beta,
      installed: Boolean(file), version,
      connected: auth ? auth.connected : null, account: auth && auth.detail ? auth.detail : '',
      loginKind: e.login ? (e.login.browser ? 'browser' : 'terminal') : null, plan: e.login ? e.login.plan : ''
    };
  }));
}

// Starts the agent's own sign-in. Browser logins run the agent's login command, which opens the
// vendor's page (Claude, ChatGPT, Cursor, xAI) and returns here after you grant access. Agents
// whose sign-in is a terminal screen get a Terminal window with the command typed in.
function login(id, { openExternal, onLine } = {}) {
  const e = ENGINES[id];
  if (!e || !e.login) return Promise.reject(new Error('This agent has no sign-in.'));
  const file = which(e.bin);
  if (!file) return Promise.reject(new Error(`${e.name} is not installed.`));
  if (e.login.terminal) return openTerminal(e.login.terminal.replace(/^\S+/, file)).then(() => ({ terminal: true }));
  return new Promise(resolve => {
    const child = spawn(file, e.login.args, { env: agentEnv(), shell: process.platform === 'win32', windowsHide: true });
    let opened = false, all = '';
    const feed = chunk => {
      const text = chunk.toString('utf8');
      all = (all + text).slice(-8000);
      text.split(/\r?\n/).forEach(l => l.trim() && onLine && onLine(l.replace(/\x1b\[[0-9;]*m/g, '')));
      const url = (text.match(/https:\/\/[^\s'"<>]+/) || [])[0];
      if (url && !opened && openExternal) { opened = true; setTimeout(() => openExternal(url), 2500); }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    const timer = setTimeout(() => child.kill('SIGTERM'), 10 * 60_000);
    child.on('close', code => { clearTimeout(timer); login.child = null; resolve({ code, output: all }); });
    child.on('error', err => { clearTimeout(timer); login.child = null; resolve({ code: 1, output: err.message }); });
    login.child = child;
    login.cancel = () => child.kill('SIGTERM');
  });
}

// Some sign-ins (Claude Code without a terminal) show a code on the web page to paste back.
// The person pastes it in the editor and it goes to the waiting sign-in command, nowhere else.
function loginInput(text) {
  const child = login.child;
  if (!child || !child.stdin || child.stdin.destroyed) return false;
  child.stdin.write(String(text).trim() + '\n');
  return true;
}

function openTerminal(command) {
  return new Promise(resolve => {
    if (process.platform === 'darwin') {
      const f = path.join(os.tmpdir(), `sve-signin-${Date.now()}.command`);
      fs.writeFileSync(f, `#!/bin/bash\n${command}\necho\necho "Done. You can close this window and go back to Scale Video Editor."\n`, { mode: 0o700 });
      execFile('open', ['-a', 'Terminal', f], () => resolve());
    } else if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/k', command], { detached: true, windowsHide: false }).unref(); resolve();
    } else {
      spawn('x-terminal-emulator', ['-e', `bash -lc ${JSON.stringify(command + '; exec bash')}`], { detached: true }).on('error', () => {}).unref(); resolve();
    }
  });
}

// The job behind Setup's "Find it on this computer": look for toolkit parts the person already
// has, and connect them where the toolkit's check looks. Never move, delete or download.
function setupPrompt({ toolkitDir }) {
  return [
    'You are the setup helper inside Scale Video Editor. The person says some parts of the Scale Video Toolkit are already on this computer.',
    `The toolkit is at ${toolkitDir}. Its check is tools/verify-install.sh: read it first, to see exactly where and how it looks for each part. install.sh and docs/ say where each part belongs.`,
    'For each part you are given: search for it on this computer. Start with Spotlight (mdfind), then look in the likely places (the home folder, ~/GitHub, ~/Documents, ~/Downloads, ~/.local, ~/.config, /Applications, /opt/homebrew), then wider if needed.',
    'When you find a part, connect it where the check expects it: a symbolic link, or a path or setting the toolkit documents. Do not copy large folders when a link works.',
    'Never move, rename, overwrite or delete the person’s own files. If the place the check expects already has something in it, leave it and say so.',
    'Never install, download or buy anything. If a part is not on this computer, say "not found" for it: the person can click Install afterwards.',
    'Keys: never read, print, copy or move an API key or password, never use security with -w or -g, never run security dump-keychain with -d, and never open a file only to look for a key.',
    'A key may already be in the Keychain under another name (for example one an older tool or Codex made). To find it, list only the Keychain item names: security dump-keychain | grep \'"svce"\' (no -d: that prints names, never secrets). Pick the item whose name clearly matches the service (ElevenLabs, OpenAI) and confirm it exists with security find-generic-password -s "<name>" without -w.',
    'Then write only that item name, never the key, into ~/.config/scale-video-toolkit/keys.json, for example {"elevenlabs": "<name>"} or {"openai": "<name>"}; keep any other entries. The toolkit then uses that Keychain item. If no item clearly matches, say "not found": the person adds the key with the command on the Setup page.',
    'An ElevenLabs voice ID is not a secret. If you find the person’s voice ID in an older settings file, you may put it in voice_id in ~/.config/scale-video-toolkit/voice.json; keep every other field.',
    'Do not play sound and do not open windows.',
    'When you are done, run tools/verify-install.sh again and end with a short list: one line per part, "connected: <where>" or "not found".'
  ].join('\n');
}

function systemPrompt(ctx) {
  if (ctx.purpose === 'setup') return setupPrompt(ctx);
  const { projectDir, toolkitDir, filmcraft, brand, voice } = ctx;
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
    brand
      ? `Brand: make this video in the "${brand.name}" brand. Read ${brand.file} in the project folder first and use its colors, fonts, shapes and rules for every title, lower third, caption, chart and end card${brand.logo ? `. The logo is ${brand.logo}: use it as it is` : ''}. Do not add colors or fonts the guide does not name. If a font is not installed, use the closest free match and say which.`
      : null,
    voice ? voice : null,
    'Rules: do not play sound out loud, do not open new windows, do not publish or upload anything, and do not run anything that costs money without asking first.',
    'Look at frames of anything you render before you call it done, and say plainly what you did not check.',
    'Keep replies short. The person sees your messages in a chat panel beside the preview.'
  ];
  return lines.filter(Boolean).join('\n');
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
  if (ctx.effort) args.push('--effort', ctx.effort);
  if (ctx.access === 'full') {
    args.push('--dangerously-skip-permissions');
  } else {
    args.push('--permission-mode', 'acceptEdits',
      '--allowedTools', 'mcp__filmcraft', 'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Skill', 'TodoWrite', 'Task');
  }
  if (ctx.resume) args.push('--resume', ctx.resume);
  if (ctx.toolkitDir) args.push('--add-dir', ctx.toolkitDir);
  for (const d of ctx.addDirs || []) args.push('--add-dir', d);
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
  if (ctx.effort) c(`model_reasoning_effort=${tomlString(ctx.effort)}`);
  const full = ctx.access === 'full';
  const access = full
    ? ['--dangerously-bypass-approvals-and-sandbox']
    : ['-c', 'sandbox_mode="workspace-write"', '-c', 'approval_policy="never"', '-c', 'sandbox_workspace_write.network_access=true'];
  if (ctx.resume) {
    return ['exec', 'resume', '--json', '--skip-git-repo-check', ...access, ...cfg, ctx.resume, '-'];
  }
  const dirs = (ctx.addDirs || []).flatMap(d => ['--add-dir', d]);
  return ['exec', '--json', '--skip-git-repo-check', '-C', ctx.projectDir, ...access, ...dirs, ...cfg, '-'];
}

// Cursor reads MCP servers from .cursor/mcp.json in the workspace.
function cursorArgs(ctx) {
  if (ctx.filmcraft) {
    const mcp = mcpLauncher(ctx);
    const dir = path.join(ctx.projectDir, '.cursor');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'mcp.json'), JSON.stringify({ mcpServers: { filmcraft: mcp } }, null, 2));
  }
  const args = ['-p', '--output-format', 'stream-json', '--trust', '--approve-mcps', '--workspace', ctx.projectDir];
  if (ctx.access === 'full') args.push('--force');
  if (ctx.model) args.push('--model', ctx.model);
  if (ctx.resume) args.push('--resume', ctx.resume);
  if (ctx.toolkitDir) args.push('--add-dir', ctx.toolkitDir);
  return args;
}
function grokArgs(ctx) {
  const args = ['--output-format', 'streaming-json'];
  if (ctx.model) args.push('--model', ctx.model);
  if (ctx.resume) args.push('--resume', ctx.resume);
  return args;
}
function antigravityArgs(ctx) {
  const args = ['--output-format', 'stream-json'];
  if (ctx.model) args.push('--model', ctx.model);
  return args;
}
function opencodeArgs(ctx) {
  const args = ['run', '--format', 'json'];
  if (ctx.model) args.push('--model', ctx.model);
  if (ctx.resume) args.push('--session', ctx.resume);
  return args;
}

// Agents without a way to take the editor's instructions as a flag get them at the top of the prompt.
function withInstructions(ctx, prompt) {
  return ctx.resume ? prompt : `${systemPrompt(ctx)}\n\n---\n\n${prompt}`;
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

// Cursor and Grok print Claude-style stream-json. OpenCode and Antigravity print their own events;
// this reads the common fields and ignores the rest.
function parseGeneric(ev) {
  const out = parseClaude(ev);
  if (ev.type === 'tool_call' && ev.subtype === 'started' && ev.tool_call) {
    const k = Object.keys(ev.tool_call)[0] || 'tool';
    out.push({ kind: 'tool', name: k.replace(/ToolCall$/, ''), detail: toolDetail(k, (ev.tool_call[k] || {}).args) });
  }
  if (ev.type === 'tool_call' && ev.subtype === 'completed') out.push({ kind: 'tool-result', ok: true, detail: '' });
  if (!out.length) {
    const part = ev.part || {};
    if (ev.type === 'text' && (part.text || ev.text)) out.push({ kind: 'text', text: part.text || ev.text });
    else if (ev.type === 'tool_use' && part.tool) out.push({ kind: 'tool', name: part.tool, detail: toolDetail(part.tool, (part.state || {}).input) });
    else if (ev.type === 'error') out.push({ kind: 'notice', text: short(ev.message || (ev.error && ev.error.message) || ev.error, 300) });
    else if (typeof ev.response === 'string') out.push({ kind: 'text', text: ev.response });
  }
  const sid = ev.sessionID || ev.sessionId || ev.conversation_id || ev.conversationId;
  if (sid && !out.some(e => e.kind === 'session')) out.push({ kind: 'session', id: sid });
  if (ev.status && ev.num_turns != null) out.push({ kind: 'done', ok: !/error|fail/i.test(ev.status), error: /error|fail/i.test(ev.status) ? short(ev.error || ev.status, 400) : null });
  return out;
}

const RUNNERS = {
  claude: { args: claudeArgs, parse: parseClaude, stdin: true },
  codex: { args: codexArgs, parse: parseCodex, stdin: true },
  cursor: { args: cursorArgs, parse: parseGeneric, prompt: 'last' },
  grok: { args: grokArgs, parse: parseGeneric, prompt: 'flag', flag: '-p' },
  antigravity: { args: antigravityArgs, parse: parseGeneric, prompt: 'flag', flag: '-p' },
  opencode: { args: opencodeArgs, parse: parseGeneric, prompt: 'last' }
};

// Runs one turn. Returns a handle with stop(). onEvent receives the shared event shape.
function runTurn(ctx, prompt, onEvent) {
  const engine = ENGINES[ctx.engine];
  if (!engine) throw new Error(`Unknown agent: ${ctx.engine}`);
  const file = which(engine.bin);
  if (!file) {
    onEvent({ kind: 'done', ok: false, error: `${engine.name} is not installed. Install it with: ${engine.installHint}` });
    return { stop() {} };
  }
  const runner = RUNNERS[ctx.engine];
  if (ctx.engine === 'grok' || ctx.engine === 'antigravity' || ctx.engine === 'opencode') ctx = { ...ctx, filmcraft: false };
  const args = runner.args(ctx);
  const parse = runner.parse;
  if (!runner.stdin) {
    const full = withInstructions(ctx, prompt);
    if (runner.prompt === 'flag') args.push(runner.flag, full); else args.push(full);
  }
  const env = agentEnv();
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
  if (runner.stdin) child.stdin.end(prompt); else child.stdin.end();
  return {
    stop() {
      if (!child.killed) child.kill('SIGTERM');
      setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 3000);
    }
  };
}

module.exports = { ENGINES, agentEnv, detect, login, loginInput, openTerminal, runTurn, claudeArgs, codexArgs, cursorArgs, parseClaude, parseCodex, parseGeneric, systemPrompt, which };
