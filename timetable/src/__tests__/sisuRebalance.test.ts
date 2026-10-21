import { describe, expect, it } from 'vitest'
import { buildScenario, compareScenarios, type ScenarioInput } from '../lib/sisuScenario'
import { compareRebalancedScenarios, periodWindowLabel, rebalanceScenario } from '../lib/sisuRebalance'
import type { CourseFact } from '../lib/sisuCourseFacts'
import type { PlanCategory, SisuPlanItem, SisuStudyPlan } from '../lib/sisuStudyPlan'

function fact(code: string, credits: number, totalHours: number, pattern: number[], prerequisites: string[] = []): CourseFact {
  return {
    code,
    name: code,
    credits,
    creditRange: { min: credits, max: credits },
    gradeScale: '0-5',
    totalHours,
    hoursSource: 'sisu',
    assessmentMethods: [],
    formalPrerequisites: prerequisites,
    offerings: [],
    offeringPattern: pattern,
    offeringConfidence: 'sisu-2026-27',
  }
}

function item(
  code: string,
  periods: number[],
  studyYear = '2026-2027',
  category: PlanCategory = 'intermediate',
  credits = 6,
): SisuPlanItem {
  return {
    id: `sisu:${code}`,
    kind: 'course',
    title: code,
    courseCode: code,
    credits,
    category,
    studyYear,
    periods,
    completed: false,
    createdAt: '2026-08-20T00:00:00.000Z',
    timingSource: 'pdf-plan',
  }
}

function factsOf(...entries: CourseFact[]): Record<string, CourseFact> {
  return Object.fromEntries(entries.map((entry) => [entry.code, entry]))
}

function planOf(items: SisuPlanItem[]): SisuStudyPlan {
  return { goalCredits: 180, items }
}

const PINNED = ['PIN1', 'PIN2', 'PIN3', 'PIN4'] as const

/** P1 carries 60 h/week: four pinned 12 h courses + one movable 12 h course.
 *  Threshold is pinned to 50 here: these specs cover the optimizer, not the
 *  product default (which is 60 h/week and tested in sisuWorkload.test.ts). */
function overloadedFixture(): ScenarioInput {
  const facts = factsOf(
    ...PINNED.map((code) => fact(code, 6, 96, [1])),
    fact('MOVE', 6, 96, [1, 2, 3, 4]),
  )
  const plan = planOf([
    ...PINNED.map((code) => item(code, [1])),
    item('MOVE', [1]),
  ])
  return { plan, facts, targetYears: 1, maxWeeklyHours: 50 }
}

function loadsOf(input: ScenarioInput): Record<string, number> {
  const result = buildScenario(input)
  return Object.fromEntries(result.terms.map((term) => [`P${term.period}`, term.weeklyHours]))
}

describe('rebalanceScenario', () => {
  it('moves a course out of the overloaded term into a free period', () => {
    const input = overloadedFixture()
    const outcome = rebalanceScenario(input)

    expect(outcome.moves).toHaveLength(1)
    const [move] = outcome.moves
    expect(move.code).toBe('MOVE')
    expect(move.fromPeriods).toEqual([1])
    // Inside the offering the window may stretch, so the same workload spreads
    // over the free periods instead of landing on one of them.
    expect(move.toPeriods).toEqual([2, 3, 4])
    expect(move.withinOffering).toBe(true)
    expect(move.weeklyHours).toBe(4)
    expect(outcome.peakBefore).toBe(60)
    expect(outcome.peakAfter).toBe(48)

    // The rebuilt projection is the authority: P1 lost the course, P2 gained it.
    const moved = outcome.scenario.terms
    expect(moved.find((term) => term.period === 1)?.courses.map((course) => course.code))
      .toEqual([...PINNED])
    expect(moved.filter((term) => term.period > 1).every((term) =>
      term.courses.map((course) => course.code).join() === 'MOVE' && term.weeklyHours === 4,
    )).toBe(true)
  })

  it('applies periodOverrides inside buildScenario instead of patching terms afterwards', () => {
    const input = overloadedFixture()
    const overridden = buildScenario({ ...input, periodOverrides: { 'sisu:MOVE': [3] } })
    const moveCourse = overridden.courses.find((course) => course.code === 'MOVE')
    expect(moveCourse?.periods).toEqual([3])
    expect(moveCourse?.moved).toBe(true)
    expect(moveCourse?.timingSource).toBe('scenario')
    expect(overridden.terms.find((term) => term.period === 3)?.weeklyHours).toBe(12)

    // Bad overrides never leak into the projection.
    const ignored = buildScenario({ ...input, periodOverrides: { 'sisu:MOVE': [0, 9, 9] } })
    expect(ignored.courses.find((course) => course.code === 'MOVE')?.periods).toEqual([1])
  })

  it('never changes the study year', () => {
    const facts = factsOf(
      fact('A1', 6, 96, [1]),
      fact('A2', 6, 96, [1]),
      fact('A3', 6, 96, [1]),
      fact('A4', 6, 96, [1]),
      fact('LATE', 6, 96, [1, 2, 3, 4]),
    )
    const plan = planOf([
      item('A1', [1], '2027-2028'), item('A2', [1], '2027-2028'),
      item('A3', [1], '2027-2028'), item('A4', [1], '2027-2028'),
      item('LATE', [1], '2027-2028'),
    ])
    const input: ScenarioInput = { plan, facts, targetYears: 2, maxWeeklyHours: 50 }
    const base = buildScenario(input)
    const outcome = rebalanceScenario(input)

    expect(outcome.moves.map((move) => move.code)).toEqual(['LATE'])
    for (const move of outcome.moves) {
      expect(move.toPeriods.every((period) => period >= 1 && period <= 4)).toBe(true)
      const before = base.courses.find((course) => course.code === move.code)
      const after = outcome.scenario.courses.find((course) => course.code === move.code)
      expect(after?.yearIndex).toBe(before?.yearIndex)
      expect(after?.periods).not.toEqual(before?.periods)
    }
  })

  it('keeps courses caught in a same-year prerequisite edge in place', () => {
    const facts = factsOf(
      ...PINNED.map((code) => fact(code, 6, 96, [1])),
      fact('BASE', 6, 96, [1, 2, 3, 4]),
      fact('DEP', 6, 96, [2], ['BASE']),
    )
    const plan = planOf([
      ...PINNED.map((code) => item(code, [1])),
      item('BASE', [1]),
      item('DEP', [2]),
    ])
    const outcome = rebalanceScenario({ plan, facts, targetYears: 1 })
    // Moving either end of the edge would push DEP into the next year.
    expect(outcome.moves.map((move) => move.code)).not.toContain('BASE')
    expect(outcome.moves.map((move) => move.code)).not.toContain('DEP')
  })

  it('strict mode only uses windows inside the SISU offering', () => {
    const facts = factsOf(
      ...PINNED.map((code) => fact(code, 6, 96, [1])),
      fact('WIDE', 6, 96, [1, 2]),
    )
    const plan = planOf([...PINNED.map((code) => item(code, [1])), item('WIDE', [1, 2])])
    const input: ScenarioInput = { plan, facts, targetYears: 1, maxWeeklyHours: 50 }

    const strict = rebalanceScenario(input, { allowOutsideOffering: false })
    expect(strict.moves).toEqual([])
    expect(strict.peakAfter).toBe(strict.peakBefore)

    const aggressive = rebalanceScenario(input)
    expect(aggressive.moves).toHaveLength(1)
    expect(aggressive.moves[0].withinOffering).toBe(false)
    expect(aggressive.peakAfter).toBeLessThan(aggressive.peakBefore)
  })

  it('does nothing when no term is overloaded', () => {
    const facts = factsOf(fact('SMALL', 3, 24, [1]))
    const outcome = rebalanceScenario({ plan: planOf([item('SMALL', [1], '2026-2027', 'general', 3)]), facts, targetYears: 1 })
    expect(outcome.moves).toEqual([])
    expect(outcome.overrides).toEqual({})
    expect(outcome.peakAfter).toBe(outcome.peakBefore)
  })

  it('is deterministic and never touches the stored plan', () => {
    const input = overloadedFixture()
    const before = JSON.stringify(input.plan)
    const a = rebalanceScenario(input)
    const b = rebalanceScenario(input)
    expect(a.overrides).toEqual(b.overrides)
    expect(JSON.stringify(input.plan)).toBe(before)
    expect(loadsOf(input)).toEqual({ P1: 60, P2: 0, P3: 0, P4: 0 })
  })

  it('levels every row of the graduation comparison', () => {
    const input = overloadedFixture()
    const comparisonInput = { plan: input.plan, facts: input.facts, maxWeeklyHours: input.maxWeeklyHours }
    const raw = compareScenarios(comparisonInput, [1])
    const levelled = compareRebalancedScenarios(comparisonInput, [1])
    expect(levelled[0].peakWeeklyHours).toBeLessThan(raw[0].peakWeeklyHours)
    expect(levelled[0].targetYears).toBe(raw[0].targetYears)
    expect(levelled[0].termCount).toBe(raw[0].termCount)
  })

  it('never levels by moving a self-paced course (it carries no weekly load)', () => {
    const facts = factsOf(
      ...PINNED.map((code) => fact(code, 6, 96, [1])),
      fact('MOVE', 6, 96, [1, 2, 3, 4]),
      fact('MOOC', 6, 324, [1]),
    )
    facts.MOOC.selfPaced = true
    const plan = planOf([...PINNED.map((code) => item(code, [1])), item('MOVE', [1]), item('MOOC', [1])])
    const input: ScenarioInput = { plan, facts, targetYears: 1 }

    // Four pinned courses + MOVE = 60h; the self-paced 324h course adds 0.
    expect(loadsOf(input).P1).toBe(60)
    const outcome = rebalanceScenario(input, { maxWeeklyHours: 40 })
    expect(outcome.moves.length).toBeGreaterThan(0)
    expect(outcome.moves.map((move) => move.code)).not.toContain('MOOC')
    expect(outcome.peakAfter).toBeLessThan(outcome.peakBefore)
    expect(outcome.scenario.courses.find((course) => course.code === 'MOOC')?.weeklyHours).toBe(0)
  })

  it('renders period windows as P labels', () => {
    expect(periodWindowLabel([1, 2])).toBe('P1+P2')
    expect(periodWindowLabel([])).toBe('—')
  })
})
