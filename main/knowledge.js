'use strict';
// Brand knowledge documents (for example BrandBaser documents): what a business is, who it serves,
// its offers, story, proof and voice. They are kept on this computer in a library, and a person can
// attach any of them to a project so the agent writes from real facts. Each document is a folder in
// "<projects folder>/Brand Knowledge/<name>":
//   KNOWLEDGE.md        the text the agent reads
//   original.<ext>      the file the person added, when it came from a file
//   .knowledge.json     the editor's own record (uid, name, source, word count, dates)
// Design guides (colors, fonts, logo) stay in Brand Guides; this library is for the words.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const brands = require('./brands');

const FILE_TYPES = brands.FILE_TYPES;
const MAX_TEXT = 600 * 1024;

let root = null;
function setRoot(dir) { root = dir; }
function ensureRoot() { if (!root) throw new Error('Brand knowledge folder not set'); fs.mkdirSync(root, { recursive: true }); return root; }

const slugify = name => String(name || 'Brand knowledge').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').replace(/^\.+/, '').slice(0, 60) || 'Brand knowledge';
const metaFile = dir => path.join(dir, '.knowledge.json');
function readMeta(dir) { try { return JSON.parse(fs.readFileSync(metaFile(dir), 'utf8')); } catch { return null; } }
function writeMeta(dir, meta) {
  const tmp = metaFile(dir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
  fs.renameSync(tmp, metaFile(dir));
}
function freeDir(name) {
  const base = slugify(name);
  let dir = path.join(ensureRoot(), base);
  for (let i = 2; fs.existsSync(dir); i++) dir = path.join(root, `${base} ${i}`);
  return dir;
}
function resolve(id) {
  const dir = path.join(ensureRoot(), String(id));
  if (path.dirname(dir) !== root || !readMeta(dir)) throw new Error('Brand knowledge document not found');
  return dir;
}
function withDir(dir) {
  const meta = readMeta(dir);
  return meta ? { ...meta, id: path.basename(dir), dir, file: path.join(dir, 'KNOWLEDGE.md') } : null;
}

function list() {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root).map(n => withDir(path.join(root, n))).filter(Boolean).sort((a, b) => (b.updated || 0) - (a.updated || 0));
}
function get(id) {
  const k = withDir(resolve(id));
  let text = '';
  try { text = fs.readFileSync(k.file, 'utf8'); } catch {}
  return { ...k, text };
}
const byUid = uid => (uid ? list().find(k => k.uid === uid) || null : null);

const words = t => (String(t).match(/\S+/g) || []).length;
// A short line for the card: the first sentence that is not a heading or front matter.
function summary(text) {
  const body = String(text).replace(/^---[\s\S]*?---\s*/, '');
  const line = body.split(/\r?\n/).map(l => l.replace(/^[#>*\-\s]+/, '').trim()).find(l => l.length > 30) || '';
  return line.length > 180 ? line.slice(0, 177).replace(/\s+\S*$/, '') + '…' : line;
}
function nameFrom(text, fallback) {
  const h1 = String(text).match(/^#\s+(.+)$/m);
  return (h1 ? h1[1] : fallback || 'Brand knowledge').trim().slice(0, 60);
}

function saveText({ name, text, source, original }) {
  const clean = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) throw new Error('That document has no text in it.');
  if (clean.length > MAX_TEXT) throw new Error('That document is very long (over about 100,000 words). Split it, or keep only the parts about the business.');
  const title = (name || '').trim() || nameFrom(clean, source && source.label);
  const dir = freeDir(title);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'KNOWLEDGE.md'), clean + '\n');
  if (original && fs.existsSync(original)) fs.copyFileSync(original, path.join(dir, 'original' + path.extname(original).toLowerCase()));
  const now = Date.now();
  const meta = { uid: crypto.randomUUID(), name: title, source: source || { kind: 'paste', label: 'Pasted text' }, words: words(clean), summary: summary(clean), created: now, updated: now };
  writeMeta(dir, meta);
  return withDir(dir);
}

async function importFile(file) {
  let text;
  try { text = await brands.textFromFile(file); } catch (err) { throw new Error(String(err.message || err).replace(/design guide/g, 'document')); }
  const base = path.basename(file, path.extname(file));
  return saveText({ name: base, text, source: { kind: 'file', label: path.basename(file) }, original: file });
}

function update(id, patch) {
  const dir = resolve(id);
  const meta = { ...readMeta(dir) };
  if (typeof patch.text === 'string') {
    const t = patch.text.replace(/\r\n/g, '\n');
    fs.writeFileSync(path.join(dir, 'KNOWLEDGE.md'), t);
    Object.assign(meta, { words: words(t), summary: summary(t) });
  }
  if (typeof patch.name === 'string' && patch.name.trim()) meta.name = patch.name.trim().slice(0, 60);
  meta.updated = Date.now();
  writeMeta(dir, meta);
  return withDir(dir);
}

// Copies the attached documents into the project's "knowledge" folder (the agent reads them there)
// and returns [{ name, file }] with paths relative to the project. Documents that were removed
// from the library are skipped. Old copies that are no longer attached are removed.
function copyInto(uids, projectDir) {
  const dest = path.join(projectDir, 'knowledge');
  const docs = (uids || []).map(byUid).filter(Boolean);
  if (fs.existsSync(dest)) for (const n of fs.readdirSync(dest)) if (n.endsWith('.md')) fs.rmSync(path.join(dest, n), { force: true });
  if (!docs.length) return [];
  fs.mkdirSync(dest, { recursive: true });
  const used = new Set();
  return docs.map(k => {
    let base = slugify(k.name), n = base;
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${base} ${i}`;
    used.add(n.toLowerCase());
    fs.copyFileSync(k.file, path.join(dest, n + '.md'));
    return { name: k.name, file: path.join('knowledge', n + '.md') };
  });
}

module.exports = { FILE_TYPES, setRoot, list, get, byUid, saveText, importFile, update, resolve, copyInto, summary };
