// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import NotificationManager from '../../components/NotificationManager'
import { I18nProvider } from '../../i18n'
import type { StudyBlock } from '../../lib/studyBlocks'

/**
 * 【接线契约】学习块提醒只在「通知总开关 + 偏好里的 remindEnabled」都打开时排期；
 * 任一关闭时只清自己的条目，不误伤课程/任务/考试/摘要提醒。
 */

const { mockRefreshStudyBlocks, mockCancelStudyBlocks, mockHeal, mockLogError, mockCancelAllFamilies } =
  vi.hoisted(() => ({
    mockRefreshStudyBlocks: vi.fn<
      (blocks: unknown[], texts: unknown, options: unknown) => Promise<void>
    >(async () => {}),
    mockCancelStudyBlocks: vi.fn<() => Promise<void>>(async () => {}),
    mockCancelAllFamilies: vi.fn<() => Promise<void>>(async () => {}),
    mockHeal: vi.fn<(texts: unknown, options: unknown) => Promise<Record<string, unknown>>>(async () => ({
      attempted: false,
      before: 0,
      after: 0,
      healed: true,
    })),
    mockLogError: vi.fn(),
  }))

vi.mock('../../hooks/useMoodleData', () => ({
  useMoodleData: () => ({ refreshFromNotification: vi.fn(), markNotificationRead: vi.fn() }),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' } }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: { addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })) } }))
vi.mock('../../lib/notifications', () => ({
  cancelLessonReminders: vi.fn(async () => {}),
  refreshNotifications: vi.fn(async () => {}),
  cancelAllNotifications: vi.fn(async () => {}),
  notifyNow: vi.fn(async () => true),
  // 自愈注册表要从「各家自己的纯函数」现算期望，缺了导出就会在自愈跑起来时炸
  wantedLessonReminders: vi.fn(() => new Map()),
}))
vi.mock('../../lib/dueNotifications', () => ({
  cancelDueReminders: vi.fn(async () => {}),
  refreshDueNotifications: vi.fn(async () => {}),
  wantedReminders: vi.fn(() => new Map()),
}))
vi.mock('../../lib/examReminders', () => ({
  cancelExamReminders: vi.fn(async () => {}),
  refreshExamReminders: vi.fn(async () => {}),
  wantedExamReminders: vi.fn(() => new Map()),
}))
vi.mock('../../lib/dailyDigest', () => ({
  cancelDigestNotifications: vi.fn(async () => {}),
  refreshDigestNotifications: vi.fn(async () => {}),
  plannedDigestDays: vi.fn(() => []),
  digestIdFor: vi.fn(() => 0),
}))
vi.mock('../../lib/subscriptions', () => ({ dueSubscriptions: vi.fn(() => []) }))
vi.mock('../../lib/syncAudit', () => ({ loadAudits: vi.fn(() => []), CHANGE_KIND_KEY: {} }))
vi.mock('../../lib/freeRooms', () => ({ freeRoomsNow: vi.fn(() => []) }))
vi.mock('../../lib/openExternal', () => ({ openExternal: vi.fn() }))
vi.mock('../../lib/studyBlockReminders', () => ({
  refreshStudyBlockReminders: mockRefreshStudyBlocks,
  cancelStudyBlockReminders: mockCancelStudyBlocks,
  wantedStudyBlockReminders: vi.fn(() => new Map()),
}))
vi.mock('../../lib/reminderHealth', () => ({
  healMissingReminders: mockHeal,
  cancelAllReminderFamilies: mockCancelAllFamilies,
}))
vi.mock('../../lib/errorLog', () => ({ logError: mockLogError }))

const blocks: StudyBlock[] = [{
  id: 'b1', sourceKind: 'task', sourceId: 'b1', title: 'Focus', startAt: '2026-10-16T08:00:00.000Z',
  endAt: '2026-10-16T09:00:00.000Z', dueAt: '2026-10-16T20:00:00.000Z', createdAt: '2026-10-15T08:00:00.000Z',
}]

function renderManager(props: { enabled: boolean; studyBlockRemindEnabled: boolean }) {
  render(
    <I18nProvider>
      <NotificationManager enabled={props.enabled} digestEnabled={false} lessons={[]} tasks={[]} studyBlocks={blocks} studyBlockRemindEnabled={props.studyBlockRemindEnabled} />
    </I18nProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('NotificationManager study block reminders', () => {
  it('schedules study block reminders only when both switches are on', () => {
    renderManager({ enabled: true, studyBlockRemindEnabled: true })
    expect(mockRefreshStudyBlocks).toHaveBeenCalledTimes(1)
    expect(mockRefreshStudyBlocks.mock.calls[0][0]).toEqual(blocks)
    expect(mockCancelStudyBlocks).not.toHaveBeenCalled()
  })

  it('cancels its own reminders when the preference is off', () => {
    renderManager({ enabled: true, studyBlockRemindEnabled: false })
    expect(mockRefreshStudyBlocks).not.toHaveBeenCalled()
    expect(mockCancelStudyBlocks).toHaveBeenCalledTimes(1)
  })

  it('cancels every family’s reminders when notifications are switched off globally', () => {
    renderManager({ enabled: false, studyBlockRemindEnabled: true })
    expect(mockRefreshStudyBlocks).not.toHaveBeenCalled()
    // 总开关关闭走的是「清空队列 + 清空六家记账」**这一个入口**（记账不清会让设置里的对账
    // 报出一条不存在的陈旧提醒），所以这里锁的是那个入口被调用，而不是某一家的 cancel。
    // 六家记账是否真被清空由 reminderFamiliesConcurrency.test.ts 在真实存储上验证。
    expect(mockCancelAllFamilies).toHaveBeenCalledTimes(1)
  })

  /**
   * 【契约】自愈必须**排在本次刷新之后**：抢在排期前对账只会把「还没写队列」
   * 当成「队列缺条目」，于是每轮都白排一次。顺序用可控 promise 固定住。
   */
  it('heals after the family refresh settles, not before', async () => {
    let settle: () => void = () => {}
    mockRefreshStudyBlocks.mockReturnValueOnce(new Promise<void>((resolve) => { settle = resolve }))
    renderManager({ enabled: true, studyBlockRemindEnabled: true })

    await waitFor(() => expect(mockRefreshStudyBlocks).toHaveBeenCalledTimes(1))
    expect(mockHeal).not.toHaveBeenCalled()

    settle()
    await waitFor(() => expect(mockHeal).toHaveBeenCalledTimes(1))
    // 自愈拿到的是一张**家族注册表**（每家自带「本应排上什么」与「怎么重排」）+ 开关，
    // 而不是「一段文案」——只有注册表才能让「只修缺的那几家」得以实现。
    const [repairs, options] = mockHeal.mock.calls[0] as unknown as [
      { family: string; expected: (at: number) => number[]; refresh: () => unknown }[],
      { enabled: boolean },
    ]
    expect(options).toEqual({ enabled: true })
    // 摘要开着的时候它也会进表；本用例摘要关着，故只有四家
    expect(repairs.map((r) => r.family).sort()).toEqual(['due', 'exam', 'lesson', 'studyBlock'])
    for (const repair of repairs) {
      expect(typeof repair.expected).toBe('function')
      expect(typeof repair.refresh).toBe('function')
    }
  })

  it('does not heal when the family switch is off (no scheduling behind the user’s back)', () => {
    renderManager({ enabled: true, studyBlockRemindEnabled: false })
    expect(mockHeal).not.toHaveBeenCalled()
  })

  it('records a heal that could not restore the queue', async () => {
    // 结果形状必须与 `ReminderHealOutcome` 一致（含 `families`）：少一个字段时那句日志
    // 消息的模板本身就会抛，异常被链尾的 .catch 吞掉 —— 症状是日志永远不落盘而测试报 0 次调用
    mockHeal.mockResolvedValueOnce({ attempted: true, before: 1, after: 1, healed: false, families: ['studyBlock'] })
    renderManager({ enabled: true, studyBlockRemindEnabled: true })

    await waitFor(() => expect(mockLogError).toHaveBeenCalledTimes(1))
    expect(mockLogError.mock.calls[0][0]).toBe('other')
    expect(String(mockLogError.mock.calls[0][2])).toContain('studyBlock')
  })
})
