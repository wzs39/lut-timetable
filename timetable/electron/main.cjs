const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')
const { autoUpdater } = require('electron-updater')

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

let mainWindow = null

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
  mainWindow = win

  if (isDev) {
    win.loadURL('http://localhost:5210')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

function broadcastUpdate(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lut-update-event', payload)
  }
}

function setupAutoUpdater() {
  // electron-updater hanya berfungsi di app terpaket (butuh app-update.yml).
  if (isDev) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) =>
    broadcastUpdate({ type: 'update-available', version: String(info.version) }),
  )
  autoUpdater.on('update-downloaded', (info) =>
    broadcastUpdate({ type: 'update-downloaded', version: String(info.version) }),
  )
  autoUpdater.on('error', (err) =>
    broadcastUpdate({ type: 'update-error', message: String(err) }),
  )

  ipcMain.handle('lut-update-install', () => {
    setImmediate(() => autoUpdater.quitAndInstall())
  })

  const check = () => autoUpdater.checkForUpdates().catch(() => {})
  setTimeout(check, 10_000)
  setInterval(check, 6 * 60 * 60 * 1000)
}

app.whenReady().then(() => {
  setupAutoUpdater()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
