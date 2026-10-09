const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, globalShortcut, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Store, buildMessages } = require('./core.cjs');
const { streamChat, checkConnection } = require('./ollama.cjs');

let mainWindow, companionWindow, tray, store, active = null, quitting = false;
const appFile = path.join(__dirname, '../src/index.html');
const companionFile = path.join(__dirname, '../src/companion.html');
const trustedURLs = new Set([appFile, companionFile].map(p => pathToFileURL(p).href));
app.setName('Meta-chan');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showMain());
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('Meta-chan could not start', error.message); app.quit(); });
}

function windows() { return [mainWindow, companionWindow].filter(w => w && !w.isDestroyed()); }
function emit(channel, value) { for (const window of windows()) window.webContents.send(channel, value); }
function snapshot() { return { ...store.snapshot(), busy: !!active, storageWarning: store.warning }; }
function changed() { emit('state:changed', snapshot()); }
function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) createMain();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}
function secure(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
}
function webPreferences() { return { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false }; }
function createMain() {
  mainWindow = new BrowserWindow({ width: 1220, height: 820, minWidth: 920, minHeight: 650, backgroundColor: '#0b101b', frame: false, show: false, icon: path.join(__dirname, '../assets/icon.png'), webPreferences: webPreferences() });
  secure(mainWindow);
  mainWindow.loadFile(appFile);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', event => {
    if (!quitting && tray) { event.preventDefault(); mainWindow.hide(); }
    else if (!quitting) { quitting = true; app.quit(); }
  });
}
function createCompanion() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea;
  companionWindow = new BrowserWindow({ width: 240, height: 355, x: x + width - 265, y: y + height - 380, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, skipTaskbar: true, alwaysOnTop: store.state.settings.alwaysOnTop, show: false, webPreferences: webPreferences() });
  secure(companionWindow);
  companionWindow.loadFile(companionFile);
  companionWindow.on('close', event => { if (!quitting) { event.preventDefault(); companionWindow.hide(); } });
}
function toggleCompanion() { if (!companionWindow || companionWindow.isDestroyed()) createCompanion(); companionWindow.isVisible() ? companionWindow.hide() : companionWindow.show(); }

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!windows().some(w => w.webContents === event.sender) || event.senderFrame !== event.sender.mainFrame || !trustedURLs.has(event.senderFrame.url)) throw new Error('Untrusted request.');
    return fn(...args);
  });
}
function mutate(fn) { const result = fn(); changed(); return result; }
function idle() { if (active) throw new Error('Stop the current reply first.'); }

async function start() {
  store = new Store(app.getPath('userData'));
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  Menu.setApplicationMenu(null);
  handle('state:get', snapshot);
  handle('settings:save', value => { idle(); store.setSettings(value); companionWindow?.setAlwaysOnTop(store.state.settings.alwaysOnTop); changed(); return snapshot(); });
  handle('connection:check', () => checkConnection(store.state.settings));
  handle('chat:send', send);
  handle('chat:stop', () => { if (active) { active.cancelled = true; active.controller.abort(); } });
  handle('chat:clear', () => { idle(); return mutate(() => store.clearChat()); });
  handle('task:add', value => mutate(() => store.addTask(value)));
  handle('task:toggle', id => mutate(() => store.toggleTask(id)));
  handle('task:delete', id => mutate(() => store.deleteTask(id)));
  handle('memory:add', value => mutate(() => store.addMemory(value)));
  handle('memory:delete', id => mutate(() => store.deleteMemory(id)));
  handle('data:clear', () => { idle(); return mutate(() => store.clearAll()); });
  handle('data:folder', async () => { const error = await shell.openPath(app.getPath('userData')); if (error) throw new Error(error); });
  handle('data:export', async () => {
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Export your Meta-chan data', defaultPath: `meta-chan-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, JSON.stringify(store.snapshot(), null, 2), { mode: 0o600 });
    return true;
  });
  handle('window:action', action => {
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    else if (action === 'close') mainWindow.close();
    else if (action === 'companion') toggleCompanion();
    else if (action === 'open') showMain();
    else if (action === 'quit') { quitting = true; app.quit(); }
    else throw new Error('Unknown window action.');
  });
  createMain(); createCompanion();
  {
    const icon = nativeImage.createFromPath(path.join(__dirname, '../assets/icon.png')).resize({ width: 24, height: 24 });
    try {
      tray = new Tray(icon);
      tray.setToolTip('Meta-chan');
      tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Meta-chan', click: showMain }, { label: 'Show / hide companion', click: toggleCompanion }, { type: 'separator' }, { label: 'Quit', click: () => { quitting = true; app.quit(); } }]));
      tray.on('double-click', showMain);
    } catch { tray = null; }
    globalShortcut.register('CommandOrControl+Shift+M', toggleCompanion);
  }
}

function send(value) {
  idle();
  const id = store.beginTurn(value);
  const run = { id, controller: new AbortController(), cancelled: false, content: '' };
  active = run;
  const settings = { ...store.state.settings };
  const messages = buildMessages(store.state);
  changed();
  setImmediate(async () => {
    let status = 'complete', errorMessage = '';
    try {
      const signal = AbortSignal.any([run.controller.signal, AbortSignal.timeout(180000)]);
      await streamChat(settings, messages, signal, token => { run.content += token; emit('chat:event', { type: 'delta', id, token }); });
    } catch (error) {
      status = run.cancelled ? 'stopped' : 'error';
      if (!run.cancelled) errorMessage = error.name === 'TimeoutError' ? 'The model took too long. Try a smaller model or a shorter prompt.' : error.message;
    }
    try { store.finishTurn(id, run.content, status); }
    catch { errorMessage = 'The reply could not be saved. Check your disk space and data folder permissions.'; }
    active = null;
    emit('chat:event', { type: 'done', id, content: run.content, status, error: errorMessage });
    changed();
  });
  return { id };
}

app.on('activate', () => { if (store) showMain(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => {
  quitting = true;
  if (active) {
    active.cancelled = true;
    active.controller.abort();
    try { store.finishTurn(active.id, active.content, 'stopped'); } catch { /* Keep last atomically saved state. */ }
  }
});
app.on('will-quit', () => globalShortcut.unregisterAll());
