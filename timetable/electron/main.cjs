const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

const isDev = !app.isPackaged

// 代理 SISU / TimeEdit 请求: 主进程 Node fetch 无 CORS 限制。
// Renderer tidak fetch langsung (terkena CORS), melainkan lewat IPC bridge
// preload.cjs -> ipcMain.handle di bawah. Ini satu-satunya jalur yang
// benar-benar lolos CORS di Electron (custom protocol tetap kena CORS).
const PROXY_HOSTS = ['sisu.lut.fi', 'cloud.timeedit.net']

ipcMain.handle('lut-proxy-fetch', async (_event, { url, method, headers, body }) => {
  try {
    const host = new URL(url).hostname
    if (!PROXY_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
      return { ok: false, status: 403, bodyText: 'host not allowed' }
    }
    const init = { method: method ?? 'GET', headers: headers ?? {} }
    if (body != null) init.body = body
    const res = await fetch(url, init)
    const bodyText = await res.text()
    return { ok: res.ok, status: res.status, bodyText }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    title: 'LUT 课表',
    backgroundColor: '#18181b',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  if (isDev) {
    win.loadURL('http://localhost:5210')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

app.whenReady().then(() => {
  protocol.handle('lut-proxy', handleProxy)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
