const { contextBridge, ipcRenderer } = require('electron');

// Expose fixed capabilities; never expose ipcRenderer, fs, shell, or arbitrary channels.
contextBridge.exposeInMainWorld('metaChan', Object.freeze({
  getState: () => ipcRenderer.invoke('state:get'),
  saveSettings: settings => ipcRenderer.invoke('settings:save', settings),
  checkConnection: () => ipcRenderer.invoke('connection:check'),
  send: message => ipcRenderer.invoke('chat:send', message),
  stop: () => ipcRenderer.invoke('chat:stop'),
  clearChat: () => ipcRenderer.invoke('chat:clear'),
  addTask: value => ipcRenderer.invoke('task:add', value),
  toggleTask: id => ipcRenderer.invoke('task:toggle', id),
  deleteTask: id => ipcRenderer.invoke('task:delete', id),
  addMemory: value => ipcRenderer.invoke('memory:add', value),
  deleteMemory: id => ipcRenderer.invoke('memory:delete', id),
  exportData: () => ipcRenderer.invoke('data:export'),
  clearData: () => ipcRenderer.invoke('data:clear'),
  openDataFolder: () => ipcRenderer.invoke('data:folder'),
  windowAction: action => ipcRenderer.invoke('window:action', action),
  onState: callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('state:changed', listener); return () => ipcRenderer.removeListener('state:changed', listener); },
  onChat: callback => { const listener = (_event, data) => callback(data); ipcRenderer.on('chat:event', listener); return () => ipcRenderer.removeListener('chat:event', listener); },
}));
