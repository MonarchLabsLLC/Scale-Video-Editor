// Brand guides: a person's design guides (DESIGN.md), kept on this computer so the agent can make
// every video in that brand. Each guide is a folder in "<projects folder>/Brand Guides/<name>":
//   DESIGN.md      the guide the agent reads
//   logo.<ext>     the logo, when we found one
//   .brand.json    the editor's own record (name, where it came from, colors and fonts for the cards)
//
// A guide comes from a file the person adds (.md .txt .rtf .doc .docx .pdf .html), from a link to a
// DESIGN.md, or from a scan of their website. Only the design guide is wanted: colors, fonts, logo and
// layout rules. A brand knowledge document (offers, audience, story) is not needed here.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const crypto = require('node:crypto');

const FILE_TYPES = ['.md', '.markdown', '.txt', '.rtf', '.doc', '.docx', '.pdf', '.html', '.htm'];
const MAX_FILE = 20 * 1024 * 1024;
const MAX_TEXT = 400 * 1024;

let root = null;
function setRoot(dir) { root = dir; }
function getRoot() { return root; }
function ensureRoot() { if (!root) throw new Error('Brand guides folder not set'); fs.mkdirSync(root, { recursive: true }); return root; }

const slugify = name => String(name || 'Brand').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').replace(/^\.+/, '').slice(0, 60) || 'Brand';
const metaFile = dir => path.join(dir, '.brand.json');
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
  if (path.dirname(dir) !== root || !readMeta(dir)) throw new Error('Brand guide not found');
  return dir;
}
function withDir(dir) {
  const meta = readMeta(dir);
  if (!meta) return null;
  const logo = meta.logo && fs.existsSync(path.join(dir, meta.logo)) ? path.join(dir, meta.logo) : null;
  return { ...meta, id: path.basename(dir), dir, file: path.join(dir, 'DESIGN.md'), logoPath: logo };
}

function list() {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root).map(n => withDir(path.join(root, n))).filter(Boolean).sort((a, b) => (b.updated || 0) - (a.updated || 0));
}
function get(id) {
  const g = withDir(resolve(id));
  let text = '';
  try { text = fs.readFileSync(g.file, 'utf8'); } catch {}
  return { ...g, text };
}

/* ---------- reading a guide ---------- */

const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const norm = h => { h = h.toLowerCase(); return h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h; };
const unquote = s => String(s || '').trim().replace(/^["']|["']$/g, '').trim();
const firstFamily = s => unquote(String(s).split(',')[0]).replace(/["']/g, '').trim();

// Pulls the parts the cards and the detail page show: name, description, colors (named when the
// guide names them), fonts and the section headings. Works on Google's DESIGN.md format (YAML front
// matter with colors and typography) and on any other text that names hex colors and fonts.
function parseDesign(text) {
  const src = String(text || '');
  let front = '', body = src;
  const fm = src.match(/^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (fm) { front = fm[1]; body = src.slice(fm[0].length); }
  const out = { name: '', description: '', colors: [], fonts: [], sections: [] };
  if (front) {
    const lines = front.split(/\r?\n/);
    let block = '';
    for (const line of lines) {
      const top = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
      if (top) {
        block = top[1];
        if (block === 'name') out.name = unquote(top[2]);
        if (block === 'description') out.description = unquote(top[2]);
        continue;
      }
      if (block === 'colors') {
        const c = line.match(/^\s+([\w.-]+):\s*["']?(#[0-9a-fA-F]{3,8})\b/);
        if (c && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c[2])) out.colors.push({ name: c[1], hex: norm(c[2]) });
      }
      const f = line.match(/^\s+fontFamily:\s*(.+)$/);
      if (f) { const fam = firstFamily(f[1]); if (fam && !out.fonts.includes(fam)) out.fonts.push(fam); }
    }
  }
  if (!out.colors.length) {
    const seen = new Map();
    for (const m of src.matchAll(HEX)) { const k = norm(m[0]); seen.set(k, (seen.get(k) || 0) + 1); }
    out.colors = [...seen.keys()].slice(0, 12).map(hex => ({ name: '', hex }));
  }
  if (!out.fonts.length) {
    const found = [];
    for (const m of src.matchAll(/font-family\s*:\s*([^;\n}]+)/gi)) found.push(firstFamily(m[1]));
    for (const m of src.matchAll(/^\s*[-*]?\s*\**(?:font|typeface|heading font|body font|display font|primary font|secondary font)s?\**\s*[:\-–]\s*\**([A-Z][\w ]{1,40}?)\**\s*(?:[,(.;]|$)/gim)) found.push(m[1].trim());
    for (const f of found) if (f && !/^(inherit|initial|var\(|sans-serif|serif|monospace|system-ui)$/i.test(f) && !out.fonts.includes(f)) out.fonts.push(f);
    out.fonts = out.fonts.slice(0, 4);
  }
  for (const m of body.matchAll(/^#{2}\s+(.+?)\s*#*\s*$/gm)) {
    const s = m[1].replace(/^\d+[.)]\s*/, '').replace(/[*_`]/g, '').trim();
    if (s && !out.sections.includes(s)) out.sections.push(s);
  }
  out.sections = out.sections.slice(0, 12);
  if (!out.name) { const t = body.match(/^#\s+(.+)$/m); if (t) out.name = t[1].replace(/[*_`]/g, '').replace(/\s*(design (guide|system)|DESIGN\.md)\s*$/i, '').trim(); }
  if (!out.description) {
    const para = body.split(/\r?\n\s*\r?\n/).map(p => p.trim()).find(p => p && !/^[#|>`\-*!\[]/.test(p) && p.length > 30);
    if (para) out.description = para.replace(/\s+/g, ' ').slice(0, 280);
  }
  out.isDesign = out.colors.length >= 2 || out.fonts.length >= 1;
  return out;
}

/* ---------- turning a file into text ---------- */

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => execFile(cmd, args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, ...opts }, (err, out) => err ? rej(err) : res(String(out))));
}
const stripTags = html => String(html)
  .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();

async function textFromFile(file) {
  const ext = path.extname(file).toLowerCase();
  if (!FILE_TYPES.includes(ext)) throw new Error(`That file type (${ext || 'none'}) is not one we read. Use .md, .txt, .rtf, .doc, .docx, .pdf or .html.`);
  const st = fs.statSync(file);
  if (st.size > MAX_FILE) throw new Error('That file is larger than 20 MB. A design guide is usually much smaller.');
  const mac = process.platform === 'darwin';
  if (ext === '.md' || ext === '.markdown' || ext === '.txt') return fs.readFileSync(file, 'utf8');
  if (ext === '.html' || ext === '.htm') {
    const raw = fs.readFileSync(file, 'utf8');
    const text = mac ? await run('textutil', ['-convert', 'txt', '-stdout', file]).catch(() => stripTags(raw)) : stripTags(raw);
    return text + stylesFound(raw);
  }
  if (ext === '.pdf') {
    if (mac || process.platform === 'linux') {
      const viaPoppler = await run('pdftotext', ['-layout', file, '-']).catch(() => '');
      if (viaPoppler.trim()) return viaPoppler;
    }
    if (mac) {
      const jxa = 'function run(argv){ObjC.import("PDFKit");var d=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));if(!d||d.isNil())return "";return ObjC.unwrap(d.string);}';
      const t = await run('osascript', ['-l', 'JavaScript', '-e', jxa, file]).catch(() => '');
      if (t.trim()) return t;
      throw new Error('We could not read any text in that PDF. It may be a scan. Export the design guide as .md or .txt instead.');
    }
    throw new Error('On this computer we cannot read PDFs yet. Save the design guide as .md or .txt and add that.');
  }
  // .rtf .doc .docx
  if (mac) return run('textutil', ['-convert', 'txt', '-stdout', file]);
  throw new Error('On this computer we cannot read Word or RTF files yet. Save the design guide as .md or .txt and add that.');
}

// HTML keeps its colors and fonts in CSS, which a text export drops. List them so the guide keeps them.
function stylesFound(html) {
  const colors = [...new Set([...String(html).matchAll(HEX)].map(m => norm(m[0])))].slice(0, 16);
  const fonts = [...new Set([...String(html).matchAll(/font-family\s*:\s*([^;}\n<]+)/gi)].map(m => firstFamily(m[1])).filter(f => f && !/^(inherit|var\()/i.test(f)))].slice(0, 6);
  if (!colors.length && !fonts.length) return '';
  return `\n\n## Styles found in the file\n\n${colors.length ? `Colors: ${colors.join(', ')}\n` : ''}${fonts.length ? `Fonts: ${fonts.join(', ')}\n` : ''}`;
}

/* ---------- saving ---------- */

function looksLikeMarkdown(text) {
  return /^---\r?\n/.test(text) || /^#{1,3}\s+\S/m.test(text);
}

// Saves a guide from text. Returns the saved guide with `warning` when it does not look like a design guide.
function saveText({ name, text, source, logo }) {
  let body = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!body) throw new Error('That file has no text in it.');
  if (body.length > MAX_TEXT) body = body.slice(0, MAX_TEXT);
  const parsed0 = parseDesign(body);
  const guideName = slugify(name || parsed0.name || 'Brand');
  if (!looksLikeMarkdown(body)) {
    body = `# ${guideName} design guide\n\n_${source && source.label ? `Imported from ${source.label}.` : 'Imported.'}_\n\n${body}`;
  }
  const parsed = parseDesign(body);
  const dir = freeDir(guideName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'DESIGN.md'), body.endsWith('\n') ? body : body + '\n');
  let logoName = null;
  if (logo && logo.data && logo.ext) {
    logoName = 'logo' + logo.ext;
    fs.writeFileSync(path.join(dir, logoName), logo.data);
  }
  const now = Date.now();
  const meta = {
    uid: crypto.randomUUID(), name: path.basename(dir), source: source || { kind: 'file', label: '' }, logo: logoName,
    description: parsed.description, colors: parsed.colors.slice(0, 12), fonts: parsed.fonts, sections: parsed.sections,
    needsGuide: !parsed.isDesign, created: now, updated: now
  };
  writeMeta(dir, meta);
  const g = withDir(dir);
  if (meta.needsGuide) g.warning = 'We found no colors or fonts in this. It may be a brand knowledge document. Add your design guide instead: the DESIGN.md file with your colors, fonts and logo.';
  return g;
}

async function importFile(file) {
  const text = await textFromFile(file);
  const base = path.basename(file, path.extname(file));
  const name = /^design$/i.test(base) ? '' : base;
  return saveText({ name, text, source: { kind: 'file', label: path.basename(file) } });
}

function update(id, patch) {
  const dir = resolve(id);
  const meta = { ...readMeta(dir) };
  if (typeof patch.text === 'string') {
    fs.writeFileSync(path.join(dir, 'DESIGN.md'), patch.text);
    const p = parseDesign(patch.text);
    Object.assign(meta, { description: p.description, colors: p.colors.slice(0, 12), fonts: p.fonts, sections: p.sections, needsGuide: !p.isDesign });
  }
  meta.updated = Date.now();
  writeMeta(dir, meta);
  return withDir(dir);
}

function rename(id, name) {
  const dir = resolve(id);
  const target = path.join(root, slugify(name));
  if (target === dir) return withDir(dir);
  if (fs.existsSync(target)) throw new Error('A brand guide with that name already exists.');
  fs.renameSync(dir, target);
  writeMeta(target, { ...readMeta(target), name: path.basename(target), updated: Date.now() });
  return withDir(target);
}

function duplicate(id) {
  const src = resolve(id);
  const dir = freeDir(`${readMeta(src).name} copy`);
  fs.cpSync(src, dir, { recursive: true, errorOnExist: true });
  const now = Date.now();
  writeMeta(dir, { ...readMeta(dir), uid: crypto.randomUUID(), name: path.basename(dir), created: now, updated: now });
  return withDir(dir);
}

// Puts the guide in the project's "brand" folder before each turn, so the agent reads the current
// version from inside its own folder. Returns what the agent's instructions name, or null.
// Projects and settings keep the guide's uid, so renaming a guide does not break them.
function byUid(uid) { return uid ? list().find(g => g.uid === uid) || null : null; }

function copyInto(uid, projectDir) {
  const g = byUid(uid);
  if (!g) return null;
  const dest = path.join(projectDir, 'brand');
  fs.mkdirSync(dest, { recursive: true });
  for (const n of fs.readdirSync(dest)) if (/^(DESIGN\.md|logo\.\w+)$/.test(n)) fs.rmSync(path.join(dest, n), { force: true });
  fs.copyFileSync(g.file, path.join(dest, 'DESIGN.md'));
  if (g.logoPath) fs.copyFileSync(g.logoPath, path.join(dest, path.basename(g.logoPath)));
  return { name: g.name, file: path.join('brand', 'DESIGN.md'), logo: g.logoPath ? path.join('brand', path.basename(g.logoPath)) : null };
}

/* ---------- links ---------- */

// Cleans what the person typed and says what kind of link it is.
function classifyUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Type a website or a link to a DESIGN.md.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new Error('That does not look like a web address.'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Use a web address that starts with https://');
  if (!u.hostname.includes('.')) throw new Error('That does not look like a web address.');
  const host = u.hostname.replace(/^www\./, '');
  // getdesign.md pages: the files themselves live in the open-source collection on GitHub.
  if (host === 'getdesign.md') {
    const slug = u.pathname.split('/').filter(Boolean)[0];
    if (slug && slug !== 'design-md') {
      return { kind: 'doc', url: `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/${encodeURIComponent(slug)}/DESIGN.md`, page: u.href, name: slug.replace(/[-_]+/g, ' ').replace(/(^|\s)\w/g, c => c.toUpperCase()) };
    }
    throw new Error('Open one design on getdesign.md, then paste the link to that design.');
  }
  if (host === 'github.com') {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+\.(?:md|markdown|txt))$/i);
    if (m) return { kind: 'doc', url: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`, page: u.href };
  }
  if (/\.(md|markdown|txt)$/i.test(u.pathname)) return { kind: 'doc', url: u.href, page: u.href };
  if (/\.pdf$/i.test(u.pathname)) return { kind: 'pdf', url: u.href, page: u.href };
  return { kind: 'site', url: u.href, page: u.href, host };
}

/* ---------- a guide from a website scan ---------- */

const rgb = hex => { const n = parseInt(norm(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = ([r, g, b]) => '#' + [r, g, b].map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
function chroma(hex) { const [r, g, b] = rgb(hex); return Math.max(r, g, b) - Math.min(r, g, b); }
function lum(hex) { const [r, g, b] = rgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
function dist(a, b) { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }
const contrastOn = hex => (lum(hex) > 0.4 ? '#0a0a0a' : '#ffffff');
function topKeys(obj, n) { return Object.entries(obj || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]); }

// Builds DESIGN.md (Google's format: YAML front matter, then sections) from what the scan saw on the page.
function designFromScan(scan, when = new Date()) {
  const canvas = scan.bg || '#ffffff';
  // Main text: of the common text colors, the one that stands out most from the background.
  const tc = Object.entries(scan.textColors || {}).sort((a, b) => b[1] - a[1]);
  const common = tc.filter(([, n]) => n >= (tc[0] ? tc[0][1] * 0.15 : 0)).map(([c]) => c).filter(c => chroma(c) <= 40);
  const contrast = c => { const a = lum(c), b = lum(canvas); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const ink = [...common, scan.text].filter(Boolean).sort((a, b) => contrast(b) - contrast(a))[0] || contrastOn(canvas);
  const accents = [];
  const add = c => { if (c && chroma(c) > 40 && dist(c, canvas) > 60 && !accents.some(a => dist(a, c) < 40)) accents.push(c); };
  (scan.buttons || []).forEach(b => add(b.bg));
  add(scan.linkColor);
  topKeys(scan.areas, 12).forEach(add);
  topKeys(scan.textColors, 12).forEach(add);
  Object.values(scan.vars || {}).forEach(add);
  const surfaces = [];
  topKeys(scan.areas, 12).forEach(c => { if (chroma(c) <= 40 && dist(c, canvas) > 8 && !surfaces.some(s => dist(s, c) < 12)) surfaces.push(c); });
  const muted = [...common, ...topKeys(scan.textColors, 12)].find(c => chroma(c) <= 40 && dist(c, ink) > 30 && dist(c, canvas) > 80);
  const primary = accents[0] || ink;
  const btn = (scan.buttons || []).find(b => b.bg && dist(b.bg, primary) < 40) || (scan.buttons || [])[0] || {};
  const colors = [['canvas', canvas], ['ink', ink], ['primary', primary], ['on-primary', btn.color && dist(btn.color, primary) > 80 ? btn.color : contrastOn(primary)]];
  if (muted) colors.push(['ink-muted', muted]);
  const light = surfaces.find(s => Math.abs(lum(s) - lum(canvas)) < 0.3);
  const inverse = surfaces.find(s => Math.abs(lum(s) - lum(canvas)) >= 0.3 && dist(s, ink) > 12);
  if (light) colors.push(['surface', light]);
  if (inverse) colors.push(['inverse', inverse]);
  accents.slice(1, 5).forEach((a, i) => colors.push([`accent-${i + 1}`, a]));
  const heading = scan.headingFont || scan.bodyFont || 'system-ui';
  const bodyFont = scan.bodyFont || heading;
  const radius = btn.radius || '8px';
  const name = scan.siteName || scan.title || scan.host || 'Brand';
  const date = when.toISOString().slice(0, 10);
  const yaml = [
    '---',
    'version: alpha',
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(`The look of ${scan.host || name}: ${describe(canvas, primary)}, ${heading} for headlines${bodyFont !== heading ? ` and ${bodyFont} for body text` : ''}. Read from the live website on ${date}.`)}`,
    '',
    'colors:',
    ...colors.map(([k, v]) => `  ${k}: "${v}"`),
    '',
    'typography:',
    '  display:',
    `    fontFamily: "${heading}"`,
    `    fontWeight: ${scan.headingWeight || 700}`,
    scan.h1Size ? `    fontSize: ${scan.h1Size}` : null,
    '  body:',
    `    fontFamily: "${bodyFont}"`,
    `    fontWeight: ${scan.bodyWeight || 400}`,
    scan.bodySize ? `    fontSize: ${scan.bodySize}` : null,
    '',
    'rounded:',
    `  button: ${radius}`,
    '---'
  ].filter(l => l !== null);
  const md = [
    '',
    `# ${name} design guide`,
    '',
    `Made by Scale Video Editor from ${scan.url} on ${date}. It is a quick read of the live page, not an official brand guide. If the brand has a real DESIGN.md, use that instead.`,
    '',
    '## Overview',
    '',
    `${scan.description ? scan.description.trim() + '\n\n' : ''}The page sits on ${canvas} with ${ink} text. ${primary !== ink ? `The main brand color is ${primary}, used on buttons and calls to action.` : 'The page has no strong accent color; it relies on contrast.'}`,
    '',
    '## Colors',
    '',
    '| Name | Hex | Use |',
    '|---|---|---|',
    ...colors.map(([k, v]) => `| ${k} | ${v} | ${USE[k.replace(/-\d+$/, '')] || 'Supporting color'} |`),
    '',
    '## Typography',
    '',
    `- Headlines: ${heading}, weight ${scan.headingWeight || 700}${scan.h1Size ? `, about ${scan.h1Size} on the website` : ''}.`,
    `- Body text: ${bodyFont}, weight ${scan.bodyWeight || 400}${scan.bodySize ? `, ${scan.bodySize}` : ''}.`,
    '- If a font is not installed, use the closest free match and say which one you used.',
    '',
    '## Shapes',
    '',
    `- Buttons and pills use a corner radius of ${radius}.`,
    '',
    '## Logo',
    '',
    scan.logoSaved ? '- The logo is saved next to this file. Use it as it is: do not redraw, recolor or stretch it.' : '- No logo was found on the page. Ask for one before you put a logo in a video.',
    '',
    "## Do's and Don'ts",
    '',
    `- Do use ${primary} for the one thing you want people to look at or click.`,
    `- Do keep text ${ink} on ${canvas} (or the reverse) so it is easy to read.`,
    '- Do keep layouts simple, with plenty of space around text.',
    '- Don\'t add colors that are not in this guide.',
    '- Don\'t mix more than the two fonts named here.',
    ''
  ];
  return yaml.join('\n') + '\n' + md.join('\n');
}
const USE = {
  canvas: 'Page and frame background', ink: 'Main text', primary: 'Buttons, highlights, calls to action',
  'on-primary': 'Text on the primary color', 'ink-muted': 'Secondary text, captions', surface: 'Cards and panels', inverse: 'Dark (or light) sections that flip the page', accent: 'Supporting accent'
};
function describe(canvas, primary) {
  const tone = lum(canvas) < 0.2 ? 'a dark background' : 'a light background';
  return primary && chroma(primary) > 40 ? `${tone} with ${primary} as the accent` : tone;
}

// Runs in the scanned page (in a hidden, sandboxed window with no access to this computer).
const SCAN_SCRIPT = `(() => {
  const hex = c => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number); if ((p[3] ?? 1) < 0.5) return null; return '#' + p.slice(0, 3).map(x => Math.round(x).toString(16).padStart(2, '0')).join(''); };
  const cs = el => getComputedStyle(el);
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2 && cs(el).visibility !== 'hidden' && cs(el).display !== 'none'; };
  const all = (sel, n) => [...document.querySelectorAll(sel)].filter(vis).slice(0, n);
  const fam = el => el ? cs(el).fontFamily.split(',')[0].replace(/["']/g, '').trim() : null;
  const body = document.body;
  const bg = hex(cs(body).backgroundColor) || hex(cs(document.documentElement).backgroundColor) || '#ffffff';
  const head = all('h1', 3)[0] || all('h2', 3)[0];
  const para = all('p', 30).find(p => (p.textContent || '').trim().length > 40) || body;
  const areas = {};
  for (const el of all('body, header, nav, main, section, footer, div, aside', 600)) {
    const c = hex(cs(el).backgroundColor); if (!c) continue;
    const r = el.getBoundingClientRect(); areas[c] = (areas[c] || 0) + Math.min(r.width * r.height, 4e6);
  }
  const textColors = {};
  for (const el of all('p, li, span, a, h1, h2, h3, h4, small, label', 800)) {
    const c = hex(cs(el).color); if (c) textColors[c] = (textColors[c] || 0) + Math.min((el.textContent || '').length, 400);
  }
  const buttons = all('button, a[class*="btn" i], a[class*="button" i], [role="button"], input[type="submit"]', 60)
    .map(b => ({ bg: hex(cs(b).backgroundColor), color: hex(cs(b).color), radius: cs(b).borderTopLeftRadius }))
    .filter(b => b.bg);
  const link = all('main a, section a, p a', 40)[0];
  const vars = {};
  try { for (const s of document.styleSheets) { let rules; try { rules = s.cssRules; } catch { continue; } for (const r of rules) { if (r.selectorText === ':root' && r.style) for (const p of r.style) { if (p.startsWith('--')) { const v = r.style.getPropertyValue(p).trim(); if (/^#[0-9a-f]{6}$/i.test(v)) vars[p] = v.toLowerCase(); } } } } } catch {}
  const meta = n => (document.querySelector('meta[property="' + n + '"], meta[name="' + n + '"]') || {}).content || '';
  const abs = u => { try { return new URL(u, location.href).href; } catch { return null; } };
  // The logo: score every image and svg near the top. A link home and the word "logo" count most;
  // a picture far down the page (a press logo, a customer logo) counts least.
  let logo = null, svg = null;
  const home = a => { if (!a) return false; try { const u = new URL(a.getAttribute('href') || '', location.href); return u.origin === location.origin && (u.pathname === '/' || u.pathname === ''); } catch { return false; } };
  const said = el => /logo|brand/i.test([el.getAttribute('class'), el.getAttribute('alt'), el.getAttribute('src'), el.getAttribute('aria-label'), el.id].join(' ')) ;
  const scored = all('img, svg', 400).map(el => {
    const r = el.getBoundingClientRect();
    if (r.top > 260 || r.width < 18 || r.height < 12 || r.width > 600) return null;
    let s = 0;
    if (home(el.closest('a'))) s += 5;
    if (said(el) || (el.parentElement && said(el.parentElement))) s += 4;
    if (el.closest('header, nav')) s += 2;
    if (r.left < innerWidth * 0.4) s += 1;
    if (r.top < 120) s += 1;
    if (el.closest('a') && !home(el.closest('a')) && !said(el)) s -= 3;
    return s >= 3 ? { el, s } : null;
  }).filter(Boolean).sort((a, b) => b.s - a.s);
  const best = scored[0] && scored[0].el;
  if (best && best.tagName.toLowerCase() === 'img') logo = abs(best.currentSrc || best.src);
  else if (best) {
    // An inline svg often takes its colors from the page's CSS. Write the drawn colors into a copy.
    const copy = best.cloneNode(true);
    const src = [best, ...best.querySelectorAll('*')], dst = [copy, ...copy.querySelectorAll('*')];
    src.forEach((el, i) => {
      const st = cs(el), d = dst[i];
      for (const k of ['fill', 'stroke', 'stop-color', 'opacity', 'fill-opacity', 'stroke-width']) { const v = st.getPropertyValue(k); if (v) d.style.setProperty(k, v); }
      if (el === best) { d.style.color = st.color; const r = el.getBoundingClientRect(); if (!d.getAttribute('width')) d.setAttribute('width', Math.round(r.width)); if (!d.getAttribute('height')) d.setAttribute('height', Math.round(r.height)); }
    });
    // A light icon often sits on a colored tile drawn by its parent. Put that tile behind it.
    let tile = null;
    for (let el = best.parentElement, i = 0; el && i < 3 && !tile; el = el.parentElement, i++) {
      const r = el.getBoundingClientRect(), me = best.getBoundingClientRect();
      if (r.width > me.width * 2.5 || r.height > me.height * 2.5) break;
      const c = hex(cs(el).backgroundColor);
      if (c) tile = { c, radius: parseFloat(cs(el).borderTopLeftRadius) || 0, w: r.width };
    }
    if (tile) {
      const vb = (copy.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
      const [x, y, w, hgt] = vb.length === 4 && vb.every(n => !isNaN(n)) ? vb : [0, 0, best.getBoundingClientRect().width, best.getBoundingClientRect().height];
      const pad = Math.max(w, hgt) * 0.3;
      copy.setAttribute('viewBox', [x - pad, y - pad, w + pad * 2, hgt + pad * 2].join(' '));
      copy.setAttribute('width', Math.round(tile.w)); copy.setAttribute('height', Math.round(tile.w));
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', x - pad); rect.setAttribute('y', y - pad); rect.setAttribute('width', w + pad * 2); rect.setAttribute('height', hgt + pad * 2);
      rect.setAttribute('rx', (tile.radius / tile.w) * (w + pad * 2)); rect.setAttribute('style', 'fill:' + tile.c + ';stroke:none');
      copy.insertBefore(rect, copy.firstChild);
    }
    if (copy.outerHTML.length < 120000) svg = copy.outerHTML;
  }
  const icon = [...document.querySelectorAll('link[rel~="apple-touch-icon"], link[rel~="icon"]')].map(l => abs(l.href)).filter(Boolean).pop() || null;
  return {
    url: location.href, host: location.hostname.replace(/^www\\./, ''), title: document.title, siteName: meta('og:site_name'), description: meta('description') || meta('og:description'),
    bg, text: hex(cs(para).color) || hex(cs(body).color), headingFont: fam(head), headingWeight: head ? cs(head).fontWeight : null, h1Size: head ? cs(head).fontSize : null,
    bodyFont: fam(para), bodyWeight: cs(para).fontWeight, bodySize: cs(para).fontSize,
    linkColor: link ? hex(cs(link).color) : null, buttons, areas, textColors, vars, logo, svg, icon
  };
})()`;

const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/gif': '.gif', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico' };

module.exports = {
  setRoot, getRoot, list, get, byUid, update, rename, duplicate, resolve, copyInto,
  parseDesign, textFromFile, importFile, saveText, classifyUrl, designFromScan, stylesFound,
  SCAN_SCRIPT, IMAGE_EXT, FILE_TYPES, MAX_TEXT
};
