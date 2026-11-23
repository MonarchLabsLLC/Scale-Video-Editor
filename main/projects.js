// Projects are plain folders, so the person (and the agent) can open them in Finder or a
// terminal. Each one has media/, work/ and exports/, plus .sve/ for the editor's own records:
// project.json (name, agent, session) and chat.jsonl (one chat message per line).

const fs = require('node:fs');
const path = require('node:path');

const MEDIA_EXT = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.wav', '.m4a', '.aac', '.srt', '.vtt', '.fcproj']);

let root = null;
function setRoot(dir) {
  root = dir;
  fs.mkdirSync(root, { recursive: true });
}
function getRoot() { return root; }

function slugify(name) {
  const s = String(name || 'Untitled').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80);
  return s || 'Untitled';
}

function metaFile(dir) { return path.join(dir, '.sve', 'project.json'); }
function chatFile(dir) { return path.join(dir, '.sve', 'chat.jsonl'); }

function readMeta(dir) {
  try { return JSON.parse(fs.readFileSync(metaFile(dir), 'utf8')); } catch { return null; }
}

function writeMeta(dir, meta) {
  fs.mkdirSync(path.dirname(metaFile(dir)), { recursive: true });
  const tmp = metaFile(dir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
  fs.renameSync(tmp, metaFile(dir));
}

function list() {
  if (!root || !fs.existsSync(root)) return [];
  const out = [];
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    const meta = readMeta(dir);
    if (!meta) continue;
    out.push({ ...meta, dir, thumb: latestStill(dir) });
  }
  return out.sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

function create({ name, engine, format, brand }) {
  let base = slugify(name);
  let dir = path.join(root, base);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(root, `${base} ${i}`);
  for (const sub of ['media', 'work', 'exports', '.sve']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const now = Date.now();
  const meta = { id: path.basename(dir), name: path.basename(dir), engine: engine || 'claude', format: format || null, brand: brand || null, session: null, created: now, updated: now };
  writeMeta(dir, meta);
  return { ...meta, dir };
}

function resolve(id) {
  const dir = path.join(root, id);
  if (path.dirname(dir) !== root || !readMeta(dir)) throw new Error('Project not found');
  return dir;
}

function get(id) {
  const dir = resolve(id);
  return { ...readMeta(dir), dir };
}

function update(id, patch) {
  const dir = resolve(id);
  const meta = { ...readMeta(dir), ...patch, updated: Date.now() };
  writeMeta(dir, meta);
  return { ...meta, dir };
}

function rename(id, name) {
  const dir = resolve(id);
  const target = path.join(root, slugify(name));
  if (target === dir) return get(id);
  if (fs.existsSync(target)) throw new Error('A project with that name already exists.');
  fs.renameSync(dir, target);
  const meta = { ...readMeta(target), id: path.basename(target), name: path.basename(target), updated: Date.now() };
  writeMeta(target, meta);
  return { ...meta, dir: target };
}

// A copy of the project's files with a fresh chat: same media, work and exports, new conversation.
function duplicate(id) {
  const src = resolve(id);
  const meta = readMeta(src);
  const base = slugify(`${meta.name} copy`);
  let dir = path.join(root, base);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(root, `${base} ${i}`);
  fs.cpSync(src, dir, { recursive: true, errorOnExist: true });
  try { fs.rmSync(chatFile(dir), { force: true }); } catch {}
  const now = Date.now();
  const next = { ...meta, id: path.basename(dir), name: path.basename(dir), session: null, created: now, updated: now };
  writeMeta(dir, next);
  return { ...next, dir };
}

function appendChat(id, msg) {
  const dir = resolve(id);
  fs.appendFileSync(chatFile(dir), JSON.stringify({ ...msg, at: Date.now() }) + '\n');
}

function readChat(id) {
  const dir = resolve(id);
  try {
    return fs.readFileSync(chatFile(dir), 'utf8').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function files(id) {
  const dir = resolve(id);
  const out = [];
  for (const sub of ['exports', 'media', 'work']) {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) continue;
    walk(d, 2, f => {
      const ext = path.extname(f).toLowerCase();
      if (!MEDIA_EXT.has(ext)) return;
      const st = fs.statSync(f);
      out.push({ path: f, rel: path.relative(dir, f), folder: sub, ext, size: st.size, mtime: st.mtimeMs });
    });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function walk(d, depth, fn) {
  let entries;
  try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (depth > 0 && !e.name.endsWith('.fcproj')) walk(p, depth - 1, fn); else if (e.name.endsWith('.fcproj')) fn(p); }
    else fn(p);
  }
}

function latestStill(dir) {
  const d = path.join(dir, 'exports');
  try {
    const stills = fs.readdirSync(d).filter(n => /\.(png|jpe?g|webp)$/i.test(n))
      .map(n => ({ p: path.join(d, n), t: fs.statSync(path.join(d, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    return stills[0] ? stills[0].p : null;
  } catch { return null; }
}

module.exports = { setRoot, getRoot, list, create, get, update, rename, duplicate, appendChat, readChat, files, resolve };
