// Preload bridge: renderer -> main process Node fetch (no CORS) + auto-update events.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('lutProxy', {
  fetch: (url, init = {}) =>
    ipcRenderer.invoke('lut-proxy-fetch', {
      url,
      method: init.method ?? 'GET',
      headers: init.headers ?? {},
      body: init.body ?? null,
    }),
})

contextBridge.exposeInMainWorld('lutUpdate', {
  onUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lut-update-event', listener)
    return () => ipcRenderer.removeListener('lut-update-event', listener)
  },
  install: () => ipcRenderer.invoke('lut-update-install'),
})