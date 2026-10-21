import { describe, expect, it } from 'vitest'
import { buildScenario, compareScenarios, earliestFeasibleYears, graduationLabel, planCategoryProgress, planStartYear } from '../lib/sisuScenario'
import type { CourseFact } from '../lib/sisuCourseFacts'
import type { PlanCategory, SisuPlanItem, SisuStudyPlan } from '../lib/sisuStudyPlan'

const item = (code: string, studyYear: string, periods: number[], patch: Partial<SisuPlanItem> = {}): SisuPlanItem => ({
  id: code, kind: 'course', title: code, courseCode: code, credits: 6, category: 'intermediate',
  studyYear, periods, completed: false, createdAt: '2026-08-20T00:00:00.000Z', timingSource: 'pdf-plan', ...patch,
})

const fact = (code: string, patch: Partial<CourseFact> = {}): CourseFact => ({
  code, credits: 6, gradeScale: '0-5', totalHours: 162, hoursSource: 'sisu',
  assessmentMethods: [], formalPrerequisites: [], offerings: [], offeringPattern: [1, 2],
  offeringConfidence: 'sisu-2026-27', ...patch,
})

const plan = (items: SisuPlanItem[]): SisuStudyPlan => ({ goalCredits: 180, items })

describe('compareScenarios', () => {
  it('projects the same plan across targets without diverging from buildScenario', () => {
    const input = {
      plan: plan([item('A', '2026-2027', [1]), item('B', '2028-2029', [3, 4])]),
      facts: { A: fact('A', { offeringPattern: [1] }), B: fact('B', { offeringPattern: [3, 4] }) },
    }
    const rows = compareScenarios(input, [4, 2, 2])
    const two = buildScenario({ ...input, targetYears: 2 })

    expect(rows.map((row) => row.targetYears)).toEqual([2, 4])
    expect(rows[0]).toMatchObject({
      graduation: graduationLabel(two, 2026),
      plannedCredits: two.plannedCredits,
      creditsPerYear: 6,
      peakWeeklyHours: two.terms.reduce((peak, term) => Math.max(peak, term.weeklyHours), 0),
      delayedCount: 0,
      overloadTerms: 0,
      fitsTarget: true,
    })
    // 4 年目标把 12 学分摊成 3 学分/年，但毕业仍按最后一门课的学段算
    expect(rows[1]).toMatchObject({ creditsPerYear: 3, plannedCredits: 12, fitsTarget: true })
    expect(earliestFeasibleYears(rows)).toBe(2)
  })

  it('flags the shorter target that stacks two study years into one overloaded term', () => {
    const input = {
      // 已完成的 2026 课把计划起点钉在 2026，否则 H1 自己会成为第一年、两门课永远不会叠在同一学段
      plan: plan([
        item('BASE', '2026-2027', [1], { completed: true, credits: 1 }),
        item('H1', '2027-2028', [1]),
        item('H2', '2028-2029', [1]),
      ]),
      facts: {
        H1: fact('H1', { totalHours: 1000, offeringPattern: [1] }),
        H2: fact('H2', { totalHours: 1000, offeringPattern: [1] }),
      },
      maxWeeklyHours: 200,
    }
    const [two, three] = compareScenarios(input, [2, 3])

    // 分母不同：2 年只有 8 个学段，3 年有 12 个——只报绝对数会让人误读
    expect(two).toMatchObject({ overloadTerms: 1, termCount: 8, fitsTarget: false })
    expect(three).toMatchObject({ overloadTerms: 0, termCount: 12, fitsTarget: true })
    expect(two.graduation).toBe('2027 P1')
    expect(three.graduation).toBe('2028 P1')
    expect(earliestFeasibleYears([two, three])).toBe(3)
    expect(earliestFeasibleYears([two])).toBeUndefined()
  })

  it('counts courses missing a prerequisite once even when several codes are absent', () => {
    const input = {
      plan: plan([item('N1', '2026-2027', [1]), item('N2', '2026-2027', [2])]),
      facts: {
        N1: fact('N1', { offeringPattern: [1], formalPrerequisites: ['GHOST1', 'GHOST2'] }),
        N2: fact('N2', { offeringPattern: [2], formalPrerequisites: ['GHOST3'] }),
      },
    }
    const [row] = compareScenarios(input, [3])

    expect(row.missingPrerequisiteCourses).toBe(2)
    expect(row.fitsTarget).toBe(true)
  })
})

describe('buildScenario', () => {
  it('compresses a later study year into the target and reports graduation', () => {
    const result = buildScenario({
      plan: plan([item('A', '2026-2027', [1]), item('B', '2028-2029', [3, 4])]),
      facts: { A: fact('A', { offeringPattern: [1] }), B: fact('B', { offeringPattern: [3, 4] }) },
      targetYears: 2,
    })
    const b = result.courses.find((course) => course.code === 'B')!
    expect(b.yearIndex).toBe(1)
    expect(b.periods).toEqual([3, 4])
    expect(b.moved).toBe(true)
    expect(result.graduationTerm).toBe(8)
    expect(graduationLabel(result, 2026)).toBe('2027 P4')
  })

  it('moves a course after its prerequisite and warns', () => {
    const result = buildScenario({
      plan: plan([item('PRE', '2026-2027', [3]), item('NEXT', '2026-2027', [1])]),
      facts: { PRE: fact('PRE', { offeringPattern: [3] }), NEXT: fact('NEXT', { offeringPattern: [1], formalPrerequisites: ['PRE'] }) },
      targetYears: 3,
    })
    const next = result.courses.find((course) => course.code === 'NEXT')!
    expect(next.yearIndex).toBe(1)
    expect(result.warnings.some((warning) => warning.kind === 'prerequisite' && warning.courseCode === 'NEXT')).toBe(true)
  })

  it('accepts a likely-equivalent prerequisite and reports missing ones without inventing passes', () => {
    const result = buildScenario({
      plan: plan([item('CT60A4050', '2026-2027', [1])]),
      facts: {
        CT60A4050: fact('CT60A4050'),
        CT30A1500: fact('CT30A1500', { formalPrerequisites: ['CT60A4002'] }),
        CT30A8912: fact('CT30A8912', { formalPrerequisites: ['CT30A3370'] }),
      },
      extraCourseCodes: ['CT30A1500', 'CT30A8912'],
      targetYears: 3,
    })
    expect(result.warnings.some((warning) => warning.kind === 'prerequisite' && warning.courseCode === 'CT30A1500')).toBe(false)
    expect(result.warnings.some((warning) => warning.kind === 'prerequisite' && warning.courseCode === 'CT30A8912')).toBe(true)
  })

  it('cancels a course without counting its credits and keeps the rest', () => {
    const result = buildScenario({
      plan: plan([item('A', '2026-2027', [1]), item('B', '2026-2027', [2])]),
      facts: { A: fact('A'), B: fact('B') },
      targetYears: 3,
      cancelledCodes: ['a-3001'],
    })
    expect(result.cancelled.map((course) => course.code)).toEqual(['A'])
    expect(result.totalCredits).toBe(6)
    expect(result.courses.find((course) => course.code === 'A')?.credits).toBe(0)
    expect(result.warnings.some((warning) => warning.kind === 'cancelled')).toBe(true)
  })

  it('flags a term whose weekly workload exceeds the cap', () => {
    const result = buildScenario({
      plan: plan([item('HEAVY', '2026-2027', [1, 2])]),
      facts: { HEAVY: fact('HEAVY', { totalHours: 1000, offeringPattern: [1, 2] }) },
      targetYears: 3,
      maxWeeklyHours: 50,
    })
    expect(result.overloadTerms).toBe(2)
    expect(result.terms.filter((term) => term.overloaded)).toHaveLength(2)
    expect(result.warnings.some((warning) => warning.kind === 'overload')).toBe(true)
  })

  it('reduces electives that are not needed for a category minimum', () => {
    const elective = item('E1', '2026-2027', [1], { category: 'elective' as PlanCategory })
    const general = item('G1', '2026-2027', [1], { category: 'general', credits: 31 })
    const result = buildScenario({
      plan: plan([general, elective]),
      facts: { G1: fact('G1'), E1: fact('E1') },
      targetYears: 3,
      reduceToMinimum: true,
    })
    expect(result.courses.map((course) => course.code)).toEqual(['G1'])
  })

  it('keeps completed credits out of the schedule and reports category progress', () => {
    const done = item('DONE', '2026-2027', [], { completed: true, credits: 5 })
    const result = buildScenario({ plan: plan([done]), facts: { DONE: fact('DONE') }, targetYears: 3 })
    expect(result.courses[0].status).toBe('completed')
    expect(result.completedCredits).toBe(5)
    expect(result.terms.every((term) => term.courses.length === 0)).toBe(true)
    expect(planCategoryProgress(plan([done])).find((row) => row.category === 'intermediate')).toMatchObject({
      completed: 5, planned: 0, minimum: 103,
    })
    expect(planStartYear(plan([item('A', '2027-2028', [1])]))).toBe(2027)
  })
})
