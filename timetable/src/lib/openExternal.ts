import { Capacitor } from '@capacitor/core'

/**
 * Buka tautan eksternal lintas platform.
 *
 * Di dalam WebView native (Android/iOS) `window.open` dan `target="_blank"`
 * diabaikan diam-diam: Capacitor tidak mengaktifkan multiple windows, jadi
 * WebChromeClient.onCreateWindow tidak pernah dipanggil dan tap pengguna
 * hilang tanpa pesan error. Karena itu di native kita navigasikan frame utama
 * — lapisan native mencegat navigasi ke host di luar origin aplikasi dan
 * menyerahkannya ke browser sistem
 * (Android: Bridge.launchIntent -> Intent.ACTION_VIEW).
 *
 * Jangan panggil window.open / target="_blank" di tempat lain: pakai
 * <ExternalLink>, dan tes penjaga src/__tests__/externalLinks.test.ts akan
 * gagal kalau keduanya muncul lagi di src/.
 */
export interface OpenActions {
  /** Native: navigasi frame utama, dicegat lapisan native. */
  navigate: (url: string) => void
  /** Browser/Electron: tab baru supaya SPA tetap hidup. */
  openTab: (url: string) => void
}

const defaultActions: OpenActions = {
  navigate: (url) => {
    window.location.href = url
  },
  openTab: (url) => {
    window.open(url, '_blank', 'noopener')
  },
}

export function openExternal(
  url: string,
  opts: { platform?: string; actions?: OpenActions } = {},
): void {
  const platform = opts.platform ?? Capacitor.getPlatform()
  const actions = opts.actions ?? defaultActions
  // Hanya browser/Electron (platform 'web') yang boleh membuka tab baru.
  if (platform === 'web') actions.openTab(url)
  else actions.navigate(url)
}
