import { Capacitor, CapacitorHttp } from '@capacitor/core'

/**
 * Fetch teks ICS dengan strategi:
 * 1. Native (Android/Windows via Capacitor): langsung, tanpa CORS.
 * 2. Browser dev: lewat proxy Vite (/proxy/sisu, /proxy/timeedit).
 * 3. Browser production: langsung dulu (TimeEdit kirim ACAO: *),
 *    lalu fallback ke proxy CORS publik (allorigins -> corsproxy).
 */
export async function fetchIcsText(url: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.get({
      url,
      headers: { Accept: 'text/calendar' },
      readTimeout: 15000,
      connectTimeout: 10000,
    })
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
    return typeof res.data === 'string' ? res.data : String(res.data)
  }

  const attempted: Promise<string>[] = []

  const proxied = devProxyUrl(url)
  if (proxied) attempted.push(fetchText(proxied))

  // Direct: TimeEdit mengizinkan CORS (Access-Control-Allow-Origin: *).
  attempted.push(fetchText(url))

  // Fallback proxy publik: allorigins (GET, gratis) lalu corsproxy.io.
  attempted.push(
    fetchText(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`),
  )
  attempted.push(
    fetchText(`https://corsproxy.io/?url=${encodeURIComponent(url)}`),
  )

  const errors: unknown[] = []
  for (const p of attempted) {
    try {
      return await p
    } catch (e) {
      errors.push(e)
    }
  }
  throw new Error(
    `Gagal memuat ICS (CORS/jaringan). Coba lagi atau cek koneksi. ${errors.map((e) => String(e)).join(' | ')}`,
  )
}

function fetchText(url: string): Promise<string> {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  })
}

function devProxyUrl(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.endsWith('sisu.lut.fi')) {
      return '/proxy/sisu' + u.pathname + u.search
    }
    if (u.hostname.includes('timeedit.net')) {
      return '/proxy/timeedit' + u.pathname + u.search
    }
    return null
  } catch {
    return null
  }
}
