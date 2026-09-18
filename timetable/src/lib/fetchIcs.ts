import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { TRANSIENT_KEYS } from './storage'

export const ICS_CACHE_TTL = 2 * 60 * 60 * 1000
const ICS_CACHE_PREFIX = TRANSIENT_KEYS.icsCachePrefix

interface IcsCacheEntry {
  fetchedAt: number
  text: string
}

/**
 * Fetch teks ICS dengan strategi:
 * 1. Native Capacitor (Android): langsung via CapacitorHttp, tanpa CORS.
 * 2. Electron desktop: lewat bridge preload.cjs -> ipcMain (fetch Node di
 *    main process, tanpa CORS — lihat electron/main.cjs + preload.cjs).
 * 3. Browser dev: lewat proxy Vite (/proxy/sisu, /proxy/timeedit).
 * 4. Browser production: langsung dulu (TimeEdit kirim ACAO: *),
 *    lalu fallback ke proxy CORS publik (allorigins -> corsproxy).
 */

/** Apakah preload bridge Electron (window.lutProxy) tersedia?
 *  Jangan menebak dari user-agent: jendela browser lain (mis. preview Freebuff
 *  yang memakai Chromium/Electron UA) TIDAK punya bridge ini dan harus tetap
 *  memakai jalur HTTP browser biasa. */
export function hasLutBridge(): boolean {
  return typeof window !== 'undefined' &&
    !!(window as unknown as { lutProxy?: unknown }).lutProxy
}

/** Proksi semua request lewat main process (Electron) — bebas CORS. */
export async function fetchViaElectron(
  url: string,
  init: RequestInit = {},
): Promise<string> {
  const w = window as unknown as {
    lutProxy?: {
      fetch: (u: string, i: { method?: string; headers?: Record<string, string>; body?: string | null }) => Promise<{
        ok: boolean
        status?: number
        bodyText?: string
        error?: string
      }>
    }
  }
  const bridge = w.lutProxy
  if (!bridge) throw new Error('Electron lutProxy bridge tidak tersedia')

  const u = new URL(url)
  const res = await bridge.fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      ...(u.pathname.endsWith('.ics') || u.pathname.includes('calendar')
        ? { Accept: 'text/calendar' }
        : {}),
    },
    body: typeof init.body === 'string' ? init.body : null,
  })
  if (res.error) throw new Error(res.error)
  if (!res.ok) throw new Error(`HTTP ${res.status ?? 0}`)
  return res.bodyText ?? ''
}

/** Kredensial (userid + authtoken) dari URL ekspor kalender Moodle. */
export function moodleCredsFromUrl(raw: string): { userid: string; authtoken: string } | null {
  try {
    const u = new URL(raw)
    const userid = u.searchParams.get('userid')
    const authtoken = u.searchParams.get('authtoken')
    return userid && authtoken ? { userid, authtoken } : null
  } catch {
    return null
  }
}

/** Ambil teks dari satu URL tanpa cache/fallback — digunakan berantai di bawah. */
export function fetchText(url: string): Promise<string> {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  })
}

/** Host kalender yang didukung aplikasi — daftar tunggal di sisi renderer.
 *  WAJIB tercakup oleh PROXY_HOSTS di electron/main.cjs: bridge desktop menolak
 *  host lain dengan 403 "host not allowed", dan sync-nya gagal tanpa penjelasan
 *  (persis yang terjadi pada moodle.lut.fi). Uji src/__tests__/proxyHosts.test.ts
 *  menjaga kedua daftar tetap sinkron. */
export const CALENDAR_HOSTS = [
  { host: 'sisu.lut.fi', devProxy: '/proxy/sisu' },
  { host: 'timeedit.net', devProxy: '/proxy/timeedit' },
  { host: 'moodle.lut.fi', devProxy: '/proxy/moodle' },
] as const

/** Host itu sendiri atau subdomainnya. */
function matchesHost(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith('.' + host)
}

function devProxyUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const entry = CALENDAR_HOSTS.find((h) => matchesHost(u.hostname, h.host))
    return entry ? entry.devProxy + u.pathname + u.search : null
  } catch {
    return null
  }
}

/**
 * Rantai fetch bersama untuk SEMUA sumber (ICS kalender + Moodle web service):
 * CapacitorHttp → Electron bridge → dev proxy → langsung → proxy publik.
 * Setiap langkah mencoba berurutan; kegagalan dikumpulkan untuk pesan akhir.
 */
async function fetchChain(
  url: string,
  opts: { accept: string; ttlMs: number; cacheKeyOf?: (u: string) => string },
): Promise<string> {
  const keyOf = opts.cacheKeyOf ?? cacheKey
  const cached = loadCached(keyOf(url), opts.ttlMs)

  /** Respons error Moodle ({ exception: ... }) tidak boleh masuk cache —
   *  kalau ter-cache, error "Invalid parameter" bertahan 2 jam walau
   *  permintaan berikutnya sudah benar (terjadi nyata saat grade call
   *  berubah ke per-course). Simpan hanya respons sukses. */
  const cacheable = (text: string): boolean => {
    const t = text.trimStart()
    if (t.startsWith('{') && /"exception"/.test(t.slice(0, 200))) return false
    return true
  }

  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.get({
        url,
        headers: { Accept: opts.accept },
        readTimeout: 15000,
        connectTimeout: 10000,
      })
      if (res.status >= 400) throw new Error(`HTTP ${res.status}`)
      // CapacitorHttp mem-parse respons application/json otomatis menjadi
      // objek. String(obj) menghasilkan "[object Object]" dan JSON.parse
      // selalu gagal (bug nyata: login SSO di Android -> "invalid JSON
      // from core_webservice_get_site_info"). Re-serialize agar aman.
      const text =
        typeof res.data === 'string'
          ? res.data
          : JSON.stringify(res.data)
      if (cacheable(text)) saveCached(keyOf(url), text)
      return text
    } catch (error) {
      if (cached) return cached.text
      throw error
    }
  }

  if (hasLutBridge()) {
    try {
      const text = await fetchViaElectron(url, { headers: { Accept: opts.accept } })
      if (cacheable(text)) saveCached(keyOf(url), text)
      return text
    } catch (error) {
      if (cached) return cached.text
      throw error
    }
  }

  // Langkah sisa sebagai THUNK (lazy): percobaan berikutnya hanya dibuat
  // jika yang sebelumnya gagal — tanpa ini, 4 permintaan jaringan terjadi
  // setiap panggilan walau yang pertama sukses.
  const attempts: Array<() => Promise<string>> = []

  const proxied = devProxyUrl(url)
  if (proxied) attempts.push(() => fetchText(proxied))

  // Direct: sebagian host mengizinkan CORS (mis. TimeEdit ACAO: *).
  attempts.push(() => fetchText(url))

  // Fallback proxy publik HANYA untuk URL tanpa kredensial (ICS kalender
  // publik). Panggilan webservice membawa wstoken di query — mengirimkannya
  // ke proxy pihak ketiga membocorkan token; otentik tidak pernah lewat sini.
  const authenticated = /([?&])(wstoken|authtoken|token)=/.test(url)
  if (!authenticated) {
    attempts.push(() => fetchText(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`))
    attempts.push(() => fetchText(`https://corsproxy.io/?url=${encodeURIComponent(url)}`))
  }

  const errors: unknown[] = []
  for (const attempt of attempts) {
    try {
      const text = await attempt()
      if (cacheable(text)) saveCached(keyOf(url), text)
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

/** ICS kalender (SISU/TimeEdit/Moodle) — perilaku lama `fetchIcsText`. */
export async function fetchIcsText(url: string): Promise<string> {
  return fetchChain(url, { accept: 'text/calendar', ttlMs: ICS_CACHE_TTL })
}

/**
 * Panggilan Moodle web service (REST, GET + JSON). Tanpa cache — pemanggil
 * yang memutuskan kesegaran (nilai harus terasa “real-time” saat diminta).
 */
export async function fetchMoodleWebService(url: string): Promise<string> {
  return fetchChain(url, {
    accept: 'application/json',
    ttlMs: 0,
    cacheKeyOf: (u) => TRANSIENT_KEYS.icsCachePrefix + 'grades:' + encodeURIComponent(u),
  })
}

function cacheKey(url: string): string {
  return ICS_CACHE_PREFIX + encodeURIComponent(url)
}

function loadCached(key: string, ttlMs: number = ICS_CACHE_TTL): IcsCacheEntry | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const entry = JSON.parse(raw) as Partial<IcsCacheEntry>
    if (
      ttlMs <= 0 ||
      typeof entry.fetchedAt !== 'number' ||
      typeof entry.text !== 'string' ||
      Date.now() - entry.fetchedAt > ttlMs
    ) {
      localStorage.removeItem(key)
      return null
    }
    return { fetchedAt: entry.fetchedAt, text: entry.text }
  } catch {
    return null
  }
}

function saveCached(key: string, text: string): void {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ fetchedAt: Date.now(), text } satisfies IcsCacheEntry),
    )
  } catch {
    // Quota errors must not prevent a successful network sync.
  }
}
