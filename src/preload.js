'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  status: () => ipcRenderer.invoke('vault:status'),
  create: (pw) => ipcRenderer.invoke('vault:create', pw),
  unlock: (pw) => ipcRenderer.invoke('vault:unlock', pw),
  lock: () => ipcRenderer.invoke('vault:lock'),
  list: () => ipcRenderer.invoke('vault:list'),
  save: (entry) => ipcRenderer.invoke('vault:save', entry),
  remove: (id) => ipcRenderer.invoke('vault:delete', id),
  changeMaster: (current, next) => ipcRenderer.invoke('vault:changeMaster', current, next),
  generate: (opts) => ipcRenderer.invoke('generate', opts),
  copy: (text) => ipcRenderer.invoke('clipboard:copy', text),
  openUrl: (url) => ipcRenderer.invoke('openUrl', url),
  onLocked: (cb) => ipcRenderer.on('vault:locked', (_e, reason) => cb(reason)),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (cb) => ipcRenderer.on('update:status', (_e, status) => cb(status)),
});
