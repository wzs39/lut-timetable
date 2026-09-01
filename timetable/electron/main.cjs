const { app, BrowserWindow, protocol } = require('electron')
const path = require('node:path')

const isDev = !app.isPackaged

// 代理 SISU / TimeEdit 请求: 主进程 Node fetch 无 CORS 限制
const PROXY_HOSTS = ['sisu.lut.fi', 'cloud.timeedit.net']

function handleProxy(req, callback) {
  try {
    const url = new URL(req.url)
    const host = url.hostname
    if (!PROXY_HOSTS.some((h) => host === h || host.endsWith('.' + h))) {
      callback({ statusCode: 403, headers: { 'content-type': 'text/plain' }, data: 'host not allowed' })
      return
    }
    const target = new URL(`${url.protocol === 'lut-proxy:' ? 'https:' : 'http:'}//${host}${url.pathname}${url.search}`)

    const headers = { ...req.headers }
    delete headers.host

    const init = { method: req.method, headers }
    if (req.method === 'POST' && req.uploadData?.length) {
      const parts = req.uploadData
        .filter((d) => d.bytes)
        .map((d) => Buffer.from(d.bytes))
      init.body = parts.length === 1 ? parts[0] : Buffer.concat(parts)
    }

    fetch(target.toString(), init)
      .then(async (res) => {
        const buf = Buffer.from(await res.arrayBuffer())
        const outHeaders = {}
        for (const [k, v] of res.headers.entries()) {
          if (/^content-type|^content-length|^cache-control|^etag|^last-modified/i.test(k)) {
            outHeaders[k] = v
          }
        }
        callback({ statusCode: res.status, headers: outHeaders, data: buf })
      })
      .catch((e) => {
        callback({ statusCode: 502, headers: { 'content-type': 'text/plain' }, data: String(e) })
      })
  } catch (e) {
    callback({ statusCode: 400, headers: { 'content-type': 'text/plain' }, data: String(e) })
  }
}

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
