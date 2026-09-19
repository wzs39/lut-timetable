import { Capacitor } from '@capacitor/core'
import { fetchText } from './fetchIcs'

/**
 * Buang APK lama hasil unduhan update sebelumnya.
 *
 * Dua lokasi:
 *  1. App cache (Directory.Cache) — bila unduhan lewat jalur in-app (masa depan).
 *  2. Public Download/ — bila unduhan lewat browser eksternal (jalur sekarang).
 *     File milik Download Provider; delete langsung akan gagal diam-diam di
 *     Android 11+ (scoped storage). Pemilik file adalah sistem, jadi satu-satunya
 *     cara tanpa dialog adalah MANAGE_EXTERNAL_STORAGE (izin besar, tidak layak
 *     untuk satu file APK).
 *
 * Keputusan: HANYA bersihkan app cache di sini. APK di Download/ dibiarkan —
 * meminta izin storage luas demi 1 MB APK justru merugikan privasi & trust.
 * Pengguna dapat menghapusnya dari Files app bila perlu (dokumen di summary).
 */
export async function maybeCleanOldApks(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const r = await Filesystem.readdir({ path: '', directory: Directory.Cache })
    for (const f of r.files) {
      if (f.name.toLowerCase().endsWith('.apk')) {
        try { await Filesystem.deleteFile({ path: f.name, directory: Directory.Cache }) } catch { /* locked */ }
      }
    }
  } catch { /* cache kosong / plugin absent — no-op */ }
  try {
    const bridge = (window as unknown as { Capacitor?: { Plugins?: { lutWidget?: { cleanOldApks?: () => Promise<{ removed: number }> } } } }).Capacitor?.Plugins?.lutWidget
    await bridge?.cleanOldApks?.()
  } catch { /* native bridge absent — no-op */ }
}

/** Where APK updates are published (GitHub Releases). */
const RELEASES_API =
  'https://api.github.com/repos/wzs39/lut-timetable/releases/latest'

export interface ApkUpdateInfo {
  /** Latest tagged version, e.g. "0.2.9" (no leading v) */
  version: string
  /** Direct download URL of the debug APK asset */
  apkUrl: string
}

function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export interface LatestRelease {
  tagName: string
  apkUrl: string | null
}

/** Query the GitHub releases API (pure, injectable for tests). */
export async function fetchLatestRelease(
  get: (url: string) => Promise<string> = (u) => fetchText(u),
): Promise<LatestRelease> {
  const raw = await get(RELEASES_API)
  const json = JSON.parse(raw) as {
    tag_name?: string
    assets?: { name?: string; browser_download_url?: string }[]
  }
  const apk = (json.assets ?? []).find((a) => a.name?.endsWith('.apk'))
  return {
    tagName: json.tag_name ?? '',
    apkUrl: apk?.browser_download_url ?? null,
  }
}

/**
 * Check whether a newer APK exists. Returns null when no update is needed
 * (up to date, no APK asset, or the platform is not Android).
 */
export async function checkApkUpdate(
  currentVersion: string,
  get: (url: string) => Promise<string> = (u) => fetchText(u),
  platform: string = Capacitor.getPlatform(),
): Promise<ApkUpdateInfo | null> {
  if (platform !== 'android') return null
  const rel = await fetchLatestRelease(get)
  if (!rel.tagName || cmpVersion(rel.tagName, currentVersion) <= 0) return null
  if (!rel.apkUrl) return null
  return {
    version: rel.tagName.replace(/^v/, ''),
    apkUrl: rel.apkUrl,
  }
}
