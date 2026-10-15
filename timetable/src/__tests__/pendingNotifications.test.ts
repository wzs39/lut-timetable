import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  PENDING_LIST_LIMIT,
  loadPendingNotifications,
  pendingItemFrom,
  summarizePending,
} from '../lib/pendingNotifications'

/**
 * 【契约】诊断面板的数据来源：只读系统队列、对脏载荷全容忍、失败要能说清原因。
 *
 * 这组测试锁住三件事：
 * 1. 排序与 `next` 的语义——「下一条什么时候响」是用户最常问的问题；
 * 2. 脏/缺字段记录被丢掉而不是把整块视图弄崩（平台之间 `schedule.at` 形态不同）；
 * 3. 插件抛错时**异常文本要带回去**，不能吞成「空队列」——那会把线索删掉。
 */

const { mockGetPending } = vi.hoisted(() => ({
  mockGetPending: vi.fn<() => Promise<unknown>>(),
}))

vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { getPending: mockGetPending },
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('pendingItemFrom', () => {
  it('keeps id/title/body and normalizes schedule.at from string, number and Date', () => {
    expect(
      pendingItemFrom({ id: 1, title: 'A', body: 'B', schedule: { at: '2026-10-16T07:00:00.000Z' } }),
    ).toEqual({ id: 1, title: 'A', body: 'B', at: '2026-10-16T07:00:00.000Z' })
    expect(pendingItemFrom({ id: 2, schedule: { at: 0 } })?.at).toBe('1970-01-01T00:00:00.000Z')
    expect(pendingItemFrom({ id: 3, schedule: { at: new Date('2026-10-16T07:00:00.000Z') } })?.at).toBe(
      '2026-10-16T07:00:00.000Z',
    )
  })

  it('rejects records without a numeric id and never throws on junk', () => {
    expect(pendingItemFrom({ id: '7', schedule: { at: '2026-10-16T07:00:00.000Z' } })).toBeNull()
    expect(pendingItemFrom({ title: 'no id' })).toBeNull()
    expect(pendingItemFrom(null)).toBeNull()
    expect(pendingItemFrom('nope')).toBeNull()
  })

  it('tolerates a missing schedule / unparseable time by leaving at null', () => {
    expect(pendingItemFrom({ id: 4 })).toEqual({ id: 4, title: '', body: '', at: null })
    expect(pendingItemFrom({ id: 5, schedule: { at: 'not a date' } })?.at).toBeNull()
    expect(pendingItemFrom({ id: 6, schedule: {} })?.at).toBeNull()
  })
})

describe('summarizePending', () => {
  const now = Date.parse('2026-10-15T12:00:00.000Z')
  const raw = {
    notifications: [
      { id: 30, title: 'later', schedule: { at: '2026-10-15T14:00:00.000Z' } },
      { id: 10, title: 'past', schedule: { at: '2026-10-15T11:00:00.000Z' } },
      { id: 20, title: 'soon', schedule: { at: '2026-10-15T12:30:00.000Z' } },
      { id: 40, title: 'undated' },
      { id: 'bad', title: 'junk', schedule: { at: '2026-10-15T13:00:00.000Z' } },
    ],
  }

  it('sorts by fire time ascending, puts undated entries last and drops junk', () => {
    const summary = summarizePending(raw, now)
    expect(summary.items.map((i) => i.id)).toEqual([10, 20, 30, 40])
    expect(summary.next?.id).toBe(20)
    expect(summary.overdue).toBe(1)
  })

  it('reports no next entry but still counts overdue when nothing lies ahead', () => {
    const summary = summarizePending(
      { notifications: [{ id: 1, title: 'x', schedule: { at: '2026-10-15T11:00:00.000Z' } }] },
      now,
    )
    expect(summary.next).toBeNull()
    expect(summary.overdue).toBe(1)
    expect(summary.items).toHaveLength(1)
  })

  it('accepts a bare array and treats anything else as empty', () => {
    expect(summarizePending([{ id: 1, schedule: { at: '2026-10-15T13:00:00.000Z' } }], now).items).toHaveLength(1)
    expect(summarizePending(null, now).items).toEqual([])
    expect(summarizePending({ notifications: 'nope' }, now).items).toEqual([])
    expect(summarizePending(undefined, now).items).toEqual([])
  })

  it('keeps the list cap small enough to stay a glance, not a history', () => {
    expect(PENDING_LIST_LIMIT).toBeGreaterThan(0)
    expect(PENDING_LIST_LIMIT).toBeLessThanOrEqual(10)
  })
})

describe('loadPendingNotifications', () => {
  it('returns the summary when the plugin answers', async () => {
    mockGetPending.mockResolvedValue({
      notifications: [{ id: 9, title: '学习时段提醒', body: '块 · 10:00 开始', schedule: { at: '2026-10-16T07:00:00.000Z' } }],
    })
    const report = await loadPendingNotifications(Date.parse('2026-10-15T12:00:00.000Z'))
    expect(report.ok).toBe(true)
    expect(report.next?.title).toBe('学习时段提醒')
    expect(report.error).toBeUndefined()
  })

  it('surfaces the plugin error instead of pretending the queue is empty', async () => {
    mockGetPending.mockRejectedValue(new Error('LocalNotifications.getPending not implemented on web'))
    const report = await loadPendingNotifications()
    expect(report.ok).toBe(false)
    expect(report.items).toEqual([])
    expect(report.error).toContain('not implemented on web')
  })

  it('survives a non-Error rejection', async () => {
    mockGetPending.mockRejectedValue('permission denied')
    const report = await loadPendingNotifications()
    expect(report.ok).toBe(false)
    expect(report.error).toBe('permission denied')
  })
})
