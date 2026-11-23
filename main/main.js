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
const DEFAULT_SETTINGS = { engine: 'claude', model: '', access: 'standard', toolkitDir: '' };

function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { return { ...DEFAULT_SETTINGS }; }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}

function toolkitDir() {
  const s = readSettings();
  const candidates = [s.toolkitDir, path.join(os.homedir(), 'Scale-Video-Toolkit')].filter(Boolean);
  return candidates.find(d => fs.existsSync(path.join(d, 'CLAUDE.md'))) || null;
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
  await js("window.__sve.go({ view: 'settings' })"); await shot('5-settings');
  await js("window.__sve.go({ view: 'filmcraft' })"); await shot('6-filmcraft');
  app.exit(0);
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
    for (const k of ['engine', 'model']) if (k in patch) allowed[k] = patch[k];
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
      mcpScript: mcpScript()
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
