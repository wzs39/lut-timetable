import type { CourseGrades } from './grades'
import type { Task } from './tasks'

/**
 * 作业优先级：先做哪个？
 *
 * 只看截止时间（现有分组已经这么做）会漏掉一个事实——**权重不一样**。
 * 一门占总评 60% 的课的小作业，通常比一门 5% 的课的大作业更值得先动。
 *
 * 打分模型（可解释、无黑盒）：
 *   score = 课程剩余权重 × 紧迫度
 * - 课程剩余权重：这门课还没评分的部分占课程总分的百分比（来自 Moodle 成绩）。
 *   匹配不到课程时给 NEUTRAL_WEIGHT——不能因为"未知"就排到最后。
 * - 紧迫度：`1 / (1 + 剩余天数)`，今天到期 = 1，明天 = 1/2，7 天 = 1/8。
 *   逾期按今天算（= 1），因为逾期本身就由「逾期」分组单独提示。
 *
 * 分数只在同一门/不同门之间做相对排序，界面上不做"精确到小数"的展示。
 */

/** 匹配不到成绩数据时的中性权重（%），保证未知课程不会被动沉底 */
export const NEUTRAL_WEIGHT = 15

export interface TaskImpact {
  id: string
  score: number
  /** 距截止的天数（向上取整，逾期为负）；无截止时间 = null */
  daysLeft: number | null
  /** 该课尚未评分的权重合计（%） */
  remainingWeight: number
  /** 课程或成绩无法匹配 → 用了中性权重 */
  approximate: boolean
}

/** 一门课尚未评分的权重合计（0 = 已全部评分或没有成绩数据）。 */
export function courseRemainingWeight(c: CourseGrades | undefined): number {
  if (!c) return 0
  let sum = 0
  for (const it of c.items) {
    if (it.weight == null || it.weight <= 0) continue
    if (it.grade == null) sum += it.weight
  }
  return sum
}

/** 紧迫度：今天到期 1，明天 1/2，一周 1/8；无截止时间取一个很小的值。 */
export function urgencyOf(daysLeft: number | null): number {
  if (daysLeft == null) return 0.1
  return 1 / (1 + Math.max(0, daysLeft))
}

function daysUntil(dueAt: string | undefined, now: Date): number | null {
  if (!dueAt) return null
  const at = new Date(dueAt).getTime()
  if (!Number.isFinite(at)) return null
  return Math.ceil((at - now.getTime()) / 86400000)
}

/**
 * 给每个任务算影响分。`weightByCode`：课程码 → 剩余权重（buildWeightIndex 产出）。
 */
export function taskImpacts(
  tasks: Task[],
  weightByCode: Map<string, number>,
  now: Date,
): Map<string, TaskImpact> {
  const out = new Map<string, TaskImpact>()
  for (const task of tasks) {
    if (task.completed) continue
    const matched = task.course ? weightByCode.get(task.course) : undefined
    const weight = matched != null && matched > 0 ? matched : NEUTRAL_WEIGHT
    const daysLeft = daysUntil(task.dueAt, now)
    out.set(task.id, {
      id: task.id,
      score: weight * urgencyOf(daysLeft),
      daysLeft,
      remainingWeight: matched ?? 0,
      approximate: !(matched != null && matched > 0),
    })
  }
  return out
}

/**
 * 按影响分降序排列（同分回到截止/创建顺序，保证稳定）。
 * 未参与打分（已完成/未知）的任务排在最后并保持原序。
 */
export function sortByImpact<T extends Task>(tasks: T[], impacts: Map<string, TaskImpact>): T[] {
  return tasks
    .map((task, i) => ({ task, i, score: impacts.get(task.id)?.score }))
    .sort((a, b) => {
      const av = a.score ?? -1
      const bv = b.score ?? -1
      if (av !== bv) return bv - av
      return a.i - b.i
    })
    .map((x) => x.task)
}

/** 低于这个剩余权重就算不上「这门课的分数大头」，不打「先做」标记 */
export const MEANINGFUL_WEIGHT = 20

/**
 * 「先做」标记：只标真正有依据的——
 * - 必须有真实课程权重（Moodle 成绩），否则无从比较（没数据的课全都会被
 *   标上，标记就失去意义）；
 * - 该课剩余权重至少 MEANINGFUL_WEIGHT；
 * - 按分数取前 n。
 * 拿不到成绩数据时返回空集：宁可不说，也不乱指方向。
 */
export function priorityHintIds(impacts: Map<string, TaskImpact>, n: number): Set<string> {
  return new Set(
    [...impacts.values()]
      .filter((i) => !i.approximate && i.remainingWeight >= MEANINGFUL_WEIGHT)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, n))
      .map((x) => x.id),
  )
}

/**
 * 课程码 → 剩余权重。键同时收「日历代码」和「Moodle 课程名」，
 * 因为任务的 course 字段两种格式都会出现（手动任务存的是课名）。
 */
export function buildWeightIndex(
  courses: readonly CourseGrades[],
  calendarCodeOf: (courseName: string) => string | null,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const c of courses) {
    const w = courseRemainingWeight(c)
    map.set(c.course, w)
    const code = calendarCodeOf(c.course)
    if (code) map.set(code, w)
  }
  return map
}
