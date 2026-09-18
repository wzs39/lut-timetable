import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { buildLaunchUrl, decodeLaunchUrl, newPassport } from './ssoLaunch'

/**
 * Orkestrasi login SSO Moodle (browser flow, sama dengan aplikasi resmi
 * ketika SSO/MFA seperti Duo aktif):
 *
 *  - Android : browser sistem membuka launch.php; setelah login + Duo,
 *              Moodle mengarahkan ke lut-timetable://... yang kembali ke
 *              aplikasi via deep link (didengar lewat @capacitor/app).
 *  - Electron: jendela BrowserWindow sesi-fresh (cookie terpisah dari
 *              browser utama) memantau navigasi; saat redirect ke skema
 *              aplikasi terdeteksi, URL-nya dikirim ke renderer.
 *  - Web     : tidak ada cara menerima deep link secara andal — alur
 *              SSO tidak ditawarkan (tombol disembunyikan).
 */

export interface SsoHooks {
  /** Daftarkan penerima URL skema aplikasi; kembalikan fungsi pelepas. */
  onLaunchUrl: (cb: (url: string) => void) => () => void
  /** Bersihkan pendengar saat alur dibatalkan. */
  cleanup: () => void
}

export type SsoOutcome =
  | { ok: true; token: string; privatenotoken?: string }
  | { ok: false; reason: 'cancelled' | 'timeout' | 'invalid' }

const FLOW_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Jalankan alur SSO penuh. Menyelesaikan begitu token tiba (dengan
 * verifikasi passport), atau timeout/cancel. URL login dikembalikan lewat
 * `openLogin` (pemanggil menampilkan/membukanya); pendengar deep link
 * dipasang SEBELUM URL dikembalikan agar redirect tidak bisa terlewat.
 */
export function runSsoFlow(
  hooks: SsoHooks,
): { promise: Promise<SsoOutcome>; loginUrl: string } {
  const passport = newPassport()
  const loginUrl = buildLaunchUrl(passport)
  let done = false

  const promise = new Promise<SsoOutcome>((resolve) => {
    const finish = (outcome: SsoOutcome) => {
      if (done) return
      done = true
      hooks.cleanup()
      clearTimeout(timer)
      resolve(outcome)
    }

    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), FLOW_TIMEOUT_MS)

    hooks.onLaunchUrl((url) => {
      const decoded = decodeLaunchUrl(url, { passport })
      if (decoded) finish({ ok: true, token: decoded.token, privatenotoken: decoded.privatenotoken })
      // URL tak cocok (spam/deep link lain) → diabaikan, alur lanjut menunggu.
    })
  })

  return { promise, loginUrl }
}

/**
 * Cek deep link SAAT APP DINGIN (cold start): Android boleh membunuh app
 * saat pengguna masih di browser; redirect lut-timetable:// kemudian
 * meluncurkan app baru sehingga listener appUrlOpen tidak terpasang.
 * (Official app menangani ini lewat checkIntent pada deviceready.)
 * Mengembalikan URL launch bila ada, selain itu null.
 */
export async function coldStartLaunchUrl(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { App } = await import('@capacitor/app')
    const launch = await App.getLaunchUrl()
    const url = launch?.url ?? ''
    // Situs bisa memaksa scheme bawaan resmi (forcedurlscheme) — terima keduanya.
    return url.startsWith('lut-timetable://') || url.startsWith('moodlemobile://') ? url : null
  } catch {
    return null
  }
}

/**
 * Hooks Android native: deep link kembali lewat Capacitor App plugin.
 * Web/Electron memakai jalur masing-masing (Electron: window.lutSso;
 * web: alur SSO tidak ditawarkan).
 */
export async function androidSsoHooks(): Promise<SsoHooks | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { App } = await import('@capacitor/app')
    let handle: PluginListenerHandle | null = null
    return {
      onLaunchUrl: (cb: (url: string) => void) => {
        void App.addListener('appUrlOpen', ({ url }: { url: string }) => cb(url)).then((h) => {
          handle = h
        })
        return () => {
          void handle?.remove()
        }
      },
      cleanup: () => {
        void handle?.remove()
      },
    }
  } catch {
    return null
  }
}
