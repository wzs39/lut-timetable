// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTIF_LEDGER_KEYS, loadNotifLedger, ownedStaleIds, saveNotifLedger } from '../lib/notifLedger'
import {
  LESSON_LEDGER_KEY,
  cancelAllNotifications,
  cancelLessonReminders,
  lessonNotifId,
  refreshNotifications,
} from '../lib/notifications'
import {
  cancelDueReminders,
  dueNotifId,
  refreshDueNotifications,
} from '../lib/dueNotifications'
import { cancelExamReminders, examNotifId, refreshExamReminders } from '../lib/examReminders'
import {
  cancelDigestNotifications,
  digestIdFor,
  planDigests,
  refreshDigestNotifications,
  resetDigestSignature,
} from '../lib/dailyDigest'
import type { Lesson } from '../types'
import type { Task } from '../lib/tasks'

/**
 * 【契约】提醒家族之间不得互删。
 *
 * 曾经的实现是「取消一切不在当前 wanted 里的通知」——wanted 为空时等于清空整个队列，
 * 把任务/考试/学习时段/摘要提醒一起删掉；四个家族又并发调用，所以被删的那家会出现
 * 「记账里还记着 id、队列里已经没了」（到点不会响）。这组测试锁住两件事：
 * 1. 只取消「记账里有 ∧ 队列里在 ∧ 现在不想要」；
 * 2. 课程刷卡别人的条目时，cancel 的载荷里绝不能出现别人的 id。
 */

const { mockGetPending, mockCancel, mockSchedule, mockUpdate } = vi.hoisted(() => ({
  mockGetPending: vi.fn<() => Promise<unknown>>(),
  mockCancel: vi.fn<(arg: unknown) => Promise<void>>(async () => {}),
  mockSchedule: vi.fn<(arg: unknown) => Promise<void>>(async () => {}),
  mockUpdate: vi.fn<(arg: unknown) => Promise<void>>(async () => {}),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'web' } }))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    getPending: mockGetPending,
    cancel: mockCancel,
    schedule: mockSchedule,
    update: mockUpdate,
    // 权限闸门必须显式声明前提：ensurePermission 会先问它，不然整个家族都跑不起来
    checkPermissions: vi.fn(async () => ({ display: 'granted' })),
  },
}))

const FOREIGN_ID = 424242 // 别家家族排的（如学习时段提醒）

const TEXTS = { title: '即将上课', body: (_l: Lesson, time: string) => `body ${time}` }

function lesson(id: string, startOffsetMs: number): Lesson {
  const start = Date.now() + startOffsetMs
  return {
    id,
    source: 'sisu',
    title: 'Kurssi',
    code: 'REF100',
    start: new Date(start).toISOString(),
    end: new Date(start + 3600000).toISOString(),
  }
}

function pendingWith(ids: number[]) {
  return {
    notifications: ids.map((id) => ({ id, title: 'x', schedule: { at: new Date(Date.now() + 60000) } })),
  }
}

/** 记录 cancel 请求里带上的所有 id。 */
function cancelledIds(): number[] {
  return mockCancel.mock.calls.flatMap((call) => {
    const arg = call[0] as { notifications: { id: number }[] }
    return arg.notifications.map((n) => n.id)
  })
}

const HOURS = 3600_000
const DAYS = 24 * HOURS

const DUE_TEXTS = { title: () => '作业即将截止', body: () => 'x' }
const EXAM_TEXTS = { title: '考试提醒', body: () => 'x' }
const DIGEST_TEXTS = { title: '每日摘要', empty: 'none', body: () => 'x' }

function task(id: string, dueInMs: number): Task {
  return {
    id,
    title: id,
    dueAt: new Date(Date.now() + dueInMs).toISOString(),
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function exam(id: string, startInMs: number): Lesson {
  return { ...lesson(id, startInMs), type: 'exam' }
}

beforeEach(() => {
  resetDigestSignature()
})

afterEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('ownedStaleIds', () => {
  it('cancels only ids that are recorded, queued and no longer wanted', () => {
    expect(ownedStaleIds([1, 2, 3], [1, 2, 9], [2])).toEqual([1])
  })

  it('never touches queued notifications it did not record', () => {
    expect(ownedStaleIds([], [FOREIGN_ID], [])).toEqual([])
  })

  it('ignores recorded ids that already left the queue (fired or cancelled)', () => {
    expect(ownedStaleIds([7], [], [])).toEqual([])
  })
})

describe('lesson family sweep is scoped to its own work', () => {
  it('touches nothing when the queue only holds other families entries', async () => {
    mockGetPending.mockResolvedValue(pendingWith([FOREIGN_ID]))

    await refreshNotifications([], TEXTS)

    // wanted 为空 + 记账为空 → 一个都不许取消（这正是“清空整个队列”那个 bug 的回归点）
    expect(mockCancel).not.toHaveBeenCalled()
    expect(mockSchedule).not.toHaveBeenCalled()
  })

  it('cancels its own stale reminder while leaving the foreign one alone', async () => {
    const gone = lessonNotifId('lesson-that-was-deleted')
    mockGetPending.mockResolvedValue(pendingWith([gone, FOREIGN_ID]))
    saveNotifLedger(LESSON_LEDGER_KEY, [gone])

    await refreshNotifications([], TEXTS)

    expect(cancelledIds()).toEqual([gone])
    expect(cancelledIds()).not.toContain(FOREIGN_ID)
  })

  it('is idempotent: a second run with the same inputs cancels nothing new', async () => {
    mockGetPending.mockResolvedValue(pendingWith([FOREIGN_ID]))
    await refreshNotifications([], TEXTS)
    await refreshNotifications([], TEXTS)
    expect(mockCancel).not.toHaveBeenCalled()
  })
})

describe('ledger storage', () => {
  it('round-trips and tolerates junk', () => {
    saveNotifLedger('tt_notif_ledger_test', [1, 2])
    expect(loadNotifLedger('tt_notif_ledger_test')).toEqual([1, 2])
    localStorage.setItem('tt_notif_ledger_test', '{"not":"an array"}')
    expect(loadNotifLedger('tt_notif_ledger_test')).toEqual([])
    localStorage.setItem('tt_notif_ledger_test', '[1,"x",2.5,3]')
    expect(loadNotifLedger('tt_notif_ledger_test')).toEqual([1, 3])
  })
})

describe('switching the family off', () => {
  it('cancels current lessons plus recorded leftovers, never foreign ids, and clears the ledger', async () => {
    const current = lesson('lesson-live', 3600000)
    const live = lessonNotifId('lesson-live')
    const gone = lessonNotifId('lesson-deleted-earlier')
    mockGetPending.mockResolvedValue(pendingWith([live, gone, FOREIGN_ID]))
    saveNotifLedger(LESSON_LEDGER_KEY, [gone])

    await cancelLessonReminders([current])

    expect(cancelledIds().sort()).toEqual([live, gone].sort()) // 已删课程的残留也要清
    expect(cancelledIds()).not.toContain(FOREIGN_ID)
    expect(loadNotifLedger(LESSON_LEDGER_KEY)).toEqual([])
  })

  it('clears the queue and the lesson ledger when everything is switched off', async () => {
    mockGetPending.mockResolvedValue(pendingWith([5]))
    saveNotifLedger(LESSON_LEDGER_KEY, [5])
    await cancelAllNotifications()
    expect(cancelledIds()).toEqual([5])
    expect(loadNotifLedger(LESSON_LEDGER_KEY)).toEqual([])
  })
})

/**
 * 【契约】due / exam / digest 三家与课程家族同一条规矩：**只清扫记账里自己排过的**。
 *
 * 这三家此前靠「从当前数据反推 id」做清扫——条目一旦被删（任务删了、考试课取消、
 * 摘要过了窗口）id 就再也算不出来，残留通知会一直躺在队列里到点还响一声。
 * 记账把「我排过谁」变成一等数据，于是删条目也能被清掉，且永远不碰别人的 id。
 */
describe('due family sweep is scoped to its own work', () => {
  it('cancels the recorded reminder of a deleted task and nothing else', async () => {
    const gone = dueNotifId('task-deleted', 24)
    mockGetPending.mockResolvedValue(pendingWith([gone, FOREIGN_ID]))
    saveNotifLedger(NOTIF_LEDGER_KEYS.due, [gone])

    await refreshDueNotifications([], DUE_TEXTS)

    expect(cancelledIds()).toEqual([gone])
    expect(cancelledIds()).not.toContain(FOREIGN_ID)
  })

  it('records what it scheduled (24h + 1h) so a later removal can be swept', async () => {
    mockGetPending.mockResolvedValue(pendingWith([]))
    await refreshDueNotifications([task('t1', 30 * HOURS)], DUE_TEXTS)
    expect(loadNotifLedger(NOTIF_LEDGER_KEYS.due).sort()).toEqual(
      [dueNotifId('t1', 24), dueNotifId('t1', 1)].sort(),
    )
  })

  it('cancels current tasks plus recorded leftovers and clears its ledger when switched off', async () => {
    const live = dueNotifId('task-live', 24)
    const gone = dueNotifId('task-gone', 24)
    mockGetPending.mockResolvedValue(pendingWith([live, gone, FOREIGN_ID]))
    saveNotifLedger(NOTIF_LEDGER_KEYS.due, [gone])

    await cancelDueReminders([task('task-live', 30 * HOURS)])

    expect(cancelledIds().sort()).toEqual([live, gone].sort())
    expect(cancelledIds()).not.toContain(FOREIGN_ID)
    expect(loadNotifLedger(NOTIF_LEDGER_KEYS.due)).toEqual([])
  })
})

describe('exam family sweep is scoped to its own work', () => {
  it('cancels the recorded reminder of a cancelled exam and nothing else', async () => {
    const gone = examNotifId('exam-deleted', 1)
    mockGetPending.mockResolvedValue(pendingWith([gone, FOREIGN_ID]))
    saveNotifLedger(NOTIF_LEDGER_KEYS.exam, [gone])

    await refreshExamReminders([], EXAM_TEXTS)

    expect(cancelledIds()).toEqual([gone])
    expect(cancelledIds()).not.toContain(FOREIGN_ID)
  })

  it('records what it scheduled and clears its ledger when switched off', async () => {
    mockGetPending.mockResolvedValue(pendingWith([]))
    await refreshExamReminders([exam('exam-live', 4 * DAYS)], EXAM_TEXTS)
    // 4 天后的考试：7 天前那条已过 → 只排 1 天前那条
    expect(loadNotifLedger(NOTIF_LEDGER_KEYS.exam)).toEqual([examNotifId('exam-live', 1)])

    const live = examNotifId('exam-live', 1)
    const gone = examNotifId('exam-gone', 1)
    mockGetPending.mockResolvedValue(pendingWith([live, gone, FOREIGN_ID]))
    saveNotifLedger(NOTIF_LEDGER_KEYS.exam, [gone])
    await cancelExamReminders([exam('exam-live', 4 * DAYS)])
    expect(cancelledIds().sort()).toEqual([live, gone].sort())
    expect(cancelledIds()).not.toContain(FOREIGN_ID)
    expect(loadNotifLedger(NOTIF_LEDGER_KEYS.exam)).toEqual([])
  })
})

describe('digest family sweep is scoped to its own work', () => {
  it('cancels a recorded digest id that has left the window', async () => {
    const now = new Date()
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    const gone = digestIdFor(yesterday)
    mockGetPending.mockResolvedValue(pendingWith([gone, FOREIGN_ID]))
    saveNotifLedger(NOTIF_LEDGER_KEYS.digest, [gone])

    await refreshDigestNotifications([], DIGEST_TEXTS, 'zh', now)

    expect(cancelledIds()).toEqual([gone])
    expect(cancelledIds()).not.toContain(FOREIGN_ID)
  })

  it('records this window’s plan so a later window shift can sweep the tail', async () => {
    const now = new Date()
    mockGetPending.mockResolvedValue(pendingWith([]))
    await refreshDigestNotifications([], DIGEST_TEXTS, 'zh', now)
    const planned = planDigests([], now, DIGEST_TEXTS).map((p) => p.id)
    expect(loadNotifLedger(NOTIF_LEDGER_KEYS.digest).sort()).toEqual([...planned].sort())
  })

  it('clears its ledger and leftovers when switched off', async () => {
    const now = new Date()
    const old = digestIdFor(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3))
    mockGetPending.mockResolvedValue(pendingWith([old, FOREIGN_ID]))
    saveNotifLedger(NOTIF_LEDGER_KEYS.digest, [old])

    await cancelDigestNotifications(now)

    expect(cancelledIds()).toEqual([old])
    expect(cancelledIds()).not.toContain(FOREIGN_ID)
    expect(loadNotifLedger(NOTIF_LEDGER_KEYS.digest)).toEqual([])
  })
})
