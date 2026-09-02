// Preload bridge: renderer -> main process Node fetch (no CORS).
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