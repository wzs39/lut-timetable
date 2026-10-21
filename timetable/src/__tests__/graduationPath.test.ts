import { describe, expect, it } from 'vitest'
import {
  COURSE_VALUE,
  HOURS_PER_CREDIT,
  courseValue,
  graduationFeasibility,
  prerequisiteGates,
  suggestCuts,
} from '../lib/graduationPath'
import type { CourseFact } from '../lib/sisuCourseFacts'
import type { PlanCategory } from '../lib/sisuStudyPlan'
import type { PersonalPlanCourse } from '../lib/personalStudyPlan'

const MINIMUMS: Record<PlanCategory, number> = {
  general: 31, language: 10, intermediate: 103, minor: 20, elective: 0,
}

const item = (
  code: string,
  credits: number,
  category: PlanCategory,
  patch: Partial<PersonalPlanCourse> = {},
): PersonalPlanCourse => ({
  code,
  title: code,
  credits,
  category,
  periods: [1],
  completed: false,
  ...patch,
})

const fact = (code: string, patch: Partial<CourseFact> = {}): CourseFact => ({
  code,
  credits: 3,
  gradeScale: '0-5',
  totalHours: 81,
  hoursSource: 'sisu',
  assessmentMethods: [],
  formalPrerequisites: [],
  offerings: [],
  examSittings: [],
  offeringPattern: [1],
  offeringConfidence: 'sisu-2026-27',
  ...patch,
})

describe('courseValue', () => {
  it('classifies the CS core courses that graduate admissions check', () => {
    expect(courseValue('HDD5030').value).toBe('core-cs')
    expect(courseValue('CT30A3350').value).toBe('core-cs')
    expect(courseValue('BM20A9200').value).toBe('core-math')
    expect(courseValue('CT60A9800').value).toBe('core-se')
  })

  it('falls back to supporting for unlisted courses instead of guessing', () => {
    const unknown = courseValue('ZZ00A0000')
    expect(unknown.value).toBe('supporting')
    expect(unknown.reason).toContain('未分类')
  })

  it('keeps every listed code pointing at itself', () => {
    for (const [code, value] of Object.entries(COURSE_VALUE)) expect(value.code).toBe(code)
  })
})

describe('suggestCuts', () => {
  it('never touches a module that has no slack left', () => {
    const plan = [
      item('HDD5030', 6, 'intermediate'),
      item('MOOC0006A', 2, 'elective'),
    ]
    const facts = { HDD5030: fact('HDD5030', { credits: 6 }), MOOC0006A: fact('MOOC0006A') }
    // 专业必修 6 cr 远低于 103 的最低要求 —— 余量为 0，不能砍。
    const result = suggestCuts(plan, facts, MINIMUMS, { goalCredits: 0 })
    expect(result.cuts.map((cut) => cut.code)).toEqual(['MOOC0006A'])
    expect(result.warnings.some((warning) => warning.includes('intermediate'))).toBe(true)
  })

  it('cuts pass-fail courses before graded ones', () => {
    // 辅修总 29 cr（含已修 20），最低 20 —— 余量只有 9，刚好够砍这两门。
    const plan = [
      item('BH60A6200', 6, 'minor'),
      item('BH60A7201', 3, 'minor'),
      item('BH60A0000', 20, 'minor', { completed: true }),
    ]
    const facts = {
      BH60A6200: fact('BH60A6200', { credits: 6, totalHours: 162 }),
      BH60A7201: fact('BH60A7201', { credits: 3, gradeScale: 'pass-fail' }),
    }
    const result = suggestCuts(plan, facts, MINIMUMS, { goalCredits: 20 })
    expect(result.cuts.map((cut) => cut.code)).toEqual(['BH60A7201', 'BH60A6200'])
    expect(result.cuts[0]?.affectsGpa).toBe(false)
    expect(result.cuts[1]?.affectsGpa).toBe(true)
  })

  it('stops as soon as the credit target is met', () => {
    const plan = [
      item('MOOC0006A', 2, 'elective'),
      item('MOOC0006B', 2, 'elective'),
      item('MOOC0006C', 2, 'elective'),
    ]
    const facts = {
      MOOC0006A: fact('MOOC0006A'), MOOC0006B: fact('MOOC0006B'), MOOC0006C: fact('MOOC0006C'),
    }
    const result = suggestCuts(plan, facts, MINIMUMS, { goalCredits: 4 })
    expect(result.creditsToCut).toBe(2)
    expect(result.cuts).toHaveLength(1)
    expect(result.projectedCredits).toBe(4)
  })

  it('never cuts a course that is bigger than the remaining module slack', () => {
    const plan = [item('BH60A7500', 6, 'minor'), item('BH60A7410', 3, 'minor')]
    const facts = {
      BH60A7500: fact('BH60A7500', { credits: 6, totalHours: 162 }),
      BH60A7410: fact('BH60A7410'),
    }
    // 辅修共 9 cr，最低 20 —— 余量 0，两门都不能砍。
    const result = suggestCuts(plan, facts, MINIMUMS, { goalCredits: 0 })
    expect(result.cuts).toHaveLength(0)
  })

  it('never cuts the programme-required placeholder courses', () => {
    const plan = [
      item('CT10A9900', 1, 'general'),
      item('MOOC0006A', 2, 'elective'),
      item('MOOC0006B', 2, 'elective'),
    ]
    const facts = {
      CT10A9900: fact('CT10A9900', { credits: 1, gradeScale: 'pass-fail' }),
      MOOC0006A: fact('MOOC0006A'), MOOC0006B: fact('MOOC0006B'),
    }
    const result = suggestCuts(plan, facts, MINIMUMS, { goalCredits: 0 })
    expect(result.cuts.map((cut) => cut.code)).not.toContain('CT10A9900')
  })

  it('ignores completed courses', () => {
    const plan = [item('MOOC0006A', 2, 'elective', { completed: true })]
    const result = suggestCuts(plan, { MOOC0006A: fact('MOOC0006A') }, MINIMUMS, { goalCredits: 0 })
    expect(result.cuts).toHaveLength(0)
    expect(result.plannedCredits).toBe(2)
  })
})

describe('graduationFeasibility', () => {
  it('reports a three-year plan as comfortable and a two-year plan as tight', () => {
    const three = graduationFeasibility({ creditsRemaining: 167, years: 3 })
    const two = graduationFeasibility({ creditsRemaining: 167, years: 2 })
    expect(three.weeklyHours).toBeLessThan(two.weeklyHours)
    expect(three.feasible).toBe(true)
    // 167 cr / 2 年 / 32 周 = 70.4 h/周，超出 60 的可持续上限。
    expect(two.weeklyHours).toBeGreaterThan(60)
    expect(two.feasible).toBe(false)
  })

  it('counts the summer period when asked', () => {
    const without = graduationFeasibility({ creditsRemaining: 167, years: 2 })
    const withSummer = graduationFeasibility({ creditsRemaining: 167, years: 2, useSummer: true })
    expect(withSummer.weeksPerYear).toBe(without.weeksPerYear + 8)
    expect(withSummer.weeklyHours).toBeLessThan(without.weeklyHours)
  })

  it('uses the real remaining weeks when they are given', () => {
    // 学分一样，但「只剩 48 周」比「按 2 年均分 64 周」紧得多。
    const even = graduationFeasibility({ creditsRemaining: 168, years: 2 })
    const real = graduationFeasibility({ creditsRemaining: 168, years: 2, weeksRemaining: 48 })
    expect(even.basis).toBe('even-years')
    expect(real.basis).toBe('remaining-weeks')
    expect(real.weeklyHours).toBeGreaterThan(even.weeklyHours)
    expect(real.feasible).toBe(false)
  })

  it('uses the LUT 27h-per-credit conversion', () => {
    const result = graduationFeasibility({ creditsRemaining: 60, years: 1 })
    expect(result.hoursPerYear).toBe(60 * HOURS_PER_CREDIT)
  })

  it('explains the shortfall in the note', () => {
    const result = graduationFeasibility({ creditsRemaining: 167, years: 2, maxWeeklyHours: 60 })
    expect(result.note).toContain('超出')
  })
})

describe('prerequisiteGates', () => {
  it('maps the Lahti-campus prerequisite codes back to the plan courses', () => {
    const plan = ['CT60A0250', 'CT60A2450', 'CT60A4350', 'CT60A5522']
    const facts = {
      CT60A0250: fact('CT60A0250'),
      CT60A2450: fact('CT60A2450'),
      CT60A4350: fact('CT60A4350', { formalPrerequisites: ['CT60A0203', 'CT60A0250'] }),
      CT60A5522: fact('CT60A5522', { formalPrerequisites: ['CT60A0203', 'CT60A4002', 'CT60A0250', 'CT60A4050'] }),
    }
    const gates = prerequisiteGates(plan, facts)
    expect(gates[0]?.code).toBe('CT60A0250')
    expect(gates[0]?.dependents).toBe(2)
  })

  it('ignores prerequisites that are not in the plan', () => {
    const gates = prerequisiteGates(
      ['CT30A3401'],
      { CT30A3401: fact('CT30A3401', { formalPrerequisites: ['CT60A0203'] }) },
    )
    expect(gates).toHaveLength(0)
  })

  it('strips the realisation suffix from prerequisite codes', () => {
    const gates = prerequisiteGates(
      ['CT60A0250', 'CT60A4350'],
      {
        CT60A0250: fact('CT60A0250'),
        CT60A4350: fact('CT60A4350', { formalPrerequisites: ['CT60A0250-3012'] }),
      },
    )
    expect(gates).toHaveLength(1)
    expect(gates[0]?.code).toBe('CT60A0250')
  })
})
