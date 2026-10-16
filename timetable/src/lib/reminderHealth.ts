import {
  NOTIF_LEDGER_KEYS,
  auditFamily,
  loadNotifLedger,
  saveNotifLedger,
  type NotifFamily,
} from './notifLedger'
import { loadPendingNotifications, type PendingNotificationsReport } from './pendingNotifications'
import { loadLessons, dedupeLessons, backfillLessonTypes } from './store'
import { KEYS, readString } from './storage'
import { loadStudyBlockPrefs } from './studyBlockPrefs'
import { loadTasks } from './tasks'
import { loadStudyBlocks } from './studyBlocks'
import { cancelAllNotifications, wantedLessonReminders } from './notifications'
import { wantedReminders } from './dueNotifications'
import { wantedExamReminders } from './examReminders'
import { digestIdFor, plannedDigestDays } from './dailyDigest'
import { wantedStudyBlockReminders } from './studyBlockReminders'

/**
 * 提醒健康的**唯一装配点**：把三份状态放到一起交给纯函数对账（诊断面板与自愈共用）。
 *
 * - 系统队列：`loadPendingNotifications`（插件读取，失败不抛）
 * - 记账清单：`notifLedger.loadNotifLedger`（每个家族各记各的）
 * - 当前数据：各家自己的 `wantedXxx` 纯函数（**同一个口径**，不在这里重算窗口/阈值）
 *
 * **读不到队列时 `audit` 是 `null` 而不是「全都缺失」**——拿一个读不到的队列去
 * 对账只会制造假警报，那比没有诊断更坏。
 *
 * 覆盖的是**提醒周期真正驱动的那几家**（课程 / 截止 / 考试 / 摘要 / 学习时段）。
 * SISU 计划提醒不在这个周期里——它由计划 hook 在计划数据变化时排（有自己的记账），
 * 把它算进来只会在「计划改过但 hook 没重跑」时制造假警报。
 */

export interface FamilyExpectation {
  family: NotifFamily
  /** 按当前数据「本应排上」的 id（提醒时点已过去的条目不算） */
  expected: number[]
}

export interface FamilyAudit extends FamilyExpectation {
  /** 本应排上、队列里却没有——这些提醒**不会响** */
  missing: number[]
  /** 记账里有、队列里也没有、且已不在期望里——陈旧记账 */
  stale: number[]
}

/** 六家一起对账（纯函数）：三集合语义的唯一实现在 `notifLedger.auditFamily`。 */
export function auditReminderFamilies(
  expectations: FamilyExpectation[],
  ledgers: Partial<Record<NotifFamily, number[]>>,
  queuedIds: number[],
): FamilyAudit[] {
  return expectations.map(({ family, expected }) => ({
    family,
    expected,
    ...auditFamily(expected, ledgers[family] ?? [], queuedIds),
  }))
}

/**
 * 从**本地存储**装配期望集合（诊断面板用，不需要 React 数据）。
 *
 * 课表走与 App 完全相同的 `dedupe + backfillLessonTypes` 管线：少了 backfill，
 * 考试类型缺失会让考试提醒的期望恒为空集，面板就会把「实际排上了」看成「不该有」。
 *
 * **关掉的家族不产生期望**：`NotificationManager` 在开关关闭时是「只清不排」，所以那些
 * 家族的「缺失」是纯粹的计算产物，不是故障。诊断报告最坏的结果不是「没有诊断」而是
 * 「指向一个不存在的问题」——实测：摘要开关默认关着，而摘要期望按窗口天数恒为 6 条，
 * 于是每一台新装的设备都会看到「有 6 条提醒应该排上却没排上」。开关读自各自的存储位
 * （`tt_notif` / `tt_daily_digest` / 学习偏好里的 `remindEnabled`），与 `useTimetable`
 * 和 `NotificationManager` 用的是同一份状态。
 */
export function storedFamilyExpectations(now: number = Date.now()): FamilyExpectation[] {
  const lessons = dedupeLessons(backfillLessonTypes(loadLessons()))
  // 三个开关的默认值都是「关」（useTimetable 的 loadNotif/loadDigest 与学习偏好一致）
  const contentOn = readString(KEYS.notif) === 'true'
  const digestOn = readString(KEYS.digest) === 'true'
  const blockRemindOn = loadStudyBlockPrefs().remindEnabled
  return [
    { family: 'lesson', expected: contentOn ? [...wantedLessonReminders(lessons, now).keys()] : [] },
    { family: 'due', expected: contentOn ? [...wantedReminders(loadTasks(), now).keys()] : [] },
    { family: 'exam', expected: contentOn ? [...wantedExamReminders(lessons, now).keys()] : [] },
    {
      family: 'digest',
      expected: digestOn ? plannedDigestDays(new Date(now)).map((d) => digestIdFor(d)) : [],
    },
    {
      family: 'studyBlock',
      expected: blockRemindOn ? [...wantedStudyBlockReminders(loadStudyBlocks(), now).keys()] : [],
    },
  ]
}

/**
 * 总开关关闭：**清空系统队列 + 清空六家记账**。
 *
 * 为什么记账必须跟着清（而不是像以前那样只清课程/学习块两家）：记账是「我排过谁」的
 * 一等数据，队列清空后它却还留着，那四家就成了「排过、但队列里既没有、也不再想要」
 * ——`auditFamily` 正把它读成**陈旧记账**，于是用户关掉提醒后反而在设置里看到一条
 * 不存在的陈旧提醒（诊断指向不存在的问题比没有诊断更坏）；下次开启时各家也是在脏记账上
 * 做清扫。
 *
 * 为什么不逐家调 `cancelXxx`：那要求每家都导出取消入口（SISU 计划家就没有自己的），
 * 而且新增一家就得记得回来补一行。这里直接按 `NOTIF_LEDGER_KEYS` 遍历——家族清单的
 * 唯一所有者是 `notifLedger`，加一家自动被覆盖。
 */
export async function cancelAllReminderFamilies(): Promise<void> {
  await cancelAllNotifications().catch(() => {})
  for (const key of Object.values(NOTIF_LEDGER_KEYS)) saveNotifLedger(key, [])
}

export interface ReminderHealth {
  report: PendingNotificationsReport
  /** 队列读失败时为 null（无法对账） */
  audit: FamilyAudit[] | null
}

function loadLedgers(): Partial<Record<NotifFamily, number[]>> {
  const out: Partial<Record<NotifFamily, number[]>> = {}
  for (const family of Object.keys(NOTIF_LEDGER_KEYS) as NotifFamily[]) {
    out[family] = loadNotifLedger(NOTIF_LEDGER_KEYS[family])
  }
  return out
}

export async function loadReminderHealth(
  now: number = Date.now(),
  expectations: FamilyExpectation[] = storedFamilyExpectations(now),
): Promise<ReminderHealth> {
  const report = await loadPendingNotifications(now)
  if (!report.ok) return { report, audit: null }
  return {
    report,
    audit: auditReminderFamilies(expectations, loadLedgers(), report.items.map((item) => item.id)),
  }
}

/** 自愈结果：诊断面板不需要它，但调用方（提醒周期）与测试需要区分几种走法。 */
export interface ReminderHealOutcome {
  /** 真的重排了一次吗（没缺失、读不到队列、开关关着 → false） */
  attempted: boolean
  /** 重排前缺失条数 */
  before: number
  /** 重排后仍缺失的条数（未尝试时与 `before` 相同） */
  after: number
  /** 重排后已经补齐（`after === 0`） */
  healed: boolean
  /** 本轮缺失过的家族（attempted=false 时为空） */
  families: NotifFamily[]
}

/**
 * 一个家族的重排入口：`expected` 现算（别缓存——排完之后数据可能已经变了），
 * `refresh` 由调用方绑定该家族的文本与输入（i18n 与数据都在组件层）。
 */
export interface FamilyRepair {
  family: NotifFamily
  expected: (now: number) => number[]
  refresh: () => Promise<void>
}

/**
 * **自动自愈**：对账发现「本应排上、队列里却没有」的提醒时，直接让**缺失的那几家**
 * 各自重排一次，而不是把「去开关一次提醒」这种活儿推给用户。
 *
 * 为什么值得自动做：队列会被 App 之外的力量清掉（WebView 重载丢内存队列、系统清理、
 * 厂商 ROM 省电策略、插件静默失败），而这些**都不会报错**——用户看到的现象只是
 * 「到点没响」。让每个提醒周期在排完之后自己再对一次账、补齐差额，就把这类静默失败
 * 收敛掉了。
 *
 * 边界（每条都刻意）：
 * - **不猜**：队列读不到时什么都不做（把读失败当成「全都缺失」是在制造噪音）。
 * - **不越权**：只在 `enabled` 时重排；关着的家族照旧只清不排。
 * - **只修缺的**：健康家族不重排（每轮都全量重排会平白抖一次通知队列）。
 * - **有界**：一次调用最多重排一趟（`before → after` 只走一遍），不循环重试；
 *   仍缺失就留给下一个周期——排期失败通常是环境问题，原地空转只会烧电。
 * - **幂等**：各家的重排入口都是「先取消自己的记账、再按当前数据排」，与常规刷新重叠
 *   也不会产生副本。
 * - **串行**：逐家 await，不并发——六家的 cancel/schedule 交错只会让队列状态难解释。
 */
export async function healMissingReminders(
  repairs: FamilyRepair[],
  options: { enabled: boolean },
  now: number = Date.now(),
): Promise<ReminderHealOutcome> {
  const idle = (before: number): ReminderHealOutcome => ({
    attempted: false,
    before,
    after: before,
    healed: before === 0,
    families: [],
  })
  if (!options.enabled) return idle(0)

  const expectations = () => repairs.map((r) => ({ family: r.family, expected: r.expected(now) }))
  const before = await loadReminderHealth(now, expectations())
  if (!before.audit) return idle(0)
  const broken = before.audit.filter((entry) => entry.missing.length > 0)
  const missing = broken.reduce((sum, entry) => sum + entry.missing.length, 0)
  if (missing === 0) return idle(0)

  for (const entry of broken) {
    const repair = repairs.find((r) => r.family === entry.family)
    if (repair) await repair.refresh().catch(() => {})
  }
  const after = await loadReminderHealth(now, expectations())
  const remaining = after.audit
    ? after.audit.reduce((sum, entry) => sum + entry.missing.length, 0)
    : missing
  return {
    attempted: true,
    before: missing,
    after: remaining,
    healed: remaining === 0,
    families: broken.map((entry) => entry.family),
  }
}
