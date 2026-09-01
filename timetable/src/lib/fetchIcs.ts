import { Capacitor, CapacitorHttp } from '@capacitor/core'

export const ICS_CACHE_TTL = 2 * 60 * 60 * 1000
const ICS_CACHE_PREFIX = 'tt_ics_cache_v1:'

interface IcsCacheEntry {
  fetchedAt: number
  text: string
}

/**
 * Fetch teks ICS dengan strategi:
 * 1. Native Capacitor (Android): langsung via CapacitorHttp, tanpa CORS.
 * 2. Electron desktop: lewat protokol lut-proxy:// (fetch Node di main
 *    process, tanpa CORS — lihat electron/main.cjs).
 * 3. Browser dev: lewat proxy Vite (/proxy/sisu, /proxy/timeedit).
 * 4. Browser production: langsung dulu (TimeEdit kirim ACAO: *),
 *    lalu fallback ke proxy CORS publik (allorigins -> corsproxy).
 */

/** Apakah berjalan di dalam Electron? */
export function isElectron(): boolean {
  return typeof navigator !== 'undefined' && /Electron\//i.test(navigator.userAgent)
}

/** Proksi semua request lewat main process (Electron) — bebas CORS. */
export async function fetchViaElectron(
  url: string,
  init: RequestInit = {},
): Promise<string> {
  const u = new URL(url)
  const proxied = new URL(`lut-proxy://${u.hostname}${u.pathname}${u.search}`)
  const res = await fetch(proxied.toString(), {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(u.pathname.endsWith('.ics') || u.pathname.includes('calendar')
        ? { Accept: 'text/calendar' }
        : {}),
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
}

export async function fetchIcsText(url: string): Promise<string> {
  const cached = loadCachedIcs(url)

  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.get({
        url,
        headers: { Accept: 'text/calendar' },
        readTimeout: 15000,
        connectTimeout: 10000,
      })
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
      const text = typeof res.data === 'string' ? res.data : String(res.data)
      saveCachedIcs(url, text)
      return text
    } catch (error) {
      if (cached) return cached.text
      throw error
    }
  }

  if (isElectron()) {
    try {
      const text = await fetchViaElectron(url)
      saveCachedIcs(url, text)
      return text
    } catch (error) {
      if (cached) return cached.text
      throw error
    }
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
      const text = await p
      saveCachedIcs(url, text)
      return text
    } catch (e) {
      errors.push(e)
    }
  }
  if (cached) return cached.text
  throw new Error(
    `Gagal memuat ICS (CORS/jaringan). Coba lagi atau cek koneksi. ${errors.map((e) => String(e)).join(' | ')}`,
  )
}

function cacheKey(url: string): string {
  return ICS_CACHE_PREFIX + encodeURIComponent(url)
}

function loadCachedIcs(url: string): IcsCacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(url))
    if (!raw) return null
    const entry = JSON.parse(raw) as Partial<IcsCacheEntry>
    if (
      typeof entry.fetchedAt !== 'number' ||
      typeof entry.text !== 'string' ||
      Date.now() - entry.fetchedAt > ICS_CACHE_TTL
    ) {
      localStorage.removeItem(cacheKey(url))
      return null
    }
    return { fetchedAt: entry.fetchedAt, text: entry.text }
  } catch {
    return null
  }
}

function saveCachedIcs(url: string, text: string): void {
  try {
    localStorage.setItem(
      cacheKey(url),
      JSON.stringify({ fetchedAt: Date.now(), text } satisfies IcsCacheEntry),
    )
  } catch {
    // Quota errors must not prevent a successful network sync.
  }
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
