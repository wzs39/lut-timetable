// Tautan luar harus keluar ke browser default OS, bukan jendela Electron.
//
// Bawaan Electron untuk window.open()/target="_blank" adalah membuat
// BrowserWindow baru — yaitu "browser di dalam aplikasi". Pengguna mengharapkan
// browser default komputernya. Karena itu setiap permintaan jendela baru dan
// setiap navigasi frame utama yang meninggalkan origin aplikasi dicegat di sini
// dan diserahkan ke shell.openExternal.
const { shell } = require('electron')

/** Hanya http/https yang diteruskan ke browser; skema lain (mis. file:) diabaikan. */
function isExternalHttpUrl(url) {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Serahkan URL ke browser default OS. true kalau benar-benar diteruskan. */
function openInDefaultBrowser(url) {
  if (!isExternalHttpUrl(url)) return false
  // Promise-nya bisa ditolak (mis. tidak ada handler OS) — jangan sampai
  // membuat unhandled rejection di proses utama.
  Promise.resolve(shell.openExternal(url)).catch(() => {})
  return true
}

/**
 * Pasang penanganan tautan luar pada satu webContents.
 *
 * @param {import('electron').WebContents} webContents
 * @param {(url: string) => boolean} isInternalUrl true untuk URL milik aplikasi sendiri
 */
function attachExternalLinkHandling(webContents, isInternalUrl) {
  // Jendela baru tidak pernah dibuat di dalam Electron.
  webContents.setWindowOpenHandler(({ url }) => {
    openInDefaultBrowser(url)
    return { action: 'deny' }
  })

  // Navigasi frame utama ke luar aplikasi: batalkan dan buka di browser default.
  webContents.on('will-navigate', (event, url) => {
    if (isInternalUrl(url)) return
    if (openInDefaultBrowser(url)) event.preventDefault()
  })
}

module.exports = { attachExternalLinkHandling, isExternalHttpUrl, openInDefaultBrowser }
