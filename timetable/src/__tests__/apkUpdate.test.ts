import { describe, expect, it } from 'vitest'
import { checkApkUpdate, fetchLatestRelease } from '../lib/apkUpdate'

const store = new Map<string, string>()
if (!globalThis.localStorage) {
  ;(globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
}

function releaseJson(tag: string, assets: string[] = ['app-debug.apk']): string {
  return JSON.stringify({
    tag_name: tag,
    html_url: `https://github.com/wzs39/lut-timetable/releases/tag/${tag}`,
    assets: assets.map((name) => ({
      name,
      browser_download_url: `https://github.com/wzs39/lut-timetable/releases/download/${tag}/${name}`,
    })),
  })
}

describe('fetchLatestRelease', () => {
  it('parses tag and the APK asset URL', async () => {
    const r = await fetchLatestRelease(async () => releaseJson('v0.2.9'))
    expect(r.tagName).toBe('v0.2.9')
    expect(r.apkUrl).toContain('releases/download/v0.2.9/app-debug.apk')
  })

  it('returns null apkUrl when no APK asset exists', async () => {
    const r = await fetchLatestRelease(async () =>
      releaseJson('v0.2.9', ['setup.exe', 'latest.yml']),
    )
    expect(r.apkUrl).toBeNull()
  })
})

describe('checkApkUpdate', () => {
  it('detects a newer release and strips the v prefix', async () => {
    const info = await checkApkUpdate('0.2.8', async () => releaseJson('v0.2.9'), 'android')
    expect(info).not.toBeNull()
    expect(info!.version).toBe('0.2.9')
    expect(info!.apkUrl).toContain('.apk')
  })

  it('returns null when current version equals latest', async () => {
    const info = await checkApkUpdate('0.2.9', async () => releaseJson('v0.2.9'), 'android')
    expect(info).toBeNull()
  })

  it('returns null when latest is older', async () => {
    const info = await checkApkUpdate('0.3.0', async () => releaseJson('v0.2.9'), 'android')
    expect(info).toBeNull()
  })

  it('returns null when there is no APK asset', async () => {
    const info = await checkApkUpdate(
      '0.2.8',
      async () => releaseJson('v0.2.9', ['setup.exe']),
      'android',
    )
    expect(info).toBeNull()
  })
})
