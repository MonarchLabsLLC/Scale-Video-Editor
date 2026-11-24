/* Scale Video Editor: the window. Plain DOM, no framework, so anyone can read and change it. */
'use strict';

const api = window.sve;
const FORMATS = window.SVE_FORMATS || [];
const CATS = window.SVE_CATEGORIES || [];
const TICKS = 254016000000;

const state = {
  env: null,
  models: {},
  voices: null,
  projects: [],
  fc: null,
  route: { view: 'home' },
  cat: 'all',
  chats: {},          // projectId -> messages
  busy: new Set(),    // projectIds with a running turn
  attachments: {},    // context key -> [paths]
  drafts: {},         // context key -> text
  files: {},          // projectId -> files
  selected: {},       // projectId -> selected file path
  previewMode: {},    // projectId -> 'exports' | 'filmcraft'
  seq: null,
  frame: null,
  frameBusy: false
};

/* ---------- small helpers ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const basename = p => String(p).split(/[\\/]/).pop();

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function ago(ms) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'now';
  const m = Math.round(s / 60); if (m < 60) return m + 'm';
  const hr = Math.round(m / 60); if (hr < 24) return hr + 'h';
  return Math.round(hr / 24) + 'd';
}

function tc(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60), f = Math.floor((sec % 1) * 30);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

// Small, safe Markdown: code blocks, inline code, bold, italics, headings, lists, links.
function md(src) {
  const blocks = String(src || '').split(/```/);
  let out = '';
  blocks.forEach((b, i) => {
    if (i % 2 === 1) { out += `<pre>${esc(b.replace(/^[a-z]*\n/, ''))}</pre>`; return; }
    const lines = b.split('\n');
    let list = null, para = [], table = null;
    const flush = () => { if (para.length) { out += `<p>${inline(para.join(' '))}</p>`; para = []; } };
    const closeTable = () => { if (table) { out += `<table class="md-table">${table.map((r, j) => `<tr>${r.map(c => j ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join('')}</tr>`).join('')}</table>`; table = null; } };
    const close = () => { if (list) { out += `</${list}>`; list = null; } closeTable(); };
    for (const line of lines) {
      if (/^\s*\|.*\|\s*$/.test(line)) {
        flush(); if (list) { out += `</${list}>`; list = null; }
        const cells = line.trim().slice(1, -1).split('|').map(c => c.trim());
        if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
        (table || (table = [])).push(cells);
        continue;
      }
      closeTable();
      const ul = line.match(/^\s*[-*]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/), hd = line.match(/^(#{1,4})\s+(.*)/);
      if (ul || ol) {
        flush();
        const want = ul ? 'ul' : 'ol';
        if (list !== want) { close(); out += `<${want}>`; list = want; }
        out += `<li>${inline((ul || ol)[1])}</li>`;
      } else if (hd) { flush(); close(); out += `<h4>${inline(hd[2])}</h4>`; }
      else if (!line.trim()) { flush(); close(); }
      else { close(); para.push(line); }
    }
    flush(); close();
  });
  return out;
}
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" data-ext="1">$1</a>');
}
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-ext]');
  if (a) { e.preventDefault(); api.os.openExternal(a.getAttribute('href')); }
});

// The dashboard's tones: each pastel with its own ink. Cards cycle through them by position,
// so neighbours never share a colour; a category keeps its own pastel.
const TONES = {
  peach: ['#f3c9b6', '#3b1d10'], lilac: ['#c5b0f4', '#20143b'], lime: ['#dceeb1', '#1d2a0c'], mint: ['#c8e6cd', '#12301a'],
  yellow: ['#f3e28a', '#3a3208'], cream: ['#f4ecd6', '#3a2f12'], pink: ['#efd4d4', '#3b1a1a']
};
const TONE_CYCLE = ['peach', 'lilac', 'lime', 'mint', 'yellow', 'cream', 'pink'];
function toneFor(format) { return TONE_CYCLE[Math.max(0, FORMATS.indexOf(format)) % TONE_CYCLE.length]; }
function toneStyle(tone) { const [bg, ink] = TONES[tone] || TONES.cream; return `--tile-bg:${bg};--tone-ink:${ink};background:${bg};color:${ink}`; }
function sectionHead(eyebrow, title, text, aside) {
  return h('div', { class: 'section-head' },
    h('div', null, h('p', { class: 'eyebrow' }, eyebrow), h('h2', { class: 'section' }, title), text ? h('p', { class: 'section-text' }, text) : null),
    aside || null);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch { toast('Could not copy.'); }
}

function agentInfo(id) {
  return (state.env?.agents || []).find(a => a.id === id) || { id, name: id, installed: false };
}

/* ---------- data ---------- */
async function refreshEnv() {
  state.env = await api.env();
  renderSidebar();
}
async function refreshProjects() {
  state.projects = await api.projects.list();
  renderSidebar();
}
// The last FilmCraft and toolkit results are kept on this computer, so the app shows them at
// once when it starts (also after an update) and checks again quietly in the background.
const CHECKS_KEY = 'sve-checks:v1';
function loadChecks() {
  try {
    const c = JSON.parse(localStorage.getItem(CHECKS_KEY) || 'null');
    if (c && c.fc && !state.fc) state.fc = c.fc;
    if (c && c.kit && !state.kit) state.kit = c.kit;
  } catch {}
}
function saveChecks() {
  try { localStorage.setItem(CHECKS_KEY, JSON.stringify({ fc: state.fc && state.fc.installed !== undefined ? state.fc : null, kit: state.kit && !state.kit.error ? state.kit : null })); } catch {}
}
async function refreshFc() {
  try { state.fc = await api.filmcraft.status(); saveChecks(); } catch { if (!state.fc) state.fc = null; }
  renderSidebar();
}

/* ---------- navigation ---------- */
function go(route) {
  state.route = route;
  render();
}
document.addEventListener('click', e => {
  const n = e.target.closest('[data-nav]');
  if (!n) return;
  e.preventDefault();
  const v = n.getAttribute('data-nav');
  if (v === 'new') return newBlankProject();
  go({ view: v });
});

function render() {
  renderSidebar();
  const main = $('#main');
  main.innerHTML = '';
  const v = state.route.view;
  if (v === 'project') main.append(viewProject(state.route.id));
  else if (v === 'formats') main.append(viewFormats());
  else if (v === 'viral') main.append(state.route.id ? viewViralFormat(state.route.id) : viewViral());
  else if (v === 'settings') main.append(viewSettings());
  else if (v === 'filmcraft') main.append(viewFilmcraft());
  else if (v === 'tools') main.append(viewTools());
  else if (v === 'setup') main.append(viewSetup());
  else if (v === 'brands') main.append(viewBrands());
  else if (v === 'brand') main.append(viewBrand(state.route.id));
  else main.append(viewHome());
}

/* ---------- sidebar ---------- */
function renderSidebar() {
  document.querySelectorAll('.nav-item[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === (state.route.view === 'brand' ? 'brands' : state.route.view)));
  const list = $('#projectList');
  list.innerHTML = '';
  if (!state.projects.length) list.append(h('div', { class: 'side-empty' }, 'No projects yet.'));
  for (const p of state.projects.slice(0, 40)) {
    const on = state.route.view === 'project' && state.route.id === p.id;
    list.append(h('div', { class: 'project-item' + (on ? ' active' : ''), role: 'button', tabindex: '0', onclick: () => go({ view: 'project', id: p.id }) },
      h('span', { class: 'name' }, p.name),
      state.busy.has(p.id) ? h('span', { class: 'busy', title: 'Working' }) : h('span', { class: 'age' }, ago(p.updated)),
      moreButton(p),
      trashButton(p)
    ));
  }
  const fcEl = $('#fcStatus');
  const fc = state.fc;
  fcEl.className = 'status-row ' + (!fc ? '' : fc.bridge ? 'ok' : fc.installed ? 'warn' : 'bad');
  fcEl.querySelector('.sub').textContent = !fc ? '…' : fc.bridge ? 'connected' : fc.installed ? (fc.updateAvailable ? 'update' : 'not connected') : 'not installed';
  const suEl = $('#setupStatus');
  if (suEl) {
    const todo = state.kit || state.env ? setupTodo().length : null;
    suEl.className = 'status-row ' + (todo == null || !state.kit ? '' : todo ? 'warn' : 'ok');
    suEl.querySelector('.sub').textContent = !state.kit ? (state.kitBusy ? 'checking' : '…') : todo ? `${todo} to do` : 'ready';
  }
  const agEl = $('#agentStatus');
  const eng = state.env?.settings?.engine || 'claude';
  const ai = agentInfo(eng);
  agEl.className = 'status-row ' + (!state.env ? '' : !ai.installed ? 'bad' : ai.connected === false ? 'warn' : 'ok');
  agEl.querySelector('.txt').textContent = ai.name || 'Agent';
  agEl.querySelector('.sub').textContent = !state.env ? '…' : !ai.installed ? 'not installed' : ai.connected === false ? 'not connected' : ai.connected ? 'connected' : (ai.version || 'ready');
}

/* ---------- agent picker ---------- */
function agentPicker({ value, onChange, up = true }) {
  const wrap = h('div', { class: 'agent-pick' });
  const cur = agentInfo(value);
  const btn = h('button', { class: 'mini-select', type: 'button', title: 'Choose the agent' },
    agentLogo(cur.id),
    h('span', null, cur.name), h('span', { style: { opacity: .5 } }, '▾'));
  wrap.append(btn);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = wrap.querySelector('.menu');
    if (open) { open.remove(); return; }
    const menu = h('div', { class: 'menu' + (up ? '' : ' down') });
    for (const a of state.env?.agents || []) {
      menu.append(h('button', {
        class: 'menu-item', type: 'button',
        onclick: ev => {
          ev.stopPropagation();
          menu.remove();
          if (!a.installed) { go({ view: 'settings' }); toast(`${a.name} is not installed. The Settings page shows how to install it.`); return; }
          if (a.connected === false) { go({ view: 'settings' }); toast(`Connect ${a.name} first: click Connect and sign in.`); return; }
          onChange(a.id);
        }
      },
        agentLogo(a.id),
        h('span', null, h('div', { class: 'mi-name' }, a.name), h('div', { class: 'mi-sub' }, agentStateText(a))),
        a.id === value ? h('span', { class: 'mi-check' }, '✓') : null));
    }
    menu.append(h('div', { class: 'menu-sep' }), h('button', { class: 'menu-item', type: 'button', onclick: () => go({ view: 'settings' }) },
      h('span', { class: 'mi-sub' }, 'Agent settings…')));
    wrap.append(menu);
    fitMenu(menu, btn);
    const close = () => { menu.remove(); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
  });
  return wrap;
}

// Keeps a menu that opens from a button inside the window: it opens on the side with more room
// and scrolls when the list is taller than that room.
function fitMenu(menu, anchor) {
  const r = anchor.getBoundingClientRect();
  const above = r.top - 16, below = innerHeight - r.bottom - 16;
  const want = menu.scrollHeight;
  const down = menu.classList.contains('down') ? !(want > below && above > below) : (want > above && below > above);
  menu.classList.toggle('down', down);
  menu.style.maxHeight = Math.max(160, down ? below : above) + 'px';
  menu.style.overflowY = 'auto';
  // Keep it inside the window on the right too (the model menu is wide with its shelf open).
  const mr = menu.getBoundingClientRect();
  const over = mr.right - (innerWidth - 12);
  if (over > 0) menu.style.left = ((parseFloat(menu.style.left) || 0) - over) + 'px';
}

/* ---------- model picker ---------- */
const EFFORT_HINTS = { '': 'The model’s usual level', low: 'Quickest answers', medium: 'Balanced', high: 'Thinks harder', xhigh: 'Thinks much harder', max: 'Deepest thinking, slowest', ultra: 'Most thinking of all', minimal: 'Almost none', none: 'No extra thinking' };
const EFFORT_NAMES = { '': 'Standard', none: 'None', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
function modelChoice(engine) { return (state.env?.settings?.models || {})[engine] || { model: '', effort: '' }; }
async function loadModels(engine, refresh) {
  try { state.models[engine] = await api.agents.models(engine, { refresh }); } catch {}
  return state.models[engine];
}
function modelLabel(engine) {
  const c = modelChoice(engine);
  const list = state.models[engine];
  if (!c.model) return 'Model: agent default';
  const m = list?.models.find(x => x.id === c.model);
  const name = m ? m.label : c.model;
  return `Model: ${name}`;
}
// The chosen model and its reasoning level, or null when that model has no reasoning levels.
function currentEffort(engine) {
  const c = modelChoice(engine);
  const m = c.model && state.models[engine]?.models.find(x => x.id === c.model);
  if (!m || !m.efforts.length) return null;
  return { model: m, effort: c.effort && m.efforts.includes(c.effort) ? c.effort : m.defaultEffort };
}
function agoLong(t) {
  if (!t) return 'not checked yet';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
}
function modelPicker({ engine, up = true }) {
  const wrap = h('div', { class: 'agent-pick model-pick' });
  const btn = h('button', { class: 'mini-select', type: 'button', title: `Choose the model ${agentInfo(engine).name || 'the agent'} uses` },
    h('span', { class: 'mp-label' }, modelLabel(engine)), h('span', { style: { opacity: .5 } }, '▾'));
  // Its own button for the reasoning level, next to the model, so it is easy to find.
  const ebtn = h('button', { class: 'mini-select effort-btn', type: 'button', title: 'Choose how hard the model thinks' },
    h('span', { class: 'mp-elabel' }, ''), h('span', { style: { opacity: .5 } }, '▾'));
  wrap.append(btn, ebtn);
  const relabel = () => {
    btn.querySelector('.mp-label').textContent = modelLabel(engine);
    const ce = currentEffort(engine);
    ebtn.hidden = !ce;
    if (ce) ebtn.querySelector('.mp-elabel').textContent = `Reasoning: ${EFFORT_NAMES[ce.effort] || ce.effort}`;
  };
  relabel();
  ebtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = wrap.querySelector('.menu');
    if (open) { const was = open.classList.contains('effort-menu'); open.remove(); if (was) return; }
    const ce = currentEffort(engine);
    if (!ce) return;
    const menu = h('div', { class: 'menu effort-menu' + (up ? '' : ' down') });
    menu.addEventListener('click', ev => ev.stopPropagation());
    const drawE = () => {
      const now = currentEffort(engine);
      menu.innerHTML = '';
      menu.append(h('div', { class: 'menu-head' }, `Reasoning for ${now.model.label}`),
        ...now.model.efforts.map(x => h('button', {
          class: 'menu-item eff-item' + (x === now.effort ? ' on' : ''), type: 'button',
          onclick: async ev => { ev.stopPropagation(); await save({ model: now.model.id, effort: x }); menu.remove(); }
        }, h('span', null, h('div', { class: 'mi-name' }, EFFORT_NAMES[x] || x), EFFORT_HINTS[x] ? h('div', { class: 'mi-sub' }, EFFORT_HINTS[x]) : null),
          x === now.effort ? h('span', { class: 'mi-check' }, '✓') : null)),
        h('div', { class: 'menu-note' }, 'More reasoning: better on hard videos, slower, uses more of your plan.'));
    };
    drawE();
    wrap.append(menu);
    menu.style.left = (ebtn.offsetLeft) + 'px';
    fitMenu(menu, ebtn);
    const close = () => { menu.remove(); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
  });
  wrap.relabel = relabel;
  if (!state.models[engine]) loadModels(engine).then(relabel);
  const save = async choice => { state.env.settings = await api.agents.setModel(engine, choice); relabel(); };
  // Two panels: the models on the left; when the chosen model has reasoning levels, a shelf
  // slides out on the right with them, so nobody has to scroll to find the reasoning.
  const draw = (menu, slide) => {
    const list = state.models[engine] || { models: [], fallback: '' };
    const c = modelChoice(engine);
    const cur = list.models.find(x => x.id === c.model);
    menu.innerHTML = '';
    const left = h('div', { class: 'mp-list' }, h('div', { class: 'menu-head' }, `Model for ${agentInfo(engine).name || 'this agent'}`));
    const item = (id, name, sub) => h('button', {
      class: 'menu-item' + ((c.model || '') === id ? ' on' : ''), type: 'button', onclick: async ev => {
        ev.stopPropagation();
        const m = list.models.find(x => x.id === id);
        const effort = m && m.efforts.length ? (m.efforts.includes(c.effort) ? c.effort : m.defaultEffort) : '';
        await save({ model: id, effort });
        draw(menu, true);
      }
    }, h('span', null, h('div', { class: 'mi-name' }, name), sub ? h('div', { class: 'mi-sub' }, sub) : null),
      (c.model || '') === id ? h('span', { class: 'mi-check' }, m_has(id) ? '›' : '✓') : null);
    const m_has = id => { const m = list.models.find(x => x.id === id); return !!(m && m.efforts.length); };
    left.append(item('', 'Default', `Uses the ${list.fallback || 'agent setting'}`));
    if (!list.models.length) left.append(h('div', { class: 'menu-note' }, state.models[engine] ? 'This agent did not list its models. It uses its own setting.' : 'Loading the models…'));
    for (const m of list.models) left.append(item(m.id, m.label, m.note || (m.id !== m.label ? m.id : '')));
    left.append(h('div', { class: 'menu-sep' }), h('button', {
      class: 'menu-item', type: 'button', onclick: async ev => {
        ev.stopPropagation();
        ev.currentTarget.querySelector('.mi-sub').textContent = 'Checking…';
        await loadModels(engine, true); relabel(); draw(menu);
      }
    }, h('span', { class: 'mi-sub' }, `Check for new models · updated ${agoLong(list.fetched)}`)));
    menu.append(left);
    if (cur && cur.efforts.length) {
      const effort = c.effort || cur.defaultEffort;
      menu.append(h('div', { class: 'mp-shelf' + (slide ? ' slide' : '') },
        h('div', { class: 'menu-head' }, 'Reasoning'),
        h('div', { class: 'menu-note', style: { paddingTop: 0 } }, cur.label),
        cur.efforts.map(e => h('button', {
          class: 'menu-item eff-item' + (e === effort ? ' on' : ''), type: 'button',
          onclick: async ev => { ev.stopPropagation(); await save({ model: cur.id, effort: e }); draw(menu); }
        }, h('span', null, h('div', { class: 'mi-name' }, EFFORT_NAMES[e] || e), EFFORT_HINTS[e] ? h('div', { class: 'mi-sub' }, EFFORT_HINTS[e]) : null),
          e === effort ? h('span', { class: 'mi-check' }, '✓') : null)),
        h('div', { class: 'menu-note' }, 'More reasoning: better on hard videos, slower, uses more of your plan.')));
    }
    if (menu.isConnected) fitMenu(menu, btn);
  };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = wrap.querySelector('.menu');
    if (open) { open.remove(); return; }
    const menu = h('div', { class: 'menu' + (up ? '' : ' down') });
    menu.addEventListener('click', ev => ev.stopPropagation());
    draw(menu);
    wrap.append(menu);
    fitMenu(menu, btn);
    if (!state.models[engine]) loadModels(engine).then(() => { relabel(); if (menu.isConnected) { draw(menu); fitMenu(menu, btn); } });
    const close = () => { menu.remove(); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
  });
  return wrap;
}

/* ---------- composer (home and project) ---------- */
function composer({ key, placeholder, onSubmit, big, busy, onStop, footLeft }) {
  const atts = state.attachments[key] || (state.attachments[key] = []);
  const ta = h('textarea', { placeholder, rows: big ? 4 : 2 });
  ta.value = state.drafts[key] || '';
  const attList = h('div', { class: 'attach-list' });
  const drawAtts = () => {
    attList.innerHTML = '';
    attList.classList.toggle('hidden', !atts.length);
    atts.forEach((p, i) => attList.append(h('span', { class: 'pill', title: p }, basename(p),
      h('button', { class: 'x', type: 'button', onclick: () => { atts.splice(i, 1); drawAtts(); } }, '×'))));
  };
  drawAtts();
  const sendBtn = h('button', { class: 'send' + (busy ? ' stop' : ''), type: 'button', title: busy ? 'Stop' : 'Send' }, busy ? '■' : '↑');
  const submit = () => {
    if (busy) { onStop && onStop(); return; }
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    const files = atts.slice();
    state.drafts[key] = '';
    atts.length = 0;
    onSubmit(text, files);
  };
  sendBtn.addEventListener('click', submit);
  ta.addEventListener('input', () => {
    state.drafts[key] = ta.value;
    if (!big) { ta.style.height = 'auto'; ta.style.height = Math.min(240, ta.scrollHeight) + 'px'; }
  });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
  });
  const addBtn = h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { const ps = await api.os.pickFiles(); ps.forEach(p => atts.includes(p) || atts.push(p)); drawAtts(); } }, '＋ Add files');
  const box = h('div', { class: 'composer' }, attList, ta,
    h('div', { class: 'composer-row' }, addBtn, footLeft || null, h('span', { class: 'grow' }), sendBtn));
  box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('drop'); });
  box.addEventListener('dragleave', () => box.classList.remove('drop'));
  box.addEventListener('drop', e => {
    e.preventDefault(); box.classList.remove('drop');
    for (const f of e.dataTransfer.files) { const p = api.os.pathForFile(f); if (p && !atts.includes(p)) atts.push(p); }
    drawAtts();
  });
  setTimeout(() => ta.focus(), 0);
  return box;
}

/* ---------- home ---------- */
function setupBanner() {
  const env = state.env;
  if (!env) return null;
  const anyAgent = env.agents.some(a => a.installed);
  if (!anyAgent) {
    return h('div', { class: 'banner' }, h('div', { class: 'grow' }, h('strong', null, 'Connect an agent to start.'),
      h('p', null, 'Scale Video Editor runs your own Claude Code or Codex. Neither is installed on this computer yet.')),
      h('button', { class: 'btn', onclick: () => go({ view: 'settings' }) }, 'Set up an agent'));
  }
  if (state.fc && !state.fc.installed) {
    return h('div', { class: 'banner' }, h('div', { class: 'grow' }, h('strong', null, 'Install FilmCraft for the timeline.'),
      h('p', null, 'FilmCraft is the free, open-source editor the agent uses to cut your video. Chat works without it.')),
      h('button', { class: 'btn', onclick: () => go({ view: 'filmcraft' }) }, 'Get FilmCraft'));
  }
  return null;
}

function viewHome() {
  const engine = state.env?.settings?.engine || 'claude';
  let chosen = engine;
  const picker = agentPicker({ value: chosen, onChange: async id => { chosen = id; state.env.settings = await api.setSettings({ engine: id }); render(); } });
  const brand = homeBrand();
  const bpick = brandPicker({ value: brand, onChange: uid => { state.homeBrand = uid; render(); } });
  const page = h('div', { class: 'page' },
    h('div', { class: 'topdrag' }),
    setupBanner(),
    h('p', { class: 'eyebrow' }, 'Scale Video Editor'),
    h('h1', { class: 'hero', html: 'Any video you can <em>describe.</em>' }),
    h('p', { class: 'lede' }, 'Say what you want to make. Your agent picks the tools and builds it while you watch, and FilmCraft holds the timeline.'),
    composer({
      key: 'home', big: true, footLeft: [picker, modelPicker({ engine: chosen }), voicePicker({ value: state.env?.settings?.voice || '', onChange: async v => { state.env.settings = await api.setSettings({ voice: v }); } }), bpick],
      placeholder: 'Describe your video, or pick a kind of video below. Drop footage, a script or a screenshot here.',
      onSubmit: (text, files) => startProject({ name: nameFrom(text), engine: chosen, brand, prompt: text, attachments: files })
    }),
    recentSection(),
    categoryTiles(),
    h('section', null,
      sectionHead('Everything it makes', `${FORMATS.length} kinds of video, one place to ask.`, null,
        h('button', { class: 'btn small', onclick: () => go({ view: 'formats' }) }, 'Browse by category →')),
      h('div', { class: 'formats' }, FORMATS.map(formatCard)))
  );
  return page;
}

function categoryTiles() {
  return h('section', null,
    sectionHead('Start here', 'What do you want to make?', 'Pick the closest fit. Each one shows what you hand over, what comes back, and a sentence that gets it started.'),
    h('button', { class: 'chat-link inline', onclick: () => openGuide() }, '? Not sure what to make? Ask the Toolkit Guide'),
    h('div', { class: 'cat-tiles' }, CATS.map(c => h('button', {
      class: 'cat-tile', style: toneStyle(c.pastel),
      onclick: () => { state.cat = c.id; go({ view: 'formats' }); }
    },
      h('span', { class: 'label-sm cat-count' }, h('span', null, `${FORMATS.filter(f => (f.cats || []).includes(c.id)).length} kinds`), h('span', null, '→')),
      h('span', null, h('strong', null, c.name), h('span', { class: 'cat-sub' }, c.sub))))));
}

function nameFrom(text) {
  const words = text.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 5).join(' ');
  return words || 'Untitled';
}

function formatCard(f) {
  const tone = toneFor(f);
  const tools = (f.tools || []).map(id => (window.SVE_TOOLS || {})[id]).filter(Boolean);
  return h('article', { class: 'fcard' },
    h('div', { class: 'ftop', style: toneStyle(tone) },
      h('div', { class: 'fart', html: window.SVE_ART(f.art) }),
      h('span', { class: 'label-sm fshape' }, f.shape)),
    h('div', { class: 'fbody' },
      h('h3', { class: 'ftitle' }, f.name),
      h('p', { class: 'fblurb' }, f.blurb),
      h('dl', { class: 'fgive' },
        h('div', null, h('dt', { class: 'label-sm' }, 'You give'), h('dd', null, f.give)),
        h('div', null, h('dt', { class: 'label-sm' }, 'You get'), h('dd', null, f.get))),
      tools.length ? h('div', { class: 'tool-pills' }, (f.tools || []).filter(id => (window.SVE_TOOLS || {})[id]).map(id => {
        const t = window.SVE_TOOLS[id];
        return h('button', { class: 'tool-pill', title: t.does, onclick: () => go({ view: 'tools', tool: id }) }, t.name);
      })) : null),
    h('div', { class: 'fsay' },
      h('div', { class: 'fsay-head' }, h('span', { class: 'label-sm' }, 'Try saying'),
        h('button', { class: 'copy-btn', onclick: () => copyText(f.ask) }, 'Copy')),
      h('q', null, f.ask)),
    h('div', { class: 'factions' },
      h('button', { class: 'btn small', title: 'Start a project with this sentence', onclick: () => startProject({ name: f.name, engine: state.env?.settings?.engine || 'claude', brand: homeBrand(), format: f.id, prompt: f.ask }) }, 'Use this sentence'),
      h('button', { class: 'btn small primary', onclick: () => openInterview(f) }, 'Answer the questions →')),
    h('div', { class: 'fchat' }, h('button', { class: 'chat-link', onclick: () => openGuide(guideDraftFor(f), f.name) }, '? Chat about this video')));
}

function recentSection() {
  if (!state.projects.length) return null;
  return h('section', null,
    sectionHead('Your projects', 'Pick up where you left off.'),
    h('div', { class: 'pgrid' }, state.projects.slice(0, 8).map(p => h('div', { class: 'pcard', role: 'button', tabindex: '0', onclick: () => go({ view: 'project', id: p.id }) },
      h('div', { class: 'card-actions' }, moreButton(p), trashButton(p)),
      h('div', { class: 'thumb' }, p.thumb ? h('img', { src: api.mediaUrl(p.thumb), alt: '' }) : h('img', { class: 'ph', src: 'assets/scale-mark.svg', alt: '' })),
      h('div', { class: 'meta' }, h('div', { class: 'pname' }, p.name), h('div', { class: 'pwhen' }, `${agentInfo(p.engine).name} · edited ${ago(p.updated)} ago`))))));
}

function viewFormats() {
  const cat = CATS.find(c => c.id === state.cat);
  const list = FORMATS.filter(f => !cat || (f.cats || []).includes(cat.id));
  const tabs = h('div', { class: 'tabs' },
    h('button', { class: 'tab' + (!cat ? ' on' : ''), onclick: () => { state.cat = 'all'; render(); } }, 'All'),
    CATS.map(c => h('button', { class: 'tab' + (state.cat === c.id ? ' on' : ''), onclick: () => { state.cat = c.id; render(); } }, c.name)));
  const opener = cat
    ? h('div', { class: 'opener', style: toneStyle(cat.pastel) }, h('p', { class: 'label' }, cat.name), h('h1', null, cat.head), h('p', { class: 'opener-sub' }, cat.sub))
    : h('div', { class: 'opener', style: toneStyle('cream') }, h('p', { class: 'label' }, 'Kinds of video'), h('h1', null, `${FORMATS.length} kinds of video.`),
      h('p', { class: 'opener-sub' }, 'Say the sentence under one, or answer its questions and your agent gets a complete brief.'));
  return h('div', { class: 'page' }, h('div', { class: 'topdrag' }),
    h('div', { class: 'tabs-row' }, tabs),
    opener,
    h('section', null,
      sectionHead(`${list.length} kinds of video`, 'Pick one and say the sentence under it.'),
      h('div', { class: 'formats' }, list.map(formatCard))));
}

/* ---------- viral videos ---------- */
const VIRAL = window.SVE_VIRAL || { formats: [] };
const viralImg = id => `assets/viral/${id}.jpg`;
// Text that goes into a brief must not contain [brackets]: those become interview questions.
const unbracket = t => String(t).replace(/\[([^\]]+)\]/g, '<$1>');

function viralBrief(f) {
  return [
    f.brief,
    '',
    `How the ${f.name} format works: ${unbracket(f.tag)}`,
    ...f.steps.map(x => '- ' + unbracket(x)),
    'Beats: ' + f.beats.map(unbracket).join(' -> '),
    'Prompts to start from (fill the <placeholders> from my answers):',
    ...f.prompts.map(p => `- ${p.label} (${p.tool}): ${unbracket(p.text)}`),
    '',
    'Tools: make stills with GenMedia google/nano-banana-2.1 and reuse each character image so the look stays the same. Animate with fal-ai/veo3.1/image-to-video (talking, lip sync) or kling/v4/image-to-video. Songs with elevenlabs/music/v2.5. Voiceover with my-voice. Cut, caption and export in FilmCraft. Burn in captions and end on the call to action.',
    'Before generating video clips, show me the script and the stills, say roughly what the video clips will cost, and wait for my go-ahead.'
  ].join('\n');
}

function makeViral(f) {
  openInterview({ id: 'viral-' + f.id, name: f.name, shape: 'Viral video', blurb: f.tag, brief: viralBrief(f), img: viralImg(f.id) });
}

function viewViral() {
  const card = f => h('article', { class: 'vcard', role: 'button', tabindex: '0', onclick: () => go({ view: 'viral', id: f.id }), onkeydown: e => { if (e.key === 'Enter') go({ view: 'viral', id: f.id }); } },
    h('div', { class: 'vthumb' }, h('img', { src: viralImg(f.id), alt: '', loading: 'lazy' })),
    h('div', { class: 'vbody' }, h('h3', null, f.name), h('p', null, f.tag)));
  return h('div', { class: 'page' }, h('div', { class: 'topdrag' }),
    h('div', { class: 'opener', style: toneStyle('lilac') },
      h('p', { class: 'label' }, 'Viral Videos'),
      h('h1', null, 'Viral Videos for Social Media.'),
      h('p', { class: 'opener-sub' }, VIRAL.lede)),
    h('section', null,
      sectionHead(`${VIRAL.formats.length} formats`, 'Pick a format.', 'Each one has the idea, the beats, ideas for your niche, and the prompts. Click Make this video and the agent does the rest.'),
      h('div', { class: 'vgrid-cards' }, VIRAL.formats.map(card))),
    h('section', { class: 'vsplit' },
      h('div', { class: 'vbox' }, h('h3', null, 'The rules behind every one'), h('ul', null, VIRAL.rules.map(r => h('li', null, r)))),
      h('div', { class: 'vbox' }, h('h3', null, 'How the editor makes it'), h('ol', { class: 'vsteps' }, VIRAL.pipeline.map(p => h('li', null, h('b', null, p.step), h('span', null, p.detail)))))),
    h('section', { class: 'vbox' }, h('h3', null, 'What does each job'),
      h('div', { class: 'vtools' }, VIRAL.tools.map(t => h('div', null, h('b', null, t.name), h('span', null, t.detail))))));
}

function viewViralFormat(id) {
  const f = VIRAL.formats.find(x => x.id === id);
  if (!f) return viewViral();
  const i = VIRAL.formats.indexOf(f);
  const next = VIRAL.formats[(i + 1) % VIRAL.formats.length];
  const prompt = p => {
    const btn = h('button', { class: 'btn small', onclick: () => copyText(p.text) }, 'Copy');
    return h('div', { class: 'vprompt' },
      h('header', null, h('b', null, p.label), h('span', { class: 'vtool' }, p.tool), h('span', { class: 'grow' }), btn),
      h('pre', null, p.text));
  };
  return h('div', { class: 'page' }, h('div', { class: 'topdrag' }),
    h('button', { class: 'btn small ghost', onclick: () => go({ view: 'viral' }) }, '← All viral formats'),
    h('div', { class: 'vhero' },
      h('div', { class: 'vhero-img' }, h('img', { src: viralImg(f.id), alt: `Example still for ${f.name}` })),
      h('div', { class: 'vhero-text' },
        h('p', { class: 'eyebrow' }, `Viral format ${i + 1} of ${VIRAL.formats.length}`),
        h('h1', { class: 'hero', style: { fontSize: '48px' } }, f.name),
        h('p', { class: 'lede' }, f.tag),
        h('div', { class: 'vbox soft' }, h('h3', null, 'Use it when'), h('p', null, f.when)),
        h('div', { class: 'row' },
          h('button', { class: 'btn coral', onclick: () => makeViral(f) }, 'Make this video'),
          h('button', { class: 'btn', onclick: () => go({ view: 'viral', id: next.id }) }, `Next: ${next.name} →`)),
        h('p', { class: 'fh' }, 'This example still was made with Nano Banana 2.1. Yours will star your business.'))),
    h('div', { class: 'vsplit' },
      h('div', { class: 'vbox' }, h('h3', null, 'How to run it'), h('ul', null, f.steps.map(x => h('li', null, x)))),
      h('div', { class: 'vbox' }, h('h3', null, 'Why it works'), h('ul', null, f.why.map(x => h('li', null, x))))),
    h('div', { class: 'vbox' }, h('h3', null, 'The beats'), h('ol', { class: 'vflow' }, f.beats.map(b => h('li', null, b)))),
    h('div', { class: 'vbox' }, h('h3', null, 'Ideas for your niche'),
      h('table', { class: 'vniche' }, h('tbody', null, f.ideas.map(n => h('tr', null, h('td', null, n.who), h('td', null, n.idea)))))),
    h('section', null,
      sectionHead('Prompts', 'Image first, then motion.', 'Text in [brackets] is yours to fill in. Make this video fills them from your answers, or copy one and use it anywhere.'),
      h('div', { class: 'vprompts' }, f.prompts.map(prompt))));
}

/* ---------- interview ---------- */
function openInterview(f) {
  const qs = window.SVEBrief.parse(f.brief);
  const answers = {};
  let engine = state.env?.settings?.engine || 'claude';
  let brand = homeBrand();
  const overlay = $('#overlay');
  const preview = h('pre');
  const update = () => { preview.textContent = window.SVEBrief.fill(f.brief, qs, answers); };
  const body = h('div', { class: 'sheet-body' });
  for (const q of qs) {
    const required = q.type === 'long' || q.type === 'file';
    const label = h('label', { class: 'ql' }, q.label, required ? h('span', { class: 'req' }, 'needed') : null);
    let input;
    if (q.type === 'choice') {
      input = h('div', { class: 'opts' }, q.options.map(o => {
        const b = h('button', { class: 'opt', type: 'button' }, o);
        b.addEventListener('click', () => {
          const on = answers[q.id] === o;
          answers[q.id] = on ? '' : o;
          b.parentElement.querySelectorAll('.opt').forEach(x => x.classList.remove('on'));
          if (!on) b.classList.add('on');
          update();
        });
        return b;
      }));
    } else if (q.type === 'long') {
      input = h('textarea', { placeholder: q.hint.replace(/^paste\s*/i, 'Paste ').replace(/^./, c => c.toUpperCase()), oninput: e => { answers[q.id] = e.target.value; update(); } });
    } else if (q.type === 'file') {
      const fname = h('span', { class: 'fname' }, 'No file chosen');
      input = h('div', { class: 'filepick' }, h('button', {
        class: 'btn small', type: 'button', onclick: async () => {
          const ps = await api.os.pickFiles();
          if (ps[0]) { answers[q.id] = ps.join(', '); fname.textContent = ps.map(basename).join(', '); update(); }
        }
      }, 'Choose file…'), fname);
    } else {
      input = h('input', { type: 'text', placeholder: q.hint, oninput: e => { answers[q.id] = e.target.value; update(); } });
    }
    body.append(h('div', { class: 'q' }, label, input));
  }
  body.append(h('details', { class: 'prompt-preview' }, h('summary', null, 'See the prompt your agent gets'), preview));
  update();

  const close = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; };
  const launch = fast => {
    const miss = window.SVEBrief.missing(qs, answers);
    if (miss.length) { toast(`Please fill in: ${miss.map(m => m.label).join(', ')}`); return; }
    const prompt = window.SVEBrief.fill(f.brief, qs, answers);
    close();
    startProject({ name: f.name, engine, brand, format: f.id, prompt: fast ? prompt + '\n\nWhere I left a choice open, choose for me and say what you chose.' : prompt });
  };
  let picker, mpick;
  const onPick = id => {
    engine = id;
    const next = agentPicker({ value: id, onChange: onPick }); picker.replaceWith(next); picker = next;
    const nm = modelPicker({ engine: id }); mpick.replaceWith(nm); mpick = nm;
  };
  picker = agentPicker({ value: engine, onChange: onPick });
  mpick = modelPicker({ engine });
  let bpick;
  const onBrand = uid => { brand = uid; const next = brandPicker({ value: uid, onChange: onBrand }); bpick.replaceWith(next); bpick = next; };
  bpick = brandPicker({ value: brand, onChange: onBrand });
  const sheet = h('div', { class: 'sheet', role: 'dialog' },
    h('div', { class: 'sheet-top' },
      f.img ? h('div', { class: 'frame' }, h('img', { src: f.img, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' } })) : h('div', { class: 'frame', style: toneStyle(toneFor(f)), html: window.SVE_ART(f.art) }),
      h('div', null, h('p', { class: 'eyebrow' }, f.shape), h('h2', null, f.name), h('p', null, f.blurb)),
      h('button', { class: 'sheet-close', onclick: close, title: 'Close' }, '×')),
    body,
    h('div', { class: 'sheet-foot' }, picker, mpick, bpick, h('span', { class: 'grow' }),
      h('button', { class: 'btn', title: 'Use defaults for every open choice', onclick: () => launch(true) }, 'Fast prompt'),
      h('button', { class: 'btn primary', onclick: () => launch(false) }, 'Go →')));
  overlay.innerHTML = '';
  overlay.append(sheet);
  overlay.classList.remove('hidden');
  overlay.onclick = e => { if (e.target === overlay) close(); };
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
}

/* ---------- projects ---------- */
async function newBlankProject() {
  const engine = state.env?.settings?.engine || 'claude';
  const p = await api.projects.create({ name: 'Untitled', engine, brand: homeBrand() || null });
  await refreshProjects();
  go({ view: 'project', id: p.id });
}

async function startProject({ name, engine, format, brand, prompt, attachments }) {
  if (!agentInfo(engine).installed) { go({ view: 'settings' }); toast(`${agentInfo(engine).name} is not installed yet.`); return; }
  const p = await api.projects.create({ name, engine, format, brand: brand || null });
  await refreshProjects();
  go({ view: 'project', id: p.id });
  await sendTurn(p.id, prompt, attachments || []);
}

async function sendTurn(id, text, attachments) {
  const chat = state.chats[id] || (state.chats[id] = []);
  chat.push({ role: 'user', text, attachments });
  state.busy.add(id);
  if (state.route.view === 'project' && state.route.id === id) render(); else renderSidebar();
  try {
    await api.agent.send({ projectId: id, prompt: text, attachments });
  } catch (err) {
    state.busy.delete(id);
    chat.push({ role: 'agent', kind: 'done', ok: false, error: String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
    render();
  }
}

api.agent.onEvent(({ projectId, event }) => {
  const chat = state.chats[projectId] || (state.chats[projectId] = []);
  if (event.kind === 'session') return;
  if (event.kind === 'tool-result') {
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i].kind === 'tool' && chat[i].ok === undefined) { chat[i].ok = event.ok; break; }
    }
    scheduleFilesRefresh(projectId);
  } else {
    chat.push({ role: 'agent', ...event });
  }
  if (event.kind === 'done') {
    state.busy.delete(projectId);
    refreshProjects();
    loadFiles(projectId, true);
  }
  if (state.route.view === 'project' && state.route.id === projectId) {
    if (event.kind === 'done') render(); else drawChat(projectId);
  } else renderSidebar();
});

const filesTimers = {};
function scheduleFilesRefresh(id) {
  clearTimeout(filesTimers[id]);
  filesTimers[id] = setTimeout(() => loadFiles(id, true), 1500);
}

async function loadFiles(id, autoselect) {
  const before = new Set((state.files[id] || []).map(f => f.path));
  try { state.files[id] = await api.projects.files(id); } catch { return; }
  const fresh = state.files[id].find(f => f.folder === 'exports' && !before.has(f.path) && /\.(mp4|mov|m4v|webm|png|jpe?g|gif|webp)$/i.test(f.path));
  if (autoselect && fresh) { state.selected[id] = fresh.path; state.previewMode[id] = 'exports'; }
  if (state.route.view === 'project' && state.route.id === id) drawPreview(id);
}

/* ---------- project workspace ---------- */
function viewProject(id) {
  const project = state.projects.find(p => p.id === id);
  if (!project) { setTimeout(() => go({ view: 'home' }), 0); return h('div'); }
  if (!state.chats[id]) {
    api.projects.chat(id).then(msgs => { state.chats[id] = msgs.filter(m => m.kind !== 'session'); drawChat(id); });
  }
  if (!state.files[id]) loadFiles(id, false);
  const busy = state.busy.has(id);
  const title = h('div', { class: 'ptitle', contenteditable: 'true', spellcheck: 'false' }, project.name);
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  title.addEventListener('blur', async () => {
    const name = title.textContent.trim();
    if (!name || name === project.name) { title.textContent = project.name; return; }
    try {
      const np = await api.projects.rename(id, name);
      for (const m of ['chats', 'files', 'selected', 'previewMode']) { if (state[m][id]) { state[m][np.id] = state[m][id]; delete state[m][id]; } }
      if (busy) state.busy.add(np.id);
      await refreshProjects();
      go({ view: 'project', id: np.id });
    } catch (err) { toast(String(err.message || err).replace(/^Error invoking[^:]+: (Error: )?/, '')); title.textContent = project.name; }
  });
  const picker = agentPicker({
    value: project.engine, onChange: async eng => {
      if (eng === project.engine) return;
      await api.projects.update(id, { engine: eng });
      await refreshProjects();
      toast(`${agentInfo(eng).name} starts a new conversation. It can still see every file in the project.`);
      render();
    }
  });
  const bpick = brandPicker({
    value: project.brand || '', onChange: async uid => {
      if (uid === (project.brand || '')) return;
      await api.projects.update(id, { brand: uid || null });
      await refreshProjects();
      toast(uid ? `From the next message, the agent uses “${brandByUid(uid)?.name}”.` : 'From the next message, the agent chooses the look.');
      render();
    }
  });
  const left = h('section', { class: 'ws-left' },
    h('div', { class: 'ws-head' },
      h('button', { class: 'crumb', onclick: () => go({ view: 'home' }) }, 'Home /'), title, h('span', { class: 'grow' }),
      h('button', { class: 'btn small ghost', title: 'Show the project folder', onclick: () => api.os.openPath(project.dir) }, 'Folder'),
      h('button', {
        class: 'btn small ghost', title: 'Start a new conversation in this project', disabled: busy, onclick: async () => {
          await api.projects.newChat(id); state.chats[id].push({ role: 'agent', kind: 'notice', text: 'New conversation. The agent starts fresh but can still see every file in the project.' }); drawChat(id);
        }
      }, 'New chat')),
    h('div', { class: 'chat', id: 'chat' }),
    h('div', { class: 'ws-compose' }, composer({
      key: 'p:' + id, busy,
      placeholder: busy ? 'The agent is working…' : 'Ask for a change, or say what to make next.',
      onSubmit: (text, files) => sendTurn(id, text, files),
      onStop: () => api.agent.stop(id),
      footLeft: [picker, modelPicker({ engine: project.engine }), voicePicker({ value: project.voice != null ? project.voice : (state.env?.settings?.voice || ''), onChange: async v => { await api.projects.update(id, { voice: v }); await refreshProjects(); toast('From the next message, the agent uses this voice.'); } }), bpick]
    })));
  const right = h('section', { class: 'ws-right', id: 'preview' });
  const ws = h('div', { class: 'ws' }, left, right);
  setTimeout(() => { drawChat(id); drawPreview(id); }, 0);
  return ws;
}

function drawChat(id) {
  const el = $('#chat');
  if (!el || state.route.id !== id) return;
  const chat = state.chats[id] || [];
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  el.innerHTML = '';
  if (!chat.length) {
    el.append(h('div', { class: 'chat-empty' },
      h('span', { class: 'eyebrow' }, 'New project'),
      h('h3', null, 'What are we making?'),
      h('p', null, 'Tell the agent what you want. Add footage, a script or screenshots with the + button, or drop them on the box below.'),
      h('div', { class: 'suggest' }, FORMATS.slice(0, 4).map(f => h('button', { onclick: () => openInterview(f) }, `${f.name}: “${f.ask}”`)))));
    return;
  }
  let group = null;
  const flushGroup = () => {
    if (!group) return;
    const items = group;
    group = null;
    const box = h('div', { class: 'tools-group' });
    const show = items.length > 4 ? items.slice(-3) : items;
    if (items.length > 4) {
      const more = h('button', { class: 'tools-more' }, `+ ${items.length - 3} earlier steps`);
      more.addEventListener('click', () => { box.innerHTML = ''; items.forEach(t => box.append(toolRow(t))); });
      box.append(more);
    }
    show.forEach(t => box.append(toolRow(t)));
    el.append(box);
  };
  let lastText = null;
  for (const m of chat) {
    if (m.kind === 'tool') { (group || (group = [])).push(m); continue; }
    flushGroup();
    if (m.kind === 'done' && !m.ok && m.error && m.error === lastText) {
      // Claude Code repeats its last message as the error; show it once, with the fix.
      el.lastChild && el.lastChild.remove();
    }
    lastText = m.kind === 'text' ? m.text : null;
    if (m.role === 'user') {
      el.append(h('div', { class: 'msg user' }, m.text, m.attachments && m.attachments.length ? h('div', { class: 'att' }, m.attachments.map(basename).join(' · ')) : null));
    } else if (m.kind === 'text') {
      el.append(h('div', { class: 'msg agent', html: md(m.text) }));
    } else if (m.kind === 'thinking') {
      el.append(h('div', { class: 'msg thinking' }, m.text.length > 280 ? m.text.slice(0, 279) + '…' : m.text));
    } else if (m.kind === 'notice') {
      el.append(h('div', { class: 'notice' }, m.text));
    } else if (m.kind === 'done' && !m.ok) {
      el.append(h('div', { class: 'err' }, m.error || 'The agent stopped.', signInHint(m.error)));
    }
  }
  flushGroup();
  if (state.busy.has(id)) el.append(h('div', { class: 'working' }, h('span', { class: 'spin' }), `${agentInfo((state.projects.find(p => p.id === id) || {}).engine).name} is working…`));
  if (atBottom || state.busy.has(id)) el.scrollTop = el.scrollHeight;
}

function signInHint(error) {
  if (!/not logged in|\/login|log in|sign in|authenticat|unauthori[sz]ed|401/i.test(error || '')) return null;
  return h('div', { style: { marginTop: '8px' } },
    'Sign in once in a terminal: run ', h('code', null, 'claude'), ' and type ', h('code', null, '/login'),
    ' for Claude Code, or run ', h('code', null, 'codex login'), ' for Codex. Then send your message again.');
}

function toolRow(t) {
  const name = String(t.name || '').replace(/^mcp__filmcraft__/, 'FilmCraft · ').replace(/^filmcraft\./, 'FilmCraft · ');
  return h('div', { class: 'tool' + (t.ok === false ? ' fail' : ''), title: t.detail || '' }, h('span', { class: 'tn' }, name), h('span', { class: 'td' }, t.detail || ''));
}

/* ---------- preview ---------- */
function drawPreview(id) {
  const el = $('#preview');
  if (!el || state.route.id !== id) return;
  const mode = state.previewMode[id] || 'exports';
  const files = state.files[id] || [];
  const fc = state.fc || {};
  el.innerHTML = '';
  const seg = h('div', { class: 'seg' },
    h('button', { class: mode === 'exports' ? 'on' : '', onclick: () => { state.previewMode[id] = 'exports'; drawPreview(id); } }, 'Files'),
    h('button', { class: mode === 'filmcraft' ? 'on' : '', onclick: () => { state.previewMode[id] = 'filmcraft'; drawPreview(id); loadSequence(id); } }, 'FilmCraft timeline'));
  const fcBtn = fc.bridge
    ? h('span', { class: 'pill' }, h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: 'var(--ok)' } }), 'FilmCraft connected')
    : h('button', { class: 'btn small', onclick: () => connectFilmcraft(id) }, fc.installed ? 'Connect FilmCraft' : 'Get FilmCraft');
  el.append(h('div', { class: 'pv-head' }, seg, h('span', { class: 'grow' }), fcBtn));

  if (mode === 'filmcraft') { drawTimelinePreview(el, id); return; }

  const sel = files.find(f => f.path === state.selected[id]) || files.find(f => f.folder === 'exports' && /\.(mp4|mov|m4v|webm)$/i.test(f.path)) || files.find(f => /\.(mp4|mov|m4v|webm|png|jpe?g|gif|webp)$/i.test(f.path));
  const stage = h('div', { class: 'stage' });
  if (!sel) {
    stage.append(h('div', { class: 'empty' }, h('span', { class: 'eyebrow' }, 'Preview'), h('h3', null, 'Your video shows up here.'),
      h('p', null, 'When the agent exports a video, a still or captions to the project’s exports folder, it plays here. Media you add shows here too.')));
  } else if (/\.(mp4|mov|m4v|webm)$/i.test(sel.path)) {
    stage.append(h('video', { src: api.mediaUrl(sel.path) + '?v=' + Math.round(sel.mtime), controls: true, preload: 'metadata' }), h('span', { class: 'badge' }, sel.folder));
  } else if (/\.(png|jpe?g|gif|webp)$/i.test(sel.path)) {
    stage.append(h('img', { src: api.mediaUrl(sel.path) + '?v=' + Math.round(sel.mtime), alt: '' }), h('span', { class: 'badge' }, sel.folder));
  } else if (sel.ext === '.fcproj') {
    stage.append(h('div', { class: 'empty' }, h('span', { class: 'eyebrow' }, 'FilmCraft project'), h('h3', null, basename(sel.path)),
      h('p', null, 'Open it in FilmCraft to see and edit the timeline.'), h('button', { class: 'btn coral', onclick: () => connectFilmcraft(id, sel.path) }, 'Open in FilmCraft')));
  } else {
    stage.append(h('div', { class: 'empty' }, h('span', { class: 'eyebrow' }, sel.ext.slice(1)), h('h3', null, basename(sel.path)),
      h('button', { class: 'btn', onclick: () => api.os.reveal(sel.path) }, 'Show in folder')));
  }
  el.append(stage);
  const strip = h('div', { class: 'strip' });
  if (!files.length) strip.append(h('div', { class: 'strip-empty' }, 'No files yet. Exports, media and work files appear here.'));
  for (const f of files.slice(0, 60)) {
    const isVid = /\.(mp4|mov|m4v|webm)$/i.test(f.path), isImg = /\.(png|jpe?g|gif|webp)$/i.test(f.path);
    const thumb = h('div', { class: 'cthumb' },
      isImg ? h('img', { src: api.mediaUrl(f.path) + '?v=' + Math.round(f.mtime), alt: '', loading: 'lazy' })
        : isVid ? h('video', { src: api.mediaUrl(f.path) + '#t=0.5', preload: 'metadata', muted: true })
          : f.ext.slice(1).toUpperCase());
    strip.append(h('button', {
      class: 'chip' + (sel && f.path === sel.path ? ' on' : ''), title: f.rel,
      onclick: () => { state.selected[id] = f.path; drawPreview(id); },
      ondblclick: () => api.os.reveal(f.path)
    }, thumb, h('div', { class: 'cname' }, basename(f.path)), h('div', { class: 'cfold' }, f.folder)));
  }
  el.append(strip);
}

async function connectFilmcraft(id, projectFile) {
  const fc = state.fc || {};
  if (!fc.installed) { go({ view: 'filmcraft' }); return; }
  toast('Starting FilmCraft…');
  const r = await api.filmcraft.connect(projectFile || null);
  await refreshFc();
  if (!r.ok) { toast(r.reason, 6000); if (!(state.fc || {}).app) go({ view: 'filmcraft' }); } else toast(r.already ? 'FilmCraft is connected.' : 'FilmCraft is open and connected.');
  if (id) { state.previewMode[id] = 'filmcraft'; drawPreview(id); loadSequence(id); }
}

async function loadSequence(id) {
  if (!state.fc?.bridge) return;
  state.seq = await api.filmcraft.sequence();
  if (state.route.id === id && (state.previewMode[id] === 'filmcraft')) {
    drawPreview(id);
    if (state.seq) renderFrame(id, (state.seq.playhead || 0) / TICKS);
  }
}

async function renderFrame(id, seconds) {
  if (state.frameBusy) { state.pendingFrame = seconds; return; }
  state.frameBusy = true;
  const r = await api.filmcraft.frame(seconds);
  state.frameBusy = false;
  state.frame = r.ok ? { file: r.file, seconds } : { error: r.reason, seconds };
  if (state.route.id === id && state.previewMode[id] === 'filmcraft') drawPreview(id);
  if (state.pendingFrame != null) { const s = state.pendingFrame; state.pendingFrame = null; renderFrame(id, s); }
}

function drawTimelinePreview(el, id) {
  const fc = state.fc || {};
  const stage = h('div', { class: 'stage' });
  if (!fc.bridge) {
    stage.append(h('div', { class: 'empty' }, h('span', { class: 'eyebrow' }, 'FilmCraft'), h('h3', null, fc.installed ? 'Connect FilmCraft to see the timeline.' : 'FilmCraft is not installed.'),
      h('p', null, 'FilmCraft opens in its own window, beside this one. The agent edits it, and the Program frame shows here.'),
      h('button', { class: 'btn coral', onclick: () => connectFilmcraft(id) }, fc.installed ? 'Connect FilmCraft' : 'Get FilmCraft')));
    el.append(stage);
    return;
  }
  const seq = state.seq;
  if (state.frame && state.frame.file) stage.append(h('img', { src: api.mediaUrl(state.frame.file), alt: 'Program frame' }));
  else stage.append(h('div', { class: 'empty' }, h('span', { class: 'eyebrow' }, 'Program'),
    h('h3', null, seq ? 'Rendering the frame…' : 'No sequence is open.'),
    h('p', null, state.frame && state.frame.error ? state.frame.error : 'Ask the agent to build the edit. The frame at the playhead shows here.')));
  if (seq) stage.append(h('span', { class: 'badge' }, seq.name || 'Sequence'));
  el.append(stage);
  const dur = seq ? (seq.duration || 0) / TICKS : 0;
  const cur = state.frame ? state.frame.seconds : 0;
  const label = h('span', { class: 'tc' }, `${tc(cur)} / ${tc(dur)}`);
  const range = h('input', { type: 'range', min: 0, max: Math.max(dur, 0.01), step: 1 / 30, value: cur, disabled: !seq });
  let t;
  range.addEventListener('input', () => { label.textContent = `${tc(+range.value)} / ${tc(dur)}`; clearTimeout(t); t = setTimeout(() => renderFrame(id, +range.value), 180); });
  el.append(h('div', { class: 'scrub' }, range, label, h('button', { class: 'btn small', onclick: () => loadSequence(id) }, 'Refresh')));
  el.append(h('div', { class: 'strip' }, h('div', { class: 'strip-empty' }, 'This is FilmCraft’s Program monitor at the slider position. Edit in the FilmCraft window, or ask the agent.')));
}

/* ---------- settings ---------- */
function viewSettings() {
  const env = state.env || { agents: [], settings: {} };
  const s = env.settings;
  const set = async patch => { state.env.settings = await api.setSettings(patch); render(); };
  const segOf = (key, opts) => h('div', { class: 'seg' }, opts.map(([v, l]) => h('button', { class: s[key] === v ? 'on' : '', onclick: () => set({ [key]: v }) }, l)));
  return h('div', { class: 'page compact', style: { maxWidth: '860px' } }, h('div', { class: 'topdrag' }),
    h('span', { class: 'eyebrow' }, 'Settings'),
    h('h1', { class: 'hero', style: { fontSize: '48px' } }, 'Your agent, your keys.'),
    h('p', { class: 'lede' }, 'The editor has no account and no AI of its own. It runs the coding agent you already use. Click Connect, sign in on the agent’s own page, and it uses your own subscription.'),
    updateSection(),
    voicesSection(),
    h('div', { class: 'section-head' }, h('h2', { class: 'section' }, 'Agents')),
    h('div', { class: 'agent-rows' }, env.agents.map(a => agentRow(a, s, set))),
    h('div', { style: { marginTop: '10px' } }, h('button', { class: 'btn small ghost', onclick: async () => { await refreshEnv(); render(); toast('Checked again.'); } }, 'Check again')),
    h('div', { class: 'section-head' }, h('h2', { class: 'section' }, 'Access')),
    h('div', { class: 'field' }, segOf('access', [['standard', 'Standard'], ['full', 'Full access']]),
      h('div', { class: 'fh' }, s.access === 'full'
        ? 'Full access: the agent runs any command without asking, with no sandbox. Use it only on a computer you trust with this.'
        : 'Standard: the agent edits files and runs commands in the project, and uses FilmCraft. Codex runs in its workspace sandbox with network on. Claude Code runs with a fixed list of allowed tools.')),
    h('div', { class: 'section-head' }, h('h2', { class: 'section' }, 'Scale Video Toolkit')),
    h('div', { class: 'field' }, h('div', null, env.toolkitDir ? `Found at ${env.toolkitDir}. The agent reads its CLAUDE.md for which tool fits each kind of video.` : 'Not found on this computer. The agent works without it, with fewer specialist tools.'),
      h('div', { class: 'row-gap' }, h('button', { class: 'btn small', onclick: () => go({ view: 'setup' }) }, 'Open Setup'), h('button', { class: 'btn small ghost', onclick: () => go({ view: 'tools' }) }, 'See the tools'))),
    h('div', { class: 'section-head' }, h('h2', { class: 'section' }, 'Projects folder')),
    h('div', { class: 'field' }, h('div', null, env.projectsRoot), h('div', { class: 'fh' }, 'Each project is a normal folder with media, work and exports inside.')),
    h('p', { style: { color: 'var(--label)', marginTop: '40px', fontSize: '12px' } }, `Scale Video Editor ${env.version || ''} · open source · FilmCraft is a separate Apache-2.0 project by storytold.`));
}

function tildePath(p) { return String(p).replace(/^\/Users\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~'); }
async function findFilmcraftApp(e) {
  const btn = e && e.currentTarget; if (btn) { btn.disabled = true; btn.textContent = 'Looking…'; }
  const r = await api.filmcraft.search();
  await refreshFc(); render();
  toast(r.ok ? `Found FilmCraft: ${tildePath(r.app)}` : 'FilmCraft was not found. Click "Choose where it is", or download it.');
}
async function chooseFilmcraftApp() {
  const r = await api.filmcraft.choose();
  if (!r.ok) { if (r.message) toast(r.message); return; }
  await refreshFc(); render();
  toast(`Using FilmCraft: ${tildePath(r.app)}`);
}

function viewFilmcraft() {
  const fc = state.fc || {};
  return h('div', { class: 'page compact', style: { maxWidth: '860px' } }, h('div', { class: 'topdrag' }),
    h('span', { class: 'eyebrow' }, 'FilmCraft'),
    h('h1', { class: 'hero', style: { fontSize: '48px' } }, 'The timeline under the chat.'),
    h('p', { class: 'lede' }, 'FilmCraft is a free, open-source video editor. The agent drives it through its MCP server, and you can edit in its window at any time. The editor never changes FilmCraft itself.'),
    h('div', { class: 'fc-card' },
      h('div', { class: 'row' }, h('strong', null, fc.installed ? (fc.bridge ? 'Connected' : 'Installed, not connected') : 'Not installed')),
      h('div', { class: 'kv' }, `Installed: ${fc.cliVersion || (fc.app ? 'app only' : '—')}   ·   Latest: ${fc.latest || 'unknown'}   ·   Control port: ${fc.port || '—'}`),
      fc.updateAvailable ? h('p', null, `FilmCraft ${fc.latest} is out. Quit FilmCraft, install the new version of the app and its CLI together, then connect again. Keep the two on the same version.`) : null,
      fc.installed && !fc.cli ? h('p', null, 'The FilmCraft app is here, but its command-line tool (filmcraft-cli) is not. The agent needs it. Install it from the same release page.') : null,
      fc.appRunningWithoutBridge ? h('p', null, 'FilmCraft is open without its control bridge. Save your work and quit FilmCraft, then click Connect.') : null,
      h('div', { class: 'kv' }, fc.appPath ? `App: ${tildePath(fc.appPath)}${fc.chosenApp ? ' (you chose this)' : ''}` : 'App: not found. If FilmCraft is already on this computer, let the editor find it or choose where it is.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: findFilmcraftApp }, 'Find it on my computer'),
        h('button', { class: 'btn small', onclick: chooseFilmcraftApp }, 'Choose where it is…'),
        fc.chosenApp ? h('button', { class: 'btn small ghost', style: { color: 'var(--on-navy)' }, onclick: async () => { await api.filmcraft.clearPath(); await refreshFc(); render(); toast('The editor looks in the usual places again.'); } }, 'Use the usual places') : null),
      h('div', { class: 'row' },
        fc.installed ? h('button', { class: 'btn coral', onclick: () => connectFilmcraft(null) }, fc.bridge ? 'Connected' : 'Connect FilmCraft') : null,
        h('button', { class: 'btn', onclick: () => api.os.openExternal(fc.releasesPage || 'https://github.com/storytold/filmcraft/releases/latest') }, fc.installed ? 'Release page' : 'Download FilmCraft'),
        h('button', { class: 'btn ghost', style: { color: 'var(--on-navy)' }, onclick: async () => { await refreshFc(); render(); toast('Checked again.'); } }, 'Check again'))));
}

/* ---------- start ---------- */
window.__sve = { go, openInterview, state, openGuide, guideSend, closeGuide, refreshKit: q => refreshKit(q) };
/* ---------- project menu (⋯) ---------- */
function closeMenus() { document.querySelectorAll('.pop-menu').forEach(m => m.remove()); }
document.addEventListener('pointerdown', e => { if (!e.target.closest('.pop-menu, .more-btn')) closeMenus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });
function moreButton(p) {
  const btn = h('button', { class: 'more-btn', title: 'More', 'aria-label': `More for ${p.name}`, html: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>' });
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = document.querySelector('.pop-menu');
    closeMenus();
    if (open && open.dataset.for === p.id) return;
    const item = (label, fn, cls) => h('button', { class: 'menu-item' + (cls ? ' ' + cls : ''), onclick: ev => { ev.stopPropagation(); closeMenus(); fn(); } }, label);
    const m = h('div', { class: 'pop-menu menu', 'data-for': p.id },
      item('Open', () => go({ view: 'project', id: p.id })),
      item('Rename…', () => renameDialog(p)),
      item('Duplicate', () => duplicateProject(p)),
      item('Show in Finder', () => api.os.reveal(p.dir)),
      h('div', { class: 'menu-sep' }),
      item('Delete…', () => confirmDelete(p), 'danger'));
    document.body.append(m);
    const r = btn.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
    m.style.left = Math.max(8, Math.min(r.left, innerWidth - mw - 8)) + 'px';
    m.style.top = (r.bottom + 6 + mh > innerHeight ? r.top - mh - 6 : r.bottom + 6) + 'px';
  });
  return btn;
}
function renameDialog(p) {
  const overlay = $('#overlay');
  const close = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; };
  const input = h('input', { type: 'text', value: p.name, maxlength: 80 });
  const save = async () => {
    const name = input.value.trim();
    if (!name || name === p.name) { close(); return; }
    try {
      const next = await api.projects.rename(p.id, name);
      close();
      await refreshProjects();
      if (state.route.view === 'project' && state.route.id === p.id) go({ view: 'project', id: next.id }); else render();
    } catch (err) { toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') close(); });
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.innerHTML = '';
  overlay.append(h('div', { class: 'sheet confirm', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'confirm-body' }, h('p', { class: 'eyebrow' }, 'Rename project'), h('h2', null, 'A new name'),
      h('div', { class: 'field' }, input, h('div', { class: 'fh' }, 'The project folder is renamed too.'))),
    h('div', { class: 'sheet-foot' }, h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Rename'))));
  overlay.classList.remove('hidden');
  input.focus(); input.select();
}
async function duplicateProject(p) {
  try {
    const copy = await api.projects.duplicate(p.id);
    await refreshProjects(); render();
    toast(`Made “${copy.name}”: the same files, with a new chat.`);
  } catch (err) { toast(`Could not duplicate: ${String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`); }
}

/* ---------- delete a project ---------- */
// Hover shows a trash can. Click it for a confirm box, or press and hold it: a ring fills,
// and the project is deleted when the ring closes. Deleting moves the folder to the Trash.
const HOLD_MS = 1200;
function trashButton(p) {
  const ring = '<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="ring-bg" cx="18" cy="18" r="16"/><circle class="ring" cx="18" cy="18" r="16"/></svg>';
  const icon = '<svg class="can" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const btn = h('button', { class: 'trash-btn', title: 'Delete project (click, or press and hold)', 'aria-label': `Delete ${p.name}`, html: ring + icon });
  let timer = null, started = 0;
  const reset = () => { clearTimeout(timer); timer = null; btn.classList.remove('holding'); };
  btn.addEventListener('click', e => e.stopPropagation());
  btn.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    started = Date.now(); btn.classList.add('holding');
    timer = setTimeout(() => { reset(); started = 0; deleteProject(p); }, HOLD_MS);
  });
  btn.addEventListener('pointerup', e => {
    e.stopPropagation();
    if (!timer) return;
    const held = Date.now() - started; reset();
    if (held < 250) confirmDelete(p);
  });
  btn.addEventListener('pointerleave', reset);
  btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); confirmDelete(p); } });
  return btn;
}
function confirmDelete(p) {
  const overlay = $('#overlay');
  const close = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.onclick = e => { if (e.target === overlay) close(); };
  const del = h('button', { class: 'btn danger', onclick: async () => { close(); await deleteProject(p); } }, 'Delete project');
  overlay.innerHTML = '';
  overlay.append(h('div', { class: 'sheet confirm', role: 'alertdialog', 'aria-modal': 'true' },
    h('div', { class: 'confirm-body' },
      h('p', { class: 'eyebrow' }, 'Delete project'),
      h('h2', null, `Delete “${p.name}”?`),
      h('p', null, 'All of its work goes with it: the chat, the media you added, the work files and every export. The folder moves to your computer’s Trash, and once the Trash is emptied it cannot be recovered.'),
      h('p', { class: 'hint' }, 'Tip: press and hold the trash can to delete without this box.')),
    h('div', { class: 'sheet-foot' }, h('span', { class: 'grow' }),
      h('button', { class: 'btn', onclick: close }, 'Cancel'), del)));
  overlay.classList.remove('hidden');
  del.focus();
}
async function deleteProject(p) {
  try { await api.projects.trash(p.id); }
  catch (err) { toast(`Could not delete “${p.name}”: ${String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`); return; }
  state.busy.delete(p.id);
  await refreshProjects();
  if (state.route.view === 'project' && state.route.id === p.id) go({ view: 'home' }); else render();
  toast(`Moved “${p.name}” to the Trash.`);
}

/* ---------- Toolkit Guide ---------- */
// The same ChatBaser agent as the dashboard's Video Toolkit guide. Questions go through the main
// process to a Scale Plus route that holds the key; this page never sees it.
const GUIDE_KEY = 'sve-guide:v1';
const GUIDE_WELCOME = "Hi, I'm the Toolkit Guide. Tell me what you'd like to make and I'll point you to the best kind of video for it, then help you write the request for your agent. You can also ask me anything about the toolkit.";
const GUIDE_STARTERS = ['What can the toolkit do?', 'I have a script. What can I make with it?', 'Help me write a request for a Short', 'What can I make without paid accounts?'];
const GUIDE_SUPPORT = 'https://support.scale.gg/';
function guideDraftFor(f) { return `Tell me more about the ${f.name}. What is it, what does the finished video look like, and what can it do? Give me some use cases and examples, and tell me what I need to have ready.`; }
const guide = { open: false, messages: [], sending: false, error: '', draft: '', format: '' };
try { const saved = JSON.parse(localStorage.getItem(GUIDE_KEY) || 'null'); if (saved && Array.isArray(saved.messages)) guide.messages = saved.messages.slice(-60); } catch {}
function saveGuide() { try { localStorage.setItem(GUIDE_KEY, JSON.stringify({ messages: guide.messages.slice(-60) })); } catch {} }

function openGuide(draft, format) {
  guide.open = true;
  if (draft) { guide.draft = draft; guide.format = format || ''; }
  drawGuide(true);
}
function closeGuide() { guide.open = false; drawGuide(); }

async function guideSend(text) {
  text = String(text || '').trim();
  if (!text || guide.sending) return;
  const conversation = guide.messages.map(({ role, content }) => ({ role, content }));
  guide.messages.push({ role: 'user', content: text });
  guide.open = true; guide.sending = true; guide.error = ''; guide.draft = '';
  const format = guide.format; guide.format = '';
  drawGuide(true);
  const res = await api.guide.ask({ message: text, conversation, format });
  guide.sending = false;
  if (res.error) guide.error = res.error;
  else guide.messages.push({ role: 'assistant', content: res.answer, escalate: res.escalate });
  saveGuide();
  drawGuide(true);
}

function drawGuide(focus) {
  const el = $('#guide');
  if (!el) return;
  el.classList.toggle('hidden', !guide.open);
  document.body.classList.toggle('guide-open', guide.open);
  $('#guideNav')?.classList.toggle('active', guide.open);
  if (!guide.open) { el.innerHTML = ''; return; }
  const box = h('textarea', { rows: 3, placeholder: 'Ask about a kind of video, a tool, or what to make…', maxlength: 4000 });
  box.value = guide.draft;
  box.addEventListener('input', () => { guide.draft = box.value; });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); guideSend(box.value); } });
  const list = h('div', { class: 'guide-list' },
    h('div', { class: 'gmsg bot' }, h('span', { class: 'gav' }, '?'), h('div', { class: 'gbody', html: md(GUIDE_WELCOME) })),
    guide.messages.length ? null : h('div', { class: 'guide-starters' }, GUIDE_STARTERS.map(q => h('button', { onclick: () => guideSend(q) }, q))),
    guide.messages.map(m => m.role === 'user'
      ? h('div', { class: 'gmsg me' }, h('div', { class: 'gbody' }, m.content))
      : h('div', { class: 'gmsg bot' }, h('span', { class: 'gav' }, '?'),
        h('div', { class: 'gbody' }, h('div', { html: md(m.content) }),
          h('div', { class: 'gtools' },
            h('button', { class: 'copy-btn', onclick: () => copyText(m.content) }, 'Copy'),
            m.escalate ? h('a', { href: GUIDE_SUPPORT, 'data-ext': '1', class: 'copy-btn' }, 'Contact support') : null)))),
    guide.sending ? h('div', { class: 'working' }, h('span', { class: 'spin' }), 'The guide is thinking…') : null,
    guide.error ? h('div', { class: 'err' }, guide.error) : null);
  el.innerHTML = '';
  el.append(
    h('div', { class: 'guide-head' },
      h('span', { class: 'gav big' }, '?'),
      h('div', { class: 'grow' }, h('div', { class: 'gname' }, 'Toolkit Guide'), h('div', { class: 'gsub' }, 'Answers from the Scale Video Toolkit knowledge base')),
      guide.messages.length ? h('button', { class: 'icon-btn', title: 'Start over', onclick: () => { guide.messages = []; guide.error = ''; saveGuide(); drawGuide(true); } }, '↺') : null,
      h('button', { class: 'icon-btn', title: 'Close', onclick: closeGuide }, '×')),
    list,
    h('div', { class: 'guide-compose' }, box,
      h('div', { class: 'ws-foot' }, h('span', { class: 'gsub' }, 'Enter to send · Shift+Enter for a new line'), h('span', { class: 'grow' }),
        h('button', { class: 'send', disabled: guide.sending, title: 'Send', onclick: () => guideSend(box.value) }, '↑'))));
  list.scrollTop = list.scrollHeight;
  if (focus) box.focus();
}

/* ---------- updates ---------- */
const UPDATE_LIVE = ['available', 'downloading', 'ready', 'manual'];
function updateActions(u, small) {
  const cls = 'btn' + (small ? ' small' : '');
  if (u.status === 'available') return h('button', { class: cls + ' primary', onclick: () => api.update.apply() }, 'Update now');
  if (u.status === 'ready') return h('button', { class: cls + ' coral', onclick: () => api.update.restart() }, 'Restart to finish');
  if (u.status === 'manual') return h('button', { class: cls, onclick: () => api.update.apply() }, 'Download the new version');
  if (u.status === 'downloading' || u.status === 'checking') return h('button', { class: cls, disabled: true }, u.status === 'checking' ? 'Checking…' : 'Updating…');
  return h('button', { class: cls, onclick: () => api.update.check() }, 'Check for updates');
}
function drawUpdateSlot() {
  const slot = $('#updateSlot');
  if (!slot) return;
  slot.innerHTML = '';
  const u = state.update;
  if (!u || !UPDATE_LIVE.includes(u.status)) return;
  const ready = u.status === 'ready';
  const busy = u.status === 'downloading';
  slot.append(h('div', { class: 'update-card' + (ready ? ' ready' : '') },
    h('p', { class: 'label-sm' }, h('span', { class: 'up-ico', 'aria-hidden': 'true' }, '↑'),
      ready ? 'Update ready' : busy ? 'Updating…' : `New version${u.latest ? ' ' + u.latest : ''}`),
    h('p', { class: 'update-msg' }, ready ? 'Restart the app to finish the update.'
      : busy ? 'Downloading the new version. Keep working.'
      : u.status === 'manual' ? u.message
      : `There is an update. Click to update to the latest version${u.latest ? ' (' + u.latest + ')' : ''}.`),
    updateActions(u, true)));
}
function updateSection() {
  const u = state.update || { status: 'idle', current: state.env?.version || '' };
  return [
    h('div', { class: 'section-head' }, h('h2', { class: 'section' }, 'Updates')),
    h('div', { class: 'field' },
      h('div', null, `Scale Video Editor ${u.current || state.env?.version || ''}`),
      h('div', { class: 'fh' }, u.message || 'The editor checks for a new version every time it starts.'),
      u.checkedAt ? h('div', { class: 'fh' }, `Last checked ${agoLong(u.checkedAt)}.`) : null,
      h('div', { class: 'row-gap' }, updateActions(u, false)))
  ];
}

// Start after every script on the page has loaded: brands.js comes after this file, and
// init needs its functions (refreshBrands). Starting earlier stopped init before the first
// FilmCraft check, so the app showed FilmCraft as unchecked until Check again.
window.addEventListener('DOMContentLoaded', async function init() {
  api.update.get().then(u => { state.update = u; drawUpdateSlot(); });
  api.update.onState(u => { state.update = u; drawUpdateSlot(); if (state.route.view === 'settings') render(); });
  api.onNav(r => go(r));
  $('#guideNav')?.addEventListener('click', () => guide.open ? closeGuide() : openGuide());
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && guide.open && !$('#overlay:not(.hidden)')) closeGuide(); });
  loadChecks();
  try { renderSidebar(); } catch {}
  await Promise.all([refreshEnv(), refreshProjects(), refreshBrands()]);
  // The main process asks each agent for its newest models at start; redraw when that is done.
  api.agents.onModelsChanged(async () => {
    await Promise.all(Object.keys(state.models).concat(state.env?.settings?.engine || 'claude').map(id => loadModels(id)));
    document.querySelectorAll('.model-pick').forEach(w => w.relabel && w.relabel());
  });
  const running = await api.agent.running();
  running.forEach(id => state.busy.add(id));
  render();
  setTimeout(() => refreshKit(true), 1500);
  refreshFc().then(() => { if (['home', 'filmcraft'].includes(state.route.view) || state.route.view === 'project') render(); });
  setInterval(async () => {
    const before = JSON.stringify([state.fc?.bridge, state.fc?.installed]);
    await refreshFc();
    if (before !== JSON.stringify([state.fc?.bridge, state.fc?.installed]) && state.route.view !== 'home') render();
  }, 15000);
});

/* ---------- the toolkit on this computer: Tools page and Setup checklist ---------- */
// Which rows of the toolkit's own check (tools/verify-install.sh) each tool depends on.
const TOOL_CHECKS = {
  hyperframes: ['skill: hyperframes', 'HyperFrames command'],
  atlas: ['3D Style Atlas data', 'Google Chrome'],
  oma: ['skill: one-minute-animation'],
  stickman: ['skill: stickman-vsl-director'],
  demo: ['skill: saas-demo-commercial'],
  huashu: ['Huashu Motion'],
  shotcraft: ['skill: video-shotcraft'],
  herk: ['Herk Edit Kit'],
  cuts: ['skill: perfect-cuts'],
  relight: ['skill: re-light', 'fal.ai key (GenMedia)'],
  filmcraft: ['FilmCraft command-line tool', 'FilmCraft app', 'FilmCraft app and tool versions'],
  voice: ['my-voice (voiceover command)', 'ElevenLabs key (voiceover)', 'Your ElevenLabs voice ID'],
  presenter: ['GenMedia command-line tool', 'fal.ai key (GenMedia)'],
  transcribe: ['skill: transcribe', 'WhisperX (word timings)'],
  cutpoints: ['cut-points runs'],
  genmedia: ['GenMedia command-line tool'],
  earshot: ['Earshot'],
  sfx: ['Sound effect set'],
  watch: ['skill: watch-video'],
  ytdlp: ['skill: yt-dlp-superpowers', 'yt-dlp'],
  router: ['skill: media-superpowers']
};
const KIT_URL = 'https://app.scaleplus.gg/pro-max/video-toolkit?view=install';
const BADGE = {
  ready: ['Ready', 'ok'], missing: ['Not installed', 'bad'], optional: ['Not installed', 'warn'],
  key: ['Needs a key', 'warn'], mismatch: ['Versions differ', 'warn'], unknown: ['Not checked', '']
};
state.kit = null;      // last result of the toolkit check
state.kitBusy = false;
state.toolFilter = 'all';

async function refreshKit(quiet) {
  if (state.kitBusy) return;
  state.kitBusy = true;
  if (['tools', 'setup'].includes(state.route.view)) render();
  try { state.kit = await api.toolkit.check(); saveChecks(); } catch (err) { if (!state.kit) state.kit = { found: false, error: String(err.message || err), rows: [] }; }
  state.kitBusy = false;
  await refreshEnv();
  if (['tools', 'setup'].includes(state.route.view)) render(); else renderSidebar();
  if (!quiet) toast('Checked this computer again.');
}
const kitRow = part => (state.kit?.rows || []).find(r => r.part === part);

function toolStatus(id) {
  const rows = (TOOL_CHECKS[id] || []).map(kitRow).filter(Boolean);
  if (!rows.length) return { status: 'unknown', rows };
  if (rows.some(r => r.status === 'missing')) return { status: 'missing', rows };
  if (rows.some(r => r.status === 'optional')) return { status: 'optional', rows };
  if (rows.some(r => r.status === 'mismatch')) return { status: 'mismatch', rows };
  if (rows.some(r => r.status === 'nokey')) return { status: 'key', rows };
  return { status: 'ready', rows };
}
function badge(status) {
  const [text, cls] = BADGE[status] || BADGE.unknown;
  return h('span', { class: 'kbadge ' + cls }, h('span', { class: 'kdot' }), text);
}
// What still needs doing, for the sidebar row and the Setup page.
function setupTodo() {
  const env = state.env;
  const items = [];
  if (env && !env.agents.some(a => a.installed)) items.push('agent');
  if (state.fc && !state.fc.installed) items.push('filmcraft');
  if (state.kit && !state.kit.found) items.push('toolkit');
  for (const r of state.kit?.rows || []) if (['missing', 'mismatch', 'nokey'].includes(r.status)) items.push(r.part);
  return items;
}

/* Tools page */
function viewTools() {
  const TOOLS = window.SVE_TOOLS || {};
  const ids = Object.keys(TOOLS);
  const known = !!state.kit?.found && !state.kit.unsupported;
  const shown = ids.filter(id => {
    if (state.toolFilter === 'all' || !known) return true;
    const st = toolStatus(id).status;
    return state.toolFilter === 'ready' ? st === 'ready' : st !== 'ready';
  });
  const counts = ids.reduce((a, id) => { const st = toolStatus(id).status; a[st === 'ready' ? 'ready' : 'todo']++; return a; }, { ready: 0, todo: 0 });
  const filter = known ? h('div', { class: 'seg' },
    [['all', `All ${ids.length}`], ['ready', `Ready ${counts.ready}`], ['todo', `Needs setup ${counts.todo}`]].map(([v, l]) =>
      h('button', { class: state.toolFilter === v ? 'on' : '', onclick: () => { state.toolFilter = v; render(); } }, l))) : null;
  const note = !state.kit ? h('div', { class: 'kit-note' }, state.kitBusy ? 'Checking this computer…' : 'Not checked yet.')
    : !state.kit.found ? h('div', { class: 'kit-note' }, 'The Scale Video Toolkit was not found on this computer, so the editor cannot say what is ready. ',
      h('button', { class: 'chat-link', onclick: () => go({ view: 'setup' }) }, 'Set it up →'))
    : state.kit.unsupported ? h('div', { class: 'kit-note' }, 'The toolkit’s check runs on macOS only. The tools are listed without a status.') : null;
  const page = h('div', { class: 'page' }, h('div', { class: 'topdrag' }),
    h('span', { class: 'eyebrow' }, 'Tools'),
    h('h1', { class: 'hero', style: { fontSize: '56px' } }, 'What’s in the kit, and ', h('em', null, 'what you have.')),
    h('p', { class: 'lede' }, 'Every tool your agent can use, what it is good at, and whether it is ready on this computer. Open one for the details.'),
    h('div', { class: 'tools-bar' }, filter, h('span', { class: 'grow' }),
      state.kit?.checkedAt ? h('span', { class: 'fh' }, `Checked ${ago(state.kit.checkedAt)} ago`) : null,
      h('button', { class: 'btn small', disabled: state.kitBusy, onclick: () => refreshKit() }, state.kitBusy ? 'Checking…' : 'Check again')),
    note,
    h('div', { class: 'ktool-list' }, shown.map((id, i) => toolEntry(id, TOOLS[id], i, known))));
  if (state.route.tool) setTimeout(() => { const el = document.getElementById('tool-' + state.route.tool); if (el) { el.open = true; el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } }, 0);
  return page;
}

function toolEntry(id, t, i, known) {
  const st = toolStatus(id);
  const fixRow = st.rows.find(r => r.fix && r.status !== 'ok');
  const keyRow = st.rows.find(r => r.status === 'nokey');
  const uses = FORMATS.filter(f => (f.tools || []).includes(id));
  const field = (label, text) => text ? h('div', { class: 'tdoc' }, h('dt', { class: 'label-sm' }, label), h('dd', null, text)) : null;
  return h('details', { class: 'ktool', id: 'tool-' + id, open: state.route.tool === id },
    h('summary', null,
      h('span', { class: 'tchip', style: toneStyle(TONE_CYCLE[i % TONE_CYCLE.length]) }, t.name.slice(0, 1)),
      h('span', { class: 'tmain' },
        h('span', { class: 'tname' }, t.name, ' ', h('span', { class: 'tkind' }, t.kind)),
        h('span', { class: 'tdoes' }, t.does)),
      known ? badge(st.status) : null,
      h('span', { class: 'tchev', 'aria-hidden': 'true' }, '›')),
    h('div', { class: 'tbody' },
      h('dl', { class: 'tdocs' },
        field('Why it is in the kit', t.why), field('How it works', t.how), field('Best for', t.best),
        field('Use it well', t.well), field('Needs', t.needs), field('You get', t.gets), field('Limits', t.limits)),
      t.by ? h('p', { class: 'fh' }, 'By ', t.by, t.type ? ` · ${t.type}` : '') : null,
      uses.length ? h('div', { class: 'tuses' }, h('span', { class: 'label-sm' }, 'Used in'),
        uses.map(f => h('button', { class: 'tool-pill', onclick: () => openInterview(f) }, f.name))) : null,
      known && st.rows.length ? h('div', { class: 'trows' }, st.rows.map(r => h('div', { class: 'trow' }, badge(r.status === 'ok' ? 'ready' : r.status === 'nokey' ? 'key' : r.status), h('span', null, r.part)))) : null,
      h('div', { class: 'row-gap' },
        fixRow ? h('button', { class: 'btn small primary', onclick: () => runKitFix(fixRow) }, 'Set it up') : null,
        !fixRow && keyRow ? h('button', { class: 'btn small primary', onclick: () => go({ view: 'setup' }) }, 'Add the key in Setup') : null,
        h('button', { class: 'btn small', onclick: () => openGuide(`Tell me about ${t.name} in the Scale Video Toolkit. When should I use it, and what do I ask my agent for?`, t.name) }, 'Ask the guide'),
        t.url ? h('button', { class: 'btn small ghost', onclick: () => api.os.openExternal(t.url) }, (t.linkText || 'Learn more') + ' ↗') : null)));
}

/* Setup checklist */
function setupLine({ status, title, detail, actions }) {
  return h('div', { class: 'sline' }, badge(status),
    h('div', { class: 'grow' }, h('div', { class: 'stitle' }, title), detail ? h('div', { class: 'fh' }, detail) : null),
    h('div', { class: 'row-gap' }, actions || []));
}
function kitLine(r) {
  const status = r.status === 'ok' ? 'ready' : r.status === 'nokey' ? 'key' : r.status;
  const actions = [];
  if (r.fix) actions.push(h('button', { class: 'btn small primary', onclick: () => runKitFix(r) }, r.status === 'mismatch' ? 'Update' : 'Install'));
  if (r.youRun) actions.push(
    h('button', { class: 'btn small', onclick: async () => { await api.copy(r.youRun); toast('Command copied. Paste it in Terminal, then paste your key when it asks.', 5000); } }, 'Copy command'),
    h('button', { class: 'btn small primary', onclick: () => api.toolkit.terminal() }, 'Open Terminal'));
  if (r.file) actions.push(h('button', { class: 'btn small primary', onclick: () => go({ view: 'settings' }) }, 'Set up voices'));
  if (r.status !== 'ok' && r.status !== 'na') actions.unshift(h('button', { class: 'btn small ghost', title: 'Already on this computer? Your agent looks for it and connects it.', onclick: () => findSheet([r]) }, 'I have it: find it'));
  let detail = r.detail.replace(/;?\s*run: .*$/, '').replace(/^you run: .*$/, '');
  if (r.youRun) detail = 'Add it yourself in Terminal: the command asks for the key and keeps it in your Mac’s Keychain. The editor never sees it.';
  if (r.file) detail = 'Add your ElevenLabs voice ID in Settings → Voices: a default and up to two alternates. A voice ID is not a secret.';
  return setupLine({ status, title: r.part, detail, actions });
}

function viewSetup() {
  const env = state.env || { agents: [] };
  const fc = state.fc;
  const kit = state.kit;
  const agentsIn = env.agents.filter(a => a.installed);
  const app = [
    setupLine({ status: agentsIn.length ? 'ready' : 'missing', title: 'A coding agent',
      detail: agentsIn.length ? agentsIn.map(a => `${a.name} ${a.version || ''}`).join(' · ') : 'Claude Code or Codex does the work. Install one and sign in with your own plan.',
      actions: [h('button', { class: 'btn small' + (agentsIn.length ? '' : ' primary'), onclick: () => go({ view: 'settings' }) }, agentsIn.length ? 'Agent settings' : 'Set up an agent')] }),
    setupLine({ status: !fc ? 'unknown' : fc.installed ? 'ready' : 'missing', title: 'FilmCraft',
      detail: !fc ? 'Checking…' : fc.bridge ? 'Installed and connected.' : fc.installed ? 'Installed. Connect it when you open a project.' : 'The free editor that holds the timeline. The chat works without it.',
      actions: [h('button', { class: 'btn small', onclick: () => go({ view: 'filmcraft' }) }, fc?.installed ? 'FilmCraft' : 'Get FilmCraft')] }),
    setupLine({ status: !kit ? 'unknown' : kit.found ? 'ready' : 'missing', title: 'Scale Video Toolkit',
      detail: !kit ? (state.kitBusy ? 'Looking for it…' : 'Not checked yet.') : kit.found ? `Found at ${String(kit.dir).replace(/^\/Users\/[^/]+/, '~')}.` : 'The specialist tools and skills your agent uses for each kind of video. Without it the agent uses what it has.',
      actions: [
        !kit?.found ? h('button', { class: 'btn small primary', onclick: () => api.os.openExternal(KIT_URL) }, 'Get the toolkit ↗') : null,
        h('button', { class: 'btn small', onclick: async () => {
          const r = await api.toolkit.choose();
          if (r.ok) { toast('Toolkit folder saved.'); refreshKit(true); } else if (r.message) toast(r.message, 5000);
        } }, kit?.found ? 'Change folder…' : 'Choose folder…')] })
  ];
  const rows = kit?.rows || [];
  const need = rows.filter(r => ['missing', 'mismatch', 'nokey'].includes(r.status));
  const optional = rows.filter(r => r.status === 'optional');
  const ok = rows.filter(r => r.status === 'ok' || r.status === 'na');
  const todo = setupTodo().length;
  return h('div', { class: 'page compact', style: { maxWidth: '960px' } }, h('div', { class: 'topdrag' }),
    h('span', { class: 'eyebrow' }, 'Setup'),
    h('h1', { class: 'hero', style: { fontSize: '48px' } }, todo ? 'What this computer still needs.' : 'This computer is ready.'),
    h('p', { class: 'lede' }, 'Each line is checked on this computer. Install runs the toolkit’s own installer for that one part, and you can watch it work. Keys you add yourself, in Terminal.'),
    h('div', { class: 'tools-bar' }, h('span', { class: 'grow' }),
      kit?.checkedAt ? h('span', { class: 'fh' }, `Checked ${ago(kit.checkedAt)} ago`) : null,
      h('button', { class: 'btn small', disabled: state.kitBusy, onclick: () => refreshKit() }, state.kitBusy ? 'Checking…' : 'Check again')),
    h('div', { class: 'section-head' }, h('h2', { class: 'section' }, 'The editor')),
    h('div', { class: 'slist' }, app),
    kit?.unsupported ? h('div', { class: 'kit-note' }, 'The toolkit’s detailed check runs on macOS only.') : null,
    kit?.error ? h('div', { class: 'kit-note' }, `The toolkit check did not finish: ${kit.error}`) : null,
    (need.length || optional.length) ? h('div', { class: 'find-banner' },
      h('div', { class: 'grow' }, h('strong', null, 'Already installed some of this?'),
        h('p', { class: 'fh' }, 'Your agent can search this computer, or a folder you choose, and connect what it finds. It never moves or deletes your files and never downloads anything. Whatever it cannot find keeps its Install button.')),
      h('button', { class: 'btn primary', onclick: () => findSheet([...need, ...optional]) }, 'Let the agent find them')) : null,
    need.length ? [h('div', { class: 'section-head' }, h('h2', { class: 'section' }, `Needs you (${need.length})`),
      h('button', { class: 'btn small ghost', onclick: () => findSheet(need) }, 'Find these on my computer')), h('div', { class: 'slist' }, need.map(kitLine))] : null,
    optional.length ? [h('div', { class: 'section-head' }, h('h2', { class: 'section' }, `Optional (${optional.length})`),
      h('button', { class: 'btn small ghost', onclick: () => findSheet(optional) }, 'Find these on my computer')),
      h('p', { class: 'fh', style: { marginTop: '-6px' } }, 'Install these when you want the kind of video they make.'), h('div', { class: 'slist' }, optional.map(kitLine))] : null,
    ok.length ? h('details', { class: 'sready' }, h('summary', null, `Ready (${ok.length})`), h('div', { class: 'slist' }, ok.map(kitLine))) : null,
    kit?.summary ? h('p', { class: 'fh', style: { marginTop: '24px' } }, 'Toolkit check: ', kit.summary) : null);
}

/* "I have it: find it": the agent searches this computer and connects what it finds */
function findSheet(rows) {
  const overlay = $('#overlay');
  const parts = rows.map(r => ({ part: r.part, detail: r.detail }));
  let folder = null;
  const close = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; render(); };
  const folderText = h('span', { class: 'fh' }, 'Where: the whole computer.');
  const log = h('div', { class: 'find-log hidden' });
  const status = h('span', { class: 'fh' }, '');
  const startBtn = h('button', { class: 'btn primary' }, 'Start looking');
  const stopBtn = h('button', { class: 'btn hidden', onclick: () => api.setup.stop() }, 'Stop');
  const closeBtn = h('button', { class: 'btn', onclick: close }, 'Close');
  const pickBtn = h('button', { class: 'btn small', onclick: async () => {
    const d = await api.setup.pickFolder();
    if (d) { folder = d; folderText.textContent = `Where: ${d.replace(/^\/Users\/[^/]+/, '~')} first, then the rest of the computer if needed.`; }
  } }, 'Choose a folder…');
  const line = (cls, text) => { log.append(h('div', { class: 'fl ' + cls }, text)); log.scrollTop = log.scrollHeight; };
  // One line per part: waiting, looking, found (green check) or not found.
  const items = new Map(rows.map(r => [r.part, h('li', { class: 'fp wait' }, h('span', { class: 'fp-ico' }), h('span', { class: 'fp-name' }, r.part), h('span', { class: 'fp-note' }, ''))]));
  const mark = (part, st, note) => { const li = items.get(part); if (!li || li.classList.contains(st)) return; li.className = 'fp ' + st; li.querySelector('.fp-note').textContent = note || ''; };
  const tick = (result, final) => {
    const by = new Map((result.rows || []).map(x => [x.part, x]));
    for (const r of rows) {
      const now = by.get(r.part);
      if (now && now.status === 'ok') mark(r.part, 'found', 'Found');
      else if (final) mark(r.part, 'missing', 'Not found: click Install');
      else mark(r.part, 'look', 'Looking…');
    }
    return rows.filter(r => by.get(r.part)?.status === 'ok').length;
  };
  let off = null;
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true; pickBtn.disabled = true;
    log.classList.remove('hidden'); stopBtn.classList.remove('hidden');
    status.textContent = 'Starting the agent…';
    off = api.setup.onEvent(ev => {
      if (ev.kind === 'start') { status.textContent = `${agentInfo(ev.engine).name} is looking. This can take a few minutes.`; for (const r of rows) mark(r.part, 'look', 'Looking…'); }
      else if (ev.kind === 'progress') { const n = tick(ev.result, false); status.textContent = `${n} of ${rows.length} found so far. Still looking…`; }
      else if (ev.kind === 'text') line('t', ev.text);
      else if (ev.kind === 'tool') line('k', `${ev.name}${ev.detail ? ': ' + ev.detail : ''}`);
      else if (ev.kind === 'notice') line('k', ev.text || '');
      else if (ev.kind === 'done') { status.textContent = ev.ok === false ? (ev.error || 'The agent stopped.') : 'Done. Checking this computer again…'; stopBtn.classList.add('hidden'); }
      else if (ev.kind === 'checked') {
        state.kit = ev.result; saveChecks();
        const ready = tick(ev.result, true);
        status.textContent = `${ready} of ${rows.length} ready now.${ready < rows.length ? ' The rest keep their Install button.' : ''}`;
        startBtn.classList.add('hidden'); closeBtn.classList.add('primary');
        off && off(); off = null; renderSidebar();
      }
    });
    try { await api.setup.find({ parts, folder }); }
    catch (err) { status.textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); startBtn.disabled = false; pickBtn.disabled = false; stopBtn.classList.add('hidden'); off && off(); off = null; }
  });
  overlay.innerHTML = '';
  overlay.onclick = null;
  overlay.append(h('div', { class: 'sheet confirm wide', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'confirm-body' },
      h('p', { class: 'eyebrow' }, 'Already on this computer'),
      h('h2', null, rows.length === 1 ? `Find ${rows[0].part}` : `Find ${rows.length} parts`),
      h('p', { class: 'fh' }, 'Your agent searches this computer and connects what it finds where the toolkit looks (with a link, so nothing is moved). It never deletes or downloads anything, and it never reads your keys. Whatever it cannot find stays “not installed”, and you can click Install.'),
      h('ul', { class: 'find-parts' }, [...items.values()]),
      h('div', { class: 'row-gap', style: { alignItems: 'center' } }, pickBtn, folderText),
      log),
    h('div', { class: 'sheet-foot' }, status, h('span', { class: 'grow' }), stopBtn, closeBtn, startBtn)));
  overlay.classList.remove('hidden');
}

/* Voices: a default ElevenLabs voice and two alternates (voice IDs are not secrets) */
async function loadVoices() { try { state.voices = await api.voices.get(); } catch { state.voices = null; } return state.voices; }
function voiceSlotsSet() { return (state.voices?.slots || []).filter(s => s.id); }
function voiceLabel(s) { return s ? `${s.name || s.label}${s.key === 'default' ? ' (default)' : ''}` : ''; }
function voicesSection() {
  const slots = state.voices?.slots;
  if (!state.voices) { loadVoices().then(() => { if (state.route.view === 'settings') render(); }); }
  const inputs = (slots || []).map(s => ({
    s,
    name: h('input', { class: 'vin', value: s.name, placeholder: s.key === 'default' ? 'Name, for example Mike' : 'Name, for example Female narrator', maxlength: 60 }),
    id: h('input', { class: 'vin mono', value: s.id, placeholder: 'Voice ID from ElevenLabs', spellcheck: 'false', autocomplete: 'off' })
  }));
  const save = async () => {
    try {
      state.voices = await api.voices.set(inputs.map(x => ({ key: x.s.key, name: x.name.value, id: x.id.value })));
      toast('Voices saved.'); refreshKit(true); render();
    } catch (err) { toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 6000); }
  };
  return [
    h('div', { class: 'section-head' }, h('h2', { class: 'section' }, 'Voices')),
    h('div', { class: 'field' },
      h('div', { class: 'fh', style: { marginTop: 0 } }, 'Your ElevenLabs voices for voiceovers. Open a voice on the ElevenLabs website and copy its voice ID. The default is used unless you pick another voice under the prompt box. A voice ID is not a secret; your ElevenLabs key stays in your Mac’s Keychain.'),
      !slots ? h('div', { class: 'fh' }, 'Loading…') : h('div', { class: 'vgrid' },
        inputs.flatMap(x => [h('div', { class: 'vslot' }, x.s.key === 'default' ? 'Default · No. 1' : `${x.s.label}`), x.name, x.id])),
      h('div', { class: 'row-gap' }, h('button', { class: 'btn small primary', onclick: save }, 'Save voices'),
        state.voices?.file ? h('span', { class: 'fh', style: { margin: 0 } }, `Saved in ${state.voices.file.replace(/^\/Users\/[^/]+/, '~')}`) : null))
  ];
}
function voicePicker({ value, onChange, up = true }) {
  const wrap = h('div', { class: 'agent-pick voice-pick' });
  const btn = h('button', { class: 'mini-select', type: 'button', title: 'Choose the voice for the voiceover' }, h('span', { class: 'vp-label' }, ''), h('span', { style: { opacity: .5 } }, '▾'));
  wrap.append(btn);
  const relabel = () => {
    const set = voiceSlotsSet();
    const cur = set.find(s => s.key === (value || 'default')) || set[0];
    btn.querySelector('.vp-label').textContent = cur ? `Voice: ${cur.name || cur.label}` : 'Voice: set up';
  };
  if (state.voices) relabel(); else loadVoices().then(relabel);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (!voiceSlotsSet().length) { go({ view: 'settings' }); return; }
    const open = wrap.querySelector('.menu');
    if (open) { open.remove(); return; }
    const menu = h('div', { class: 'menu' + (up ? '' : ' down') });
    menu.append(h('div', { class: 'menu-head' }, 'Voice for the voiceover'));
    for (const s of voiceSlotsSet()) menu.append(h('button', { class: 'menu-item', type: 'button', onclick: ev => { ev.stopPropagation(); menu.remove(); value = s.key === 'default' ? '' : s.key; relabel(); onChange(value); } },
      h('span', null, h('div', { class: 'mi-name' }, s.name || s.label), h('div', { class: 'mi-sub' }, s.key === 'default' ? 'Default · No. 1' : s.label)),
      (value || 'default') === s.key ? h('span', { class: 'mi-check' }, '✓') : null));
    menu.append(h('div', { class: 'menu-sep' }), h('button', { class: 'menu-item', type: 'button', onclick: () => go({ view: 'settings' }) }, h('span', { class: 'mi-sub' }, 'Set up voices…')));
    wrap.append(menu);
    fitMenu(menu, btn);
    const close = () => { menu.remove(); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
  });
  return wrap;
}

/* Running a fix, with its log in a sheet */
async function runKitFix(row) {
  const overlay = $('#overlay');
  const log = h('pre', { class: 'fixlog' });
  const status = h('span', { class: 'fh' }, 'Running…');
  const stopBtn = h('button', { class: 'btn', onclick: () => api.toolkit.stop() }, 'Stop');
  const closeBtn = h('button', { class: 'btn primary', disabled: true, onclick: () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; render(); } }, 'Close');
  overlay.innerHTML = '';
  overlay.onclick = null;
  overlay.append(h('div', { class: 'sheet confirm wide', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'confirm-body' }, h('p', { class: 'eyebrow' }, 'Installing'), h('h2', null, row.part),
      h('p', { class: 'fh' }, 'This runs the toolkit’s installer for one part. It never removes what you have. Large parts can take several minutes.'), log),
    h('div', { class: 'sheet-foot' }, status, h('span', { class: 'grow' }), stopBtn, closeBtn)));
  overlay.classList.remove('hidden');
  const off = api.toolkit.onLog(d => { log.textContent += d.line + '\n'; if (log.textContent.length > 200000) log.textContent = log.textContent.slice(-150000); log.scrollTop = log.scrollHeight; });
  try {
    const { code, result } = await api.toolkit.fix(row.fix);
    state.kit = result;
    const after = result.rows.find(r => r.part === row.part);
    status.textContent = after && after.status === 'ok' ? 'Done. It is ready now.' : code === 0 ? 'Finished. The check still shows it as not ready; read the log above.' : `Stopped with code ${code}. Read the log above.`;
  } catch (err) {
    status.textContent = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  } finally {
    off();
    stopBtn.remove();
    closeBtn.disabled = false;
    renderSidebar();
  }
}

/* ---------- agents: logos, connected state, one-click connect ---------- */
const AGENT_MARK = { claude: 'C', codex: 'X', cursor: 'Cu', grok: 'G', antigravity: 'A', opencode: 'O' };
function agentLogo(id) { return h('span', { class: 'agent-logo ' + id }, AGENT_MARK[id] || String(id).slice(0, 1).toUpperCase()); }
function agentStateText(a) {
  if (!a.installed) return 'Not installed';
  if (a.connected === true) return `Connected${a.account ? ' · ' + a.account : ''}`;
  if (a.connected === false) return 'Not connected';
  return `${a.vendor} · ${a.version || 'installed'}`;
}
const connecting = new Set();
async function connectAgent(a) {
  if (connecting.has(a.id)) return;
  connecting.add(a.id); render();
  if (a.loginKind === 'browser') toast(`Your browser opens ${a.vendor}’s sign-in page. Sign in, allow access, then come back here.`, 8000);
  else toast(`A Terminal window opens with the ${a.name} sign-in. Follow it there, then click Check again.`, 8000);
  try {
    const r = await api.agents.login(a.id);
    state.env.agents = r.agents;
    const now = r.agents.find(x => x.id === a.id);
    if (r.terminal) { /* the person finishes in Terminal */ }
    else if (now && now.connected) toast(`${a.name} is connected.`);
    else toast(`${a.name} did not finish signing in. Try Connect again.`, 6000);
  } catch (err) {
    toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 6000);
  } finally { connecting.delete(a.id); render(); }
}
function agentRow(a, s, set) {
  let right;
  if (!a.installed) right = h('button', { class: 'btn small', onclick: () => api.os.openExternal(a.docs) }, 'How to install ↗');
  else if (connecting.has(a.id)) right = h('span', { class: 'row-gap', style: { marginTop: 0 } }, h('span', { class: 'conn wait' }, h('span', { class: 'kdot' }), 'Waiting for sign-in…'),
    h('button', { class: 'btn small ghost', onclick: () => api.agents.cancelLogin() }, 'Cancel'));
  else if (a.connected === false) right = h('button', { class: 'btn small coral', onclick: () => connectAgent(a) }, 'Connect');
  else right = h('span', { class: 'row-gap', style: { marginTop: 0, alignItems: 'center' } },
    a.connected ? h('span', { class: 'conn ok' }, h('span', { class: 'kdot' }), 'Connected') : h('button', { class: 'btn small ghost', onclick: () => connectAgent(a), title: 'This agent cannot report its sign-in. Sign in again if it asks.' }, 'Sign in'),
    s.engine === a.id ? h('span', { class: 'pill on' }, 'Default') : h('button', { class: 'btn small', onclick: () => set({ engine: a.id }) }, 'Make default'));
  const codeBox = connecting.has(a.id) && a.loginKind === 'browser' ? (() => {
    const input = h('input', { type: 'password', class: 'code-input', placeholder: 'Paste the code here', autocomplete: 'off', spellcheck: 'false' });
    const send = async () => {
      const v = input.value.trim();
      if (!v) { input.focus(); return; }
      input.value = '';
      const ok = await api.agents.loginCode(v);
      toast(ok ? 'Code sent. Finishing sign-in…' : 'The sign-in is no longer waiting. Click Connect again.', 5000);
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
    return h('div', { class: 'code-box' },
      h('div', { class: 'fh' }, `If ${a.vendor}’s page shows an authentication code, click Copy code there, paste it here and press Enter.`),
      h('div', { class: 'row-gap' }, input, h('button', { class: 'btn small primary', onclick: send }, 'Finish sign-in')));
  })() : null;
  const sub = !a.installed ? h('div', { style: { fontSize: '13px', marginTop: '4px' } }, 'Install in a terminal: ', h('code', null, a.installHint))
    : a.connected === false ? h('div', { class: 'fh' }, a.loginKind === 'browser' ? `Connect opens ${a.vendor}’s page. Sign in with your ${a.plan} plan and allow access.` : `Connect opens a Terminal window with the sign-in. Use your ${a.plan} account.`)
    : a.connected ? h('div', null, h('div', { class: 'fh' }, `Uses your own ${a.plan} plan.`),
      h('div', { class: 'row-gap settings-model' }, h('span', { class: 'fh', style: { margin: 0 } }, 'Model and reasoning:'), modelPicker({ engine: a.id, up: false })))
    : h('div', { class: 'fh' }, 'Installed. It cannot report whether it is signed in; if a reply asks you to sign in, click Sign in.');
  return h('div', { class: 'agent-row' + (a.connected ? ' is-on' : '') }, agentLogo(a.id),
    h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, a.name, ' ',
      a.beta ? h('span', { class: 'beta' }, 'beta') : null,
      h('span', { style: { color: 'var(--label)', fontWeight: 400 } }, a.installed ? ` · ${a.version || 'installed'}` : ' · not installed')), sub, codeBox),
    right);
}
