// Stdio MCP launcher for agents. Claude Code and Codex start this script (run by the editor's
// own Electron binary in Node mode), and it starts `filmcraft-cli mcp --bridge`, connected to
// the running FilmCraft app. It reads the control token from the control file itself, so the
// token never appears in an agent's config, command line or logs.

const { spawn } = require('node:child_process');
const fc = require('./filmcraft');

const cli = process.env.SVE_FILMCRAFT_CLI || fc.findCli();
const control = fc.readControl();
if (!cli || !control) {
  process.stderr.write('Scale Video Editor: FilmCraft is not installed or not connected.\n');
  process.exit(1);
}
const env = { ...process.env, FILMCRAFT_CONTROL_TOKEN: control.token };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(cli, ['mcp', '--bridge', `127.0.0.1:${control.port}`], { stdio: 'inherit', env });
child.on('exit', code => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
