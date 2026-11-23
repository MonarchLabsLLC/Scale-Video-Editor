'use strict';
// The ElevenLabs voices the toolkit's my-voice command uses, kept in its own settings file
// (~/.config/scale-video-toolkit/voice.json). The editor edits three slots:
//   Default (No. 1) -> "voice_id", the voice my-voice uses when no --voice is given
//   Alternate 2/3   -> "voices": { "alternate-2": id, "alternate-3": id }, used with --voice alternate-2
// Names for the slots go in "voice_names". Every other field in the file is kept as it is.
// A voice ID is not a secret. The ElevenLabs key stays in the Keychain; this file never holds it.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SLOTS = [
  { slot: 1, key: 'default', label: 'Default' },
  { slot: 2, key: 'alternate-2', label: 'Alternate 2' },
  { slot: 3, key: 'alternate-3', label: 'Alternate 3' }
];
const ID_RE = /^[A-Za-z0-9]{12,40}$/;

function file() {
  return process.env.SVT_VOICE_CONFIG || path.join(process.env.SVT_CONFIG_DIR || path.join(os.homedir(), '.config', 'scale-video-toolkit'), 'voice.json');
}

function readRaw() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')) || {}; } catch { return {}; }
}

// [{ slot, key, label, name, id }]
function get() {
  const cfg = readRaw();
  const names = cfg.voice_names || {};
  const extra = cfg.voices || {};
  return {
    file: file(),
    slots: SLOTS.map(s => ({
      ...s,
      id: s.key === 'default' ? (cfg.voice_id || '') : (extra[s.key] || ''),
      name: names[s.key] || ''
    }))
  };
}

// slots: [{ key, name, id }]. Empty id clears that slot. Returns get() or throws a plain message.
function set(slots) {
  const cfg = readRaw();
  const names = { ...(cfg.voice_names || {}) };
  const extra = { ...(cfg.voices || {}) };
  for (const s of slots || []) {
    const def = SLOTS.find(x => x.key === s.key);
    if (!def) continue;
    const id = String(s.id || '').trim();
    const name = String(s.name || '').trim().slice(0, 60);
    if (id && !ID_RE.test(id)) throw new Error(`${def.label}: a voice ID is 12 to 40 letters and numbers, with no spaces.`);
    if (def.key === 'default') cfg.voice_id = id;
    else if (id) extra[def.key] = id; else delete extra[def.key];
    if (name && id) names[def.key] = name; else delete names[def.key];
  }
  cfg.voices = extra;
  cfg.voice_names = names;
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  fs.renameSync(tmp, f);
  return get();
}

// What the agent is told for one turn. key: '' (default) or a slot key.
function forPrompt(key) {
  const { slots } = get();
  const set = slots.filter(s => s.id);
  if (!set.length) return null;
  const chosen = set.find(s => s.key === (key || 'default')) || set[0];
  const label = s => `${s.label}${s.name ? ` "${s.name}"` : ''}`;
  return {
    chosen,
    line: `Voiceover: use the ${label(chosen)} voice: ${chosen.key === 'default' ? 'my-voice with no --voice' : `my-voice --voice ${chosen.key}`}.` +
      (set.length > 1 ? ` Other voices the person set up: ${set.filter(s => s !== chosen).map(s => `${label(s)} (${s.key === 'default' ? 'no --voice' : '--voice ' + s.key})`).join(', ')}. Use another one only when the person asks.` : '')
  };
}

module.exports = { SLOTS, ID_RE, file, get, set, forPrompt };
