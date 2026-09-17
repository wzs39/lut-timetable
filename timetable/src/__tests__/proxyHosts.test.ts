// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { CALENDAR_HOSTS, fetchIcsText } from '../lib/fetchIcs'

/**
 * Penjaga: allowlist bridge Electron (PROXY_HOSTS di electron/main.cjs) harus
 * mencakup SETIAP host yang bisa diminta renderer.
 *
 * Bridge menolak host lain dengan 403 "host not allowed", dan renderer cuma
 * melihat "HTTP 403" — sync Moodle diam-diam mati karena moodle.lut.fi tidak
 * pernah didaftarkan (bug yang sama bentuknya dengan scope Tauri sebelumnya).
 */
const electronSources = import.meta.glob('../../electron/*.cjs', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const mainCjs = Object.entries(electronSources).find(([p]) => p.endsWith('main.cjs'))?.[1]

/** Aturan yang dipakai bridge, dibaca dari sumbernya sendiri. */
function bridgeAllowlist(): string[] {
  const m = mainCjs?.match(/const PROXY_HOSTS = \[([^\]]*)\]/)
  expect(m, 'PROXY_HOSTS tidak ditemukan di electron/main.cjs').toBeTruthy()
  return [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}

/** Cermin dari predikat di ipcMain.handle('lut-proxy-fetch'). */
const bridgeAllows = (allowed: string[], url: string) => {
  const host = new URL(url).hostname
  return allowed.some((h) => host === h || host.endsWith('.' + h))
}

// URL berisi nilai sintetis — bentuknya sama dengan yang asli, tokennya palsu.
const SAMPLE_URLS: Record<string, string> = {
  'SISU calendar-share ICS':
    'https://sisu.lut.fi/ilmo/api/calendar-share/00000000-0000-4000-8000-000000000000',
  'SISU course API': 'https://sisu.lut.fi/api/',
  'TimeEdit ICS': 'https://cloud.timeedit.net/lut/student/ri1EXAMPLE.ics',
  'Moodle calendar export':
    'https://moodle.lut.fi/calendar/export_execute.php?userid=1&authtoken=0badc0ffee0badc0ffee0badc0ffee0badc0ffee&preset_what=all&preset_time=custom',
}

describe('electron proxy allowlist', () => {
  it('allows every host the renderer can request', () => {
    const allowed = bridgeAllowlist()
    const denied = Object.entries(SAMPLE_URLS)
      .filter(([, url]) => !bridgeAllows(allowed, url))
      .map(([label, url]) => `${label} (${new URL(url).hostname})`)
    expect(denied).toEqual([])
  })

  it('covers every supported calendar host', () => {
    const allowed = bridgeAllowlist()
    const uncovered = CALENDAR_HOSTS.map((h) => h.host).filter(
      (host) => !allowed.some((h) => h === host || h.endsWith('.' + host)),
    )
    expect(uncovered).toEqual([])
  })

  it('keeps Moodle allowed (regression: desktop Moodle sync died on 403)', () => {
    expect(bridgeAllows(bridgeAllowlist(), SAMPLE_URLS['Moodle calendar export'])).toBe(true)
  })

  it('still denies hosts outside the calendar sources', () => {
    const allowed = bridgeAllowlist()
    expect(bridgeAllows(allowed, 'https://example.com/evil.ics')).toBe(false)
    expect(bridgeAllows(allowed, 'https://moodle.lut.fi.evil.example/ics')).toBe(false)
  })
})

/**
 * Di browser (tanpa CapacitorHttp, tanpa bridge) setiap sumber harus lewat
 * proxy dev yang tepat — pemetaan host→path ini yang dipakai ulang oleh
 * CALENDAR_HOSTS, jadi ia ikut dijaga di sini.
 */
describe('browser dev-proxy routing', () => {
  async function firstAttempt(url: string): Promise<string> {
    const original = globalThis.fetch
    const calls: string[] = []
    globalThis.fetch = (async (input: unknown) => {
      calls.push(String(input))
      return { ok: true, status: 200, text: async () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' }
    }) as unknown as typeof fetch
    try {
      localStorage.clear()
      await fetchIcsText(url)
      return calls[0] ?? '(no request)'
    } finally {
      globalThis.fetch = original
    }
  }

  const CASES: Record<string, string> = {
    'SISU calendar-share ICS': '/proxy/sisu/ilmo/api/calendar-share/',
    'TimeEdit ICS': '/proxy/timeedit/lut/student/',
    'Moodle calendar export': '/proxy/moodle/calendar/export_execute.php',
  }

  for (const [label, prefix] of Object.entries(CASES)) {
    it(`routes ${label} through its dev proxy`, async () => {
      expect(await firstAttempt(SAMPLE_URLS[label])).toContain(prefix)
    })
  }
})
