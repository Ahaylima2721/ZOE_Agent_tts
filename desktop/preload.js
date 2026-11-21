/* Ponte mínima e explícita entre a interface (sandbox) e o processo principal. */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zoe', {
  coreInfo: () => ipcRenderer.invoke('core:info'),
  api: (method, path, body) => ipcRenderer.invoke('core:api', method, path, body),
  setMode: (mode) => ipcRenderer.send('ui:mode', mode),
  reportState: (st) => ipcRenderer.send('ui:state', st),
  contextMenu: () => ipcRenderer.send('ui:context-menu'),
  openExternal: (url) => ipcRenderer.send('ui:open-external', url),
  openMain: (page) => ipcRenderer.send('ui:open-main', page),
  dragStart: (p) => ipcRenderer.send('drag:start', p),
  dragMove: (p) => ipcRenderer.send('drag:move', p),
  dragEnd: (orbCenter) => ipcRenderer.send('drag:end', orbCenter),
  on: (channel, fn) => {
    if (!['layout', 'cursor', 'open-panel', 'open-page'].includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
