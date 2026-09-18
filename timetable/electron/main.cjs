const { app, BrowserWindow, ipcMain, session, protocol } = require('electron')
const path = require('node:path')
const { autoUpdater } = require('electron-updater')
const { attachExternalLinkHandling } = require('./external-links.cjs')

const isDev = !app.isPackaged

/** Skema SSO harus terdaftar privileged SEBELUM app ready agar navigasi ke
 *  skema ini diproses internal Chromium (bukan diteruskan ke OS). */
protocol.registerSchemesAsPrivileged([
  { scheme: 'lut-timetable', privileges: { standard: true, secure: true } },
  { scheme: 'moodlemobile', privileges: { standard: true, secure: true } },
])

/** Satu-satunya sumber kebenaran untuk "URL milik aplikasi sendiri". */
const DEV_URL = 'http://localhost:5210'

function isInternalUrl(url) {
  return url.startsWith(isDev ? DEV_URL : 'file://')
}

/** Skema yang dianggap "milik alur SSO kami". Moodle launch.php biasanya
 *  mengarah ke urlscheme yang kita kirim (lut-timetable), TETAPI situs bisa
 *  memaksa scheme lain lewat tool_mobile | forcedurlscheme — LUT memaksa
 *  'moodlemobile' (skema bawaan aplikasi resmi). Token dalam URL tetap
 *  diverifikasi renderer lewat md5(passport) kami, jadi menerima skema
 *  tambahan tidak melemahkan keamanan. */
const SSO_SCHEMES = ['lut-timetable://', 'moodlemobile://']

function isSsoLaunchUrl(url) {
  return SSO_SCHEMES.some((s) => url.startsWith(s))
}

/** Penerima URL launch aktif (dipasang oleh handler lut-sso-start).
 *  Skema diregistrasi lewat ses.protocol.handle pada sesi SSO sehingga
 *  redirect launch.php ke moodlemobile:// / lut-timetable:// tertangkap
 *  DI DALAM aplikasi — tidak pernah diteruskan ke OS (tanpa dialog
 *  "pilih aplikasi", tanpa membuka aplikasi Moodle resmi). */
let ssoLaunchCapture = null

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

/* ------------- Moodle SSO login (default-browser flow, Duo-friendly) -------------
 * Alur resmi Moodle: app membuka {WWWROOT}/admin/tool/mobile/launch.php di
 * BROWSER DEFAULT OS (bukan browser terpasang — pengguna login + Duo di
 * browser yang sudah dipercayanya), lalu launch.php mengarahkan ke skema
 * token. Skema diregistrasi sebagai handler OS (app.setAsDefaultProtocolClient
 * untuk 'lut-timetable' DAN 'moodlemobile' — LUT memaksa skema resmi lewat
 * tool_mobile | forcedurlscheme) sehingga redirect kembali KE aplikasi ini,
 * bukan ke aplikasi Moodle resmi. Token diverifikasi renderer lewat
 * md5(passport); passport satu kali pakai disimpan renderer.
 *
 * Argumen CLI dari OS (Windows: lut-timetable://... / moodlemobile://...
 * sebagai argv; macOS: open-url event) diteruskan ke renderer lewat
 * lut-sso-result. Tanpa jendela login terpasang, tanpa dialog "pilih
 * aplikasi" — skema sudah dimiliki aplikasi ini. */

/** Kirim URL launch ke renderer (dipakai CLI argv & open-url). */
function deliverSsoUrl(url) {
  const token = rawTokenFromLaunchUrl(url)
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lut-sso-result', token ? { ok: true, token } : { ok: false, error: 'invalid' })
  }
}

/** Windows: instance kedua diluncurkan OS dengan URL skema sebagai argv. */
const gotSingleLock = app.requestSingleInstanceLock()
if (!gotSingleLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => isSsoLaunchUrl(a))
    if (url) deliverSsoUrl(url)
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

/** macOS: deep link datang lewat open-url. */
app.on('open-url', (e, url) => {
  e.preventDefault()
  if (isSsoLaunchUrl(url)) deliverSsoUrl(url)
})

/** Daftarkan kedua skema sebagai milik aplikasi ini di OS.
 *  Dev (electron .) dan prod (exe terpasang) sama-sama didaftarkan. */
function registerSsoProtocols() {
  if (process.defaultApp) {
    // Dev: OS akan menjalankan "electron.exe ." — argumen kedua adalah path app.
    for (const scheme of ['lut-timetable', 'moodlemobile']) {
      try { app.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1])]) } catch { /* non-Windows dev */ }
    }
  } else {
    for (const scheme of ['lut-timetable', 'moodlemobile']) {
      app.setAsDefaultProtocolClient(scheme)
    }
  }
}

ipcMain.handle('lut-sso-start', async (event, loginUrl) => {
  const wc = event.sender
  // Buka di browser DEFAULT OS — bukan jendela terpasang. Duo berjalan
  // di lingkungan yang sudah dipercaya pengguna.
  try {
    const { shell } = require('electron')
    await shell.openExternal(loginUrl)
  } catch (e) {
    wc.send('lut-sso-result', { ok: false, error: 'open-failed: ' + String(e) })
    return
  }
  // Tidak ada jendela, tidak ada session sementara: token kembali lewat
  // protokol OS (second-instance / open-url) -> deliverSsoUrl.
})

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
  registerSsoProtocols()
  setupAutoUpdater()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
