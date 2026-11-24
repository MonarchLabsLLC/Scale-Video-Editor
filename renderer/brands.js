/* Scale Video Editor: Brand Guides. A person adds their design guide (DESIGN.md) once, from a file,
   a link or a scan of their website, and picks it for a video. The agent then makes that video in the
   style of the guide. Loaded after app.js and uses its helpers (h, api, state, go, render, toast). */
'use strict';

state.brands = null;        // the saved guides
state.brandDetail = null;   // the guide open on its own page
state.brandBusy = '';       // what is being added right now
state.brandUrl = '';        // the link box draft
state.homeBrand = undefined; // the brand picked on Home (undefined = the default from Settings)

async function refreshBrands() {
  try { state.brands = await api.brands.list(); } catch { state.brands = []; }
}
const cleanErr = err => String(err && err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const brandByUid = uid => (state.brands || []).find(b => b.uid === uid) || null;
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || ''); } };
const fmtDate = ms => new Date(ms || Date.now()).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
function sourceText(b) {
  const s = b.source || {};
  if (s.kind === 'site') return `Made from ${hostOf(s.label)}`;
  if (s.kind === 'link') return `From ${hostOf(s.label)}`;
  return s.label ? `From ${s.label}` : 'Added by you';
}
function defaultBrand() { return state.env?.settings?.brand || ''; }
function homeBrand() { const v = state.homeBrand === undefined ? defaultBrand() : state.homeBrand; return brandByUid(v) ? v : ''; }

const BRAND_SOURCES = [
  { name: 'BrandBaser', where: 'brandbaser.com/brand-kits', url: 'https://brandbaser.com/brand-kits', how: 'Open Brand Kits, open your kit, and click Download DESIGN.md file.', tone: 'pink' },
  { name: 'ClickCampaigns', where: 'clickcampaigns.ai/welcome', url: 'https://clickcampaigns.ai/welcome', how: 'Click Brand Kits on the main dashboard, open your kit, and click Download DESIGN.md file.', tone: 'lilac' },
  { name: 'PageBuilder templates', where: 'pagebuilder.gg', url: 'https://pagebuilder.gg/?library=templates', how: 'Pick a template whose look you like and download its DESIGN.md.', tone: 'mint' },
  { name: 'getdesign.md', where: 'getdesign.md', url: 'https://getdesign.md/', how: 'Design guides inspired by well-known websites. Paste the link to one here, or download its file.', tone: 'cream' }
];
const BRAND_USES = ['Title cards', 'Lower thirds', 'Captions', 'Charts', 'Animated text', 'Explainers', 'End cards'];

/* ---------- small parts ---------- */
function swatches(colors, n = 6) {
  return h('span', { class: 'swatches' }, (colors || []).slice(0, n).map(c => h('span', { class: 'sw', style: { background: c.hex }, title: c.hex })));
}
function brandStripe(colors) {
  const cs = (colors || []).filter(c => c.hex).slice(0, 4);
  return h('div', { class: 'bstripe' }, cs.length ? cs.map(c => h('span', { style: { background: c.hex } })) : h('span', { style: { background: 'var(--soft)' } }));
}
function brandMark(b, cls = '') {
  return h('span', { class: 'bmark ' + cls }, b.logoPath ? h('img', { src: api.mediaUrl(b.logoPath), alt: '' }) : (b.name || '?').slice(0, 1).toUpperCase());
}
function popMenu(btn, items) {
  closeMenus();
  const m = h('div', { class: 'pop-menu menu' }, items.map(it => it === '-' ? h('div', { class: 'menu-sep' })
    : h('button', { class: 'menu-item' + (it.danger ? ' danger' : ''), onclick: ev => { ev.stopPropagation(); closeMenus(); it.run(); } }, it.label)));
  document.body.append(m);
  const r = btn.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.right - mw, innerWidth - mw - 8)) + 'px';
  m.style.top = (r.bottom + 6 + mh > innerHeight ? r.top - mh - 6 : r.bottom + 6) + 'px';
}
function brandMenuItems(b) {
  const isDefault = defaultBrand() === b.uid;
  return [
    { label: 'Open', run: () => go({ view: 'brand', id: b.id }) },
    { label: 'Make a video with it', run: () => useBrand(b) },
    { label: isDefault ? 'Stop using as default' : 'Use for every new video', run: () => setDefaultBrand(isDefault ? '' : b.uid) },
    '-',
    { label: 'Rename…', run: () => nameBrandDialog(b) },
    { label: 'Duplicate', run: () => duplicateBrand(b) },
    { label: 'Show in Finder', run: () => api.os.reveal(b.file) },
    '-',
    { label: 'Delete…', danger: true, run: () => confirmDeleteBrand(b) }
  ];
}
function brandMoreButton(b) {
  const btn = h('button', { class: 'more-btn', title: 'More', 'aria-label': `More for ${b.name}`, html: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>' });
  btn.addEventListener('click', e => { e.stopPropagation(); popMenu(btn, brandMenuItems(b)); });
  return btn;
}

/* ---------- the Brand Guides page ---------- */
function viewBrands() {
  if (state.brandTab === 'knowledge') return viewKnowledge();
  if (!state.brands) refreshBrands().then(() => { if (state.route.view === 'brands') render(); });
  const list = state.brands || [];
  const busy = !!state.brandBusy;
  const input = h('input', { type: 'text', class: 'burl', placeholder: 'yoursite.com, or a link to a DESIGN.md', spellcheck: 'false', disabled: busy, 'aria-label': 'Website or link' });
  input.value = state.brandUrl;
  input.addEventListener('input', () => { state.brandUrl = input.value; });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') addBrandFromUrl(input.value); });
  const addBox = h('div', { class: 'badd' + (busy ? ' busy' : '') },
    h('span', { class: 'bicon', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' }),
    input,
    h('button', { class: 'btn', disabled: busy, onclick: async () => { const f = await api.brands.pickFile(); if (f) addBrandFromFile(f); } }, 'Upload a file'),
    h('button', { class: 'btn coral', disabled: busy, onclick: () => addBrandFromUrl(input.value) }, 'Scan my site'));
  addBox.addEventListener('dragover', e => { e.preventDefault(); addBox.classList.add('drop'); });
  addBox.addEventListener('dragleave', () => addBox.classList.remove('drop'));
  addBox.addEventListener('drop', e => {
    e.preventDefault(); addBox.classList.remove('drop');
    const f = e.dataTransfer.files[0];
    const p = f && api.os.pathForFile(f);
    if (p) addBrandFromFile(p);
  });
  if (!busy) setTimeout(() => { if (!state.brandUrl && state.route.view === 'brands') input.focus(); }, 0);

  return h('div', { class: 'page brands-page' }, h('div', { class: 'topdrag' }),
    brandTabs('style'),
    h('div', { class: 'bhero' },
      h('p', { class: 'eyebrow' }, 'Brand Guides'),
      h('h1', { class: 'hero', html: 'Every video, in <em>your brand.</em>' }),
      h('p', { class: 'lede' }, 'Add your brand’s design guide once. Pick it for a video, and your agent makes that video in the style of the guide: its colors, fonts, shapes and logo.'),
      addBox,
      h('p', { class: 'bformats' }, 'Upload .md, .txt, .rtf, .doc, .docx, .pdf or .html, drop a file on the box, or paste a link. No design guide? Type your website and we make one from it.'),
      busy ? h('div', { class: 'bbusy' }, h('span', { class: 'spin' }), state.brandBusy) : null),
    h('div', { class: 'binfo' },
      h('div', { class: 'binfo-card uses' },
        h('p', { class: 'label-sm' }, 'What it is for'),
        h('h3', null, 'Videos that look like your brand.'),
        h('p', null, 'The agent uses the guide for everything it designs. It works best for motion graphics: title cards, lower thirds, captions, charts, animated text, explainers and end cards.'),
        h('div', { class: 'buse-chips' }, BRAND_USES.map(t => h('span', { class: 'pill' }, t)))),
      h('div', { class: 'binfo-card note' },
        h('p', { class: 'label-sm' }, 'Only the design guide here'),
        h('h3', null, 'Your brand knowledge has its own tab.'),
        h('p', null, 'A design guide, often a file named DESIGN.md, holds your colors, fonts, logo and layout rules. Your brand knowledge documents, with your story, offers and audience, go in the Brand knowledge tab.'),
        h('button', { class: 'btn small', style: { marginTop: '10px' }, onclick: () => { state.brandTab = 'knowledge'; go({ view: 'brands' }); } }, 'Open Brand knowledge'))),
    h('section', null,
      sectionHead('Your brand guides', list.length ? `${list.length} saved on this computer.` : 'None yet.', list.length ? 'Kept on this computer, in the Brand Guides folder next to your projects.' : null),
      list.length
        ? h('div', { class: 'bgrid' }, list.map(brandCard))
        : h('div', { class: 'bempty' }, h('strong', null, 'Add your first brand guide above.'), h('p', null, 'Upload your DESIGN.md, paste a link, or scan your website.'))),
    h('section', null,
      sectionHead('Where to get one', 'Already have a brand kit? Download its design guide.', 'Then upload the file here. Each of these gives you a DESIGN.md.'),
      h('div', { class: 'bsources' }, BRAND_SOURCES.map(s => h('div', { class: 'bsource' },
        h('span', { class: 'bs-chip', style: toneStyle(s.tone) }, s.name.slice(0, 1)),
        h('div', { class: 'bs-main' }, h('strong', null, s.name), h('span', { class: 'bs-where' }, s.where), h('p', null, s.how)),
        h('button', { class: 'btn small', onclick: () => api.os.openExternal(s.url) }, 'Open ↗'))))));
}

function brandCard(b) {
  const isDefault = defaultBrand() === b.uid;
  const open = () => go({ view: 'brand', id: b.id });
  return h('div', { class: 'bcard', role: 'button', tabindex: '0', onclick: open, onkeydown: e => { if (e.key === 'Enter') open(); } },
    brandStripe(b.colors),
    h('div', { class: 'card-actions' }, brandMoreButton(b)),
    h('div', { class: 'bbody' },
      brandMark(b),
      h('div', { class: 'bname' }, b.name),
      h('p', { class: 'bdesc' }, b.description || sourceText(b)),
      h('div', { class: 'btags' },
        b.needsGuide ? h('span', { class: 'tag warn' }, 'Needs a design guide') : h('span', { class: 'tag ok' }, 'Design guide'),
        b.source?.kind === 'site' ? h('span', { class: 'tag' }, 'From your website') : null,
        isDefault ? h('span', { class: 'tag coral' }, 'Default') : null),
      h('div', { class: 'bfoot' }, swatches(b.colors, 5), h('span', { class: 'bwhen' }, `Updated ${fmtDate(b.updated)}`))));
}

/* ---------- one brand guide ---------- */
// Font samples sit on the guide's own background, in its own text color, so a dark brand reads too.
function fontBoxStyle(colors) {
  const find = re => (colors.find(c => re.test(c.name)) || {}).hex;
  const bg = find(/^(canvas|background|bg|surface|paper)/i);
  const ink = find(/^(ink|text|on-canvas|on-background|foreground|fg)$/i) || find(/^(ink|text)/i);
  return bg && ink ? { background: bg, color: ink } : null;
}
function viewBrand(id) {
  const b = state.brandDetail && state.brandDetail.id === id ? state.brandDetail : null;
  if (!b) {
    api.brands.get(id).then(g => { state.brandDetail = g; if (state.route.view === 'brand') render(); })
      .catch(() => go({ view: 'brands' }));
    return h('div', { class: 'page' }, h('div', { class: 'topdrag' }));
  }
  const isDefault = defaultBrand() === b.uid;
  const text = String(b.text || '');
  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  const bodyMd = fm ? text.slice(fm[0].length) : text;
  const colors = b.colors || [];
  return h('div', { class: 'page brand-page' }, h('div', { class: 'topdrag' }),
    h('button', { class: 'crumb', onclick: () => go({ view: 'brands' }) }, '← All brand guides'),
    h('div', { class: 'bdhead' },
      h('div', { class: 'bdcover' }, brandStripe(colors), brandMark(b, 'big')),
      h('div', { class: 'bdtitle' },
        h('p', { class: 'eyebrow' }, 'Brand guide'),
        h('h1', null, b.name),
        h('p', { class: 'bdsrc' }, `${sourceText(b)} · updated ${fmtDate(b.updated)}`)),
      h('div', { class: 'bdactions' },
        h('button', { class: 'btn primary', onclick: () => useBrand(b) }, 'Make a video with it →'),
        h('button', { class: 'btn' + (isDefault ? ' on' : ''), onclick: () => setDefaultBrand(isDefault ? '' : b.uid) }, isDefault ? '✓ Default for new videos' : 'Use for every new video'),
        brandMoreButton(b))),
    b.needsGuide ? h('div', { class: 'bwarn' }, h('strong', null, 'This does not look like a design guide.'),
      h('p', null, 'We found no colors or fonts in it. It may be a brand knowledge document. Add your design guide instead: the DESIGN.md with your colors, fonts and logo. You can delete this one.')) : null,
    h('div', { class: 'bdgrid' },
      h('section', { class: 'bdpanel' },
        h('h3', null, 'Colors'),
        colors.length
          ? h('div', { class: 'bcolors' }, colors.map(c => h('button', { class: 'bcolor', title: 'Copy ' + c.hex, onclick: () => copyText(c.hex) },
            h('span', { class: 'chip', style: { background: c.hex } }), h('span', { class: 'cname' }, c.name || 'Color'), h('span', { class: 'chex' }, c.hex))))
          : h('p', { class: 'muted' }, 'No colors found.')),
      h('section', { class: 'bdpanel' },
        h('h3', null, 'Fonts'),
        (b.fonts || []).length
          ? h('div', { class: 'bfont-box', style: fontBoxStyle(colors) }, (b.fonts || []).map((f, i) => h('div', { class: 'bfont' },
            h('div', { class: 'bfont-sample', style: { fontFamily: `"${f}", var(--sans)` } }, i ? 'Every video, in your brand.' : 'Aa Bb Cc 123'),
            h('div', { class: 'bfont-name' }, i ? `Also ${f}` : f))))
          : h('p', { class: 'muted' }, 'No fonts found.'),
        h('p', { class: 'fh' }, 'A sample only. A font this computer does not have shows in a close match.')),
      b.logoPath ? h('section', { class: 'bdpanel' }, h('h3', null, 'Logo'), h('div', { class: 'blogo' }, h('img', { src: api.mediaUrl(b.logoPath), alt: `${b.name} logo` }))) : null),
    h('section', { class: 'bdpanel wide' },
      h('div', { class: 'bdpanel-head' }, h('h3', null, 'Design guide'),
        h('button', { class: 'btn small ghost', onclick: () => api.os.reveal(b.file) }, 'Show DESIGN.md in Finder')),
      b.description ? h('p', { class: 'bddesc' }, b.description) : null,
      (b.sections || []).length ? h('div', { class: 'bcovers' }, h('span', { class: 'label-sm' }, 'What it covers'), (b.sections || []).map(s => h('span', { class: 'tag' }, s))) : null,
      h('details', { class: 'bfull' }, h('summary', null, 'Read the full design guide'),
        fm ? h('pre', { class: 'btokens' }, fm[1]) : null,
        h('div', { class: 'md', html: md(bodyMd) }))));
}

/* ---------- actions ---------- */
async function addBrandFromFile(file) {
  await runBrandImport(`Reading ${basename(file)}…`, () => api.brands.importFile(file));
}
async function addBrandFromUrl(text) {
  const t = String(text || '').trim();
  if (!t) { toast('Type your website, or paste a link to a DESIGN.md.'); return; }
  const fileLink = /\.(md|markdown|txt|pdf)(\?|#|$)/i.test(t) || /getdesign\.md|github\.com/i.test(t);
  await runBrandImport(fileLink ? `Getting ${t}…` : `Scanning ${t} for its colors, fonts and logo. This takes about ten seconds…`, () => api.brands.importUrl(t));
}
async function runBrandImport(msg, fn) {
  if (state.brandBusy) return;
  state.brandBusy = msg;
  render();
  try {
    const g = await fn();
    state.brandBusy = '';
    state.brandUrl = '';
    await refreshBrands();
    state.brandDetail = null;
    go({ view: 'brand', id: g.id });
    nameBrandDialog(g, true);
  } catch (err) {
    state.brandBusy = '';
    render();
    toast(cleanErr(err), 7000);
  }
}

function nameBrandDialog(b, isNew) {
  const overlay = $('#overlay');
  const close = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; };
  const input = h('input', { type: 'text', value: b.name, maxlength: 60 });
  const save = async () => {
    const name = input.value.trim();
    if (!name || name === b.name) { close(); return; }
    try {
      const next = await api.brands.rename(b.id, name);
      close();
      await refreshBrands();
      state.brandDetail = null;
      if (state.route.view === 'brand') go({ view: 'brand', id: next.id }); else render();
    } catch (err) { toast(cleanErr(err)); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') close(); });
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.innerHTML = '';
  overlay.append(h('div', { class: 'sheet confirm', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'confirm-body' },
      h('p', { class: 'eyebrow' }, isNew ? 'Brand guide added' : 'Rename brand guide'),
      h('h2', null, isNew ? 'Name this brand guide' : 'A new name'),
      isNew && b.warning ? h('p', { class: 'warn-text' }, b.warning) : null,
      h('div', { class: 'field' }, input, h('div', { class: 'fh' }, 'This is the name you pick it by when you make a video.'))),
    h('div', { class: 'sheet-foot' }, h('span', { class: 'grow' }),
      h('button', { class: 'btn', onclick: close }, isNew ? 'Keep this name' : 'Cancel'),
      h('button', { class: 'btn primary', onclick: save }, 'Save'))));
  overlay.classList.remove('hidden');
  input.focus(); input.select();
}

async function duplicateBrand(b) {
  try { const c = await api.brands.duplicate(b.id); await refreshBrands(); render(); toast(`Made “${c.name}”.`); }
  catch (err) { toast(`Could not duplicate: ${cleanErr(err)}`); }
}

function confirmDeleteBrand(b) {
  const overlay = $('#overlay');
  const close = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; };
  overlay.onclick = e => { if (e.target === overlay) close(); };
  const del = h('button', { class: 'btn danger', onclick: async () => {
    close();
    try { await api.brands.trash(b.id); } catch (err) { toast(`Could not delete: ${cleanErr(err)}`); return; }
    if (defaultBrand() === b.uid) await setDefaultBrand('', true);
    if (state.homeBrand === b.uid) state.homeBrand = undefined;
    await refreshBrands();
    state.brandDetail = null;
    go({ view: 'brands' });
    toast(`Moved “${b.name}” to the Trash.`);
  } }, 'Delete brand guide');
  overlay.innerHTML = '';
  overlay.append(h('div', { class: 'sheet confirm', role: 'alertdialog', 'aria-modal': 'true' },
    h('div', { class: 'confirm-body' }, h('p', { class: 'eyebrow' }, 'Delete brand guide'), h('h2', null, `Delete “${b.name}”?`),
      h('p', null, 'The guide folder moves to your computer’s Trash. Videos you already made keep their copy of it.')),
    h('div', { class: 'sheet-foot' }, h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), del)));
  overlay.classList.remove('hidden');
  del.focus();
}

async function setDefaultBrand(uid, quiet) {
  state.env.settings = await api.setSettings({ brand: uid });
  state.homeBrand = undefined;
  if (!quiet) { render(); toast(uid ? `New videos use “${brandByUid(uid)?.name}”. You can change it under the prompt box.` : 'New videos start with no brand guide.'); }
}

function useBrand(b) {
  state.homeBrand = b.uid;
  go({ view: 'home' });
  toast(`“${b.name}” is picked. Describe your video, or pick a kind of video below.`, 4500);
}

/* ---------- the brand picker (under the prompt box) ---------- */
function brandPicker({ value, onChange, up = true }) {
  const wrap = h('div', { class: 'agent-pick brand-pick' });
  const cur = brandByUid(value);
  const btn = h('button', { class: 'mini-select', type: 'button', title: 'Choose a brand guide for this video' },
    cur ? swatches(cur.colors, 3) : h('span', { class: 'nobrand' }, '◌'),
    h('span', null, cur ? cur.name : 'No brand'), h('span', { style: { opacity: .5 } }, '▾'));
  wrap.append(btn);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = wrap.querySelector('.menu');
    if (open) { open.remove(); return; }
    const menu = h('div', { class: 'menu' + (up ? '' : ' down') });
    const pick = uid => ev => { ev.stopPropagation(); menu.remove(); onChange(uid); };
    menu.append(h('button', { class: 'menu-item', type: 'button', onclick: pick('') },
      h('span', { class: 'nobrand big' }, '◌'),
      h('span', null, h('div', { class: 'mi-name' }, 'No brand'), h('div', { class: 'mi-sub' }, 'The agent chooses the look.')),
      !cur ? h('span', { class: 'mi-check' }, '✓') : null));
    for (const b of state.brands || []) {
      menu.append(h('button', { class: 'menu-item', type: 'button', onclick: pick(b.uid) },
        brandMark(b, 'small'),
        h('span', null, h('div', { class: 'mi-name' }, b.name), h('div', { class: 'mi-sub' }, swatches(b.colors, 6), b.fonts?.[0] ? ' ' + b.fonts[0] : '')),
        cur && cur.uid === b.uid ? h('span', { class: 'mi-check' }, '✓') : null));
    }
    menu.append(h('div', { class: 'menu-sep' }), h('button', { class: 'menu-item', type: 'button', onclick: () => go({ view: 'brands' }) },
      h('span', { class: 'mi-sub' }, (state.brands || []).length ? 'Manage brand guides…' : 'Add a brand guide…')));
    wrap.append(menu);
    fitMenu(menu, btn);
    const close = () => { menu.remove(); document.removeEventListener('click', close); };
    setTimeout(() => document.addEventListener('click', close), 0);
  });
  return wrap;
}
