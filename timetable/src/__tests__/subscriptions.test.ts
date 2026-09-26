// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { FreeRoom } from '../lib/freeRooms'
import type { SyncChange } from '../lib/syncAudit'
import {
  addSubscription,
  dueSubscriptions,
  isSubscribed,
  loadSubscriptions,
  markFired,
  REFIRE_COOLDOWN_MS,
  removeSubscription,
  saveSubscriptions,
  subKey,
  toggleSubscription,
  type Subscription,
} from '../lib/subscriptions'

// 【订阅契约】只有真的有事才推；冷却期内不许重复推；静音不等于删除。

const NOW = new Date('2026-09-23T10:00:00Z').getTime()

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: 's1',
  kind: 'course-change',
  target: 'CT60A0250',
  label: 'Software Engineering',
  createdAt: '2026-09-20T00:00:00.000Z',
  enabled: true,
  ...over,
})

const change = (label: string): SyncChange => ({ kind: 'moved', key: 'k', label })
const room = (building: string, r: string): FreeRoom => ({ building, room: r, nextBusyAt: null })

beforeEach(() => localStorage.clear())

describe('mutations', () => {
  it('does not add the same target twice', () => {
    const withOne = addSubscription([], { id: 'a', kind: 'room-free', target: 'M19_AUD1B', label: 'M19 AUD1B' })
    const again = addSubscription(withOne, { id: 'b', kind: 'room-free', target: 'm19_aud1b', label: 'dup' })
    expect(again).toHaveLength(1)
    expect(again[0].id).toBe('a')
    // 同类不同目标 / 不同类同目标都可以共存
    expect(addSubscription(again, { id: 'c', kind: 'room-free', target: 'MC105', label: 'MC105' })).toHaveLength(2)
    expect(addSubscription(again, { id: 'd', kind: 'course-change', target: 'M19_AUD1B', label: 'x' })).toHaveLength(2)
  })

  it('toggles, removes and reports membership', () => {
    const list = [sub(), sub({ id: 's2', kind: 'room-free', target: 'M19_AUD1B' })]
    expect(isSubscribed(list, 'course-change', 'ct60a0250')).toBe(true)
    expect(isSubscribed(list, 'room-free', 'M19_AUD1B')).toBe(true)
    expect(isSubscribed(list, 'room-free', 'MC105')).toBe(false)
    expect(toggleSubscription(list, 's1')[0].enabled).toBe(false)
    expect(removeSubscription(list, 's1')).toHaveLength(1)
    expect(subKey('room-free', 'M19_AUD1B')).toBe('room-free:m19_aud1b')
  })

  it('round-trips through storage and drops garbage', () => {
    saveSubscriptions([sub()])
    expect(loadSubscriptions()).toHaveLength(1)
    localStorage.setItem('tt_subscriptions_v1', JSON.stringify([{ id: 1 }, sub(), { kind: 'nope' }]))
    expect(loadSubscriptions()).toHaveLength(1)
  })
})

describe('dueSubscriptions', () => {
  it('fires a course subscription when that course changed', () => {
    const list = [sub(), sub({ id: 's2', target: 'HDD4010', label: 'Human Factors' })]
    const due = dueSubscriptions(list, { changes: [change('CT60A0250')], now: NOW })
    expect(due.map((s) => s.id)).toEqual(['s1'])
  })

  it('matches room subscriptions by exact room or by building', () => {
    const exact = sub({ id: 'r1', kind: 'room-free', target: 'M19_AUD1B', label: 'M19 AUD1B' })
    const building = sub({ id: 'r2', kind: 'room-free', target: 'MC', label: 'MC105' })
    const miss = sub({ id: 'r3', kind: 'room-free', target: 'NIE73_B211', label: 'NIE73 B211' })
    const free = [room('M19', 'AUD1B'), room('MC', '105')]
    expect(dueSubscriptions([exact, building, miss], { freeRooms: free, now: NOW }).map((s) => s.id)).toEqual([
      'r1',
      'r2',
    ])
  })

  it('respects the cooldown, and silence keeps the subscription but stops it', () => {
    const recentlyFired = sub({ lastFiredAt: new Date(NOW - 60_000).toISOString() })
    const changed = [change('CT60A0250')]
    expect(dueSubscriptions([recentlyFired], { changes: changed, now: NOW })).toHaveLength(0)
    // 冷却过后再次触发
    const old = sub({ lastFiredAt: new Date(NOW - REFIRE_COOLDOWN_MS - 1).toISOString() })
    expect(dueSubscriptions([old], { changes: changed, now: NOW })).toHaveLength(1)
    // 静音
    expect(dueSubscriptions([sub({ enabled: false })], { changes: changed, now: NOW })).toHaveLength(0)
    // 坏的 lastFiredAt 不阻塞
    expect(dueSubscriptions([sub({ lastFiredAt: 'garbage' })], { changes: changed, now: NOW })).toHaveLength(1)
  })

  it('marks the fired ones so the next pass stays quiet', () => {
    const list = [sub(), sub({ id: 's2' })]
    const fired = markFired(list, ['s1'], new Date(NOW).toISOString())
    expect(fired[0].lastFiredAt).toBeTruthy()
    expect(fired[1].lastFiredAt).toBeUndefined()
    expect(dueSubscriptions(fired, { changes: [change('CT60A0250')], now: NOW })).toHaveLength(1)
  })
})
