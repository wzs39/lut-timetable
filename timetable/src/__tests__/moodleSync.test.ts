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
  it('concurrent calls for the same domain share ONE network promise', async () => {
    const key = domainCacheKey('dedup1')
    let networkCalls = 0
    let release!: (v: number[]) => void
    const gate = new Promise<number[]>((res) => {
      release = res
    })
    const opts = {
      cacheKey: key,
      ttlMs: 30_000,
      load: (r: { items: number[] }) => r.items,
      save: () => {},
      src: { token: 't' },
      force: true,
      network: async () => {
        networkCalls++
        return gate
      },
    }
    const a = syncDomain<number>(opts)
    const b = syncDomain<number>(opts)
    await new Promise((r) => setTimeout(r, 0)) // flush microtasks: shared call has dialed once
    expect(networkCalls).toBe(1) // second caller joined, did not re-dial
    release([5])
    expect(await a).toEqual([5])
    expect(await b).toEqual([5])

    // Map cleaned after settle → a later call dials the network again
    await syncDomain<number>({
      ...opts,
      network: async () => {
        networkCalls++
        return [6]
      },
    })
    expect(networkCalls).toBe(2)
  })

  it('failure is never cached: joiners fall back to cache, next call retries network', async () => {
    const key = domainCacheKey('dedup2')
    writeCache(key, [7])
    let networkCalls = 0
    let fail = true
    const opts = {
      cacheKey: key,
      ttlMs: 30_000,
      load: (r: { items: number[] }) => r.items,
      save: () => {},
      src: { token: 't' },
      force: true,
      network: async () => {
        networkCalls++
        if (fail) throw new Error('boom')
        return [9]
      },
    }
    const a = syncDomain<number>(opts)
    const b = syncDomain<number>(opts)
    // both joiners of the failed shared promise fall back to their own cache
    expect(await a).toEqual([7])
    expect(await b).toEqual([7])
    fail = false
    const c = await syncDomain<number>(opts)
    expect(c).toEqual([9]) // retried instead of being stuck on a cached failure
    expect(networkCalls).toBe(2)
  })

  it('different domains never share an in-flight promise', async () => {
    let calls = 0
    const mk = (name: string) => ({
      cacheKey: domainCacheKey(name),
      ttlMs: 30_000,
      load: (r: { items: number[] }) => r.items,
      save: () => {},
      src: { token: 't' },
      force: true,
      network: async () => {
        calls++
        return [calls]
      },
    })
    const [x, y] = await Promise.all([syncDomain<number>(mk('da')), syncDomain<number>(mk('db'))])
    expect(calls).toBe(2)
    expect(x).toEqual([1])
    expect(y).toEqual([2])
  })
})

function writeJsonDirect(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value))
}
