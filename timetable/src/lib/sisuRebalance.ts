import type { CourseFact } from './sisuCourseFacts'
import {
  buildScenario,
  cleanPlanCode,
  planStartYear,
  scenarioComparisonRow,
  type ScenarioComparisonRow,
  type ScenarioCourse,
  type ScenarioInput,
  type ScenarioResult,
} from './sisuScenario'
import { DEFAULT_MAX_WEEKLY_HOURS, courseWeeklyHours } from './sisuWorkload'

/**
 * Load levelling for the graduation scenario.
 *
 * The optimiser never changes a study year and never crams a course into fewer
 * weeks than planned: it only re-times a course's window inside the same year's
 * P1–P4. Windows that stay inside the SISU offering pattern are "safe";
 * same-length windows outside it are still offered (otherwise nothing could be
 * levelled on plans where every course is pinned to P1–P2) but they are flagged
 * so the UI can ask the user to verify the offering before trusting the plan.
 *
 * Everything here is a pure projection: the stored plan and the scenario prefs
 * are never touched.
 */

export interface RebalanceMove {
  itemId: string
  code?: string
  title: string
  yearIndex: number
  /** Periods the course occupied before the first move. */
  fromPeriods: number[]
  /** Periods it occupies after all moves. */
  toPeriods: number[]
  credits: number
  /** Weekly hours per teaching period after the move (a window inside the offering may stretch). */
  weeklyHours: number
  /** True when the new window is inside the SISU offering pattern. */
  withinOffering: boolean
}

export interface RebalanceOutcome {
  /** Final scenario with every accepted move applied. */
  scenario: ScenarioResult
  moves: RebalanceMove[]
  /** itemId → periods, ready for `buildScenario({ periodOverrides })`. */
  overrides: Record<string, number[]>
  peakBefore: number
  peakAfter: number
  overloadedBefore: number
  overloadedAfter: number
}

const TERM_PERIODS = [1, 2, 3, 4]
const MAX_MOVES = 32
// 阈值只有一个家：sisuWorkload（见该文件的 60h/周 口径说明）。

export interface RebalanceOptions {
  /**
   * Allow same-length windows outside the SISU offering pattern. They still
   * carry `withinOffering: false` so the UI can ask for verification, and the
   * strict mode exists because moving a P1–P2 course to P3–P4 is only correct
   * when that course is actually taught again later in the year.
   */
  allowOutsideOffering?: boolean
  maxWeeklyHours?: number
}

function termKey(yearIndex: number, period: number): string {
  return `${yearIndex}:${period}`
}

function withinBounds(periods: readonly number[]): number[] {
  return [...new Set(periods)].filter((period) => period >= 1 && period <= 4).sort((a, b) => a - b)
}

/** Every contiguous window inside `periods`, shortest first. */
function contiguousRuns(periods: readonly number[]): number[][] {
  const sorted = withinBounds(periods)
  const runs: number[][] = []
  for (let start = 0; start < sorted.length; start++) {
    for (let end = start; end < sorted.length; end++) {
      const run = sorted.slice(start, end + 1)
      if (run[run.length - 1] - run[0] !== run.length - 1) break
      runs.push(run)
    }
  }
  return runs
}

function initialLoads(result: ScenarioResult): Map<string, number> {
  const loads = new Map<string, number>()
  for (const term of result.terms) loads.set(termKey(term.yearIndex, term.period), term.weeklyHours)
  return loads
}

function peakOf(loads: Map<string, number>): number {
  let peak = 0
  for (const hours of loads.values()) if (hours > peak) peak = hours
  return Math.round(peak * 10) / 10
}

/**
 * Per-year load quality: the busiest week first, then how many terms go over
 * the cap, then the total excess (which spreads the load on ties).
 *
 * The batch-level guard below still lets the **global** peak rise when the
 * number of overloaded terms drops — pulling a prerequisite-delayed course
 * back into the year is such a trade — and the UI reports both numbers.
 */
function yearScore(loads: Map<string, number>, yearIndex: number, maxWeeklyHours: number) {
  let overloads = 0
  let peak = 0
  // Sum of squares spreads the load when the peak ties: without it the greedy
  // pass piles every move into whichever term emptied first.
  let spread = 0
  for (const period of TERM_PERIODS) {
    const hours = loads.get(termKey(yearIndex, period)) ?? 0
    if (hours > peak) peak = hours
    if (hours > maxWeeklyHours) overloads += 1
    spread += hours * hours
  }
  return {
    overloads,
    peak: Math.round(peak * 10) / 10,
    spread: Math.round(spread * 10) / 10,
  }
}

function betterScore(a: { overloads: number; peak: number; spread: number }, b: { overloads: number; peak: number; spread: number }): boolean {
  // Peak first: the switch is advertised as "削峰" and the dashboard headlines
  // the busiest term. Fixing a second term by raising the busiest one is how a
  // levelling pass ends up reporting "峰值 64.1 → 69.2" — fewer red cells, but a
  // worse answer to "how bad is my worst week".
  if (a.peak !== b.peak) return a.peak < b.peak
  if (a.overloads !== b.overloads) return a.overloads < b.overloads
  return a.spread < b.spread
}

/** "P1+P2" — the moves list reuses this so the two never drift. */
export function periodWindowLabel(periods: readonly number[]): string {
  return periods.length > 0 ? periods.map((period) => `P${period}`).join('+') : '—'
}

/**
 * The 2/3/4-year comparison, but every row is levelled. Lives here rather than
 * in `sisuScenario` so the dependency only points one way (rebalance → scenario).
 */
export function compareRebalancedScenarios(
  input: Omit<ScenarioInput, 'targetYears'>,
  targets: readonly number[],
  options: RebalanceOptions = {},
): ScenarioComparisonRow[] {
  const startYear = planStartYear(input.plan)
  const unique = [...new Set(targets.filter((years) => Number.isFinite(years)))].sort((a, b) => a - b)
  return unique.map((targetYears) =>
    scenarioComparisonRow(rebalanceScenario({ ...input, targetYears }, options).scenario, startYear))
}

/**
 * Candidate windows for one course: contiguous runs of its offering pattern
 * that are at least as long as today (never cram a course into fewer weeks —
 * that would raise its weekly intensity), plus same-length shifts anywhere in
 * the year.
 */
function candidateWindows(
  course: ScenarioCourse,
  pattern: readonly number[],
  current: readonly number[],
  allowOutsideOffering: boolean,
): number[][] {
  const safe = contiguousRuns(pattern).filter((run) => run.length >= current.length)
  const safeKeys = new Set(safe.map((run) => run.join(',')))
  const shifts: number[][] = []
  const hasLoad = allowOutsideOffering && course.weeklyHours > 0 && current.length > 0
  if (hasLoad) {
    for (let start = 0; start + current.length <= TERM_PERIODS.length; start++) {
      const window = TERM_PERIODS.slice(start, start + current.length)
      const key = window.join(',')
      if (safeKeys.has(key)) continue
      shifts.push(window)
    }
  }
  return [...safe, ...shifts]
    .filter((window) => window.join(',') !== current.join(','))
    .sort((a, b) => a[0] - b[0] || a.length - b.length)
}

function isWithinOffering(window: readonly number[], pattern: readonly number[]): boolean {
  return window.every((period) => pattern.includes(period))
}

/** Same converter as the projection (self-paced / 0 cr / duplicate periods). */
function hoursIn(window: readonly number[], fact: CourseFact, credits: number): number {
  return courseWeeklyHours({ totalHours: fact.totalHours, credits, periods: window, selfPaced: fact.selfPaced })
}

interface Candidate {
  course: ScenarioCourse
  window: number[]
  score: { overloads: number; peak: number; spread: number }
  withinOffering: boolean
  distance: number
}

/**
 * Lower is better; every key is deterministic so results never depend on Map
 * order. Must rank in the same order as `betterScore`, otherwise the batch
 * picks a candidate the acceptance check then rejects.
 */
function better(a: Candidate, b: Candidate): boolean {
  if (a.score.peak !== b.score.peak) return a.score.peak < b.score.peak
  if (a.score.overloads !== b.score.overloads) return a.score.overloads < b.score.overloads
  if (a.score.spread !== b.score.spread) return a.score.spread < b.score.spread
  if (a.withinOffering !== b.withinOffering) return a.withinOffering
  if (a.distance !== b.distance) return a.distance < b.distance
  return a.window.join(',').localeCompare(b.window.join(',')) < 0
}

/**
 * Greedy, deterministic levelling: repeatedly take the most overloaded term and
 * apply the single best course move that strictly improves that year's score
 * (peak first, then overload count). Ties break on offering safety, then on the
 * shortest shift, then on the period label.
 */
export function rebalanceScenario(input: ScenarioInput, options: RebalanceOptions = {}): RebalanceOutcome {
  const allowOutsideOffering = options.allowOutsideOffering ?? true
  const maxWeeklyHours = options.maxWeeklyHours ?? input.maxWeeklyHours ?? DEFAULT_MAX_WEEKLY_HOURS
  const base = buildScenario({ ...input, maxWeeklyHours, periodOverrides: undefined })
  const loads = initialLoads(base)
  const empty: RebalanceOutcome = {
    scenario: base,
    moves: [],
    overrides: {},
    peakBefore: peakOf(loads),
    peakAfter: peakOf(loads),
    overloadedBefore: base.overloadTerms,
    overloadedAfter: base.overloadTerms,
  }
  if (base.overloadTerms === 0) return empty

  const facts = input.facts
  const scheduled = base.courses.filter((course) =>
    course.status === 'scheduled' && course.yearIndex != null && course.code != null && course.periods.length > 0,
  )

  // Courses tied to a same-year prerequisite edge stay put: moving either end
  // can push the dependent course into the next year, which is not levelling.
  const locked = new Set<string>()
  for (const course of scheduled) {
    const fact = course.code ? facts[cleanPlanCode(course.code)] : undefined
    if (!fact || fact.formalPrerequisites.length === 0) continue
    for (const prerequisite of fact.formalPrerequisites) {
      const clean = cleanPlanCode(prerequisite)
      for (const other of scheduled) {
        if (other === course || !other.code || other.yearIndex !== course.yearIndex) continue
        if (cleanPlanCode(other.code) !== clean) continue
        locked.add(course.itemId)
        locked.add(other.itemId)
      }
    }
  }

  const patterns = new Map<string, number[]>()
  const currentPeriods = new Map<string, number[]>()
  for (const course of scheduled) {
    const fact = course.code ? facts[cleanPlanCode(course.code)] : undefined
    patterns.set(course.itemId, fact ? withinBounds(fact.offeringPattern) : [])
    currentPeriods.set(course.itemId, withinBounds(course.periods))
  }

  const overrides: Record<string, number[]> = {}
  const order: string[] = []
  const moves = new Map<string, RebalanceMove>()

  for (let step = 0; step < MAX_MOVES; step++) {
    let target: { yearIndex: number; period: number; hours: number } | null = null
    for (const [key, hours] of loads) {
      if (hours <= maxWeeklyHours) continue
      const [yearIndex, period] = key.split(':').map(Number)
      if (target == null || hours > target.hours ||
        (hours === target.hours && (yearIndex < target.yearIndex || (yearIndex === target.yearIndex && period < target.period)))) {
        target = { yearIndex, period, hours }
      }
    }
    if (!target) break
    const overloaded = target

    const inTerm = scheduled.filter((course) =>
      course.yearIndex === overloaded.yearIndex &&
      !locked.has(course.itemId) &&
      (currentPeriods.get(course.itemId) ?? []).includes(overloaded.period),
    )
    if (inTerm.length === 0) break

    const beforeScore = yearScore(loads, overloaded.yearIndex, maxWeeklyHours)
    let best: Candidate | null = null
    for (const course of inTerm) {
      const fact = course.code ? facts[cleanPlanCode(course.code)] : undefined
      if (!fact || fact.totalHours <= 0) continue
      const pattern = patterns.get(course.itemId) ?? []
      if (pattern.length === 0) continue
      const current = currentPeriods.get(course.itemId) ?? []
      const out = hoursIn(current, fact, course.credits)
      if (out <= 0) continue
      for (const window of candidateWindows(course, pattern, current, allowOutsideOffering)) {
        const next = hoursIn(window, fact, course.credits)
        if (next <= 0) continue
        const probe = new Map(loads)
        for (const period of current) {
          const key = termKey(course.yearIndex as number, period)
          probe.set(key, Math.max(0, (probe.get(key) ?? 0) - out))
        }
        for (const period of window) {
          const key = termKey(course.yearIndex as number, period)
          probe.set(key, (probe.get(key) ?? 0) + next)
        }
        const after = yearScore(probe, course.yearIndex as number, maxWeeklyHours)
        // Strict improvement only: shifting overload around is not a fix.
        if (!betterScore(after, beforeScore)) continue
        const candidate: Candidate = {
          course,
          window,
          score: after,
          withinOffering: isWithinOffering(window, pattern),
          distance: current.reduce((sum, period) => sum + Math.abs((window[0] ?? period) - period), 0),
        }
        if (best == null || better(candidate, best)) best = candidate
      }
    }
    if (!best) break

    const course = best.course
    const yearIndex = course.yearIndex as number
    const previous = currentPeriods.get(course.itemId) ?? []
    const fact = facts[cleanPlanCode(course.code as string)]
    const previousHours = hoursIn(previous, fact, course.credits)
    const nextHours = hoursIn(best.window, fact, course.credits)
    for (const period of previous) {
      const key = termKey(yearIndex, period)
      loads.set(key, Math.max(0, (loads.get(key) ?? 0) - previousHours))
    }
    for (const period of best.window) {
      const key = termKey(yearIndex, period)
      loads.set(key, (loads.get(key) ?? 0) + nextHours)
    }
    currentPeriods.set(course.itemId, best.window)
    overrides[course.itemId] = best.window

    const existing = moves.get(course.itemId)
    if (existing) {
      existing.toPeriods = best.window
      existing.weeklyHours = Math.round(nextHours * 10) / 10
      existing.withinOffering = existing.withinOffering && best.withinOffering
    } else {
      order.push(course.itemId)
      moves.set(course.itemId, {
        itemId: course.itemId,
        code: course.code,
        title: course.title,
        yearIndex,
        fromPeriods: previous,
        toPeriods: best.window,
        credits: course.credits,
        weeklyHours: Math.round(nextHours * 10) / 10,
        withinOffering: best.withinOffering,
      })
    }
  }

  if (order.length === 0) return empty

  // Trust the rebuilt scenario, not the incremental bookkeeping: this is what
  // the page renders, so the reported peak must come from the same function.
  // The caller's threshold must survive the rebuild: the page renders this
  // scenario, and comparing it against a 60 h baseline while it was levelled
  // against another cap would make "fewer overloaded terms" meaningless.
  const scenario = buildScenario({ ...input, maxWeeklyHours, periodOverrides: overrides })
  const peakAfter = peakOf(initialLoads(scenario))
  // Defensive: a move that helps one year but breaks another is not shipped.
  const worse = scenario.overloadTerms > base.overloadTerms ||
    (scenario.overloadTerms === base.overloadTerms && peakAfter > empty.peakBefore)
  if (worse) return empty

  return {
    scenario,
    moves: order.map((id) => moves.get(id) as RebalanceMove),
    overrides,
    peakBefore: empty.peakBefore,
    peakAfter,
    overloadedBefore: base.overloadTerms,
    overloadedAfter: scenario.overloadTerms,
  }
}
