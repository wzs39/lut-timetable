// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KEYS } from '../lib/storage'
import { loadStudyBlocks, type StudyBlock } from '../lib/studyBlocks'
import { saveStudyBlockPrefs } from '../lib/studyBlockPrefs'
import {
  auditStudyBlockReminders,
  refreshStudyBlockReminders,
  studyBlockNotifId,
  wantedStudyBlockReminders,
} from '../lib/studyBlockReminders'
import {
  auditReminderFamilies,
  healMissingReminders,
  loadReminderHealth,
  storedFamilyExpectations,
  type FamilyRepair,
} from '../lib/reminderHealth'

/**
 * 【契约】「该响的提醒到底排上没有」——记账与真实队列的三方对账。
 *
 * 三份状态：当前数据（应排什么）、记账清单（上次排完记下的 id）、系统队列（真会响的）。
 * 这组测试锁住的是**判别力**：能把「没排上」「陈旧记账」「完全就位」分开，
 * 而且投递完成后不再留假警报。
 */

const { mockGetPending, mockSchedule, mockCancel, mockCheckPermissions } = vi.hoisted(() => ({
  mockGetPending: vi.fn<() => Promise<unknown>>(),
  mockSchedule: vi.fn<(args: { notifications: { id: number }[] }) => Promise<void>>(),
  mockCancel: vi.fn<(args: { notifications: { id: number }[] }) => Promise<void>>(),
  mockCheckPermissions: vi.fn(async () => ({ display: 'granted' })),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false },
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    getPending: mockGetPending,
    schedule: mockSchedule,
    cancel: mockCancel,
    checkPermissions: mockCheckPermissions,
    requestPermissions: mockCheckPermissions,
  },
}))

const MIN = 60000
const NOW = Date.parse('2026-10-15T12:00:00.000Z')

/** 学习时段提醒的文案（多个用例共用；放模块级，免得各 describe 各写一份）。 */
const HEAL_TEXTS = { title: '学习时段提醒', body: () => '到点了' }

function block(id: string, startOffsetMs: number, base: number = NOW): StudyBlock {
  const start = new Date(base + startOffsetMs)
  return {
    id,
    sourceKind: 'task',
    sourceId: id,
    title: `块 ${id}`,
    dueAt: new Date(base + 48 * 3600 * 1000).toISOString(),
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + 30 * MIN).toISOString(),
    createdAt: new Date(base).toISOString(),
  }
}

/** 写进存储：块列表 + 记账清单（面板的读取路径真的从存储里读）。 */
function seed(blocks: StudyBlock[], tracked: number[]) {
  localStorage.setItem(KEYS.studyBlocks, JSON.stringify(blocks))
  localStorage.setItem(`${KEYS.studyBlocks}:scheduled`, JSON.stringify(tracked))
}

afterEach(() => {
  cleanupStorage()
  vi.clearAllMocks()
})

function cleanupStorage() {
  localStorage.removeItem(KEYS.studyBlocks)
  localStorage.removeItem(`${KEYS.studyBlocks}:scheduled`)
  // 期望集合受三个开关影响（默认全关）——不擦就会串到下一个用例
  localStorage.removeItem(KEYS.studyBlockPrefs)
  localStorage.removeItem(KEYS.notif)
  localStorage.removeItem(KEYS.digest)
}

/**
 * 有状态的假队列：`schedule` 真的入队、`cancel` 真的出队、`getPending` 返回当前队列。
 * 自愈测试的关键就在这里——「重排之后队列里到底有没有」必须能被观测，
 * 只断言「调了 schedule」证明不了自愈（那正是本轮要修的那类静默失败）。
 */
function fakeQueue(initial: number[] = []): Set<number> {
  const queue = new Set(initial)
  mockGetPending.mockImplementation(async () => ({
    notifications: [...queue].map((id) => ({ id, title: '学习时段提醒', schedule: { at: new Date(NOW + 3600_000) } })),
  }))
  mockSchedule.mockImplementation(async ({ notifications }) => {
    for (const n of notifications) queue.add(n.id)
  })
  mockCancel.mockImplementation(async ({ notifications }) => {
    for (const n of notifications) queue.delete(n.id)
  })
  return queue
}

describe('auditStudyBlockReminders', () => {
  const future = block('b1', 60 * MIN) // 提醒点 = 开始前 10 分钟 = 50 分钟后
  const idForB1 = studyBlockNotifId('b1', 10)

  it('reports nothing when bookkeeping, expectation and queue all agree', () => {
    const audit = auditStudyBlockReminders([future], [idForB1], [idForB1], NOW)
    expect(audit.expected).toEqual([idForB1])
    expect(audit.missing).toEqual([])
    expect(audit.stale).toEqual([])
  })

  it('flags an expected reminder that is absent from the queue', () => {
    const audit = auditStudyBlockReminders([future], [idForB1], [], NOW)
    expect(audit.missing).toEqual([idForB1])
    // 同一条不能既算 missing 又算 stale，否则用户看到两个数字指的是同一件事
    expect(audit.stale).toEqual([])
  })

  it('flags bookkeeping entries that are neither queued nor expected', () => {
    const gone = studyBlockNotifId('deleted-block', 10)
    const audit = auditStudyBlockReminders([future], [gone, idForB1], [idForB1], NOW)
    expect(audit.missing).toEqual([])
    expect(audit.stale).toEqual([gone])
  })

  it('stays clean after delivery: a block whose reminder time passed is not "missing"', () => {
    const started = block('b2', 5 * MIN) // 开始前 10 分钟的提醒点已经过去
    const audit = auditStudyBlockReminders([started], [], [], NOW)
    expect(audit.expected).toEqual([])
    expect(audit.missing).toEqual([])
  })

  it('reports an empty audit on an empty dataset instead of inventing work', () => {
    expect(auditStudyBlockReminders([], [], [], NOW)).toEqual({ expected: [], missing: [], stale: [] })
    // 没有任何块时，记账里的残留只能算「陈旧」，不能算「缺失」
    expect(auditStudyBlockReminders([], [777], [], NOW)).toEqual({ expected: [], missing: [], stale: [777] })
  })
})

describe('loadReminderHealth', () => {
  it('assembles the queue and the cross-check from storage', async () => {
    const future = block('b9', 90 * MIN)
    const id = studyBlockNotifId('b9', 10)
    seed([future], [id])
    saveStudyBlockPrefs({ remindEnabled: true })
    mockGetPending.mockResolvedValue({ notifications: [{ id, title: '学习时段提醒', schedule: { at: future.startAt } }] })

    const health = await loadReminderHealth(NOW)
    expect(health.report.ok).toBe(true)
    const blockAudit = health.audit?.find((entry) => entry.family === 'studyBlock')
    expect(blockAudit?.missing).toEqual([])
    expect(blockAudit?.expected).toEqual([id])
  })

  it('refuses to cross-check when the queue cannot be read (no false alarms)', async () => {
    seed([block('b9', 90 * MIN)], [12345])
    mockGetPending.mockRejectedValue(new Error('not implemented'))

    const health = await loadReminderHealth(NOW)
    expect(health.report.ok).toBe(false)
    expect(health.audit).toBeNull()
  })
})

/**
 * 【契约】自动自愈：对账发现缺失就**当场重排**，不把「去开关一次」推给用户。
 *
 * 这里锁的是三条边界，它们各自对应一次真实失效：
 * - 队列被应用之外的力量清掉 → 重排后**队列里真的有了**（不只是「调了 schedule」）；
 * - 队列读不到 → 什么都不做（把读失败当「全都缺失」会制造噪音）；
 * - 开关关着 → 不排（自愈不能绕过用户的偏好）。
 */
describe('healMissingReminders', () => {
  const texts = HEAL_TEXTS
  const enabled = { enabled: true }
  /**
   * 自愈的入参是「家族注册表」：每个家族给出**本应排上什么**（纯函数、与它自己的
   * 排期口径同源）与**怎么重排**。这里只挂学习时段一家，其余家族的注册表在组件里。
   */
  const blockRepair = (): FamilyRepair => ({
    family: 'studyBlock',
    expected: (at) => [...wantedStudyBlockReminders(loadStudyBlocks(), at).keys()],
    refresh: () => refreshStudyBlockReminders(loadStudyBlocks(), texts, { enabled: true }),
  })
  /**
   * 自愈链路里的**重排用的是真实时钟**（`refreshStudyBlockReminders` 自己取
   * `Date.now()`），所以这里的块必须相对真实当下构造——写死一个基准时刻会让
   * 参数一旦落到过去、重排静默变成空集，用例红得莫名其妙。
   */
  const R = Date.now()

  it('does nothing when the queue already matches (no needless rescheduling)', async () => {
    const future = block('h1', 90 * MIN, R)
    const id = studyBlockNotifId('h1', 10)
    seed([future], [id])
    fakeQueue([id])

    const outcome = await healMissingReminders([blockRepair()], enabled, R)
    expect(outcome).toEqual({ attempted: false, before: 0, after: 0, healed: true, families: [] })
    expect(mockSchedule).not.toHaveBeenCalled()
  })

  it('reschedules a missing reminder and the queue ends up holding it', async () => {
    const future = block('h2', 90 * MIN, R)
    const id = studyBlockNotifId('h2', 10)
    // 队列被外部清空了（WebView 重载 / 系统清理）：记账还在，队列没了
    seed([future], [id])
    const queue = fakeQueue([])

    const outcome = await healMissingReminders([blockRepair()], enabled, R)
    expect(outcome.attempted).toBe(true)
    expect(outcome.before).toBe(1)
    expect(outcome.healed).toBe(true)
    expect(outcome.after).toBe(0)
    expect(outcome.families).toEqual(['studyBlock'])
    expect([...queue]).toEqual([id])
    // 重排也要把记账写回：否则下一次对账会把已排好的当成陈旧
    expect(JSON.parse(localStorage.getItem(`${KEYS.studyBlocks}:scheduled`) ?? 'null')).toEqual([id])
  })

  it('never guesses when the queue cannot be read', async () => {
    seed([block('h3', 90 * MIN, R)], [studyBlockNotifId('h3', 10)])
    mockGetPending.mockRejectedValue(new Error('not implemented'))

    const outcome = await healMissingReminders([blockRepair()], enabled, R)
    expect(outcome.attempted).toBe(false)
    expect(mockSchedule).not.toHaveBeenCalled()
  })

  it('stays out of the way when the family switch is off', async () => {
    seed([block('h4', 90 * MIN, R)], [studyBlockNotifId('h4', 10)])
    const queue = fakeQueue([])

    const outcome = await healMissingReminders([blockRepair()], { enabled: false }, R)
    expect(outcome.attempted).toBe(false)
    expect(mockSchedule).not.toHaveBeenCalled()
    expect([...queue]).toEqual([])
  })

  it('recovers a silently dropped schedule within the same cycle (one retry, bounded)', async () => {
    const future = block('h5', 90 * MIN, R)
    const id = studyBlockNotifId('h5', 10)
    seed([future], [id])
    const queue = fakeQueue([])
    // 插件「静默失败」：第一次 schedule 被吞掉（不报错、不入队）
    let dropped = 1
    const realSchedule = mockSchedule.getMockImplementation()!
    mockSchedule.mockImplementation(async (args) => {
      if (dropped > 0) {
        dropped -= 1
        return
      }
      await realSchedule(args)
    })

    // 面板的期望跟着开关走：这里让学习块提醒开着，否则默认关的那一家本就不该有期望
    saveStudyBlockPrefs({ remindEnabled: true })

    // 周期第一段：常规刷新。它的 schedule 被吞了 —— 这就是面板会显示的「缺失」
    await refreshStudyBlockReminders([future], texts, enabled)
    expect([...queue]).toEqual([])
    expect((await loadReminderHealth(R)).audit?.find((e) => e.family === 'studyBlock')?.missing).toEqual([id])

    // 周期第二段：自愈对账，把丢掉的那条补上
    const outcome = await healMissingReminders([blockRepair()], enabled, R)
    expect(outcome.attempted).toBe(true)
    expect(outcome.healed).toBe(true)
    expect([...queue]).toEqual([id])
  })
})

/**
 * 【契约】自愈与审计是**跨家族**的：只修缺条目的那几家，健康的家族一次都不重排。
 * 单家族版本做不到这一点——一个家族静默失败时其它四家会陪着一起重排，队列白白抖动。
 */
describe('healMissingReminders across families', () => {
  const R = Date.now()

  it('repairs only the family that is missing entries', async () => {
    const future = block('m1', 90 * MIN, R)
    const id = studyBlockNotifId('m1', 10)
    seed([future], [id])
    fakeQueue([])
    const healthyRefresh = vi.fn(async () => {})
    const brokenRefresh = vi.fn(async () => {
      await refreshStudyBlockReminders(loadStudyBlocks(), HEAL_TEXTS, { enabled: true })
    })

    const outcome = await healMissingReminders(
      [
        { family: 'lesson', expected: () => [], refresh: healthyRefresh },
        { family: 'studyBlock', expected: (at) => [...wantedStudyBlockReminders(loadStudyBlocks(), at).keys()], refresh: brokenRefresh },
      ],
      { enabled: true },
      R,
    )

    expect(outcome.families).toEqual(['studyBlock'])
    expect(brokenRefresh).toHaveBeenCalledTimes(1)
    expect(healthyRefresh).not.toHaveBeenCalled()
    expect(outcome.healed).toBe(true)
  })

  it('does nothing when every family is healthy', async () => {
    const future = block('m2', 90 * MIN, R)
    const id = studyBlockNotifId('m2', 10)
    seed([future], [id])
    fakeQueue([id])
    const refresh = vi.fn(async () => {})

    const outcome = await healMissingReminders(
      [{ family: 'studyBlock', expected: (at) => [...wantedStudyBlockReminders(loadStudyBlocks(), at).keys()], refresh }],
      { enabled: true },
      R,
    )
    expect(outcome.attempted).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('auditReminderFamilies', () => {
  it('keeps each family’s verdict separate and never double-counts', () => {
    const audits = auditReminderFamilies(
      [
        { family: 'lesson', expected: [1, 2] },
        { family: 'due', expected: [9] },
      ],
      { lesson: [1, 99], due: [] },
      [1, 99],
    )
    expect(audits).toEqual([
      // lesson 记着 99（还排在队列里）但已不该有 → 既是清扫目标，也要在审计里露面
      { family: 'lesson', expected: [1, 2], missing: [2], stale: [99] },
      { family: 'due', expected: [9], missing: [9], stale: [] },
    ])
  })

  it('reports stale for any recorded id that is no longer expected', () => {
    const [audit] = auditReminderFamilies(
      [{ family: 'exam', expected: [] }],
      { exam: [404] },
      [404],
    )
    expect(audit.missing).toEqual([])
    expect(audit.stale).toEqual([404])
  })
})

describe('storedFamilyExpectations', () => {
  const familiesOf = (list: ReturnType<typeof storedFamilyExpectations>) =>
    Object.fromEntries(list.map((e) => [e.family, e.expected]))

  it('derives each family’s expectation from the same predicates its scheduler uses', () => {
    const now = Date.now()
    const soon = block('e1', 90 * MIN, now)
    const far = block('e2', 40 * 24 * 60 * MIN, now) // 超出 30 天窗口
    localStorage.setItem(KEYS.studyBlocks, JSON.stringify([soon, far]))
    saveStudyBlockPrefs({ remindEnabled: true })

    const expectations = storedFamilyExpectations(now)
    const byFamily = familiesOf(expectations)
    expect(byFamily.studyBlock).toEqual([studyBlockNotifId('e1', 10)])
    // 五家都在（SISU 计划提醒由计划 hook 自己排，不在提醒周期里，故不在审计内）
    expect(expectations.map((e) => e.family)).toEqual(['lesson', 'due', 'exam', 'digest', 'studyBlock'])
  })

  it('expects nothing from a switched-off family (a silent switch is not a fault)', () => {
    const now = Date.now()
    localStorage.setItem(KEYS.studyBlocks, JSON.stringify([block('e1', 90 * MIN, now)]))
    // 三个开关保持默认（均关）——`NotificationManager` 也只会「只清不排」
    const expectations = storedFamilyExpectations(now)
    expect(expectations.every((e) => e.expected.length === 0)).toBe(true)
  })

  it('gives each family its own switch —摘要开着不会让课程家产生期望', () => {
    const now = Date.now()
    localStorage.setItem(KEYS.notif, 'true')
    const onlyContent = familiesOf(storedFamilyExpectations(now))
    expect(onlyContent.digest).toEqual([])

    localStorage.removeItem(KEYS.notif)
    localStorage.setItem(KEYS.digest, 'true')
    const onlyDigest = familiesOf(storedFamilyExpectations(now))
    expect(onlyDigest.lesson).toEqual([])
    expect(onlyDigest.due).toEqual([])
    expect(onlyDigest.exam).toEqual([])
    // 摘要窗口里“本应排上”的天数：今天 07:30 已过就不算今天
    expect(onlyDigest.digest.length).toBeGreaterThan(0)
  })
})
