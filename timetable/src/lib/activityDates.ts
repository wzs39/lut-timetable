import type { Task } from './tasks'
import { taskCmidOf } from './submissions'

/**
 * 活动（Moodle activity）的开始/截止日期：唯一合成处。
 *
 * 数据来源两份，都是学生 token 可读、都已存在的请求：
 *   1. `mod_assign_get_assignments` 的 `allowsubmissionsfromdate` / `duedate`
 *      （精确；由 submissions.ts 解析）
 *   2. `core_course_get_contents` 每个模块的 `dates[]`（quiz/forum 等非 assign
 *      活动；`module.id` 本身就是 cmid）
 *
 * 规则：
 *   - 活动有值就覆盖任务上的推断值（ICS 事件跨度 / 时间线 timesort 只是兜底）；
 *   - 活动缺某个字段时**保留**任务原值，绝不清空；
 *   - 只按 cmid 联接（`taskCmidOf`，唯一所有者），手动任务永不改写。
 *
 * 模块 `dates` 的 label 会被站点语言翻译（"Opens:"/"Avautuu:"…），但 `dataid`
 * 是**语义键**（`timeopen` / `duedate` / `allowsubmissionsfromdate` / `timeclose` /
 * `submissionstart` / `assessmentend` / `cutoffdate` …）。因此：
 *   - `dataid` 全部可识别 → 开放类取 min=开始、截止类取 max=截止、
 *     `cutoffdate` 单独存为**迟交截止**（assign 的宽限窗口，不是 due）、
 *     `gradingduedate` 单独存为**评分截止**（教师批改期限，既不是 due 也不是 cutoff）；
 *     **只有开放日期时绝不当截止**（实测 K200DJ96 的作业只有 `Opened:`：
 *     以前会被写成「截止 8月26日」，连带逾期/提醒/ICS 全错）；
 *   - `dataid` 缺失或不认识（旧站点、第三方模块）→ 退回时间戳启发式：
 *     ≥2 个取 min/max，只有 1 个当截止。
 */

export interface ActivityDates {
  startAt?: string
  /** 提交截止 / 测验关闭（Moodle `duedate` / `timeclose`）。 */
  dueAt?: string
  /** 迟交截止（Moodle `cutoffdate`）：due 之后仍可提交到这一刻。 */
  cutoffAt?: string
  /** 评分截止（Moodle `gradingduedate`）：教师批改期限，不是学生的提交期限。 */
  gradingDueAt?: string
}

export type ActivityDatesByCmid = ReadonlyMap<number, ActivityDates>

/** 同步来源的任务（与任务列表里「手动任务」的判据同源）。 */
const MOODLE_TASK = /^moodle(-act)?:/

function isoFromSeconds(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  const date = new Date(value * 1000)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

/** Moodle `dates[].dataid` 的语义分类（label 被本地化，dataid 不会）。 */
const OPEN_DATE_IDS = new Set(['timeopen', 'allowsubmissionsfromdate', 'submissionstart', 'assessmentstart'])
const CLOSE_DATE_IDS = new Set(['duedate', 'timeclose', 'submissionend', 'assessmentend'])
/** 迟交截止必须与 due 分开：它是宽限窗口的终点，不是提交截止。 */
const CUTOFF_DATE_IDS = new Set(['cutoffdate'])
/** 评分截止是教师批改期限：既不能当 due，也不能当迟交截止。 */
const GRADING_DATE_IDS = new Set(['gradingduedate'])

/** `core_course_get_contents` 模块的 `dates[]` → ActivityDates（label 不可信，dataid 可信）。 */
export function parseModuleDates(
  raw: ReadonlyArray<{ timestamp?: number; dataid?: string | number } | null | undefined> | undefined,
): ActivityDates {
  if (!Array.isArray(raw)) return {}
  const usable = raw.filter(
    (entry): entry is { timestamp: number; dataid?: string | number } =>
      !!entry && typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp) && entry.timestamp > 0,
  )
  if (usable.length === 0) return {}
  /** 实测 dataid 是字符串；早期版本的类型写成 number，这里两种都接受。 */
  const dateId = (entry: { dataid?: string | number }): string => (entry.dataid == null ? '' : String(entry.dataid))

  // 全部 dataid 都认识时按语义分桶：开放类 ≠ 截止类。
  const allKnown = usable.every(
    (entry) =>
      OPEN_DATE_IDS.has(dateId(entry)) ||
      CLOSE_DATE_IDS.has(dateId(entry)) ||
      CUTOFF_DATE_IDS.has(dateId(entry)) ||
      GRADING_DATE_IDS.has(dateId(entry)),
  )
  if (allKnown) {
    const opens = usable.filter((entry) => OPEN_DATE_IDS.has(dateId(entry))).map((entry) => entry.timestamp)
    const closes = usable.filter((entry) => CLOSE_DATE_IDS.has(dateId(entry))).map((entry) => entry.timestamp)
    const cutoffs = usable.filter((entry) => CUTOFF_DATE_IDS.has(dateId(entry))).map((entry) => entry.timestamp)
    const gradings = usable.filter((entry) => GRADING_DATE_IDS.has(dateId(entry))).map((entry) => entry.timestamp)
    const result: ActivityDates = {}
    if (opens.length) result.startAt = isoFromSeconds(Math.min(...opens))
    if (closes.length) result.dueAt = isoFromSeconds(Math.max(...closes))
    if (cutoffs.length) result.cutoffAt = isoFromSeconds(Math.max(...cutoffs))
    if (gradings.length) result.gradingDueAt = isoFromSeconds(Math.max(...gradings))
    return result
  }

  // 旧站点/第三方模块没有 dataid：退回时间戳启发式（1 个=截止，≥2 个=min/max）。
  const unique = [...new Set(usable.map((entry) => entry.timestamp))].sort((a, b) => a - b)
  if (unique.length === 1) return { dueAt: isoFromSeconds(unique[0]) }
  return { startAt: isoFromSeconds(unique[0]), dueAt: isoFromSeconds(unique[unique.length - 1]) }
}

/** 合并多份 map；**后者覆盖前者**的逐字段值（assign 应作为最后一个参数）。 */
export function mergeActivityDates(...maps: ActivityDatesByCmid[]): ActivityDatesByCmid {
  const out = new Map<number, ActivityDates>()
  for (const map of maps) {
    for (const [cmid, dates] of map) {
      const prev = out.get(cmid)
      const next: ActivityDates = {
        startAt: dates.startAt ?? prev?.startAt,
        dueAt: dates.dueAt ?? prev?.dueAt,
        cutoffAt: dates.cutoffAt ?? prev?.cutoffAt,
        gradingDueAt: dates.gradingDueAt ?? prev?.gradingDueAt,
      }
      if (next.startAt || next.dueAt || next.cutoffAt || next.gradingDueAt) out.set(cmid, next)
    }
  }
  return out
}

/** 从已同步任务反推日期（内容树的兜底：活动接口没给时的最后已知值）。 */
export function datesFromTasks(tasks: Task[]): ActivityDatesByCmid {
  const out = new Map<number, ActivityDates>()
  for (const task of tasks) {
    if (!MOODLE_TASK.test(task.id)) continue
    if (!task.startAt && !task.dueAt && !task.cutoffAt && !task.gradingDueAt) continue
    const cmid = taskCmidOf(task)
    if (cmid == null) continue
    out.set(cmid, {
      startAt: task.startAt,
      dueAt: task.dueAt,
      cutoffAt: task.cutoffAt,
      gradingDueAt: task.gradingDueAt,
    })
  }
  return out
}

/**
 * 把活动日期套用到同步任务上。
 * 无 cmid、非同步任务、日期没变化 → 返回原数组引用（避免无意义的落盘与重渲染）。
 */
export function applyActivityDatesToTasks(
  tasks: Task[],
  byCmid: ActivityDatesByCmid,
): Task[] {
  if (byCmid.size === 0) return tasks
  let changed = false
  const next = tasks.map((task) => {
    if (!MOODLE_TASK.test(task.id)) return task
    const cmid = taskCmidOf(task)
    if (cmid == null) return task
    const dates = byCmid.get(cmid)
    if (!dates) return task
    const startAt = dates.startAt ?? task.startAt
    const dueAt = dates.dueAt ?? task.dueAt
    const cutoffAt = dates.cutoffAt ?? task.cutoffAt
    const gradingDueAt = dates.gradingDueAt ?? task.gradingDueAt
    if (
      startAt === task.startAt &&
      dueAt === task.dueAt &&
      cutoffAt === task.cutoffAt &&
      gradingDueAt === task.gradingDueAt
    ) return task
    changed = true
    return {
      ...task,
      startAt: startAt || undefined,
      dueAt: dueAt || undefined,
      cutoffAt: cutoffAt || undefined,
      gradingDueAt: gradingDueAt || undefined,
      updatedAt: new Date().toISOString(),
    }
  })
  return changed ? next : tasks
}
