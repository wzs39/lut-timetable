import { describe, expect, it } from 'vitest'
import { applySisuWeights, parseSisuWeights, planSisuWeights } from '../lib/sisuGradeWeights'
import { courseWithSisuWeights, type CourseGrades, type GradeItem } from '../lib/grades'

const item = (name: string, over: Partial<GradeItem> = {}): GradeItem => ({
  name,
  grade: null,
  max: 100,
  classAvg: null,
  weight: null,
  ...over,
})

function weightsOf(text: string | undefined) {
  const parsed = parseSisuWeights(text)
  return parsed ? Object.fromEntries(parsed.components.map((component) => [component.kind, component.weight])) : null
}

describe('parseSisuWeights — real SISU evaluation criteria', () => {
  it('reads percentages written after the component name', () => {
    // CT60A2450 (SISU, 2026-27)
    expect(weightsOf('0-5. Exam 50%, project 30%, weekly tasks 20%')).toEqual({ exam: 50, project: 30, exercises: 20 })
  })

  it('survives the grade-scale prefix and a missing sentence boundary', () => {
    // CT60A4050 — "0-5, continuous evaluation.Compulsory weekly exercises 25 %, …"
    expect(weightsOf('0-5, continuous evaluation.Compulsory weekly exercises 25 %, project 25 %, exam 50 %.'))
      .toEqual({ exercises: 25, project: 25, exam: 50 })
  })

  it('merges components of the same Moodle kind and keeps the sum at 100', () => {
    // CT60A5550 — "| midterm test (20%), final exam (40%), home assignments (20%)| …"
    expect(weightsOf('0 - 5| midterm test (20%), final exam (40%), home assignments (20%)| quizzes and seminars attendance (20%)'))
      .toEqual({ exam: 60, exercises: 20, attendance: 20 })
  })

  it('normalizes a teacher table that does not add up to 100', () => {
    // CT60A4350 — 31 + 36 + 25 = 92
    const parsed = parseSisuWeights('0-5, project, weekly assignments/exercises 31%. Project 36%, Exam 25%')
    expect(parsed?.normalized).toBe(true)
    expect(parsed?.total).toBe(92)
    const sum = parsed!.components.reduce((total, component) => total + component.weight, 0)
    expect(Math.abs(sum - 100)).toBeLessThan(0.6)
    expect(parsed!.components.find((c) => c.kind === 'exam')!.weight).toBeCloseTo(27.2, 1)
  })

  it('stops before a nested "including" breakdown', () => {
    // BH60A7500 — Individual tasks 20 %, Group work 80 %, including … (35/25/15/5)
    expect(weightsOf('Grading: 0 - 5: Individual tasks: 20%, Group work: 80%, including Business plan and calculations: 35%, Learning Portfolio: 25%, Pitch Deck: 15%, Pitching: 5%.'))
      .toEqual({ exercises: 20, project: 80 })
  })

  it('ignores pass thresholds, ranges and grading scales without weights', () => {
    // CT60A4800 — "at least 50 % from the maximum points … 90 % of the maximum points"
    expect(parseSisuWeights('Grade 0-5. To pass the course, a student needs to receive at least 50 % from the maximum points of mandatory assignments. To achieve the highest grade, 90 % of the maximum points is needed. The grading is linear between these ends.')).toBeNull()
    // HDD5000 — "Bachelor's thesis 80-100 %, … 0-20 %"
    expect(parseSisuWeights("0 - 5. Bachelor's thesis 80-100 %, seminar presentations and proper maturity test (abstract of the work) included into the thesis 0-20%.")).toBeNull()
    expect(parseSisuWeights('Pass / fail')).toBeNull()
    expect(parseSisuWeights('0-5, exam, 100 %')).toMatchObject({ total: 100 })
    expect(parseSisuWeights(undefined)).toBeNull()
  })
})

describe('planSisuWeights — mapping teacher weights onto Moodle items', () => {
  const criteria = '0-5, continuous evaluation.Compulsory weekly exercises 25 %, project 25 %, exam 50 %.'
  const items = [
    item('Weekly exercise 1', { grade: 80 }),
    item('Weekly exercise 2', { grade: 60 }),
    item('Project', { grade: 90 }),
    item('Exam', { grade: 50 }),
  ]

  it('splits a component across the items of that kind', () => {
    const plan = planSisuWeights(criteria, items)
    expect(plan.applied).toBe(true)
    expect(plan.itemWeights).toEqual([12.5, 12.5, 25, 50])
    const weighted = applySisuWeights(items, plan)
    expect(weighted.map((entry) => entry.weight)).toEqual([12.5, 12.5, 25, 50])
    // 0.8*12.5 + 0.6*12.5 + 0.9*25 + 0.5*50 = 65
    expect(weighted.reduce((sum, entry) => sum + (entry.weight ?? 0) * (entry.grade ?? 0) / 100, 0)).toBeCloseTo(65, 5)
  })

  it('refuses a partial mapping instead of redistributing weights', () => {
    const plan = planSisuWeights(criteria, [item('Weekly exercise 1'), item('Exam')])
    expect(plan.applied).toBe(false)
    expect(plan.unmapped).toEqual(['project'])
    expect(plan.itemWeights.every((weight) => weight == null)).toBe(true)
  })

  it('leaves non-matching Moodle items on their own weight', () => {
    const plan = planSisuWeights(criteria, [...items, item('Attendance bonus', { weight: 0 })])
    const applied = applySisuWeights(items.concat(item('Attendance bonus', { weight: 0 })), plan)
    expect(applied.at(-1)?.weight).toBe(0)
  })

  it('does nothing without criteria', () => {
    expect(planSisuWeights(null, items).applied).toBe(false)
  })
})

describe('courseWithSisuWeights — integration helper', () => {
  const base: CourseGrades = {
    course: 'CT60A4050',
    matched: true,
    average: 40,
    officialTotal: 40,
    items: [
      item('Weekly exercise 1', { grade: 80, weight: 50 }),
      item('Project', { grade: 90, weight: 50 }),
      item('Exam', { grade: 50, weight: 100 }),
    ],
  }

  it('takes over the weights and keeps the official total as the headline', () => {
    const next = courseWithSisuWeights(base, '0-5. Weekly exercises 25%, project 25%, exam 50%.')
    expect(next.weighting).toMatchObject({ source: 'sisu' })
    expect(next.items.map((entry) => entry.weight)).toEqual([25, 25, 50])
    // 官方总评优先：权重变了，但 headline 仍是 Moodle 的 40。
    expect(next.average).toBe(40)
    // 原对象不被改写。
    expect(base.items.map((entry) => entry.weight)).toEqual([50, 50, 100])
    expect(base.weighting).toBeUndefined()
  })

  it('keeps the course untouched when a component has no Moodle item', () => {
    const next = courseWithSisuWeights(base, '0-5. Weekly exercises 50%, attendance 50%.')
    expect(next).toBe(base)
    expect(next.weighting).toBeUndefined()
  })

  it('uses the SISU weights for the computed average when Moodle has no official total', () => {
    const next = courseWithSisuWeights({ ...base, officialTotal: null, average: null }, '0-5. Weekly exercises 25%, project 25%, exam 50%.')
    // 0.25*80 + 0.25*90 + 0.5*50 = 67.5
    expect(next.average).toBeCloseTo(67.5, 5)
  })
})
