// Starting an agent's command on Windows.
//
// npm installs agents as .cmd files (codex.cmd), and Node can only start a .cmd through cmd.exe.
// cmd.exe joins the command line without quoting, so a path with a space in it
// ("C:\Users\me\AppData\Local\Author Software\nvm\codex.cmd") fails at once, and a line break in an
// argument (the agent's instructions) ends the command there. So:
//   - .exe files start directly, with no shell.
//   - npm's .cmd files are read to find the node script they start, and node runs that script
//     directly, with the arguments passed as they are.
//   - any other .cmd or .bat goes through cmd.exe with every part quoted and escaped.
// On macOS and Linux nothing changes.

const fs = require('node:fs');
const path = require('node:path');

// npm's shim ends with:  "%_prog%"  "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
const SHIM_SCRIPT = /"%dp0%\\([^"]+)"\s+%\*/i;

function findOnPath(name) {
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    if (!d) continue;
    const p = path.join(d, name);
    try { if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
  }
  return null;
}

// The node script an npm .cmd shim starts, and the node.exe it would use. null when the file is
// not an npm shim.
function readShim(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const m = text.match(SHIM_SCRIPT);
  if (!m) return null;
  const dir = path.dirname(file);
  const script = path.join(dir, m[1]);
  if (!fs.existsSync(script)) return null;
  const local = path.join(dir, 'node.exe');
  const node = fs.existsSync(local) ? local : findOnPath('node.exe');
  return node ? { node, script } : null;
}

// cmd.exe quoting (the same rules as the cross-spawn package).
const META = /([()\][%!^"`<>&|;, *?])/g;
function quoteForCmd(arg, doubleEscape) {
  let a = String(arg).replace(/\r?\n/g, ' '); // cmd.exe cannot pass a line break
  a = a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1');
  a = `"${a}"`.replace(META, '^$1');
  return doubleEscape ? a.replace(META, '^$1') : a;
}

// Returns what to pass to spawn or execFile: { file, args, options }.
function prepare(file, args = [], platform = process.platform) {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { file, args, options: {} };
  const shim = readShim(file);
  if (shim) return { file: shim.node, args: [shim.script, ...args], options: {} };
  const line = [path.normalize(file).replace(META, '^$1'), ...args.map(a => quoteForCmd(a, false))].join(' ');
  return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } };
}

module.exports = { prepare, readShim, quoteForCmd };
