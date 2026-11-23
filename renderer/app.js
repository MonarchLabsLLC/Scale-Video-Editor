/* Scale Video Editor: the window. Plain DOM, no framework, so anyone can read and change it. */
'use strict';

const api = window.sve;
const FORMATS = window.SVE_FORMATS || [];
const CATS = window.SVE_CATEGORIES || [];
const TICKS = 254016000000;

const state = {
  env: null,
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
    let list = null, para = [];
    const flush = () => { if (para.length) { out += `<p>${inline(para.join(' '))}</p>`; para = []; } };
    const close = () => { if (list) { out += `</${list}>`; list = null; } };
    for (const line of lines) {
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
async function refreshFc() {
  try { state.fc = await api.filmcraft.status(); } catch { state.fc = null; }
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
  else if (v === 'settings') main.append(viewSettings());
  else if (v === 'filmcraft') main.append(viewFilmcraft());
  else if (v === 'tools') main.append(viewTools());
  else if (v === 'setup') main.append(viewSetup());
  else main.append(viewHome());
}

/* ---------- sidebar ---------- */
function renderSidebar() {
  document.querySelectorAll('.nav-item[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === state.route.view));
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
  const page = h('div', { class: 'page' },
    h('div', { class: 'topdrag' }),
    setupBanner(),
    h('p', { class: 'eyebrow' }, 'Scale Video Editor'),
    h('h1', { class: 'hero', html: 'Any video you can <em>describe.</em>' }),
    h('p', { class: 'lede' }, 'Say what you want to make. Your agent picks the tools and builds it while you watch, and FilmCraft holds the timeline.'),
    composer({
      key: 'home', big: true, footLeft: picker,
      placeholder: 'Describe your video, or pick a kind of video below. Drop footage, a script or a screenshot here.',
      onSubmit: (text, files) => startProject({ name: nameFrom(text), engine: chosen, prompt: text, attachments: files })
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
      h('button', { class: 'btn small', title: 'Start a project with this sentence', onclick: () => startProject({ name: f.name, engine: state.env?.settings?.engine || 'claude', format: f.id, prompt: f.ask }) }, 'Use this sentence'),
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

/* ---------- interview ---------- */
function openInterview(f) {
  const qs = window.SVEBrief.parse(f.brief);
  const answers = {};
  let engine = state.env?.settings?.engine || 'claude';
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
    startProject({ name: f.name, engine, format: f.id, prompt: fast ? prompt + '\n\nWhere I left a choice open, choose for me and say what you chose.' : prompt });
  };
  let picker;
  const onPick = id => { engine = id; const next = agentPicker({ value: id, onChange: onPick }); picker.replaceWith(next); picker = next; };
  picker = agentPicker({ value: engine, onChange: onPick });
  const sheet = h('div', { class: 'sheet', role: 'dialog' },
    h('div', { class: 'sheet-top' },
      h('div', { class: 'frame', style: toneStyle(toneFor(f)), html: window.SVE_ART(f.art) }),
      h('div', null, h('p', { class: 'eyebrow' }, f.shape), h('h2', null, f.name), h('p', null, f.blurb)),
      h('button', { class: 'sheet-close', onclick: close, title: 'Close' }, '×')),
    body,
    h('div', { class: 'sheet-foot' }, picker, h('span', { class: 'grow' }),
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
  const p = await api.projects.create({ name: 'Untitled', engine });
  await refreshProjects();
  go({ view: 'project', id: p.id });
}

async function startProject({ name, engine, format, prompt, attachments }) {
  if (!agentInfo(engine).installed) { go({ view: 'settings' }); toast(`${agentInfo(engine).name} is not installed yet.`); return; }
  const p = await api.projects.create({ name, engine, format });
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
      footLeft: picker
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
  if (!r.ok) toast(r.reason, 6000); else toast(r.already ? 'FilmCraft is connected.' : 'FilmCraft is open and connected.');
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
    h('div', { class: 'section-head', style: { marginTop: '8px' } }, h('h2', { class: 'section' }, 'Agents')),
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
    updateSection(),
    h('div', { class: 'section-head' }, h('h2', { class: 'section' }, 'Projects folder')),
    h('div', { class: 'field' }, h('div', null, env.projectsRoot), h('div', { class: 'fh' }, 'Each project is a normal folder with media, work and exports inside.')),
    h('p', { style: { color: 'var(--label)', marginTop: '40px', fontSize: '12px' } }, `Scale Video Editor ${env.version || ''} · open source · FilmCraft is a separate Apache-2.0 project by storytold.`));
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
  slot.append(h('div', { class: 'update-card' },
    h('p', { class: 'label-sm' }, u.status === 'ready' ? 'Update ready' : 'Update available'),
    h('p', { class: 'update-msg' }, u.message),
    updateActions(u, true)));
}
function updateSection() {
  const u = state.update || { status: 'idle', current: state.env?.version || '' };
  return [
    h('div', { class: 'section-head' }, h('h2', { class: 'section' }, 'Updates')),
    h('div', { class: 'field' },
      h('div', null, `Scale Video Editor ${u.current || state.env?.version || ''}`),
      h('div', { class: 'fh' }, u.message || 'The editor checks for a new version every time it starts.'),
      u.checkedAt ? h('div', { class: 'fh' }, `Last checked ${ago(u.checkedAt)} ago.`) : null,
      h('div', { class: 'row-gap' }, updateActions(u, false)))
  ];
}

(async function init() {
  api.update.get().then(u => { state.update = u; drawUpdateSlot(); });
  api.update.onState(u => { state.update = u; drawUpdateSlot(); if (state.route.view === 'settings') render(); });
  api.onNav(r => go(r));
  $('#guideNav')?.addEventListener('click', () => guide.open ? closeGuide() : openGuide());
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && guide.open && !$('#overlay:not(.hidden)')) closeGuide(); });
  await Promise.all([refreshEnv(), refreshProjects()]);
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
})();

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
  try { state.kit = await api.toolkit.check(); } catch (err) { state.kit = { found: false, error: String(err.message || err), rows: [] }; }
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
  if (r.file) actions.push(h('button', { class: 'btn small primary', onclick: async () => { const e = await api.toolkit.openFile(r.file); if (e) toast(e, 5000); } }, 'Open voice.json'));
  let detail = r.detail.replace(/;?\s*run: .*$/, '').replace(/^you run: .*$/, '');
  if (r.youRun) detail = 'Add it yourself in Terminal: the command asks for the key and keeps it in your Mac’s Keychain. The editor never sees it.';
  if (r.file) detail = 'Paste your ElevenLabs voice ID into voice_id in this file and save. A voice ID is not a secret.';
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
    need.length ? [h('div', { class: 'section-head' }, h('h2', { class: 'section' }, `Needs you (${need.length})`)), h('div', { class: 'slist' }, need.map(kitLine))] : null,
    optional.length ? [h('div', { class: 'section-head' }, h('h2', { class: 'section' }, `Optional (${optional.length})`)),
      h('p', { class: 'fh', style: { marginTop: '-6px' } }, 'Install these when you want the kind of video they make.'), h('div', { class: 'slist' }, optional.map(kitLine))] : null,
    ok.length ? h('details', { class: 'sready' }, h('summary', null, `Ready (${ok.length})`), h('div', { class: 'slist' }, ok.map(kitLine))) : null,
    kit?.summary ? h('p', { class: 'fh', style: { marginTop: '24px' } }, 'Toolkit check: ', kit.summary) : null);
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
  const sub = !a.installed ? h('div', { style: { fontSize: '13px', marginTop: '4px' } }, 'Install in a terminal: ', h('code', null, a.installHint))
    : a.connected === false ? h('div', { class: 'fh' }, a.loginKind === 'browser' ? `Connect opens ${a.vendor}’s page. Sign in with your ${a.plan} plan and allow access.` : `Connect opens a Terminal window with the sign-in. Use your ${a.plan} account.`)
    : a.connected ? h('div', { class: 'fh' }, `Uses your own ${a.plan} plan.`)
    : h('div', { class: 'fh' }, 'Installed. It cannot report whether it is signed in; if a reply asks you to sign in, click Sign in.');
  return h('div', { class: 'agent-row' + (a.connected ? ' is-on' : '') }, agentLogo(a.id),
    h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, a.name, ' ',
      a.beta ? h('span', { class: 'beta' }, 'beta') : null,
      h('span', { style: { color: 'var(--label)', fontWeight: 400 } }, a.installed ? ` · ${a.version || 'installed'}` : ' · not installed')), sub),
    right);
}
