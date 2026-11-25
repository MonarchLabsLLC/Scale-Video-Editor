'use strict';
// Model lists for each agent, read from the agent's own CLI or cache on this computer, so the
// list matches the plan the person is signed in with. Refreshed every time the app starts.
//
// A list looks like:
//   { models: [{ id, label, efforts: ['low', ...], defaultEffort, variants? }], effortFlag, fallback, fetched }
// effortFlag: the effort is passed as its own flag (Claude Code, Codex).
// variants:   the effort is part of the model name (Cursor); maps effort -> the real model id.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const winspawn = require('./winspawn');

const EFFORT_ORDER = ['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const sortEfforts = list => [...new Set(list)].sort((a, b) => EFFORT_ORDER.indexOf(a) - EFFORT_ORDER.indexOf(b));
const SAFE_MODEL = /^[\w.\-/:[\]=,@]+$/;
const SAFE_EFFORT = /^[a-z]+$/;

let cacheFile = null;
let cache = {};
function setCacheFile(file) {
  cacheFile = file;
  try { cache = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { cache = {}; }
}
function save() {
  if (!cacheFile) return;
  try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2)); } catch {}
}

function run(file, args, env, timeout = 20000) {
  return new Promise(resolve => {
    const r = winspawn.prepare(file, args);
    execFile(r.file, r.args, { timeout, env, maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...r.options },
      (err, stdout) => resolve(err && !stdout ? '' : String(stdout || '')));
  });
}

/* ---------- Claude Code ---------- */
// Claude Code has no "list models" command. It keeps what the signed-in plan can use in
// ~/.claude.json. The aliases (opus, sonnet, haiku, fable) always run the newest model of that
// family, so the list passes the alias and shows the newest version it knows about.
const CLAUDE_FAMILIES = [
  { alias: 'fable', name: 'Fable', note: 'Most capable, for the hardest work', optIn: true },
  { alias: 'opus', name: 'Opus', note: 'Very capable, for most videos' },
  { alias: 'sonnet', name: 'Sonnet', note: 'Fast and capable' },
  { alias: 'haiku', name: 'Haiku', note: 'Fastest, for small edits', noEffort: true }
];
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

function claudeVersions(text) {
  const best = {};
  for (const m of text.matchAll(/claude-(fable|opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?![\d])/g)) {
    const v = [Number(m[2]), Number(m[3] || 0)];
    const cur = best[m[1]];
    if (!cur || v[0] > cur[0] || (v[0] === cur[0] && v[1] > cur[1])) best[m[1]] = v;
  }
  return best;
}

function parseClaude(json, settingsModel) {
  const text = JSON.stringify(json || {});
  const best = claudeVersions(text);
  const options = Array.isArray(json && json.additionalModelOptionsCache) ? json.additionalModelOptionsCache : [];
  const hasOpt = alias => options.some(o => new RegExp(`\\b${alias}\\b`, 'i').test(`${o.value} ${o.label}`));
  const models = [];
  for (const f of CLAUDE_FAMILIES) {
    if (f.optIn && !hasOpt(f.alias)) continue;
    const v = best[f.alias];
    const version = v ? (v[1] ? `${v[0]}.${v[1]}` : `${v[0]}`) : '';
    models.push({
      id: f.alias,
      label: version ? `${f.name} ${version}` : `${f.name} (newest)`,
      note: f.note,
      efforts: f.noEffort ? [] : CLAUDE_EFFORTS,
      defaultEffort: f.noEffort ? '' : 'high'
    });
  }
  return { models, effortFlag: true, fallback: settingsModel ? `Claude Code setting (${settingsModel})` : 'Claude Code setting' };
}

async function claudeList() {
  let json = {};
  try { json = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8')); } catch {}
  let settingsModel = '';
  try { settingsModel = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8')).model || ''; } catch {}
  return parseClaude(json, settingsModel);
}

/* ---------- Codex ---------- */
// `codex debug models` prints the catalog for the signed-in account (Codex refreshes it itself).
function parseCodex(json, configText) {
  const list = Array.isArray(json) ? json : (json && json.models) || [];
  const models = list
    .filter(m => m && m.slug && m.visibility !== 'hide')
    .map(m => ({
      id: m.slug,
      label: m.display_name || m.slug,
      note: m.description || '',
      efforts: sortEfforts((m.supported_reasoning_levels || []).map(e => e.effort || e).filter(e => typeof e === 'string')),
      defaultEffort: m.default_reasoning_level || ''
    }));
  const cm = (configText.match(/^\s*model\s*=\s*"([^"]+)"/m) || [])[1];
  const ce = (configText.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m) || [])[1];
  const fb = [cm, ce].filter(Boolean).join(', ');
  return { models, effortFlag: true, fallback: fb ? `Codex setting (${fb})` : 'Codex setting' };
}

async function codexList(file, env) {
  const out = await run(file, ['debug', 'models'], env);
  let json = null;
  try { json = JSON.parse(out); } catch {}
  if (!json) {
    try { json = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex', 'models_cache.json'), 'utf8')); } catch {}
  }
  let config = '';
  try { config = fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8'); } catch {}
  return parseCodex(json, config);
}

/* ---------- Cursor ---------- */
// `cursor-agent models` prints "id - Label". The effort is part of the id (claude-opus-5-5-high),
// so ids that differ only by effort become one model with an effort choice.
const EFFORT_WORDS = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' };
function parseCursor(text) {
  const groups = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/[​‌‍﻿]/g, '').trim();
    const m = line.match(/^([\w.\-[\]=,:]+)\s+-\s+(.+?)(?:\s+\((?:current|default)[^)]*\))*$/i);
    if (!m) continue;
    const id = m[1];
    let label = m[2].trim();
    const em = id.match(/^(.*?)-(low|medium|high|xhigh|max)(-fast)?$/);
    const base = em ? em[1] + (em[3] || '') : id;
    const effort = em ? em[2] : '';
    if (em) label = label.replace(new RegExp(`\\s*\\b${EFFORT_WORDS[effort]}\\b`, 'i'), '').replace(/\s{2,}/g, ' ').trim();
    if (!groups.has(base)) groups.set(base, { id: base, label, variants: {} });
    const g = groups.get(base);
    if (!effort || label.length < g.label.length) g.label = label || g.label;
    g.variants[effort] = id;
  }
  const models = [];
  for (const g of groups.values()) {
    const efforts = sortEfforts(Object.keys(g.variants));
    const real = efforts.length > 1 || efforts[0] !== '';
    models.push({
      id: g.id, label: g.label,
      efforts: real ? efforts : [],
      defaultEffort: g.variants[''] ? '' : (g.variants.medium ? 'medium' : efforts[0]),
      variants: g.variants
    });
  }
  return { models, effortFlag: false, fallback: 'Cursor setting' };
}

/* ---------- others ---------- */
// OpenCode prints one "provider/model" per line. Grok Build and Antigravity are tried the same way.
function parseLines(text, name) {
  const models = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = line.match(/^([\w.\-/:[\]]+)(?:\s+-\s+(.+))?$/);
    if (!m || /^(available|usage|models?)$/i.test(m[1])) continue;
    models.push({ id: m[1], label: (m[2] || m[1]).trim(), efforts: [], defaultEffort: '' });
  }
  return { models, effortFlag: false, fallback: `${name} setting` };
}

async function fetchList(id, file, env, name) {
  if (id === 'claude') return claudeList();
  if (!file) return { models: [], effortFlag: false, fallback: `${name} setting` };
  if (id === 'codex') return codexList(file, env);
  if (id === 'cursor') return parseCursor(await run(file, ['models'], env));
  return parseLines(await run(file, ['models'], env, 12000), name);
}

// Returns the saved list at once; refresh: true asks the agent again.
async function list(engine, { file, env, refresh } = {}) {
  const have = cache[engine.id];
  if (have && !refresh) return have;
  try {
    const fresh = await fetchList(engine.id, file, env, engine.name);
    // Keep the last good list if the agent said nothing this time (offline, signed out).
    if (fresh.models.length || !have) { cache[engine.id] = { ...fresh, fetched: Date.now() }; save(); }
  } catch {}
  return cache[engine.id] || { models: [], effortFlag: false, fallback: `${engine.name} setting` };
}

// Turns a saved choice { model, effort } into what the agent gets: { model, effort }.
function resolve(engineId, choice) {
  if (!choice || !choice.model) return { model: '', effort: '' };
  const l = cache[engineId];
  const m = l && l.models.find(x => x.id === choice.model);
  let model = choice.model;
  let effort = choice.effort || '';
  if (m && m.variants) { model = m.variants[effort] || m.variants[m.defaultEffort] || Object.values(m.variants)[0]; effort = ''; }
  else if (l && !l.effortFlag) effort = '';
  if (m && !m.variants && effort && m.efforts.length && !m.efforts.includes(effort)) effort = m.defaultEffort || '';
  if (m && !m.efforts.length) effort = '';
  return { model: SAFE_MODEL.test(model) ? model : '', effort: SAFE_EFFORT.test(effort) ? effort : '' };
}

module.exports = { setCacheFile, list, resolve, parseClaude, parseCodex, parseCursor, parseLines, claudeVersions };
