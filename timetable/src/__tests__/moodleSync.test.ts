// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { domainCacheKey, readCache, syncDomain, writeCache } from '../lib/moodleSync'

beforeEach(() => {
  localStorage.clear()
})

describe('moodleSync cache helpers', () => {
  it('readCache honors TTL', () => {
    const key = domainCacheKey('test')
    writeJsonDirect(key, { fetchedAt: Date.now() - 1000, items: [1] })
    expect(readCache<number>(key, 30_000, (r) => r.items)).toEqual([1])
    // expired
    writeJsonDirect(key, { fetchedAt: Date.now() - 60_000, items: [1] })
    expect(readCache<number>(key, 30_000, (r) => r.items)).toBeNull()
  })

  it('readCache never throws on corrupt payloads', () => {
    const key = domainCacheKey('corrupt')
    localStorage.setItem(key, '{not json')
    expect(readCache<number>(key, 30_000, (r) => r.items)).toBeNull()
  })
})

describe('syncDomain', () => {
  const mk = () => {
    let saved: number[] | null = null
    return {
      saved: () => saved,
      save: (items: number[]) => {
        saved = items
      },
    }
  }

  it('returns cache when fresh, never touches network', async () => {
    const key = domainCacheKey('d1')
    writeCache(key, [7])
    let networkCalls = 0
    const out = await syncDomain<number>({
      cacheKey: key,
      ttlMs: 30_000,
      load: (r) => r.items,
      save: () => {},
      src: { token: 't' },
      network: async () => {
        networkCalls++
        return [9]
      },
    })
    expect(out).toEqual([7])
    expect(networkCalls).toBe(0)
  })

  it('force bypasses cache and writes result', async () => {
    const key = domainCacheKey('d2')
    writeCache(key, [7])
    const h = mk()
    const out = await syncDomain<number>({
      cacheKey: key,
      ttlMs: 30_000,
      load: (r) => r.items,
      save: h.save,
      src: { token: 't' },
      force: true,
      network: async () => [9],
    })
    expect(out).toEqual([9])
    expect(h.saved()).toEqual([9])
  })

  it('no token → cached value, no network', async () => {
    const key = domainCacheKey('d3')
    writeCache(key, [7])
    let networkCalls = 0
    const out = await syncDomain<number>({
      cacheKey: key,
      ttlMs: 30_000,
      load: (r) => r.items,
      save: () => {},
      src: null,
      network: async () => {
        networkCalls++
        return []
      },
    })
    expect(out).toEqual([7])
    expect(networkCalls).toBe(0)
  })

  it('no token and no cache → []', async () => {
    const out = await syncDomain<number>({
      cacheKey: domainCacheKey('d4'),
      ttlMs: 30_000,
      load: (r) => r.items,
      save: () => {},
      src: null,
      network: async () => [1],
    })
    expect(out).toEqual([])
  })

  it('network failure falls back to stale-or-empty, never throws', async () => {
    const key = domainCacheKey('d5')
    writeCache(key, [7])
    const out = await syncDomain<number>({
      cacheKey: key,
      ttlMs: 30_000,
      load: (r) => r.items,
      save: () => {},
      src: { token: 't' },
      force: true,
      network: async () => {
        throw new Error('boom')
      },
    })
    expect(out).toEqual([7])
    // no cache at all
    const out2 = await syncDomain<number>({
      cacheKey: domainCacheKey('d6'),
      ttlMs: 30_000,
      load: (r) => r.items,
      save: () => {},
      src: { token: 't' },
      network: async () => {
        throw new Error('boom')
      },
    })
    expect(out2).toEqual([])
  })

  it('empty network result: keeps old cache unless keepWhenEmpty', async () => {
    const key = domainCacheKey('d7')
    writeCache(key, [7])
    const h = mk()
    const out = await syncDomain<number>({
      cacheKey: key,
      ttlMs: 30_000,
      load: (r) => r.items,
      save: h.save,
      src: { token: 't' },
      force: true,
      network: async () => [],
    })
    expect(out).toEqual([7]) // falls back to (still saved) old cache
    expect(h.saved()).toBeNull() // empty result NOT written over old cache

    const h2 = mk()
    await syncDomain<number>({
      cacheKey: domainCacheKey('d8'),
      ttlMs: 30_000,
      load: (r) => r.items,
      save: h2.save,
      src: { token: 't' },
      keepWhenEmpty: true,
      network: async () => [],
    })
    expect(h2.saved()).toEqual([]) // keepWhenEmpty persists the empty list
  })
})

function writeJsonDirect(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}
