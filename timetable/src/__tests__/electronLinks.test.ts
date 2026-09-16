import { describe, expect, it } from 'vitest'

/**
 * Penjaga: jendela Electron tidak boleh menjadi "browser di dalam aplikasi".
 *
 * window.open() bawaan Electron membuat BrowserWindow baru, jadi tautan luar
 * (SISU, TimeEdit, Moodle, unduhan APK) harus dicegat dan diserahkan ke
 * shell.openExternal — lihat electron/external-links.cjs.
 */
const files = import.meta.glob('../../electron/*.cjs', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('electron external links', () => {
  it('ships a handler that denies in-app windows and defers to the OS browser', () => {
    const links = files['../../electron/external-links.cjs']
    expect(links).toBeTruthy()
    expect(links).toMatch(/setWindowOpenHandler/)
    expect(links).toMatch(/action:\s*'deny'/)
    expect(links).toMatch(/shell\.openExternal\s*\(/)
    expect(links).toMatch(/will-navigate/)
  })

  it('wires that handler onto the app window', () => {
    const main = files['../../electron/main.cjs']
    expect(main).toBeTruthy()
    expect(main).toMatch(/require\('\.\/external-links\.cjs'\)/)
    expect(main).toMatch(/attachExternalLinkHandling\s*\(\s*win\.webContents/)
  })
})
