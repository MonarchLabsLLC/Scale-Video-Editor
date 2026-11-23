const { app, BrowserWindow, ipcMain, shell, dialog, protocol, net, Menu } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const agents = require('./agents');
const filmcraft = require('./filmcraft');
const projects = require('./projects');
const updater = require('./updater');
const guide = require('./guide');
const toolkit = require('./toolkit');
const brands = require('./brands');

app.setName('Scale Video Editor');
const APP_ICON = path.join(__dirname, '..', 'renderer', 'assets', 'app-icon.png');

// Apps started from Finder or the Dock get a short PATH. Read the login shell's PATH once so
// claude, codex and filmcraft-cli are found the same way a terminal finds them.
function loadShellPath() {
  if (process.platform === 'win32') return;
  try {
    const shellBin = process.env.SHELL || '/bin/zsh';
    const out = execFileSync(shellBin, ['-ilc', 'printf "__PATH__%s__END__" "$PATH"'], { timeout: 5000, encoding: 'utf8' });
    const m = out.match(/__PATH__(.*)__END__/);
    if (m && m[1]) {
      const merged = new Set([...m[1].split(':'), ...(process.env.PATH || '').split(':')].filter(Boolean));
      process.env.PATH = [...merged].join(':');
    }
  } catch { /* keep the PATH we have */ }
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'sve-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: false } }
]);

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = { engine: 'claude', model: '', access: 'standard', toolkitDir: '', brand: '' };

function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { return { ...DEFAULT_SETTINGS }; }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}

function toolkitDir() {
  const s = readSettings();
  const d = toolkit.dir(s.toolkitDir);
  if (d) return d;
  const candidates = [s.toolkitDir, path.join(os.homedir(), 'Scale-Video-Toolkit')].filter(Boolean);
  return candidates.find(c => fs.existsSync(path.join(c, 'CLAUDE.md'))) || null;
}

const framesDir = () => path.join(app.getPath('temp'), 'scale-video-editor-frames');
const mcpScript = () => path.join(__dirname, 'filmcraft-mcp.js');

let win = null;
const running = new Map(); // projectId -> turn handle

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function allowedPath(p) {
  const real = path.resolve(p);
  return [projects.getRoot(), framesDir()].some(root => root && (real === root || real.startsWith(root + path.sep)));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    title: 'Scale Video Editor',
    icon: APP_ICON,
    backgroundColor: '#fcfcfa',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    show: !SNAPSHOT_DIR,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  // Check for a new version a few seconds after every start, then every six hours.
  if (!SNAPSHOT_DIR) win.webContents.once('did-finish-load', () => {
    setTimeout(() => updater.check(), 4000);
    setInterval(() => updater.check(), 6 * 60 * 60 * 1000).unref();
  });
  if (SNAPSHOT_DIR) win.webContents.once('did-finish-load', () => takeSnapshots().catch(err => { console.error(err); app.exit(1); }));
}

// Development check: SVE_SNAPSHOT=<dir> renders each screen in a hidden window, saves a PNG
// of it, and quits. No window appears on screen.
const SNAPSHOT_DIR = process.env.SVE_SNAPSHOT || '';
async function takeSnapshots() {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const js = code => win.webContents.executeJavaScript(code);
  const shot = async name => {
    await wait(900);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SNAPSHOT_DIR, name + '.png'), img.toPNG());
  };
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  await wait(1800);
  await shot('1-home');
  await js("document.querySelector('.pcard .more-btn')?.click()"); await wait(200); await shot('1b-menu');
  await js("[...document.querySelectorAll('.pop-menu .menu-item')].find(b => b.textContent.startsWith('Delete'))?.click()"); await wait(200); await shot('1c-delete');
  await js("document.querySelector('#overlay .sheet-foot .btn:not(.danger)')?.click()");
  await js("window.__sve.go({ view: 'formats' })"); await shot('2-formats');
  await js("window.__sve.state.cat = 'marketing'; window.__sve.go({ view: 'formats' })"); await shot('2b-marketing'); await js("window.__sve.state.cat = 'all'");
  if (process.env.SVE_GUIDE_URL) { await js("window.__sve.go({ view: 'home' }); window.__sve.guideSend('I have a script. What can I make with it?')"); await wait(1500); await shot('2c-guide'); await js("window.__sve.closeGuide(); localStorage.removeItem('sve-guide:v1')"); }
  await js("window.__sve.go({ view: 'home' }); window.__sve.openInterview(window.SVE_FORMATS.find(f => f.id === 'short'))"); await shot('3-interview');
  await js("document.querySelector('#overlay').click()");
  const first = projects.list()[0];
  if (first) { await js(`window.__sve.go({ view: 'project', id: ${JSON.stringify(first.id)} })`); await wait(800); await shot('4-project'); }
  await js("window.__sve.refreshKit(true)"); await wait(6000);
  await js("window.__sve.go({ view: 'tools', tool: 'voice' })"); await wait(600); await shot('4b-tools');
  await js("window.__sve.go({ view: 'setup' })"); await wait(300); await shot('4c-setup');
  await js("window.__sve.go({ view: 'settings' })"); await wait(300); await js("document.querySelectorAll('*').forEach(e => { if (e.scrollTop) e.scrollTop = 0; })"); await shot('5-settings');
  await js("window.__sve.go({ view: 'filmcraft' })"); await shot('6-filmcraft');
  // Brand Guides. SVE_SNAPSHOT_BRANDS="site.com,https://link/DESIGN.md" adds those first (needs the network).
  for (const link of (process.env.SVE_SNAPSHOT_BRANDS || '').split(',').filter(Boolean)) {
    try { await importBrandUrl(link); } catch (err) { console.error('brand', link, err.message); }
  }
  await js("refreshBrands().then(() => window.__sve.go({ view: 'brands' }))"); await wait(400); await shot('7-brands');
  const firstBrand = brands.list()[0];
  if (firstBrand) {
    await js(`window.__sve.go({ view: 'brand', id: ${JSON.stringify(firstBrand.id)} })`); await wait(800); await shot('7b-brand');
    await js("document.querySelector('.bfull')?.setAttribute('open', ''); document.querySelector('.bfull')?.scrollIntoView()"); await wait(300); await shot('7c-brand-guide');
    await js(`window.__sve.state.homeBrand = ${JSON.stringify(firstBrand.uid)}; window.__sve.go({ view: 'home' })`); await wait(300);
    await js("document.querySelector('.brand-pick .mini-select')?.click()"); await wait(300); await shot('7d-home-brand');
  }
  app.exit(0);
}

/* ---------- brand guides from a link ---------- */
async function fetchLimited(url, max, accept) {
  const res = await net.fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) ScaleVideoEditor', accept: accept || '*/*' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`The link answered ${res.status}.`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max) throw new Error('That file is too large.');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new Error('That file is too large.');
  return { buf, type: (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase() };
}

async function importBrandUrl(input) {
  const link = brands.classifyUrl(input);
  if (link.kind === 'doc') {
    let got;
    try { got = await fetchLimited(link.url, 4 * 1024 * 1024, 'text/markdown, text/plain, */*'); }
    catch { throw new Error(link.page.includes('getdesign.md') ? 'We could not get that design from getdesign.md. Download its DESIGN.md and add the file instead.' : 'We could not get that file. Download it and add the file instead.'); }
    if (/html/.test(got.type)) throw new Error('That link opens a web page, not a file. Download the DESIGN.md and add the file instead.');
    return brands.saveText({ name: link.name || '', text: got.buf.toString('utf8'), source: { kind: 'link', label: link.page } });
  }
  if (link.kind === 'pdf') {
    const { buf } = await fetchLimited(link.url, 20 * 1024 * 1024);
    const tmp = path.join(app.getPath('temp'), `sve-brand-${Date.now()}.pdf`);
    fs.writeFileSync(tmp, buf);
    try {
      const text = await brands.textFromFile(tmp);
      return brands.saveText({ name: '', text, source: { kind: 'link', label: link.page } });
    } finally { fs.rmSync(tmp, { force: true }); }
  }
  // A website: read its look in a hidden window, then write a DESIGN.md from it.
  const scan = await scanSite(link.url);
  let logo = null;
  try {
    if (scan.logo && /^https:\/\//.test(scan.logo)) {
      const { buf, type } = await fetchLimited(scan.logo, 2 * 1024 * 1024, 'image/*');
      if (brands.IMAGE_EXT[type]) logo = { data: buf, ext: brands.IMAGE_EXT[type] };
    }
    if (!logo && scan.svg) logo = { data: Buffer.from(scan.svg.includes('xmlns') ? scan.svg : scan.svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')), ext: '.svg' };
    if (!logo && scan.icon && /^https:\/\//.test(scan.icon)) {
      const { buf, type } = await fetchLimited(scan.icon, 1024 * 1024, 'image/*');
      if (brands.IMAGE_EXT[type] && type !== 'image/x-icon' && type !== 'image/vnd.microsoft.icon') logo = { data: buf, ext: brands.IMAGE_EXT[type] };
    }
  } catch { logo = null; }
  scan.logoSaved = !!logo;
  const name = (scan.siteName || scan.title || scan.host || 'Brand').split(/\s+[|\-–—:]\s+/)[0].slice(0, 60);
  return brands.saveText({ name, text: brands.designFromScan(scan), source: { kind: 'site', label: scan.url }, logo });
}

// Opens the site in a hidden window with its own throwaway session and no access to this computer,
// lets it settle, reads colors, fonts and the logo, and closes it. Nothing is shown on screen.
function scanSite(url) {
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({
      show: false, width: 1440, height: 900,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'sve-brand-scan', backgroundThrottling: false, webSecurity: true }
    });
    w.webContents.setAudioMuted(true);
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.session.on('will-download', e => e.preventDefault());
    w.webContents.setUserAgent(w.webContents.getUserAgent().replace(/\s(Electron|scale-video-editor|Scale Video Editor)\/\S+/gi, ''));
    let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); if (!w.isDestroyed()) w.destroy(); err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => finish(new Error('That website took too long to open. Try again, or add a design guide file instead.')), 30000);
    w.webContents.on('did-fail-load', (_e, code, desc, _u, isMain) => { if (isMain && code !== -3) finish(new Error(`We could not open that website (${desc}). Check the address.`)); });
    w.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (done) return;
        w.webContents.executeJavaScript(brands.SCAN_SCRIPT, true)
          .then(r => finish(null, r))
          .catch(() => finish(new Error('We opened the website but could not read its styles.')));
      }, 2500);
    });
    w.loadURL(url).catch(() => {});
  });
}

function registerIpc() {
  ipcMain.handle('guide:ask', (_e, payload) => guide.ask(payload, app.getVersion()));
  ipcMain.handle('update:get', () => updater.get());
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:apply', () => updater.apply());
  ipcMain.handle('update:restart', () => updater.restart());
  ipcMain.handle('env:get', async () => ({
    platform: process.platform,
    version: app.getVersion(),
    agents: await agents.detect(),
    toolkitDir: toolkitDir(),
    projectsRoot: projects.getRoot(),
    settings: readSettings()
  }));

  ipcMain.handle('toolkit:find', async () => { await toolkit.find(readSettings().toolkitDir); return toolkitDir(); });
  ipcMain.handle('toolkit:check', () => toolkit.verify(readSettings().toolkitDir));
  ipcMain.handle('toolkit:last', () => toolkit.last());
  ipcMain.handle('toolkit:fix', async (_e, id) => {
    const code = await toolkit.runFix(id, readSettings().toolkitDir, line => send('toolkit:log', { id, line }));
    const result = await toolkit.verify(readSettings().toolkitDir);
    return { code, result };
  });
  ipcMain.handle('toolkit:stop', () => toolkit.stopFix());
  ipcMain.handle('toolkit:choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose the Scale Video Toolkit folder', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    const d = r.filePaths[0];
    if (!fs.existsSync(path.join(d, 'tools', 'verify-install.sh'))) return { ok: false, message: 'That folder is not the Scale Video Toolkit. Choose the folder that has install.sh and a tools folder in it.' };
    writeSettings({ ...readSettings(), toolkitDir: d });
    return { ok: true, dir: d };
  });
  ipcMain.handle('toolkit:terminal', () => {
    const d = toolkitDir();
    if (process.platform === 'darwin') return new Promise(res => require('node:child_process').execFile('open', ['-a', 'Terminal', d || os.homedir()], () => res(true)));
    return false;
  });
  ipcMain.handle('toolkit:openFile', (_e, p) => {
    const full = path.resolve(String(p).replace(/^~(?=\/)/, os.homedir()));
    const okDir = path.join(os.homedir(), '.config', 'scale-video-toolkit') + path.sep;
    if (!full.startsWith(okDir)) return 'Not allowed';
    if (!fs.existsSync(full)) return 'The file is not there yet. Run the toolkit step "tools" first; it makes the file.';
    return shell.openPath(full);
  });
  ipcMain.handle('clipboard:write', (_e, text) => { require('electron').clipboard.writeText(String(text)); return true; });

  ipcMain.handle('agents:login', async (_e, id) => {
    const r = await agents.login(id, { openExternal: url => shell.openExternal(url), onLine: line => send('agent:login', { id, line }) });
    return { ...r, agents: await agents.detect() };
  });
  ipcMain.handle('agents:loginCode', (_e, text) => agents.loginInput(text));
  ipcMain.handle('agents:cancelLogin', () => { if (agents.login.cancel) agents.login.cancel(); });
  ipcMain.handle('agents:detect', () => agents.detect());

  ipcMain.handle('settings:set', (_e, patch) => {
    const next = { ...readSettings(), ...patch };
    writeSettings(next);
    return next;
  });

  ipcMain.handle('projects:list', () => projects.list());
  ipcMain.handle('projects:create', (_e, opts) => projects.create(opts));
  ipcMain.handle('projects:get', (_e, id) => projects.get(id));
  ipcMain.handle('projects:update', (_e, id, patch) => {
    const allowed = {};
    for (const k of ['engine', 'model', 'brand']) if (k in patch) allowed[k] = patch[k];
    if ('engine' in patch) allowed.session = null; // a session belongs to one agent
    return projects.update(id, allowed);
  });
  ipcMain.handle('projects:rename', (_e, id, name) => {
    if (running.has(id)) throw new Error('Wait for the agent to finish before you rename this project.');
    return projects.rename(id, name);
  });
  ipcMain.handle('projects:duplicate', (_e, id) => projects.duplicate(id));
  ipcMain.handle('projects:files', (_e, id) => projects.files(id));
  ipcMain.handle('projects:chat', (_e, id) => projects.readChat(id));
  ipcMain.handle('projects:newChat', (_e, id) => projects.update(id, { session: null }));
  // Delete = move the whole project folder to the system Trash (recoverable until the Trash is emptied).
  ipcMain.handle('projects:trash', async (_e, id) => {
    const p = projects.get(id);
    const turn = running.get(id);
    if (turn) { try { turn.stop(); } catch {} running.delete(id); }
    await shell.trashItem(p.dir);
    return true;
  });

  /* ---------- brand guides ---------- */
  ipcMain.handle('brands:list', () => brands.list());
  ipcMain.handle('brands:get', (_e, id) => brands.get(id));
  ipcMain.handle('brands:pickFile', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Add a design guide', properties: ['openFile'],
      filters: [{ name: 'Design guides', extensions: brands.FILE_TYPES.map(e => e.slice(1)) }]
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('brands:importFile', (_e, file) => brands.importFile(String(file)));
  ipcMain.handle('brands:importUrl', (_e, input) => importBrandUrl(input));
  ipcMain.handle('brands:rename', (_e, id, name) => brands.rename(id, name));
  ipcMain.handle('brands:duplicate', (_e, id) => brands.duplicate(id));
  ipcMain.handle('brands:trash', async (_e, id) => { await shell.trashItem(brands.resolve(id)); return true; });

  ipcMain.handle('agent:send', async (_e, { projectId, prompt, attachments }) => {
    if (running.has(projectId)) throw new Error('The agent is still working on this project.');
    const project = projects.get(projectId);
    const settings = readSettings();
    const fcStatus = await filmcraft.status();
    let full = String(prompt || '').trim();
    if (attachments && attachments.length) {
      full += '\n\nFiles I added (use them where they are; do not move or delete them):\n' + attachments.map(a => `- ${a}`).join('\n');
    }
    projects.appendChat(projectId, { role: 'user', text: prompt, attachments: attachments || [] });
    const ctx = {
      engine: project.engine || settings.engine,
      model: project.model || settings.model,
      access: settings.access,
      projectDir: project.dir,
      resume: project.session,
      toolkitDir: toolkitDir(),
      filmcraft: fcStatus.bridge,
      mcpScript: mcpScript(),
      brand: project.brand ? brands.copyInto(project.brand, project.dir) : null
    };
    const handle = agents.runTurn(ctx, full, ev => {
      if (ev.kind === 'session' && ev.id && ev.id !== project.session) {
        projects.update(projectId, { session: ev.id });
        project.session = ev.id;
      }
      if (ev.kind === 'text' || ev.kind === 'tool' || ev.kind === 'notice') {
        projects.appendChat(projectId, { role: 'agent', ...ev });
      }
      if (ev.kind === 'done') {
        running.delete(projectId);
        projects.appendChat(projectId, { role: 'agent', ...ev });
        projects.update(projectId, {});
      }
      send('agent:event', { projectId, event: ev });
    });
    running.set(projectId, handle);
    return { ok: true, engine: ctx.engine, filmcraft: ctx.filmcraft };
  });

  ipcMain.handle('agent:stop', (_e, projectId) => {
    const h = running.get(projectId);
    if (h) h.stop();
    return true;
  });
  ipcMain.handle('agent:running', () => [...running.keys()]);

  ipcMain.handle('filmcraft:status', () => filmcraft.status());
  ipcMain.handle('filmcraft:connect', (_e, projectFile) => {
    if (projectFile && !allowedPath(projectFile)) projectFile = null;
    return filmcraft.startBridge(projectFile);
  });
  ipcMain.handle('filmcraft:sequence', () => filmcraft.inspectSequence());
  ipcMain.handle('filmcraft:frame', async (_e, seconds) => {
    const dir = framesDir();
    // Keep only the newest few preview frames.
    try {
      const old = fs.readdirSync(dir).map(n => path.join(dir, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(8);
      old.forEach(f => fs.rmSync(f, { force: true }));
    } catch { /* first run */ }
    return filmcraft.renderFrame(seconds, dir);
  });

  ipcMain.handle('os:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp3', 'wav', 'm4a', 'aac', 'txt', 'md', 'srt', 'vtt', 'pdf'] }, { name: 'All files', extensions: ['*'] }]
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('os:reveal', (_e, p) => { if (allowedPath(p)) shell.showItemInFolder(p); });
  ipcMain.handle('os:openPath', (_e, p) => { if (allowedPath(p)) return shell.openPath(p); });
  ipcMain.handle('os:openExternal', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
}

// The standard menus, plus "Check for Updates…" where a Mac app keeps it.
function buildMenu() {
  const checkItem = { label: 'Check for Updates…', click: () => { updater.check(); if (win) win.webContents.send('nav', { view: 'settings' }); } };
  const template = [
    ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' }, checkItem, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    { role: 'help', submenu: [...(process.platform === 'darwin' ? [] : [checkItem]), { label: 'Scale Video Editor on GitHub', click: () => shell.openExternal('https://github.com/MonarchLabsLLC/Scale-Video-Editor') }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  updater.init(app, state => { if (win && !win.isDestroyed()) win.webContents.send('update:state', state); });
  buildMenu();
  // When run from source the Dock shows Electron's own icon; show the Scale.gg mark instead.
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) app.dock.setIcon(APP_ICON);
  app.setAboutPanelOptions({ applicationName: 'Scale Video Editor', applicationVersion: app.getVersion(), iconPath: APP_ICON });
  loadShellPath();
  projects.setRoot(process.env.SVE_PROJECTS_ROOT || path.join(app.getPath('documents'), 'Scale Video Editor'));
  brands.setRoot(path.join(projects.getRoot(), 'Brand Guides'));
  protocol.handle('sve-media', req => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (process.platform === 'win32') p = p.replace(/^\/([A-Za-z]:)/, '$1');
    if (!allowedPath(p)) return new Response('Not allowed', { status: 403 });
    return net.fetch(pathToFileURL(p).toString(), { headers: req.headers });
  });
  registerIpc();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  for (const h of running.values()) h.stop();
  if (process.platform !== 'darwin') app.quit();
});
