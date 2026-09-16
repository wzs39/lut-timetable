import { Capacitor } from '@capacitor/core'
import { fetchText } from './fetchIcs'

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
