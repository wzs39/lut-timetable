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

// Moodle SSO 登录桥：渲染端生成 launch URL（含 passport）→ 主进程独立
// session 窗口完成 LUT SSO + Duo → token 经 lut-sso-result 事件回传。
contextBridge.exposeInMainWorld('lutSso', {
  start: (loginUrl) => ipcRenderer.invoke('lut-sso-start', loginUrl),
  onResult: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lut-sso-result', listener)
    return () => ipcRenderer.removeListener('lut-sso-result', listener)
  },
})

contextBridge.exposeInMainWorld('lutUpdate', {
  onUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lut-update-event', listener)
    return () => ipcRenderer.removeListener('lut-update-event', listener)
  },
  install: () => ipcRenderer.invoke('lut-update-install'),
  check: () => ipcRenderer.invoke('lut-update-check'),
})

// 桌面常驻桥：托盘/全局快捷键的偏好由主进程持有（userData/desktop-prefs.json），
// 渲染端只读写状态；托盘文案由渲染端推过去，这样菜单跟着 App 语言走。
contextBridge.exposeInMainWorld('lutDesktop', {
  getState: () => ipcRenderer.invoke('lut-desktop-get-state'),
  setPrefs: (patch) => ipcRenderer.invoke('lut-desktop-set-prefs', patch),
  setTrayLabels: (labels) => ipcRenderer.send('lut-tray-labels', labels),
  onCommand: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('lut-tray-command', listener)
    return () => ipcRenderer.removeListener('lut-tray-command', listener)
  },
})