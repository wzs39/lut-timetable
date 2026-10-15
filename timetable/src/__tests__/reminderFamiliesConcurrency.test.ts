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
import { healMissingReminders, type FamilyRepair } from '../lib/reminderHealth'

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
const DUE_TEXTS = { title: '作业即将截止', body: () => 'x' }
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

/** 有状态的假队列：入队/出队/回读都是真的，`getPending` 忠实返回当前内容。 */
function fakePlugin(initial: number[] = []): Set<number> {
  const queue = new Set(initial)
  mockGetPending.mockImplementation(async () => ({
    notifications: [...queue].map((id) => ({ id, title: 'n' })),
  }))
  mockSchedule.mockImplementation(async ({ notifications }) => {
    for (const n of notifications) queue.add(n.id)
  })
  mockUpdate.mockImplementation(async ({ notifications }) => {
    for (const n of notifications) queue.add(n.id)
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
