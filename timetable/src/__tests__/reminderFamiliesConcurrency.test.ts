// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lesson } from '../types'
import type { SisuPlanItem } from '../lib/sisuStudyPlan'
import type { StudyBlock } from '../lib/studyBlocks'
import type { Task } from '../lib/tasks'
import { KEYS } from '../lib/storage'
import {
  lessonNotifId,
  refreshNotifications,
  wantedLessonReminders,
} from '../lib/notifications'
import { dueNotifId, refreshDueNotifications, wantedReminders } from '../lib/dueNotifications'
import { examNotifId, refreshExamReminders, wantedExamReminders } from '../lib/examReminders'
import {
  digestIdFor,
  digestWindowIds,
  planDigests,
  plannedDigestDays,
  refreshDigestNotifications,
  resetDigestSignature,
} from '../lib/dailyDigest'
import {
  refreshStudyBlockReminders,
  studyBlockNotifId,
  wantedStudyBlockReminders,
} from '../lib/studyBlockReminders'
import { refreshSisuPlanReminders, sisuPlanReminderId } from '../lib/sisuStudyPlanReminders'
import {
  cancelAllReminderFamilies,
  healMissingReminders,
  loadReminderHealth,
  type FamilyRepair,
} from '../lib/reminderHealth'
import { NOTIF_LEDGER_KEYS, loadNotifLedger } from '../lib/notifLedger'

/**
 * 【集成契约】六个提醒家族**并发**跑一轮之后，队列里必须仍然有每一家的条目。
 *
 * 为什么需要这一层：每个家族的单测都只面对自己那一份队列，而真实调用是
 * `NotificationManager.refresh()` 里六家**并发、互不 await**（各自 `.catch`）——
 * 于是「A 家的清扫删掉 B 家刚排上的条目」这种故障在单测里永远看不见。
 * 历史上正是这样翻的车：课程提醒的清扫写成「取消一切不在当前 wanted 里的条目」，
 * 新装/周末夜里 `wanted` 为空 = **清空整个通知队列**，学习时段提醒记账里记着 id、
 * 队列里却没了，到点不会响。本文件把那个场景钉死在集成层。
 *
 * 断言面是**有状态的假队列**（`schedule` 真入队、`cancel` 真出队、`getPending` 返回
 * 当前队列），不是「调没调 schedule」——「重排成功但队列里没有」正是当初被蒙过去的
 * 那一类静默失败。
 */

const { mockGetPending, mockSchedule, mockUpdate, mockCancel, mockCheckPermissions, mockCheckExact } =
  vi.hoisted(() => ({
    mockGetPending: vi.fn<() => Promise<unknown>>(),
    mockSchedule: vi.fn<(args: { notifications: { id: number }[] }) => Promise<void>>(),
    mockUpdate: vi.fn<(args: { notifications: { id: number }[] }) => Promise<void>>(),
    mockCancel: vi.fn<(args: { notifications: { id: number }[] }) => Promise<void>>(),
    mockCheckPermissions: vi.fn(async () => ({ display: 'granted' })),
    mockCheckExact: vi.fn(async () => ({ exact_alarm: 'granted' })),
  }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false },
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    getPending: mockGetPending,
    schedule: mockSchedule,
    update: mockUpdate,
    cancel: mockCancel,
    checkPermissions: mockCheckPermissions,
    requestPermissions: mockCheckPermissions,
    checkExactNotificationSetting: mockCheckExact,
  },
}))

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/**
 * 冻结时钟：所有家族内部都读 `Date.now()`，跑在同一时刻上，断言才可能逐条对齐
 * （尤其是每日摘要按本地 07:30 决定要不要排今天）。假定时器只假 `Date`，不假微任务，
 * 各家的 `await` 链照常推进。
 */
const NOW = Date.parse('2026-10-15T12:00:00.000Z')

const LESSON_TEXTS = { title: '课程提醒', body: () => 'x' }
const DUE_TEXTS = { title: () => '作业即将截止', body: () => 'x' }
const EXAM_TEXTS = { title: '考试提醒', body: () => 'x' }
const DIGEST_TEXTS = { title: '每日摘要', empty: '今天没有课', body: () => 'x' }
const BLOCK_TEXTS = { title: '学习时段提醒', body: () => 'x' }
const SISU_TEXTS = { title: '计划提醒', body: () => 'x' }

function lesson(id: string, startMs: number, type: Lesson['type'] = 'lecture'): Lesson {
  return {
    id,
    source: 'sisu',
    title: `课 ${id}`,
    code: 'CT60A4050',
    type,
    location: 'M19_AUD1B',
    start: new Date(startMs).toISOString(),
    end: new Date(startMs + HOUR).toISOString(),
  }
}

/** 近课：48 小时窗口内 → 课程提醒有活干；同时进摘要 */
const nearLesson = lesson('L-near', NOW + 3 * HOUR)
/** 远考试：>48h（课程提醒 `wanted` 因此为空）但在 45 天窗口内且进摘要 */
const farExam = lesson('L-exam', NOW + 4 * DAY, 'exam')

const task: Task = {
  id: 'T-1',
  title: '作业',
  dueAt: new Date(NOW + 30 * HOUR).toISOString(),
  completed: false,
  createdAt: new Date(NOW).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
}
const task2: Task = { ...task, id: 'T-2', dueAt: new Date(NOW + 50 * HOUR).toISOString() }

const block: StudyBlock = {
  id: 'SB-1',
  sourceKind: 'task',
  sourceId: 'T-1',
  title: '学习时段',
  dueAt: new Date(NOW + 8 * HOUR).toISOString(),
  startAt: new Date(NOW + 2 * HOUR).toISOString(),
  endAt: new Date(NOW + 3 * HOUR).toISOString(),
  createdAt: new Date(NOW).toISOString(),
}

const planItem: SisuPlanItem = {
  id: 'SP-1',
  kind: 'exam',
  title: '计划项',
  dueAt: new Date(NOW + 10 * HOUR).toISOString(),
  completed: false,
  createdAt: new Date(NOW).toISOString(),
}

/**
 * 假插件的载荷表：id → 最近一次 schedule/update 的**完整通知对象**。
 *
 * `getPending` 用它回读，与真插件一样把排期时的 title/body/`schedule.at` 原样交回来。
 * 之前这里回读的是占位标题 `'n'`，于是「队列里这条还是不是我想要的那条」这种判断
 * 会把健康队列全部误判成“变了”——排期侧会每轮空转重排，断言也就失去分辨力：
 * 一个「时刻跟着数据走」的用例在修复前也能因为“每轮都在 update”而假绿。
 */
let sentPayloads = new Map<number, unknown>()

/** 队列里那一条的预定时刻（毫秒）；没有载荷（例如外部塞进去的陌生 id）时 undefined。 */
function queuedAt(id: number): number | undefined {
  const payload = sentPayloads.get(id) as { schedule?: { at?: Date } } | undefined
  const at = payload?.schedule?.at
  return at instanceof Date ? at.getTime() : undefined
}

/** 有状态的假队列：入队/出队/回读都是真的，`getPending` 忠实返回当前内容。 */
function fakePlugin(initial: number[] = []): Set<number> {
  const queue = new Set(initial)
  sentPayloads = new Map()
  mockGetPending.mockImplementation(async () => ({
    notifications: [...queue].map((id) => sentPayloads.get(id) ?? { id, title: 'n' }),
  }))
  mockSchedule.mockImplementation(async ({ notifications }) => {
    for (const n of notifications) {
      queue.add(n.id)
      sentPayloads.set(n.id, n)
    }
  })
  mockUpdate.mockImplementation(async ({ notifications }) => {
    for (const n of notifications) {
      queue.add(n.id)
      sentPayloads.set(n.id, n)
    }
  })
  mockCancel.mockImplementation(async ({ notifications }) => {
    for (const n of notifications) queue.delete(n.id)
  })
  return queue
}

interface CycleInputs {
  lessons: Lesson[]
  tasks: Task[]
  blocks: StudyBlock[]
  planItems: SisuPlanItem[]
}

/**
 * 与 `NotificationManager.refresh()` **同形**：六家并发启动、各自 `.catch`，谁也不等谁；
 * 家族刷新落定之后再跑自愈（组件里也是这个次序）。
 */
/** 与 `NotificationManager.refresh()` 同一张注册表：同一批闭包既跑周期、也供自愈重排。 */
function familyRepairs(inputs: CycleInputs): FamilyRepair[] {
  return [
    {
      family: 'lesson',
      expected: (at) => [...wantedLessonReminders(inputs.lessons, at).keys()],
      refresh: () => refreshNotifications(inputs.lessons, LESSON_TEXTS, 'zh'),
    },
    {
      family: 'due',
      expected: (at) => [...wantedReminders(inputs.tasks, at).keys()],
      refresh: () => refreshDueNotifications(inputs.tasks, DUE_TEXTS, 'zh'),
    },
    {
      family: 'exam',
      expected: (at) => [...wantedExamReminders(inputs.lessons, at).keys()],
      refresh: () => refreshExamReminders(inputs.lessons, EXAM_TEXTS, 'zh'),
    },
    {
      family: 'digest',
      expected: (at) => plannedDigestDays(new Date(at)).map((d) => digestIdFor(d)),
      refresh: () => refreshDigestNotifications(inputs.lessons, DIGEST_TEXTS, 'zh'),
    },
    {
      family: 'studyBlock',
      expected: (at) => [...wantedStudyBlockReminders(inputs.blocks, at).keys()],
      refresh: () => refreshStudyBlockReminders(inputs.blocks, BLOCK_TEXTS, { enabled: true, locale: 'zh' }),
    },
  ]
}

async function runReminderCycle(inputs: CycleInputs): Promise<void> {
  const families = familyRepairs(inputs)
  await Promise.all([
    ...families.map((family) => family.refresh().catch(() => {})),
    // SISU 计划提醒由计划 hook 自己排，不在提醒周期里——这里模拟「它也在同一时刻动队列」
    refreshSisuPlanReminders(inputs.planItems, SISU_TEXTS).catch(() => {}),
  ])
  await healMissingReminders(families, { enabled: true }).catch(() => {})
}

const fullInputs: CycleInputs = {
  lessons: [nearLesson, farExam],
  tasks: [task, task2],
  blocks: [block],
  planItems: [planItem],
}

/** 各家族「这一轮应该排上」的 id（用各家自己的纯函数推导，不手写魔数） */
function expectedIds(lessons: Lesson[], tasks: Task[]): {
  lesson: number[]
  due: number[]
  exam: number[]
  digest: number[]
  block: number[]
  sisu: number[]
} {
  return {
    // 与各家实现同口径：提醒时点必须还在未来（已过去的时点不排），课程提醒另有 48 小时窗口
    lesson: lessons
      .map((l) => ({ id: lessonNotifId(l.id), at: new Date(l.start).getTime() - 10 * MIN }))
      .filter((e) => e.at > NOW && e.at < NOW + 48 * HOUR)
      .map((e) => e.id),
    due: tasks.flatMap((t) => [dueNotifId(t.id, 24), dueNotifId(t.id, 1)]),
    exam: lessons
      .filter((l) => l.type === 'exam')
      .flatMap((l) =>
        [7, 1]
          .map((d) => ({ id: examNotifId(l.id, d), at: new Date(l.start).getTime() - d * DAY }))
          .filter((e) => e.at > NOW),
      )
      .map((e) => e.id),
    digest: planDigests(lessons, new Date(NOW), DIGEST_TEXTS).map((p) => p.id),
    block: [studyBlockNotifId(block.id, 10)],
    sisu: [sisuPlanReminderId(planItem.id, 1)],
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  resetDigestSignature()
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  localStorage.clear()
})

describe('reminder families run concurrently', () => {
  it('leaves every family’s entry in the queue after one concurrent cycle', async () => {
    const queue = fakePlugin()
    await runReminderCycle(fullInputs)

    const expected = expectedIds(fullInputs.lessons, fullInputs.tasks)
    // 逐家断言「有我这一条」，而不是只数字数——总数相等也可能是两家互相顶替
    expect(queue.has(expected.lesson[0])).toBe(true)
    expect(expected.due.every((id) => queue.has(id))).toBe(true)
    expect(expected.exam.every((id) => queue.has(id))).toBe(true)
    expect(expected.digest.every((id) => queue.has(id))).toBe(true)
    expect(queue.has(expected.block[0])).toBe(true)
    expect(queue.has(expected.sisu[0])).toBe(true)

    // 摘要落进队列的条目必须**正好**是这一轮计划的那几条（多的少了的都算漏）
    const windowIds = new Set(digestWindowIds(new Date(NOW)))
    expect([...queue].filter((id) => windowIds.has(id)).sort()).toEqual([...expected.digest].sort())
  })

  it('keeps the other families when the lesson family has nothing left to schedule', async () => {
    const queue = fakePlugin()
    await runReminderCycle(fullInputs)

    const before = expectedIds(fullInputs.lessons, fullInputs.tasks)
    expect(queue.has(before.lesson[0])).toBe(true)

    // 近课从课表消失（删课/换课），远考试还在：课程提醒的 `wanted` 变成空集。
    // 修复前正是这条路径把整个队列清空 —— 六家并发时它会删掉别人刚排上的条目。
    const next: CycleInputs = { ...fullInputs, lessons: [farExam] }
    await runReminderCycle(next)

    // 自家那条该被清掉（它自己排的、且已不再想要）
    expect(queue.has(before.lesson[0])).toBe(false)
    // 其余各家一条都不能少
    const after = expectedIds(next.lessons, next.tasks)
    expect(after.exam.every((id) => queue.has(id))).toBe(true)
    expect(after.digest.every((id) => queue.has(id))).toBe(true)
    expect(after.due.every((id) => queue.has(id))).toBe(true)
    expect(queue.has(after.block[0])).toBe(true)
    expect(queue.has(after.sisu[0])).toBe(true)
  })

  it('stays complete and duplicate-free across repeated cycles', async () => {
    const queue = fakePlugin()
    await runReminderCycle(fullInputs)
    const sizeAfterFirst = queue.size
    await runReminderCycle(fullInputs)
    await runReminderCycle(fullInputs)

    const expected = expectedIds(fullInputs.lessons, fullInputs.tasks)
    expect(expected.lesson.every((id) => queue.has(id))).toBe(true)
    expect(expected.due.every((id) => queue.has(id))).toBe(true)
    expect(expected.exam.every((id) => queue.has(id))).toBe(true)
    expect(expected.digest.every((id) => queue.has(id))).toBe(true)
    expect(queue.has(expected.block[0])).toBe(true)
    expect(queue.has(expected.sisu[0])).toBe(true)
    // 幂等：重排不会越排越多（Set 天然去重，这里锁的是「没有多余的新 id 冒出来」）
    expect(queue.size).toBe(sizeAfterFirst)
  })

  it('restores an entry the plugin silently dropped without disturbing the others', async () => {
    const queue = fakePlugin()
    await runReminderCycle(fullInputs)
    const expected = expectedIds(fullInputs.lessons, fullInputs.tasks)

    // 插件静默失败 / 队列被应用之外的力量清掉：只丢学习时段那一条，其余留着
    queue.delete(expected.block[0])
    expect(queue.has(expected.block[0])).toBe(false)

    await runReminderCycle(fullInputs)

    expect(queue.has(expected.block[0])).toBe(true)
    expect(expected.due.every((id) => queue.has(id))).toBe(true)
    expect(expected.exam.every((id) => queue.has(id))).toBe(true)
    expect(expected.digest.every((id) => queue.has(id))).toBe(true)
    expect(queue.has(expected.lesson[0])).toBe(true)
    expect(queue.has(expected.sisu[0])).toBe(true)
  })

  it('cancels nothing at all when a family has nothing to schedule and nothing recorded', async () => {
    const queue = fakePlugin()
    await runReminderCycle(fullInputs)
    const before = [...queue].sort()

    // 「课程提醒这一家无事可做」的输入：48 小时窗口里没有课（只剩 4 天后的考试，那归考试家管）
    // 外加它的记账被外部清空（新装 / 换设备 / 存储被清）——当年正是这个输入清空了整个队列。
    //
    // 注意**不能**用 `lessons: []`：那会连带考试家真的失去自己的课（它该取消自己那条），
    // 断言「队列一条不少」就成了错的期望 —— 本条只针对「课程家无活干」这一种静默失败。
    const idleLessonFamily: CycleInputs = { ...fullInputs, lessons: [farExam] }
    localStorage.removeItem(`${KEYS.lessons}:scheduled`)
    await runReminderCycle(idleLessonFamily)

    // 其余各家这一轮想排的条目一条都不能少（考试家的考试记录仍在，故它的期望不变）
    const expected = expectedIds(idleLessonFamily.lessons, idleLessonFamily.tasks)
    expect(expected.exam.every((id) => queue.has(id))).toBe(true)
    expect(expected.due.every((id) => queue.has(id))).toBe(true)
    expect(expected.block.every((id) => queue.has(id))).toBe(true)
    expect(queue.has(expected.sisu[0])).toBe(true)
    // 记账被清空的课程家不知道那条提醒是自己排的 —— 不猜、不动别人（也不动“疑似自己的”）
    expect([...queue].sort()).toEqual(before)
  })

  it('never lets one family cancel ids it did not schedule', async () => {
    // 队列里先放一批「没人认领」的 id（别的版本/别的窗口排的）
    const foreign = [111_222_333, 222_333_444]
    const queue = fakePlugin(foreign)
    await runReminderCycle(fullInputs)
    await runReminderCycle({ ...fullInputs, lessons: [farExam], tasks: [] })

    // 六家各自的清扫都只碰自己记账/自己数据反推出来的 id，陌生的必须原样留着
    expect(foreign.every((id) => queue.has(id))).toBe(true)
  })
})

/**
 * 【契约·已删条目】条目被删之后，它的提醒 id 就再也从数据里反推不出来——唯一还能认出
 * 「这是我排的」的东西只有各家自己的记账。本组把「删掉任务/考试 → 它的提醒当场离开队列，
 * 且其余各家一条不少」钉在集成层（各家单测都只面对自己那份队列，看不见这一步）。
 */
describe('deleted entries leave no reminder behind', () => {
  it('clears a deleted task’s reminders and keeps every other family untouched', async () => {
    const queue = fakePlugin()
    await runReminderCycle(fullInputs)
    const before = expectedIds(fullInputs.lessons, fullInputs.tasks)
    expect(before.due.length).toBeGreaterThan(0)
    expect(before.due.every((id) => queue.has(id))).toBe(true)

    // 任务被删除：`wantedReminders([])` 是空集，反推不出任何 id，只有记账认得那两条
    const next: CycleInputs = { ...fullInputs, tasks: [] }
    await runReminderCycle(next)

    expect(before.due.every((id) => queue.has(id))).toBe(false)
    expect(queue.has(before.lesson[0])).toBe(true)
    expect(before.exam.every((id) => queue.has(id))).toBe(true)
    expect(before.digest.every((id) => queue.has(id))).toBe(true)
    expect(queue.has(before.block[0])).toBe(true)
    expect(queue.has(before.sisu[0])).toBe(true)
  })

  it('clears a deleted exam’s reminders and keeps every other family untouched', async () => {
    const queue = fakePlugin()
    await runReminderCycle(fullInputs)
    const before = expectedIds(fullInputs.lessons, fullInputs.tasks)
    expect(before.exam.length).toBeGreaterThan(0)
    expect(before.exam.every((id) => queue.has(id))).toBe(true)

    // 考试从课表消失（考完了 / 换课 / 同步掉了）：考试家 `wanted` 变空集
    const next: CycleInputs = { ...fullInputs, lessons: [nearLesson] }
    await runReminderCycle(next)

    expect(before.exam.every((id) => queue.has(id))).toBe(false)
    expect(queue.has(before.lesson[0])).toBe(true)
    expect(before.due.every((id) => queue.has(id))).toBe(true)
    expect(before.block.every((id) => queue.has(id))).toBe(true)
    expect(queue.has(before.sisu[0])).toBe(true)
  })
})

/**
 * 【契约·总开关关闭】总开关关掉时，队列清空**必须**伴随六家记账一起清空。
 *
 * 只清课程/学习块两家会让截止/考试/摘要/计划四家带着「我排过、队列里却没有」的旧账活着：
 * 设置里的对账随即报出一条**不存在的**陈旧提醒（诊断指向不存在的问题比没有诊断更坏），
 * 下次开启时也是在脏记账上做清扫。
 */
describe('master switch off', () => {
  it('clears every family’s bookkeeping, not just the ones with a dedicated cancel path', async () => {
    const queue = fakePlugin()
    await runReminderCycle(fullInputs)
    expect(queue.size).toBeGreaterThan(0)

    await cancelAllReminderFamilies()

    expect([...queue]).toEqual([])
    for (const key of Object.values(NOTIF_LEDGER_KEYS)) {
      expect(loadNotifLedger(key), `${key} 应随总开关一起清空`).toEqual([])
    }

    // 关掉之后的对账必须是干净的：既不缺、也没有陈旧记账
    const health = await loadReminderHealth(NOW)
    expect(health.report.ok).toBe(true)
    expect(health.audit?.every((entry) => entry.missing.length === 0)).toBe(true)
    expect(health.audit?.every((entry) => entry.stale.length === 0)).toBe(true)
  })
})

/**
 * 【契约·自愈不被签名挡住】摘要按「内容签名」跳过重排（每 10 分钟一次调用必须便宜），
 * 但签名只说明**内容没变**，不说明**队列里还在**。队列被应用之外的力量清掉时若仍按签名
 * 早退，摘要就永远补不回来：自愈每轮空转、把「did not restore queue」写进错误日志，
 * 而用户那边只是「早上什么都没收到」。
 */
describe('digest reminders survive a queue wipe', () => {
  it('restores digest entries that vanished even though the plan is unchanged', async () => {
    const queue = fakePlugin()
    await runReminderCycle(fullInputs)
    const expected = expectedIds(fullInputs.lessons, fullInputs.tasks)
    expect(expected.digest.length).toBeGreaterThan(0)

    for (const id of expected.digest) queue.delete(id)
    expect(expected.digest.some((id) => queue.has(id))).toBe(false)

    await runReminderCycle(fullInputs)

    expect(expected.digest.every((id) => queue.has(id))).toBe(true)
  })
})

/**
 * 【契约·提醒跟着数据走】id 是稳定的（由 lessonId/taskId 哈希而来），但**时刻**跟着数据走。
 * 课程详情里改时间走的是 `updateLesson`（id 不变，只换 start/end），改任务截止时间同理。
 * 排期方过去只按「这个 id 没排过就排」跳过已在队列里的，于是这类改动会让提醒**停在旧时刻**
 * ——比没提醒更坏：它看起来是好的，只是响在错的点上、写着过时的正文。
 */
describe('reminders follow the data when a time changes', () => {
  it('does not reschedule anything when nothing changed', async () => {
    fakePlugin()
    await runReminderCycle(fullInputs)
    mockUpdate.mockClear()
    mockSchedule.mockClear()

    await runReminderCycle(fullInputs)

    // 没变就不该动队列：这既是性能契约，也是下面三条漂移用例的分辨力来源
    // （若这里会重排，那三条在修复前也会因“每轮都 update”而假绿）
    expect(mockUpdate).not.toHaveBeenCalled()
    // 不能直接断言「schedule 一次都没调」：学习时段家刻意**整段重排**（时间/标题可能变而
    // id 稳定），它每轮都会 cancel + schedule 自己的那几条。要断言的是**课程/截止/考试三家**
    // 没有重排自己的条目。
    const mine = expectedIds(fullInputs.lessons, fullInputs.tasks)
    const ours = [...mine.lesson, ...mine.due, ...mine.exam]
    const rescheduled = mockSchedule.mock.calls.flatMap(([args]) => args.notifications.map((n) => n.id))
    expect(rescheduled.filter((id) => ours.includes(id))).toEqual([])
  })

  it('moves an already-queued deadline reminder when the deadline changes', async () => {
    const queue = fakePlugin()
    await runReminderCycle(fullInputs)
    const id = dueNotifId('T-1', 24)
    expect(queuedAt(id)).toBe(NOW + 30 * HOUR - 24 * HOUR)

    const moved: Task = { ...task, dueAt: new Date(NOW + 40 * HOUR).toISOString() }
    await runReminderCycle({ ...fullInputs, tasks: [moved, task2] })

    expect(queue.has(id)).toBe(true)
    expect(queuedAt(id)).toBe(NOW + 40 * HOUR - 24 * HOUR)
  })

  it('moves an already-queued lesson reminder when the lesson time changes', async () => {
    const queue = fakePlugin()
    await runReminderCycle(fullInputs)
    const id = lessonNotifId('L-near')
    expect(queuedAt(id)).toBe(NOW + 3 * HOUR - 10 * MIN)

    // 课程详情里改时间：同一条课、**同一个 id**，只有 start/end 变了
    const moved = lesson('L-near', NOW + 5 * HOUR)
    await runReminderCycle({ ...fullInputs, lessons: [moved, farExam] })

    expect(queue.has(id)).toBe(true)
    expect(queuedAt(id)).toBe(NOW + 5 * HOUR - 10 * MIN)
  })

  it('moves an already-queued exam reminder when the exam time changes', async () => {
    const queue = fakePlugin()
    await runReminderCycle(fullInputs)
    const id = examNotifId('L-exam', 1)
    expect(queuedAt(id)).toBe(NOW + 4 * DAY - 1 * DAY)

    const moved = lesson('L-exam', NOW + 6 * DAY, 'exam')
    await runReminderCycle({ ...fullInputs, lessons: [nearLesson, moved] })

    expect(queue.has(id)).toBe(true)
    expect(queuedAt(id)).toBe(NOW + 6 * DAY - 1 * DAY)
  })
})
