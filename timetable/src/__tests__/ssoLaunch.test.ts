import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildLaunchUrl,
  decodeLaunchUrl,
  md5,
  newPassport,
  MOODLE_DEFAULT_SCHEME,
  URL_SCHEME,
  WWWROOT,
} from '../lib/ssoLaunch'
import { readString } from '../lib/storage'

// localStorage stub for the passport persistence path.
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  })
})

afterEach(() => vi.unstubAllGlobals())

// Node-verified reference digests (crypto.createHash('md5')) — our md5 must
// match PHP md5() exactly, since Moodle computes md5(wwwroot + passport).
const PASSPORT_A = 'passport123'
const CHECK_A = '273b3846130e30f890b6a834177ada1c' // md5(WWWROOT + 'passport123')
const TOKEN = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'

describe('md5 implementation (cross-checked with Node crypto)', () => {
  it('matches Node for empty string', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e')
  })
  it('matches Node for "abc"', () => {
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72')
  })
  it('matches Node for the launch checksum input', () => {
    expect(md5(WWWROOT + PASSPORT_A)).toBe(CHECK_A)
  })
})

describe('ssoLaunch', () => {
  it('builds a launch URL with service, passport and urlscheme', () => {
    expect(buildLaunchUrl(PASSPORT_A)).toBe(
      'https://moodle.lut.fi/admin/tool/mobile/launch.php' +
        '?service=moodle_mobile_app&passport=passport123&urlscheme=lut-timetable',
    )
  })

  it('newPassport is 32 hex chars and persisted', () => {
    const p = newPassport()
    expect(p).toMatch(/^[0-9a-f]{32}$/)
    expect(readString('tt_moodle_sso_passport')).toBe(p)
  })

  it('decodes a real launch redirect and verifies the passport checksum', () => {
    const b64 = btoa(`${CHECK_A}:::${TOKEN}`)
    expect(decodeLaunchUrl(`${URL_SCHEME}://token=${b64}`, { passport: PASSPORT_A })).toEqual({
      token: TOKEN,
    })
  })

  it('decodes with privatenotoken part', () => {
    const b64 = btoa(`${CHECK_A}:::${'t'.repeat(32)}:::${'p'.repeat(32)}`)
    const out = decodeLaunchUrl(`${URL_SCHEME}://token=${b64}`, { passport: PASSPORT_A })
    expect(out?.token).toBe('t'.repeat(32))
    expect(out?.privatenotoken).toBe('p'.repeat(32))
  })

  it('rejects a forged redirect whose checksum does not match our passport', () => {
    const b64 = btoa(`${'0'.repeat(32)}:::${'x'.repeat(32)}`)
    expect(decodeLaunchUrl(`${URL_SCHEME}://token=${b64}`, { passport: PASSPORT_A })).toBeNull()
  })

  it('rejects when no passport is pending (one-time use enforced)', () => {
    const b64 = btoa(`${CHECK_A}:::${TOKEN}`)
    expect(decodeLaunchUrl(`${URL_SCHEME}://token=${b64}`)).toBeNull()
  })

  it('clears the stored passport after a decode attempt (one-time use)', () => {
    const p = newPassport()
    const b64 = btoa(`${md5(WWWROOT + p)}:::${TOKEN}`)
    const out = decodeLaunchUrl(`${URL_SCHEME}://token=${b64}`)
    expect(out?.token).toBe(TOKEN)
    expect(readString('tt_moodle_sso_passport')).toBeNull()
  })

  it('rejects wrong scheme and malformed payloads', () => {
    expect(decodeLaunchUrl('https://evil.example/token=AAA', { passport: 'p' })).toBeNull()
    expect(decodeLaunchUrl(`${URL_SCHEME}://token=!!!notb64!!!`, { passport: 'p' })).toBeNull()
    expect(decodeLaunchUrl(`${URL_SCHEME}://token=${btoa('noseparator')}`, { passport: 'p' })).toBeNull()
  })

  it('decodes a URL with trailing slash after payload (iOS-style)', () => {
    const b64 = btoa(`${CHECK_A}:::${TOKEN}`)
    expect(decodeLaunchUrl(`${URL_SCHEME}://token=${b64}/`, { passport: PASSPORT_A })).toEqual({
      token: TOKEN,
    })
  })

  it('accepts the moodlemobile:// scheme (site-forced via tool_mobile|forcedurlscheme)', () => {
    const b64 = btoa(`${CHECK_A}:::${TOKEN}`)
    expect(decodeLaunchUrl(`moodlemobile://token=${b64}`, { passport: PASSPORT_A })).toEqual({
      token: TOKEN,
    })
    expect(decodeLaunchUrl(`${MOODLE_DEFAULT_SCHEME}://token=${b64}/`, { passport: PASSPORT_A })).toEqual({
      token: TOKEN,
    })
    // Unknown scheme stays rejected.
    expect(decodeLaunchUrl(`evil://token=${b64}`, { passport: PASSPORT_A })).toBeNull()
  })
})
