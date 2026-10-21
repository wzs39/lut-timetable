import type { CourseFact } from './sisuCourseFacts'
import type { PlanCategory, SisuPlanItem, SisuStudyPlan } from './sisuStudyPlan'
import { PERSONAL_PLAN_CATEGORY_MINIMUMS } from './personalStudyPlan'
import { likelyPrerequisiteCodes } from './optionalCourses'
import { DEFAULT_MAX_WEEKLY_HOURS, courseWeeklyHours, teachingPeriods, termCreditShare } from './sisuWorkload'

export type ScenarioStatus = 'completed' | 'scheduled' | 'cancelled' | 'delayed' | 'unscheduled'

export interface ScenarioCourse {
  itemId: string
  code?: string
  title: string
  credits: number
  category?: PlanCategory
  status: ScenarioStatus
  /** 0-based study year inside the scenario window. */
  yearIndex?: number
  periods: number[]
  plannedYearIndex?: number
  plannedPeriods?: number[]
  moved: boolean
  timingSource: 'pdf-plan' | 'scenario' | 'completed'
  weeklyHours: number
  reasons: string[]
}

export interface ScenarioTerm {
  yearIndex: number
  period: number
  courses: ScenarioCourse[]
  credits: number
  weeklyHours: number
  overloaded: boolean
}

export type ScenarioWarningKind =
  | 'overload' | 'prerequisite' | 'cancelled' | 'delayed' | 'unscheduled'
  | 'stale-offering' | 'workload-anomaly' | 'no-offering' | 'report-mismatch'

export interface ScenarioWarning {
  kind: ScenarioWarningKind
  courseCode?: string
  messageKey: string
  detail: string
}

export interface ScenarioResult {
  targetYears: number
  terms: ScenarioTerm[]
  courses: ScenarioCourse[]
  cancelled: ScenarioCourse[]
  delayed: ScenarioCourse[]
  unscheduled: ScenarioCourse[]
  warnings: ScenarioWarning[]
  annualCredits: number[]
  totalCredits: number
  plannedCredits: number
  completedCredits: number
  /** Absolute 1-based term (yearIndex * 4 + period). */
  graduationTerm?: number
  overloadTerms: number
}

export interface ScenarioInput {
  plan: SisuStudyPlan
  facts: Readonly<Record<string, CourseFact>>
  targetYears: number
  cancelledCodes?: readonly string[]
  reduceToMinimum?: boolean
  extraCourseCodes?: readonly string[]
  prerequisiteOverrides?: Readonly<Record<string, readonly string[]>>
  maxWeeklyHours?: number
  /**
   * itemId → periods, produced by `rebalanceScenario` (or by hand). Applied
   * after `place()` so the whole projection — terms, warnings, graduation —
   * recomputes around the levelled windows instead of being patched afterwards.
   */
  periodOverrides?: Readonly<Record<string, readonly number[]>>
}

export function cleanPlanCode(code: string): string {
  return code.replace(/-\d{4}$/, '').trim().toUpperCase()
}

export function planStartYear(plan: SisuStudyPlan): number {
  const years = plan.items
    .map((item) => Number(item.studyYear?.slice(0, 4)))
    .filter((year) => Number.isFinite(year) && year > 2000)
  return years.length > 0 ? Math.min(...years) : 2026
}

export interface CategoryProgress {
  category: PlanCategory
  completed: number
  planned: number
  total: number
  minimum: number
}

export function planCategoryProgress(plan: SisuStudyPlan): CategoryProgress[] {
  return (Object.keys(PERSONAL_PLAN_CATEGORY_MINIMUMS) as PlanCategory[]).map((category) => {
    const items = plan.items.filter((item) => item.category === category)
    const completed = items.filter((item) => item.completed).reduce((sum, item) => sum + (item.credits ?? 0), 0)
    const planned = items.filter((item) => !item.completed).reduce((sum, item) => sum + (item.credits ?? 0), 0)
    return { category, completed, planned, total: completed + planned, minimum: PERSONAL_PLAN_CATEGORY_MINIMUMS[category] ?? 0 }
  })
}

function plannedTerm(item: SisuPlanItem, startYear: number): { yearIndex: number; periods: number[] } {
  const year = Number(item.studyYear?.slice(0, 4))
  const yearIndex = Number.isFinite(year) && year >= startYear ? year - startYear : 0
  return { yearIndex, periods: [...(item.periods ?? [])] }
}

function termIndex(yearIndex: number, period: number): number {
  return yearIndex * 4 + period
}

function withMinimumPlan(plan: SisuStudyPlan): SisuStudyPlan {
  const kept: SisuPlanItem[] = []
  const totals = new Map<PlanCategory, number>()
  for (const item of plan.items) {
    if (item.completed && item.category) {
      totals.set(item.category, (totals.get(item.category) ?? 0) + (item.credits ?? 0))
    }
  }
  for (const item of plan.items) {
    if (item.completed || !item.category) {
      kept.push(item)
      continue
    }
    const minimum = PERSONAL_PLAN_CATEGORY_MINIMUMS[item.category] ?? 0
    const current = totals.get(item.category) ?? 0
    if (current < minimum) {
      kept.push(item)
      totals.set(item.category, current + (item.credits ?? 0))
    }
  }
  return { ...plan, items: kept }
}

function optionalItem(code: string, fact: CourseFact, startYear: number, targetYears: number): SisuPlanItem {
  return {
    id: `scenario-optional-${code}`,
    kind: 'course',
    title: fact.code,
    courseCode: code,
    credits: fact.credits,
    category: 'elective',
    studyYear: `${startYear + targetYears - 1}-${startYear + targetYears}`,
    periods: [...fact.offeringPattern],
    completed: false,
    createdAt: new Date(0).toISOString(),
    timingSource: 'scenario',
  }
}

interface Placement { yearIndex: number; periods: number[]; stale: boolean; noOffering: boolean }

function place(
  item: SisuPlanItem,
  fact: CourseFact | undefined,
  targetYears: number,
  startYear: number,
  override?: readonly number[],
): Placement {
  const planned = plannedTerm(item, startYear)
  // The scenario compresses every year beyond the target into the final target year.
  const preferredYear = Math.min(planned.yearIndex, targetYears - 1)
  // 学段一律走 teachingPeriods：合法化 + 去重，重复值不能把负荷除两次。
  const pattern = teachingPeriods(fact?.offeringPattern ?? [])
  const wanted = teachingPeriods(planned.periods)
  const levelled = teachingPeriods(override ?? [])

  const withOverride = (placement: Placement): Placement =>
    levelled.length > 0 ? { ...placement, periods: levelled } : placement

  if (!fact) return withOverride({ yearIndex: preferredYear, periods: wanted.length > 0 ? wanted : [1, 2], stale: false, noOffering: false })
  // No public offering data is not the same as a stale/mismatched offering.
  if (pattern.length === 0) return withOverride({ yearIndex: preferredYear, periods: wanted.length > 0 ? wanted : [1], stale: fact.offeringConfidence === 'stale', noOffering: false })

  const overlap = wanted.filter((period) => pattern.includes(period))
  const chosen = overlap.length > 0 ? overlap : pattern
  const matchesPlan = overlap.length > 0 && planned.yearIndex === preferredYear
  return withOverride({
    yearIndex: preferredYear,
    periods: chosen,
    stale: fact.offeringConfidence === 'stale' || (!matchesPlan && planned.periods.length > 0),
    noOffering: false,
  })
}

/**
 * Build "what if" scenarios without touching storage. Courses keep their SISU
 * offering pattern; the only thing the scenario moves is the study year when a
 * graduation target compresses the plan.
 */
export function buildScenario(input: ScenarioInput): ScenarioResult {
  const targetYears = Math.max(1, Math.min(6, Math.round(input.targetYears)))
  const startYear = planStartYear(input.plan)
  const maxWeeklyHours = input.maxWeeklyHours ?? DEFAULT_MAX_WEEKLY_HOURS
  const cancelled = new Set((input.cancelledCodes ?? []).map(cleanPlanCode))
  const overrides = input.prerequisiteOverrides ?? {}
  const basePlan = input.reduceToMinimum ? withMinimumPlan(input.plan) : input.plan
  const extraItems = (input.extraCourseCodes ?? [])
    .filter((code) => !basePlan.items.some((item) => item.courseCode && cleanPlanCode(item.courseCode) === cleanPlanCode(code)))
    .flatMap((code) => input.facts[cleanPlanCode(code)] ? [optionalItem(cleanPlanCode(code), input.facts[cleanPlanCode(code)], startYear, targetYears)] : [])

  const items = [...basePlan.items, ...extraItems]
  const courses: ScenarioCourse[] = []
  const warnings: ScenarioWarning[] = []
  const byCode = new Map<string, ScenarioCourse>()

  const placed = new Map<string, ScenarioCourse>()
  for (const item of items) {
    const code = item.courseCode ? cleanPlanCode(item.courseCode) : undefined
    const fact = code ? input.facts[code] : undefined
    const planned = plannedTerm(item, startYear)
    if (item.completed) {
      const completed: ScenarioCourse = {
        itemId: item.id, code, title: item.title, credits: item.credits ?? 0, category: item.category,
        status: 'completed', periods: [], plannedYearIndex: planned.yearIndex, plannedPeriods: planned.periods,
        moved: false, timingSource: 'completed', weeklyHours: 0, reasons: [],
      }
      courses.push(completed)
      if (code) byCode.set(code, completed)
      continue
    }
    if (code && cancelled.has(code)) {
      const blocked: ScenarioCourse = {
        itemId: item.id, code, title: item.title, credits: 0, category: item.category,
        status: 'cancelled', periods: [], plannedYearIndex: planned.yearIndex, plannedPeriods: planned.periods,
        moved: false, timingSource: 'scenario', weeklyHours: 0, reasons: ['scenarioWhyCancelled'],
      }
      courses.push(blocked)
      if (code) byCode.set(code, blocked)
      warnings.push({ kind: 'cancelled', courseCode: code, messageKey: 'scenarioWarnCancelled', detail: code })
      continue
    }
    const placement = place(item, fact, targetYears, startYear, input.periodOverrides?.[item.id])
    const periods = placement.periods
    const credits = item.credits ?? fact?.credits ?? 0
    // 周负荷的唯一换算是 sisuWorkload.courseWeeklyHours：它会排除自定进度
    // 与 0 学分行，并按学段数均摊。不要在调用处重写 `totalHours / 8`。
    const weeklyHours = courseWeeklyHours({
      totalHours: fact?.totalHours,
      credits,
      periods,
      selfPaced: fact?.selfPaced,
    })
    const moved = placement.yearIndex !== planned.yearIndex ||
      periods.join(',') !== planned.periods.join(',')
    const scheduled: ScenarioCourse = {
      itemId: item.id, code, title: item.title, credits, category: item.category,
      status: 'scheduled', yearIndex: placement.yearIndex, periods, plannedYearIndex: planned.yearIndex,
      plannedPeriods: planned.periods, moved, timingSource: moved ? 'scenario' : 'pdf-plan', weeklyHours,
      reasons: moved ? ['scenarioWhyMoved'] : [],
    }
    courses.push(scheduled)
    if (code) {
      byCode.set(code, scheduled)
      placed.set(code, scheduled)
    }
    if (placement.stale && periods.length > 0) {
      warnings.push({
        kind: 'stale-offering', courseCode: code, messageKey: 'scenarioWarnStaleOffering',
        detail: `${code ?? item.title}: ${periods.join('/')}`,
      })
    }
    if (fact?.workloadAnomaly) {
      warnings.push({ kind: 'workload-anomaly', courseCode: code, messageKey: 'scenarioWarnWorkloadAnomaly', detail: code ?? item.title })
    }
  }

  // Prerequisites: a course may never start before a prerequisite ends.
  const factOf = (code?: string) => code ? input.facts[cleanPlanCode(code)] : undefined
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (const course of courses) {
      if (course.status !== 'scheduled' || !course.code || course.yearIndex == null) continue
      const fact = factOf(course.code)
      if (!fact || fact.formalPrerequisites.length === 0) continue
      let latestPrereq = -1
      for (const prerequisite of fact.formalPrerequisites) {
        const clean = cleanPlanCode(prerequisite)
        const equivalent = overrides[clean] ?? likelyPrerequisiteCodes(clean)
        const candidates = [clean, ...equivalent]
          .map((code) => byCode.get(code))
          .filter((entry): entry is ScenarioCourse => Boolean(entry))
        if (candidates.length === 0) {
          warnings.push({ kind: 'prerequisite', courseCode: course.code, messageKey: 'scenarioWarnPrereqMissing', detail: `${course.code}（缺 ${clean}）` })
          continue
        }
        for (const candidate of candidates) {
          if (candidate.status === 'completed') continue
          if (candidate.yearIndex == null || candidate.periods.length === 0) continue
          latestPrereq = Math.max(latestPrereq, termIndex(candidate.yearIndex, Math.max(...candidate.periods)))
        }
      }
      if (latestPrereq < 0) continue
      const firstTerm = termIndex(course.yearIndex, Math.min(...course.periods))
      const prereqYear = Math.floor((latestPrereq - 1) / 4)
      if (latestPrereq >= firstTerm) {
        warnings.push({
          kind: 'prerequisite', courseCode: course.code, messageKey: 'scenarioWarnPrereq',
          detail: `${course.code} <- ${fact.formalPrerequisites.join(', ')}`,
        })
        if (course.yearIndex < targetYears - 1) {
          course.yearIndex = prereqYear + 1
          course.status = course.yearIndex >= targetYears ? 'delayed' : 'scheduled'
          course.moved = true
          course.timingSource = 'scenario'
          course.reasons = [...course.reasons, 'scenarioWhyPrereq']
          changed = true
        }
      }
    }
    if (!changed) break
  }

  // Anything placed beyond the target window is delayed, not counted as scheduled.
  for (const course of courses) {
    if (course.status !== 'scheduled' || course.yearIndex == null) continue
    if (course.yearIndex >= targetYears) {
      course.status = 'delayed'
      course.yearIndex = undefined
      warnings.push({ kind: 'delayed', courseCode: course.code, messageKey: 'scenarioWarnDelayed', detail: course.code ?? course.title })
    }
  }

  const terms: ScenarioTerm[] = []
  for (let yearIndex = 0; yearIndex < targetYears; yearIndex++) {
    for (let period = 1; period <= 4; period++) {
      const inTerm = courses.filter((course) =>
        course.status === 'scheduled' && course.yearIndex === yearIndex && course.periods.includes(period),
      )
      // 跨学段课程按学段均摊学分：否则同一门课会在 P1/P2 各算一次整学分，
      // 第一学年会被虚报成 42 cr（真实 27.8 cr）。与 weeklyHours 同一分母。
      const credits = Math.round(
        inTerm.reduce((sum, course) => sum + termCreditShare(course.credits, course.periods.length), 0) * 10,
      ) / 10
      const weeklyHours = Math.round(inTerm.reduce((sum, course) => sum + course.weeklyHours, 0) * 10) / 10
      const overloaded = weeklyHours > maxWeeklyHours
      terms.push({ yearIndex, period, courses: inTerm, credits, weeklyHours, overloaded })
      if (overloaded) {
        warnings.push({
          kind: 'overload', messageKey: 'scenarioWarnOverload',
          detail: `${startYear + yearIndex} P${period}: ${weeklyHours} h/周 / ${maxWeeklyHours} h/周`,
        })
      }
    }
  }

  const scheduled = courses.filter((course) => course.status === 'scheduled')
  const cancelledCourses = courses.filter((course) => course.status === 'cancelled')
  const delayed = courses.filter((course) => course.status === 'delayed')
  const unscheduled = courses.filter((course) => course.status === 'unscheduled')
  const completed = courses.filter((course) => course.status === 'completed')
  const lastTerm = scheduled.reduce((max, course) => {
    if (course.yearIndex == null || course.periods.length === 0) return max
    return Math.max(max, termIndex(course.yearIndex, Math.max(...course.periods)))
  }, 0)
  const annualCredits = Array.from({ length: targetYears }, (_, yearIndex) =>
    courses.filter((course) => course.status === 'scheduled' && course.yearIndex === yearIndex)
      .reduce((sum, course) => sum + course.credits, 0),
  )
  const plannedCredits = [...scheduled, ...delayed].reduce((sum, course) => sum + course.credits, 0)
  const completedCredits = completed.reduce((sum, course) => sum + course.credits, 0)
  const totalCredits = completed.reduce((sum, course) => sum + course.credits, 0) + plannedCredits

  return {
    targetYears,
    terms,
    courses,
    cancelled: cancelledCourses,
    delayed,
    unscheduled,
    warnings,
    annualCredits,
    totalCredits,
    plannedCredits,
    completedCredits,
    graduationTerm: lastTerm > 0 ? lastTerm : undefined,
    overloadTerms: terms.filter((term) => term.overloaded).length,
  }
}

export interface ScenarioComparisonRow {
  targetYears: number
  graduation?: string
  plannedCredits: number
  /** Planned credits spread over the target window (completed credits are already earned, not scheduled). */
  creditsPerYear: number
  peakWeeklyHours: number
  /** Terms inside the target window; overload counts are only comparable against it. */
  termCount: number
  overloadTerms: number
  delayedCount: number
  cancelledCount: number
  /** Courses whose prerequisite set is not in the plan at all (one warning per missing code, deduped per course). */
  missingPrerequisiteCourses: number
  /** Everything lands inside the window without an overloaded term. */
  fitsTarget: boolean
}

/**
 * Run the same plan through several graduation targets. Read-only: each row is a
 * fresh `buildScenario` projection, so the comparison can never drift from the
 * scenario the rest of the page renders.
 */
/** One comparison row for an already-built scenario; the single owner of the row shape. */
export function scenarioComparisonRow(result: ScenarioResult, startYear: number): ScenarioComparisonRow {
  const missing = new Set(result.warnings
    .filter((warning) => warning.messageKey === 'scenarioWarnPrereqMissing' && warning.courseCode)
    .map((warning) => warning.courseCode as string))
  return {
    targetYears: result.targetYears,
    graduation: graduationLabel(result, startYear),
    plannedCredits: result.plannedCredits,
    creditsPerYear: Math.round((result.plannedCredits / result.targetYears) * 10) / 10,
    peakWeeklyHours: result.terms.reduce((peak, term) => Math.max(peak, term.weeklyHours), 0),
    termCount: result.terms.length,
    overloadTerms: result.overloadTerms,
    delayedCount: result.delayed.length,
    cancelledCount: result.cancelled.length,
    missingPrerequisiteCourses: missing.size,
    fitsTarget: result.delayed.length === 0 && result.overloadTerms === 0,
  }
}

export function compareScenarios(
  input: Omit<ScenarioInput, 'targetYears'>,
  targets: readonly number[] = [2, 3, 4],
): ScenarioComparisonRow[] {
  const startYear = planStartYear(input.plan)
  const unique = [...new Set(targets.filter((years) => Number.isFinite(years)))].sort((a, b) => a - b)
  return unique.map((targetYears) => scenarioComparisonRow(buildScenario({ ...input, targetYears }), startYear))
}

/** Shortest target that fits the whole plan; `undefined` when none of them do. */
export function earliestFeasibleYears(rows: readonly ScenarioComparisonRow[]): number | undefined {
  return rows.find((row) => row.fitsTarget)?.targetYears
}

export function graduationLabel(result: ScenarioResult, startYear: number): string | undefined {
  if (!result.graduationTerm) return undefined
  const yearIndex = Math.floor((result.graduationTerm - 1) / 4)
  const period = ((result.graduationTerm - 1) % 4) + 1
  return `${startYear + yearIndex} P${period}`
}
