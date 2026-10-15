// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LocalNotifications } from '@capacitor/local-notifications'
import { KEYS } from '../lib/storage'
import {
  STUDY_BLOCK_REMIND_BEFORE_MINUTES,
  cancelStudyBlockReminders,
  refreshStudyBlockReminders,
  studyBlockNotifId,
  wantedStudyBlockReminders,
} from '../lib/studyBlockReminders'
import type { StudyBlock } from '../lib/studyBlocks'

// 【提醒契约】已确认学习块开始前 10 分钟提醒一次：
// - 唯一开关是偏好里的 remindEnabled（关掉 = 清空自己的条目，不碰别的通知）
// - id 由块 id 经 FNV-1a 推导（稳定、可反查），陈旧条目靠已排期清单对账
// - 权限未授予时既不排期也不抛错（Android 13+ 未授权时插件会在原生线程 NPE 杀进程）
// - 只读学习块：不写服务器、不动任何已读记录、不碰 Moodle 同步域

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: vi.fn(async () => ({ display: 'granted' })),
    checkExactNotificationSetting: vi.fn(async () => ({ exact_alarm: 'granted' })),
    requestPermissions: vi.fn(async () => ({ display: 'granted' })),
    getPending: vi.fn(async () => ({ notifications: [] })),
    schedule: vi.fn(async () => ({ notifications: [] })),
    cancel: vi.fn(async () => ({})),
  },
}))

const NOW = new Date('2026-09-15T12:00:00.000Z').getTime()
const TRACKED = `${KEYS.studyBlocks}:scheduled`
const HOUR = 3600 * 1000

const at = (offsetH: number) => new Date(NOW + offsetH * HOUR).toISOString()

const block = (id: string, startOffsetH: number, over: Partial<StudyBlock> = {}): StudyBlock => {
  const startAt = at(startOffsetH)
  return {
    id,
    sourceKind: 'task',
    sourceId: id,
    title: `Focus ${id}`,
    startAt,
    endAt: new Date(Date.parse(startAt) + HOUR).toISOString(),
    dueAt: new Date(Date.parse(startAt) + 6 * HOUR).toISOString(),
    createdAt: new Date(NOW).toISOString(),
    ...over,
  }
}

const texts = {
  title: 'Study block',
  body: (value: StudyBlock, time: string) => `${value.title} · ${time}`,
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  // 同文件前面的用例改过 checkPermissions，而 clearAllMocks 不还原实现：
  // 每个用例自己声明权限前提，不依赖执行顺序。
  vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' } as never)
  vi.mocked(LocalNotifications.checkExactNotificationSetting).mockResolvedValue({ exact_alarm: 'granted' } as never)
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('studyBlockNotifId', () => {
  it('is a stable positive int32 derived from the block id', () => {
    const first = studyBlockNotifId('block-a', STUDY_BLOCK_REMIND_BEFORE_MINUTES)
    const again = studyBlockNotifId('block-a', STUDY_BLOCK_REMIND_BEFORE_MINUTES)
    const other = studyBlockNotifId('block-b', STUDY_BLOCK_REMIND_BEFORE_MINUTES)
    expect(Number.isSafeInteger(first)).toBe(true)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(2147483647)
    expect(again).toBe(first)
    expect(other).not.toBe(first)
  })

  it('keeps the leading time at ten minutes', () => {
    expect(STUDY_BLOCK_REMIND_BEFORE_MINUTES).toBe(10)
  })
})

describe('wantedStudyBlockReminders', () => {
  it('asks for one reminder ten minutes before each upcoming block', () => {
    const wanted = wantedStudyBlockReminders([block('a', 3)], NOW)
    expect([...wanted.keys()]).toEqual([studyBlockNotifId('a', STUDY_BLOCK_REMIND_BEFORE_MINUTES)])
    const only = [...wanted.values()][0]
    expect(only.at.getTime()).toBe(NOW + 3 * HOUR - 10 * 60 * 1000)
    expect(only.block.id).toBe('a')
  })

  it('skips blocks that already started, invalid intervals and far-away blocks', () => {
    const past = block('past', -2)
    const invalid = { ...block('invalid', 4), startAt: 'not-a-date' }
    const reversed = { ...block('reversed', 5), endAt: at(4) }
    const far = block('far', 24 * 40)
    expect(wantedStudyBlockReminders([past, invalid, reversed, far], NOW).size).toBe(0)
  })

  it('drops a reminder whose lead time has already passed', () => {
    // 块在 5 分钟后开始，10 分钟前的提醒点已经过去
    expect(wantedStudyBlockReminders([block('soon', 5 / 60)], NOW).size).toBe(0)
  })
})

describe('refreshStudyBlockReminders', () => {
  it('schedules nothing and clears its own entries while the preference is off', async () => {
    localStorage.setItem(TRACKED, JSON.stringify([studyBlockNotifId('a', STUDY_BLOCK_REMIND_BEFORE_MINUTES)]))
    await refreshStudyBlockReminders([block('a', 3)], texts, { enabled: false })

    expect(LocalNotifications.schedule).not.toHaveBeenCalled()
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({
      notifications: [{ id: studyBlockNotifId('a', STUDY_BLOCK_REMIND_BEFORE_MINUTES) }],
    })
    expect(localStorage.getItem(TRACKED)).toBe('[]')
  })

  it('never schedules and never throws when permission is not granted', async () => {
    localStorage.setItem(TRACKED, JSON.stringify([studyBlockNotifId('a', STUDY_BLOCK_REMIND_BEFORE_MINUTES)]))
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'denied' } as never)

    await expect(refreshStudyBlockReminders([block('a', 3)], texts, { enabled: true })).resolves.toBeUndefined()

    expect(LocalNotifications.schedule).not.toHaveBeenCalled()
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({
      notifications: [{ id: studyBlockNotifId('a', STUDY_BLOCK_REMIND_BEFORE_MINUTES) }],
    })
    expect(localStorage.getItem(TRACKED)).toBe('[]')
  })

  it('schedules one reminder per upcoming block with localised text and tracks the ids', async () => {
    await refreshStudyBlockReminders([block('a', 3), block('b', 30)], texts, { enabled: true })

    const scheduled = vi.mocked(LocalNotifications.schedule).mock.calls[0][0].notifications
    expect(scheduled.map((n) => n.id)).toEqual([
      studyBlockNotifId('a', STUDY_BLOCK_REMIND_BEFORE_MINUTES),
      studyBlockNotifId('b', STUDY_BLOCK_REMIND_BEFORE_MINUTES),
    ])
    // 第二个参数是本地化的钟点串（formatter 归 lib/date），不断言具体格式，只要求带上标题
    expect(scheduled[0].title).toBe('Study block')
    expect(scheduled[0].body).toContain('Focus a')
    expect(scheduled[0].body?.length).toBeGreaterThan('Focus a · '.length)
    expect(scheduled[0].smallIcon).toBe('ic_stat_lesson')
    expect(scheduled[0].schedule?.at?.getTime()).toBe(NOW + 3 * HOUR - 10 * 60 * 1000)
    expect(JSON.parse(localStorage.getItem(TRACKED) ?? '[]')).toEqual(scheduled.map((n) => n.id))
  })

  it('cancels the reminder of a deleted block and keeps the remaining one', async () => {
    await refreshStudyBlockReminders([block('a', 3), block('b', 5)], texts, { enabled: true })
    vi.mocked(LocalNotifications.schedule).mockClear()
    vi.mocked(LocalNotifications.cancel).mockClear()

    // b 被删除：只剩 a —— 两个旧 id 全部撤销，只重排 a
    await refreshStudyBlockReminders([block('a', 3)], texts, { enabled: true })

    expect(LocalNotifications.cancel).toHaveBeenCalledWith({
      notifications: [
        { id: studyBlockNotifId('a', STUDY_BLOCK_REMIND_BEFORE_MINUTES) },
        { id: studyBlockNotifId('b', STUDY_BLOCK_REMIND_BEFORE_MINUTES) },
      ],
    })
    const scheduled = vi.mocked(LocalNotifications.schedule).mock.calls[0][0].notifications
    expect(scheduled.map((n) => n.id)).toEqual([studyBlockNotifId('a', STUDY_BLOCK_REMIND_BEFORE_MINUTES)])
  })

  it('clears every tracked entry when no block needs a reminder any more', async () => {
    await refreshStudyBlockReminders([block('a', 3)], texts, { enabled: true })
    vi.mocked(LocalNotifications.cancel).mockClear()

    await refreshStudyBlockReminders([block('a', -2)], texts, { enabled: true })

    expect(LocalNotifications.cancel).toHaveBeenCalledWith({
      notifications: [{ id: studyBlockNotifId('a', STUDY_BLOCK_REMIND_BEFORE_MINUTES) }],
    })
    expect(localStorage.getItem(TRACKED)).toBe('[]')
  })

  it('still schedules when the tracked-ids key is corrupted', async () => {
    localStorage.setItem(TRACKED, JSON.stringify({ oops: true }))
    await refreshStudyBlockReminders([block('fresh', 4)], texts, { enabled: true })
    expect(LocalNotifications.schedule).toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem(TRACKED) ?? '[]')).toEqual([
      studyBlockNotifId('fresh', STUDY_BLOCK_REMIND_BEFORE_MINUTES),
    ])
  })
})

describe('cancelStudyBlockReminders', () => {
  it('cancels only its own tracked entries and forgets them', async () => {
    localStorage.setItem(TRACKED, JSON.stringify([studyBlockNotifId('a', STUDY_BLOCK_REMIND_BEFORE_MINUTES)]))
    await cancelStudyBlockReminders()
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({
      notifications: [{ id: studyBlockNotifId('a', STUDY_BLOCK_REMIND_BEFORE_MINUTES) }],
    })
    expect(localStorage.getItem(TRACKED)).toBe('[]')
  })

  it('does not touch the plugin when nothing was ever scheduled', async () => {
    await cancelStudyBlockReminders()
    expect(LocalNotifications.cancel).not.toHaveBeenCalled()
  })
})
