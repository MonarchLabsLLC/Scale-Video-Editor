const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('sve', {
  env: () => invoke('env:get'),
  setSettings: patch => invoke('settings:set', patch),
  guide: { ask: payload => invoke('guide:ask', payload) },
  update: {
    get: () => invoke('update:get'),
    check: () => invoke('update:check'),
    apply: () => invoke('update:apply'),
    restart: () => invoke('update:restart'),
    onState: fn => { const h = (_e, s) => fn(s); ipcRenderer.on('update:state', h); return () => ipcRenderer.removeListener('update:state', h); }
  },
  toolkit: {
    find: () => invoke('toolkit:find'),
    check: () => invoke('toolkit:check'),
    last: () => invoke('toolkit:last'),
    fix: id => invoke('toolkit:fix', id),
    stop: () => invoke('toolkit:stop'),
    choose: () => invoke('toolkit:choose'),
    terminal: () => invoke('toolkit:terminal'),
    openFile: p => invoke('toolkit:openFile', p),
    onLog: fn => { const h = (_e, d) => fn(d); ipcRenderer.on('toolkit:log', h); return () => ipcRenderer.removeListener('toolkit:log', h); }
  },
  knowledge: {
    list: () => invoke('knowledge:list'),
    get: id => invoke('knowledge:get', id),
    pickFiles: () => invoke('knowledge:pickFiles'),
    importFile: file => invoke('knowledge:importFile', file),
    saveText: opts => invoke('knowledge:saveText', opts),
    update: (id, patch) => invoke('knowledge:update', id, patch),
    trash: id => invoke('knowledge:trash', id)
  },
  brands: {
    list: () => invoke('brands:list'),
    get: id => invoke('brands:get', id),
    pickFile: () => invoke('brands:pickFile'),
    importFile: file => invoke('brands:importFile', file),
    importUrl: url => invoke('brands:importUrl', url),
    rename: (id, name) => invoke('brands:rename', id, name),
    duplicate: id => invoke('brands:duplicate', id),
    trash: id => invoke('brands:trash', id)
  },
  copy: text => invoke('clipboard:write', text),
  onNav: fn => { const h = (_e, r) => fn(r); ipcRenderer.on('nav', h); return () => ipcRenderer.removeListener('nav', h); },
  projects: {
    list: () => invoke('projects:list'),
    create: opts => invoke('projects:create', opts),
    get: id => invoke('projects:get', id),
    update: (id, patch) => invoke('projects:update', id, patch),
    rename: (id, name) => invoke('projects:rename', id, name),
    files: id => invoke('projects:files', id),
    chat: id => invoke('projects:chat', id),
    newChat: id => invoke('projects:newChat', id),
    trash: id => invoke('projects:trash', id),
    duplicate: id => invoke('projects:duplicate', id)
  },
  voices: {
    get: () => invoke('voices:get'),
    set: slots => invoke('voices:set', slots)
  },
  setup: {
    pickFolder: () => invoke('setup:pickFolder'),
    find: opts => invoke('setup:find', opts),
    stop: () => invoke('setup:stop'),
    onEvent: fn => { const l = (_e, d) => fn(d); ipcRenderer.on('setup:event', l); return () => ipcRenderer.removeListener('setup:event', l); }
  },
  agents: {
    detect: () => invoke('agents:detect'),
    models: (id, opts) => invoke('agents:models', id, opts),
    setModel: (id, choice) => invoke('agents:setModel', id, choice),
    onModelsChanged: fn => { const l = () => fn(); ipcRenderer.on('models:changed', l); return () => ipcRenderer.removeListener('models:changed', l); },
    login: id => invoke('agents:login', id),
    cancelLogin: () => invoke('agents:cancelLogin'),
    loginCode: text => invoke('agents:loginCode', text),
    onLoginLine: fn => { const h = (_e, d) => fn(d); ipcRenderer.on('agent:login', h); return () => ipcRenderer.removeListener('agent:login', h); }
  },
  agent: {
    send: payload => invoke('agent:send', payload),
    stop: id => invoke('agent:stop', id),
    running: () => invoke('agent:running'),
    onEvent: fn => {
      const h = (_e, data) => fn(data);
      ipcRenderer.on('agent:event', h);
      return () => ipcRenderer.removeListener('agent:event', h);
    }
  },
  filmcraft: {
    status: () => invoke('filmcraft:status'),
    choose: () => invoke('filmcraft:choose'),
    search: () => invoke('filmcraft:search'),
    clearPath: () => invoke('filmcraft:clearPath'),
    connect: file => invoke('filmcraft:connect', file),
    sequence: () => invoke('filmcraft:sequence'),
    frame: seconds => invoke('filmcraft:frame', seconds)
  },
  os: {
    pickFiles: () => invoke('os:pickFiles'),
    reveal: p => invoke('os:reveal', p),
    openPath: p => invoke('os:openPath', p),
    openExternal: url => invoke('os:openExternal', url),
    pathForFile: file => webUtils.getPathForFile(file)
  },
  mediaUrl: p => 'sve-media://local' + encodeURI(p.split('\\').join('/').replace(/^([A-Za-z]):/, '/$1:'))
});
