const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('node:path')
const { autoUpdater } = require('electron-updater')
const { attachExternalLinkHandling } = require('./external-links.cjs')

const isDev = !app.isPackaged

/** Satu-satunya sumber kebenaran untuk "URL milik aplikasi sendiri". */
const DEV_URL = 'http://localhost:5210'

function isInternalUrl(url) {
  return url.startsWith(isDev ? DEV_URL : 'file://')
}

/** Ekstrak bagian token mentah (belum terverifikasi) dari URL launch.
 *  Verifikasi md5(passport) tetap di renderer yang memiliki passport. */
function rawTokenFromLaunchUrl(url) {
  try {
    const b64 = decodeURIComponent(url.split('token=')[1] || '')
    const payload = Buffer.from(b64, 'base64').toString('utf8')
    const parts = payload.split(':::')
    return parts.length >= 2 ? parts[1] : ''
  } catch {
    return ''
  }
}

// 代理 SISU / TimeEdit / Moodle 请求: 主进程 Node fetch 无 CORS 限制。
// Renderer tidak fetch langsung (terkena CORS), melainkan lewat IPC bridge
// preload.cjs -> ipcMain.handle di bawah. Ini satu-satunya jalur yang
// benar-benar lolos CORS di Electron (custom protocol tetap kena CORS).
//
// PENTING: daftar ini harus mencakup SETIAP host yang bisa diminta renderer
// (lihat CALENDAR_HOSTS di src/lib/fetchIcs.ts). Host yang tertinggal di sini
// ditolak dengan 403 "host not allowed" dan sync-nya mati tanpa jejak di UI —
// itu yang dulu terjadi pada moodle.lut.fi. Uji src/__tests__/proxyHosts.test.ts
// menjaga kedua daftar tetap sinkron.
const PROXY_HOSTS = ['sisu.lut.fi', 'cloud.timeedit.net', 'moodle.lut.fi']

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

  // Tautan luar (SISU, TimeEdit, Moodle, APK) keluar ke browser default OS.
  attachExternalLinkHandling(win.webContents, isInternalUrl)

  if (isDev) {
    win.loadURL(DEV_URL)
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
  autoUpdater.on('download-progress', (p) =>
    broadcastUpdate({
      type: 'download-progress',
      percent: Math.round(p.percent ?? 0),
    }),
  )
  autoUpdater.on('update-not-available', () =>
    broadcastUpdate({ type: 'update-not-available' }),
  )
  autoUpdater.on('error', (err) =>
    broadcastUpdate({ type: 'update-error', message: String(err) }),
  )

  ipcMain.handle('lut-update-install', () => {
    setImmediate(() => autoUpdater.quitAndInstall())
  })

  /* ------------- Moodle SSO login (browser flow, Duo-friendly) -------------
   * Jendela BrowserWindow dengan SESSION BARU (cookie terpisah) membuka
   * launch.php — URL DIBUAT RENDERER bersama passport-nya. Pengguna
   * menyelesaikan LUT SSO + Duo di dalamnya; redirect ke
   * lut-timetable://token=... dicegah dari navigasi, token mentahnya
   * dikirim ke renderer untuk verifikasi checksum passport. Sesi dibuang
   * setelah selesai agar tidak ada jejak login tersisa di disk. */
  ipcMain.handle('lut-sso-start', async (event, loginUrl) => {
    const wc = event.sender
    const ses = session.fromPartition('lut-sso-' + Date.now())
    let win = null
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      try { win?.destroy() } catch { /* already gone */ }
      ses.clearStorageData().catch(() => {})
      wc.send('lut-sso-result', result)
    }
    return await new Promise((resolve) => {
      win = new BrowserWindow({
        width: 480,
        height: 720,
        title: 'Moodle Login',
        webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true },
      })
      win.webContents.on('will-navigate', (e, url) => {
        if (url.startsWith('lut-timetable://')) {
          e.preventDefault()
          finish({ ok: true, token: rawTokenFromLaunchUrl(url) })
          resolve()
        }
      })
      win.on('closed', () => {
        if (!settled) {
          settled = true
          ses.clearStorageData().catch(() => {})
          wc.send('lut-sso-result', { ok: false, error: 'cancelled' })
        }
        resolve()
      })
      win.loadURL(loginUrl)
    })
  })

  // 手动检查更新：结果通过 update-status 事件回传给渲染层。
  ipcMain.handle('lut-update-check', async () => {
    try {
      const r = await autoUpdater.checkForUpdates()
      const v = r?.updateInfo?.version ? String(r.updateInfo.version) : null
      return { ok: true, version: v }
    } catch (e) {
      return { ok: false, error: String(e) }
    }
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
