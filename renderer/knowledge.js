/* Brand knowledge documents (BrandBaser documents and the like): a library of what a business is,
   who it serves, its offers, story and voice. Attach any of them to a project and the agent writes
   from those facts, and fills sample scripts (Mad Libs) with them. Loaded after app.js and brands.js. */

async function refreshKnowledge() {
  try { state.knowledge = await api.knowledge.list(); } catch { state.knowledge = state.knowledge || []; }
  return state.knowledge;
}
const knowledgeByUid = uid => (state.knowledge || []).find(k => k.uid === uid) || null;
// Knowledge picked on Home for the next new project (kept until changed, not saved).
function homeKnowledge() { return (state.homeKnowledge || []).filter(knowledgeByUid); }
const kWords = n => `${(n || 0).toLocaleString()} word${n === 1 ? '' : 's'}`;

// The two tabs at the top of Brand Guides: the look, and the words.
function brandTabs(on) {
  const tab = (id, label) => h('button', { class: 'tab' + (on === id ? ' on' : ''), onclick: () => { state.brandTab = id; go({ view: 'brands' }); } }, label);
  return h('div', { class: 'tabs-row' }, h('div', { class: 'tabs' }, tab('style', 'Style guides'), tab('knowledge', 'Brand knowledge')));
}

function viewKnowledge() {
  if (!state.knowledge) refreshKnowledge().then(() => { if (state.route.view === 'brands') render(); });
  const list = state.knowledge || [];
  const busy = !!state.knowledgeBusy;
  const addBox = h('div', { class: 'badd kadd' + (busy ? ' busy' : '') },
    h('span', { class: 'bicon', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>' }),
    h('span', { class: 'kadd-text' }, 'Drop documents here, or'),
    h('button', { class: 'btn', disabled: busy, onclick: async () => { const fs = await api.knowledge.pickFiles(); if (fs.length) addKnowledgeFiles(fs); } }, 'Upload documents'),
    h('button', { class: 'btn coral', disabled: busy, onclick: pasteKnowledgeDialog }, 'Paste text'));
  addBox.addEventListener('dragover', e => { e.preventDefault(); addBox.classList.add('drop'); });
  addBox.addEventListener('dragleave', () => addBox.classList.remove('drop'));
  addBox.addEventListener('drop', e => {
    e.preventDefault(); addBox.classList.remove('drop');
    const ps = [...e.dataTransfer.files].map(f => api.os.pathForFile(f)).filter(Boolean);
    if (ps.length) addKnowledgeFiles(ps);
  });
  return h('div', { class: 'page brands-page' }, h('div', { class: 'topdrag' }),
    brandTabs('knowledge'),
    h('div', { class: 'bhero' },
      h('p', { class: 'eyebrow' }, 'Brand knowledge'),
      h('h1', { class: 'hero', html: 'Every video, in <em>your words.</em>' }),
      h('p', { class: 'lede' }, 'Add your brand knowledge documents: your BrandBaser documents, offers, audience, story, proof and voice. Attach them to any project, and the agent writes from your real facts and fills sample scripts with them.'),
      addBox,
      h('p', { class: 'bformats' }, 'Upload .md, .txt, .rtf, .doc, .docx, .pdf or .html, several at once, or paste the text. Everything stays on this computer, in the Brand Knowledge folder next to your projects.'),
      busy ? h('div', { class: 'bbusy' }, h('span', { class: 'spin' }), state.knowledgeBusy) : null),
    h('div', { class: 'binfo' },
      h('div', { class: 'binfo-card uses' },
        h('p', { class: 'label-sm' }, 'How it is used'),
        h('h3', null, 'Pick documents for a project.'),
        h('p', null, 'Under the prompt box, click Knowledge and tick the documents this video should use. You can change them in a project at any time. The agent reads them before it writes a word.')),
      h('div', { class: 'binfo-card note' },
        h('p', { class: 'label-sm' }, 'Sample scripts'),
        h('h3', null, 'Your facts fill the blanks.'),
        h('p', null, 'Each Viral Videos format has a sample script with blanks, like a Mad Lib. The agent keeps the beats and the jokes and fills the blanks from your knowledge documents.'))),
    h('section', null,
      sectionHead('Your library', list.length ? `${list.length} document${list.length === 1 ? '' : 's'} saved.` : 'None yet.'),
      list.length
        ? h('div', { class: 'kgrid' }, list.map(knowledgeCard))
        : h('div', { class: 'bempty' }, h('strong', null, 'Add your first brand knowledge document above.'), h('p', null, 'A BrandBaser document, a one-page about-us, an offer sheet or a customer avatar all work.'))));
}

function knowledgeCard(k) {
  const open = () => go({ view: 'knowledge-doc', id: k.id });
  return h('div', { class: 'kcard', role: 'button', tabindex: '0', onclick: open, onkeydown: e => { if (e.key === 'Enter') open(); } },
    h('div', { class: 'kcard-top' }, h('span', { class: 'kicon', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l5 5v13H7z M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>' }), h('span', { class: 'label-sm' }, kWords(k.words))),
    h('h3', null, k.name),
    h('p', null, k.summary || 'No summary.'),
    h('span', { class: 'ksrc' }, `${k.source?.label || 'Pasted text'} · ${fmtDate(k.updated)}`));
}

async function addKnowledgeFiles(files) {
  let ok = 0; const errs = [];
  for (const [i, f] of files.entries()) {
    state.knowledgeBusy = `Reading ${basename(f)}${files.length > 1 ? ` (${i + 1} of ${files.length})` : ''}…`; render();
    try { await api.knowledge.importFile(f); ok++; } catch (err) { errs.push(`${basename(f)}: ${cleanErr(err)}`); }
  }
  state.knowledgeBusy = null;
  await refreshKnowledge(); render();
  if (ok) toast(`Added ${ok} document${ok === 1 ? '' : 's'} to your library.`);
  if (errs.length) toast(errs.join(' '), 8000);
}

function pasteKnowledgeDialog() {
  const overlay = $('#overlay');
  const name = h('input', { type: 'text', placeholder: 'Name, for example: Acme brand knowledge' });
  const text = h('textarea', { class: 'kpaste', placeholder: 'Paste your brand knowledge document here.' });
  const close = () => { overlay.classList.add('hidden'); overlay.innerHTML = ''; };
  const save = async () => {
    if (!text.value.trim()) { toast('Paste some text first.'); return; }
    try { await api.knowledge.saveText({ name: name.value, text: text.value }); close(); await refreshKnowledge(); render(); toast('Saved to your library.'); }
    catch (err) { toast(cleanErr(err), 6000); }
  };
  overlay.innerHTML = '';
  overlay.append(h('div', { class: 'sheet', role: 'dialog' },
    h('div', { class: 'sheet-top' }, h('div', null, h('p', { class: 'eyebrow' }, 'Brand knowledge'), h('h2', null, 'Paste a document')), h('button', { class: 'sheet-close', onclick: close, title: 'Close' }, '×')),
    h('div', { class: 'sheet-body' }, h('div', { class: 'q' }, h('label', { class: 'ql' }, 'Name'), name), h('div', { class: 'q' }, h('label', { class: 'ql' }, 'Text'), text)),
    h('div', { class: 'sheet-foot' }, h('span', { class: 'grow' }), h('button', { class: 'btn', onclick: close }, 'Cancel'), h('button', { class: 'btn primary', onclick: save }, 'Save'))));
  overlay.classList.remove('hidden');
  overlay.onclick = e => { if (e.target === overlay) close(); };
  setTimeout(() => name.focus(), 0);
}

function viewKnowledgeDoc(id) {
  const page = h('div', { class: 'page brands-page' }, h('div', { class: 'topdrag' }), h('p', { class: 'fh' }, 'Loading…'));
  api.knowledge.get(id).then(k => {
    page.innerHTML = '';
    let editing = false;
    const body = h('div');
    const draw = () => {
      body.innerHTML = '';
      if (editing) {
        const ta = h('textarea', { class: 'kpaste tall' }); ta.value = k.text;
        body.append(ta, h('div', { class: 'row', style: { marginTop: '12px', display: 'flex', gap: '10px' } },
          h('button', { class: 'btn primary', onclick: async () => { k = { ...k, ...(await api.knowledge.update(id, { text: ta.value })), text: ta.value }; editing = false; await refreshKnowledge(); draw(); toast('Saved.'); } }, 'Save'),
          h('button', { class: 'btn', onclick: () => { editing = false; draw(); } }, 'Cancel')));
      } else {
        body.append(h('pre', { class: 'ktext' }, k.text));
      }
    };
    draw();
    page.append(h('div', { class: 'topdrag' }),
      h('button', { class: 'btn small ghost', onclick: () => { state.brandTab = 'knowledge'; go({ view: 'brands' }); } }, '← Brand knowledge'),
      h('p', { class: 'eyebrow', style: { marginTop: '20px' } }, `Brand knowledge · ${kWords(k.words)}`),
      h('h1', { class: 'hero', style: { fontSize: '44px' } }, k.name),
      h('p', { class: 'lede' }, `${k.source?.label || 'Pasted text'} · added ${fmtDate(k.created)}`),
      h('div', { class: 'row', style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '18px' } },
        h('button', { class: 'btn coral', onclick: () => { state.homeKnowledge = [...new Set([...homeKnowledge(), k.uid])]; go({ view: 'home' }); toast(`“${k.name}” is attached to your next video.`); } }, 'Use for a new video'),
        h('button', { class: 'btn', onclick: () => { editing = true; draw(); } }, 'Edit text'),
        h('button', { class: 'btn', onclick: () => {
          const title = page.querySelector('h1.hero');
          const inp = h('input', { type: 'text', class: 'krename' }); inp.value = k.name;
          const save = async () => { const n = inp.value.trim(); if (n && n !== k.name) { k = { ...k, ...(await api.knowledge.update(id, { name: n })) }; await refreshKnowledge(); toast('Renamed.'); } title.textContent = k.name; inp.replaceWith(title); };
          inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') save(); if (ev.key === 'Escape') inp.replaceWith(title); });
          inp.addEventListener('blur', save);
          title.replaceWith(inp); inp.focus(); inp.select();
        } }, 'Rename'),
        h('button', { class: 'btn ghost', onclick: () => api.os.openPath(k.dir) }, 'Show folder'),
        h('button', { class: 'btn ghost danger', onclick: async () => {
          if (!confirm(`Move “${k.name}” to the Trash? Projects that used it keep their own copy.`)) return;
          await api.knowledge.trash(id); await refreshKnowledge(); state.brandTab = 'knowledge'; go({ view: 'brands' }); toast('Moved to the Trash.');
        } }, 'Delete')),
      body);
  }).catch(err => { page.innerHTML = ''; page.append(h('p', null, cleanErr(err))); });
  return page;
}

/* ---------- the knowledge picker (under the prompt box) ---------- */
function knowledgePicker({ value, onChange, up = true }) {
  const chosen = (value || []).filter(knowledgeByUid);
  const wrap = h('div', { class: 'agent-pick knowledge-pick' });
  const label = !chosen.length ? 'No knowledge' : chosen.length === 1 ? knowledgeByUid(chosen[0]).name : `Knowledge: ${chosen.length} docs`;
  const btn = h('button', { class: 'mini-select', type: 'button', title: 'Attach brand knowledge documents to this video' },
    h('span', { class: 'kdot' + (chosen.length ? ' on' : '') }, chosen.length ? '✓' : '◌'),
    h('span', { class: 'kpick-label' }, label), h('span', { style: { opacity: .5 } }, '▾'));
  wrap.append(btn);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = wrap.querySelector('.menu');
    if (open) { open.remove(); return; }
    const menu = h('div', { class: 'menu' + (up ? '' : ' down') });
    const set = new Set(chosen);
    const docs = state.knowledge || [];
    if (!docs.length) menu.append(h('div', { class: 'menu-item', style: { cursor: 'default' } }, h('span', null, h('div', { class: 'mi-name' }, 'No documents yet'), h('div', { class: 'mi-sub' }, 'Add your brand knowledge first.'))));
    for (const k of docs) {
      const item = h('button', { class: 'menu-item', type: 'button' },
        h('span', { class: 'kbox' + (set.has(k.uid) ? ' on' : '') }, set.has(k.uid) ? '✓' : ''),
        h('span', null, h('div', { class: 'mi-name' }, k.name), h('div', { class: 'mi-sub' }, kWords(k.words))));
      item.addEventListener('click', ev => {
        ev.stopPropagation();
        if (set.has(k.uid)) set.delete(k.uid); else set.add(k.uid);
        const box = item.querySelector('.kbox'); box.classList.toggle('on', set.has(k.uid)); box.textContent = set.has(k.uid) ? '✓' : '';
      });
      menu.append(item);
    }
    const done = () => { menu.remove(); document.removeEventListener('click', close); onChange([...set]); };
    menu.append(h('div', { class: 'menu-sep' }),
      docs.length ? h('button', { class: 'menu-item', type: 'button', onclick: ev => { ev.stopPropagation(); done(); } }, h('span', { class: 'mi-name' }, 'Done')) : null,
      h('button', { class: 'menu-item', type: 'button', onclick: () => { state.brandTab = 'knowledge'; go({ view: 'brands' }); } }, h('span', { class: 'mi-sub' }, docs.length ? 'Manage brand knowledge…' : 'Add brand knowledge…')));
    wrap.append(menu);
    fitMenu(menu, btn);
    // Clicking outside also keeps the ticks.
    const close = ev => { if (menu.contains(ev.target)) return; done(); };
    setTimeout(() => document.addEventListener('click', close), 0);
  });
  return wrap;
}

refreshKnowledge();
