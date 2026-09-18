import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Regresi bug Android nyata: CapacitorHttp mem-parse respons
 * application/json otomatis menjadi objek, dan fetchChain memanggil
 * String(obj) -> "[object Object]" -> JSON.parse selalu gagal
 * ("invalid JSON from core_webservice_get_site_info" saat login SSO di
 * Android). FetchChain harus mengembalikan teks JSON yang bisa di-parse,
 * apa pun bentuk res.data dari native bridge.
 */

const nativeGet = vi.fn()

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { get: (...args: unknown[]) => nativeGet(...args) },
}))

// localStorage stub (vitest environment node)
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

import { fetchMoodleWebService } from '../lib/fetchIcs'

const WS_URL =
  'https://moodle.lut.fi/webservice/rest/server.php?wstoken=x&wsfunction=core_webservice_get_site_info&moodlewsrestformat=json'

afterEach(() => {
  nativeGet.mockReset()
  store.clear()
})

describe('fetchMoodleWebService di platform native', () => {
  it('CapacitorHttp mengembalikan objek ter-parse -> fetchChain tetap memberi teks JSON valid', async () => {
    nativeGet.mockResolvedValue({
      status: 200,
      data: { userid: 2291340, fullname: 'Test User' }, // objek, BUKAN string
    })
    const text = await fetchMoodleWebService(WS_URL)
    const parsed = JSON.parse(text) // harus lulus — dulu: "[object Object]"
    expect(parsed).toEqual({ userid: 2291340, fullname: 'Test User' })
  })

  it('respons string tetap diteruskan apa adanya', async () => {
    nativeGet.mockResolvedValue({
      status: 200,
      data: '{"userid":1}',
    })
    expect(JSON.parse(await fetchMoodleWebService(WS_URL))).toEqual({ userid: 1 })
  })

  it('respons exception Moodle tidak masuk cache', async () => {
    nativeGet.mockResolvedValue({
      status: 200,
      data: { exception: 'invalidtoken', message: 'Invalid token' },
    })
    await fetchMoodleWebService(WS_URL)
    expect(store.size).toBe(0)
  })

  it('HTTP >= 400 dilempar, bukan dikembalikan', async () => {
    nativeGet.mockResolvedValue({ status: 503, data: 'busy' })
    await expect(fetchMoodleWebService(WS_URL)).rejects.toThrow('HTTP 503')
  })
})
