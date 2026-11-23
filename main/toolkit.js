// The Scale Video Toolkit on this computer: where it is, what its own check says, and the fixes
// the editor may run for you.
//
// The toolkit ships tools/verify-install.sh, which prints a Markdown table of every part with
// OK, MISSING, OPTIONAL, NO KEY, MISMATCH or n/a. The editor runs it, reads the table, and
// offers a Fix button only for the install commands listed in FIXES below. It never runs a
// command taken from the script's output as text, and it never asks for or handles a key:
// rows that wait for a key show the command for you to run yourself in Terminal.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

const STEPS = ['base', 'tools', 'skills', 'public', 'hyperframes', 'atlas', 'herk', 'huashu', 'earshot', 'filmcraft', 'genmedia', 'whisperx'];
// Fix id -> the command, as an argument list run in the toolkit folder.
const FIXES = Object.fromEntries([
  ...STEPS.map(s => [`step:${s}`, { cmd: 'bash', args: ['install.sh', s], label: `./install.sh ${s}` }]),
  ['filmcraft-update', { cmd: 'bash', args: ['tools/filmcraft-update.sh'], label: 'bash tools/filmcraft-update.sh' }],
  ['earshot-models', { cmd: 'bash', args: ['install.sh', 'earshot'], env: { SVT_EARSHOT_MODELS: '1' }, label: 'SVT_EARSHOT_MODELS=1 ./install.sh earshot' }]
]);

const isToolkit = d => !!d && fs.existsSync(path.join(d, 'tools', 'verify-install.sh')) && fs.existsSync(path.join(d, 'install.sh'));

let found = null;      // the folder, once known
let searched = false;  // Spotlight search done

function candidates(setting) {
  return [setting, process.env.SVT_HOME, path.join(os.homedir(), 'Scale-Video-Toolkit')].filter(Boolean);
}

// Quick, synchronous: the setting, $SVT_HOME, ~/Scale-Video-Toolkit, or what Spotlight found earlier.
function dir(setting) {
  const quick = candidates(setting).find(isToolkit);
  if (quick) return quick;
  return found && isToolkit(found) ? found : null;
}

// Slower: also asks Spotlight (macOS) for a folder holding tools/svt-env.sh. Runs once.
function find(setting) {
  const quick = dir(setting);
  if (quick || searched || process.platform !== 'darwin') return Promise.resolve(quick);
  searched = true;
  return new Promise(resolve => {
    execFile('mdfind', ['kMDItemFSName == "svt-env.sh"'], { timeout: 10_000 }, (err, out) => {
      if (!err) {
        const hit = String(out).split('\n').filter(Boolean)
          .map(p => path.dirname(path.dirname(p)))
          .filter(d => !d.includes('/node_modules/') && !d.includes('/.Trash/'))
          .find(isToolkit);
        if (hit) found = hit;
      }
      resolve(dir(setting));
    });
  });
}

/* ---------- reading the check ---------- */

const STATUS = { OK: 'ok', MISSING: 'missing', OPTIONAL: 'optional', 'NO KEY': 'nokey', MISMATCH: 'mismatch', 'N/A': 'na' };

function fixFor(detail) {
  if (/SVT_EARSHOT_MODELS=1 \.\/install\.sh earshot/.test(detail)) return 'earshot-models';
  if (/bash tools\/filmcraft-update\.sh/.test(detail)) return 'filmcraft-update';
  const m = detail.match(/\.\/install\.sh ([a-z]+)/);
  return m && STEPS.includes(m[1]) ? `step:${m[1]}` : null;
}

// Turns the script's table into rows. Section rows ("**Skills (…)**") set the section of the rows under them.
function parse(text, home = os.homedir()) {
  const rows = [];
  let section = '';
  let summary = '', result = '';
  const tidy = s => s.split(home).join('~');
  for (const line of String(text).split('\n')) {
    if (line.startsWith('Summary:')) { summary = line.slice(8).trim(); continue; }
    if (line.startsWith('RESULT:')) { result = line.slice(7).trim(); continue; }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length < 3 || /^-+$/.test(cells[0]) || cells[0] === 'Part') continue;
    const [part, status, detail] = cells;
    const sec = part.match(/^\*\*(.+?)\*\*$/);
    if (sec) { section = tidy(sec[1]).replace(/\s*\(.*\)$/, ''); continue; }
    const row = { section, part, status: STATUS[status.toUpperCase()] || 'unknown', detail: tidy(detail) };
    const fix = row.status === 'ok' ? null : fixFor(detail);
    if (fix) row.fix = fix;
    const you = detail.match(/you run: (security add-generic-password .*)$/);
    if (you) row.youRun = you[1].trim();
    const file = detail.match(/in (\S+voice\.json)/);
    if (file) row.file = file[1];
    rows.push(row);
  }
  return { rows, summary, result };
}

let last = null;

function verify(setting) {
  return find(setting).then(d => new Promise(resolve => {
    if (!d) { last = { found: false, checkedAt: Date.now(), rows: [] }; return resolve(last); }
    if (process.platform !== 'darwin') { last = { found: true, dir: d, unsupported: true, checkedAt: Date.now(), rows: [] }; return resolve(last); }
    execFile('bash', [path.join(d, 'tools', 'verify-install.sh'), '--quiet-exit'],
      { cwd: d, timeout: 90_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, SVT_HOME: d } },
      (err, out) => {
        const parsed = parse(out || '');
        last = { found: true, dir: d, checkedAt: Date.now(), ...parsed, error: err && !parsed.rows.length ? String(err.message).split('\n')[0] : '' };
        resolve(last);
      });
  }));
}

/* ---------- running a fix ---------- */

let job = null;

// Runs one whitelisted fix in the toolkit folder. Lines go to onLine; resolves with the exit code.
function runFix(id, setting, onLine) {
  const fix = FIXES[id];
  if (!fix) return Promise.reject(new Error('That fix is not one the editor runs.'));
  if (job) return Promise.reject(new Error('Another fix is still running.'));
  const d = dir(setting);
  if (!d) return Promise.reject(new Error('The toolkit folder was not found.'));
  return new Promise(resolve => {
    onLine(`$ ${fix.label}`);
    const child = spawn(fix.cmd, fix.args, { cwd: d, env: { ...process.env, SVT_HOME: d, ...(fix.env || {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
    job = { id, child };
    let buf = '';
    const feed = chunk => {
      buf += String(chunk);
      const parts = buf.split(/\r?\n/);
      buf = parts.pop();
      parts.forEach(l => onLine(l.replace(/\x1b\[[0-9;]*m/g, '')));
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('close', code => { if (buf) onLine(buf); job = null; resolve(code); });
    child.on('error', err => { onLine(String(err.message)); job = null; resolve(1); });
  });
}

function stopFix() { if (job) job.child.kill('SIGTERM'); }

module.exports = { dir, find, parse, verify, runFix, stopFix, last: () => last, FIXES, STEPS };
