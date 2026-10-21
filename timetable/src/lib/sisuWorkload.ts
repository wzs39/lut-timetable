/**
 * 学分量 → 周工作量的唯一换算（SISU 总学时口径）。
 *
 * 为什么单独成文件：这个换算同时被毕业情景（`sisuScenario`）、自动均衡负荷
 * （`sisuRebalance`）、可选课程推荐（`optionalCourses`）和页面上的负荷告警消费。
 * 散在几处各写一个除数，就会出现
 * 「情景说 93.8h、削峰按另一个数搬课」的漂移。
 *
 * 口径（2026-10 校准）：
 * - 1 学分 = 27 h 总工作量（SISU 的 `totalHours` 已含自学/作业；缺字段时才用
 *   `ects-estimate` 的 27 h/学分）。SISU 写出的总学时若低于 20 h/学分（真实案例：
 *   12 cr 的论文课描述只合计 162 h），`scripts/fetch-sisu-facts.mjs` 改按 27 h/cr
 *   估算并打 `workloadAnomaly`，UI 会列出「请核对」——不要在这里再猜一次。
 * - 一个 LUT 学段 ≈ 8 周（含考试周）。跨学段的课程按学段数均摊，所以
 *   「6 学分、162 h、P1–P2」= 10.1 h/周，而不是 20.3。
 * - **自定进度课程（MOOC 等 `selfPaced`）不计入周负荷**：它们没有固定课表，
 *   把 54 h 压进某一个学段会把整周数字抬高到不可信（真实数据里 5 门 MOOC
 *   曾凭空制造 34 h/周）。学分照算，只是不参与周负荷。
 * - **0 学分课程不计入**：计划里用 0 学分占位的行（如 HDD5000）带 162 h，
 *   直接把一个学段从 50 h 抬到 60 h，但它并不产生工作量。
 * - 告警阈值 = 60 h/周。全日制 60 学分/年 × 27 h ÷ 32 教学周 ≈ 50.6 h/周，
 *   60 留了约 18% 余量；这样「正常满课」不会天天告警，而 1.5 倍负荷会。
 */

/** LUT 一个学段的教学周数（含考试周）。所有周负荷都按这个分母折算。 */
export const WEEKS_PER_PERIOD = 8

/**
 * 全日制基准（60 cr/年 ≈ 50.6 h/周）+ 余量。超过它才算「负荷告警」，不是
 * 每门课都报警。阈值只在这里定义，`sisuScenario` / `sisuRebalance` 都引用它。
 */
export const DEFAULT_MAX_WEEKLY_HOURS = 60

/** 每周总工作量（含自学）的绝对上限：再高就不是「忙」而是排不下。 */
export const ABSOLUTE_MAX_WEEKLY_HOURS = 80

/**
 * Valid, de-duplicated study periods (P1–P4).
 *
 * Duplicates must never inflate the divisor: a stored plan row with `[1, 1]`
 * would otherwise divide by 16 weeks and halve that course's weekly load, and
 * thereby hide a real overload.
 */
export function teachingPeriods(periods: readonly number[]): number[] {
  const unique: number[] = []
  for (const period of periods) {
    if (Number.isInteger(period) && period >= 1 && period <= 4 && !unique.includes(period)) unique.push(period)
  }
  return unique.sort((a, b) => a - b)
}

export interface WorkloadInput {
  /** 课程总工作量（SISU `totalHours`）；缺失或 0 → 不产生周负荷。 */
  totalHours?: number
  /** 计划行学分；0 学分占位行不产生工作量。 */
  credits: number
  /** 课程占用的学段（决定均摊的周数）。空 → 无固定排期。 */
  periods: readonly number[]
  /** 自定进度（MOOC 等）：没有固定周课表，不计入周负荷。 */
  selfPaced?: boolean
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 一门课在「它占用的每个学段」里的周工作量。
 *
 * 跨学段课程均摊（162 h / P1–P2 = 10.1 h/周）；自定进度与 0 学分返回 0。
 * 这是唯一实现，不要在调用处再写 `totalHours / (periods * 8)`。
 */
export function courseWeeklyHours(input: WorkloadInput): number {
  if (input.selfPaced) return 0
  if (!(input.credits > 0)) return 0
  if (!input.totalHours || input.totalHours <= 0) return 0
  const periodCount = teachingPeriods(input.periods).length
  if (periodCount === 0) return 0
  return round1(input.totalHours / (periodCount * WEEKS_PER_PERIOD))
}

/**
 * 课程在该学段占的学分份额。跨学段课程按学段数均摊，否则同一门课会在
 * P1 和 P2 各算一次整学分（真实数据里第一学年因此从 67 cr 虚报成 99 cr）。
 */
export function termCreditShare(credits: number, periodCount: number): number {
  if (!(credits > 0) || periodCount <= 0) return 0
  return round2(credits / periodCount)
}

/** 一个学段的汇总：学分份额 + 周工作量（两者用同一套均摊规则）。 */
export function termTotals(
  courses: ReadonlyArray<WorkloadInput & { credits: number }>,
): { credits: number; weeklyHours: number } {
  let credits = 0
  let weeklyHours = 0
  for (const course of courses) {
    credits += termCreditShare(course.credits, teachingPeriods(course.periods).length)
    weeklyHours += courseWeeklyHours(course)
  }
  return { credits: round1(credits), weeklyHours: round1(weeklyHours) }
}
