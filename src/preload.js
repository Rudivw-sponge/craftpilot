'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => ipcRenderer.on(channel, (_e, payload) => fn(payload));

contextBridge.exposeInMainWorld('companion', {
  getState: () => ipcRenderer.invoke('state:get'),
  chooseProject: () => ipcRenderer.invoke('project:choose'),
  openApp: (id) => ipcRenderer.invoke('app:open', id),
  send: (text) => ipcRenderer.invoke('chat:send', text),
  stop: () => ipcRenderer.invoke('chat:stop'),
  newChat: () => ipcRenderer.invoke('chat:new'),
  answerPermission: (answer) => ipcRenderer.invoke('perm:answer', answer),
  togglePin: () => ipcRenderer.invoke('window:pin'),
  getInfo: () => ipcRenderer.invoke('info:get'),
  getIcons: () => ipcRenderer.invoke('icons:get'),
  setApiKey: (key) => ipcRenderer.invoke('auth:setKey', key),
  clearApiKey: () => ipcRenderer.invoke('auth:clearKey'),
  openClaudeCode: () => ipcRenderer.invoke('claude:open'),
  openLink: (url) => ipcRenderer.invoke('link:open', url),
  getUsage: () => ipcRenderer.invoke('usage:get'),
  setModel: (model) => ipcRenderer.invoke('model:set', model),
  setEffort: (effort) => ipcRenderer.invoke('effort:set', effort),
  onState: on('state'),
  onEvent: on('chat:event'),
  onPermission: on('perm:ask'),
  onReset: on('chat:reset'),
});
