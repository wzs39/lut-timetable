import { describe, expect, it } from 'vitest'
import { OPTIONAL_COURSES, findSwapOptions, prerequisiteStatus, recommendOptionalCourses } from '../lib/optionalCourses'
import { COURSE_FACTS, type CourseFact } from '../lib/sisuCourseFacts'
import { courseWeeklyHours } from '../lib/sisuWorkload'
import { personalPlanItems } from '../lib/personalStudyPlan'
import type { SisuPlanItem, SisuStudyPlan } from '../lib/sisuStudyPlan'

const item = (code: string, credits: number, patch: Partial<SisuPlanItem> = {}): SisuPlanItem => ({
  id: code, kind: 'course', title: code, courseCode: code, credits,
  category: 'intermediate', completed: false, createdAt: '2026-08-20T00:00:00.000Z', ...patch,
})

const plan = (items: SisuPlanItem[]): SisuStudyPlan => ({ goalCredits: 180, items })

const fact = (code: string, patch: Partial<CourseFact> = {}): CourseFact => ({
  code, credits: 6, gradeScale: '0-5', totalHours: 162, hoursSource: 'sisu',
  assessmentMethods: [], formalPrerequisites: [], offerings: [], offeringPattern: [1, 2],
  offeringConfidence: 'sisu-2026-27', examSittings: [], ...patch,
})

describe('optional course catalogue scope', () => {
  it('only offers computer-science / software-engineering courses', () => {
    // The HEBUT (HDD) Chinese language/culture courses are not optional studies
    // of this programme; they used to be recommended first and are gone.
    expect(OPTIONAL_COURSES.every((course) => course.categoryImpact === 'elective')).toBe(true)
    expect(OPTIONAL_COURSES.some((course) => /chinese|china/i.test(course.title))).toBe(false)
    expect(OPTIONAL_COURSES.map((course) => course.code)).not.toContain('HDD7010')
    expect(OPTIONAL_COURSES.map((course) => course.code)).not.toContain('HDD7020')
  })

  it('never recommends the HDD Chinese block even when the facts contain it', () => {
    const plan = { goalCredits: 180, items: personalPlanItems() }
    const recommendations = recommendOptionalCourses(plan, COURSE_FACTS, { targetYears: 3, limit: 8 })
    expect(recommendations.length).toBeGreaterThan(0)
    for (const recommendation of recommendations) {
      expect(recommendation.course.code.startsWith('HDD7')).toBe(false)
      expect(recommendation.course.categoryImpact).toBe('elective')
    }
    // Computer courses lead the list now that the Chinese block is gone.
    expect(recommendations[0].course.tags).toContain('software')
    expect(recommendations.map((recommendation) => recommendation.course.code)).toContain('CT30A1500')
  })
})

describe('optional course recommendations', () => {
  it('distinguishes satisfied, likely-equivalent and missing prerequisites', () => {
    const withCourse = plan([item('CT60A4050', 6)])
    expect(prerequisiteStatus(['CT60A4050'], withCourse)).toEqual({ status: 'ok', missing: [] })
    expect(prerequisiteStatus(['CT60A4002'], withCourse)).toEqual({ status: 'likely-equivalent', missing: [] })
    expect(prerequisiteStatus(['CT30A3370'], withCourse)).toEqual({ status: 'missing', missing: ['CT30A3370'] })
    // An explicit override is an exact course code, never a fuzzy match.
    expect(prerequisiteStatus(['CT60A4002'], plan([item('ZZ000', 6)]), { CT60A4002: ['ZZ000'] }).status).toBe('ok')
  })

  it('finds a same-credit elective first, then combinations', () => {
    const options = findSwapOptions(plan([
      item('E6', 6, { category: 'elective' }),
      item('E3A', 3, { category: 'elective' }),
      item('E3B', 3, { category: 'elective' }),
      item('REQ', 6, { category: 'intermediate' }),
    ]), 6)
    expect(options[0]).toMatchObject({ codes: ['E6'], credits: 6 })
    expect(options.some((option) => option.codes.join('+') === 'E3A+E3B')).toBe(true)
    expect(options.some((option) => option.codes.includes('REQ'))).toBe(false)
  })

  it('does not offer a swap that would break a remaining prerequisite', () => {
    const facts = {
      E1: fact('E1'),
      DEP: fact('DEP', { formalPrerequisites: ['E1'] }),
    }
    const options = findSwapOptions(plan([
      item('E1', 6, { category: 'elective' }),
      item('DEP', 6, { category: 'intermediate' }),
    ]), 6, facts)
    expect(options).toEqual([])
  })

  it('recommends only courses with facts, skips planned courses and enforces the 2-year swap rule', () => {
    const facts = { CT30A1500: fact('CT30A1500'), BM20A6100: fact('BM20A6100', { formalPrerequisites: ['HDD5040'] }) }
    const three = recommendOptionalCourses(plan([]), facts, { targetYears: 3, limit: 8 })
    expect(three.map((rec) => rec.course.code)).toEqual(expect.arrayContaining(['CT30A1500', 'BM20A6100']))
    expect(three.find((rec) => rec.course.code === 'BM20A6100')?.prereqStatus).toBe('missing')

    const two = recommendOptionalCourses(plan([]), facts, { targetYears: 2, limit: 8 })
    expect(two).toEqual([])

    const swapped = recommendOptionalCourses(plan([item('E1', 6, { category: 'elective' })]), facts, { targetYears: 2, limit: 8 })
    expect(swapped.find((rec) => rec.course.code === 'CT30A1500')?.swapOptions).toHaveLength(1)

    const already = recommendOptionalCourses(plan([item('CT30A1500', 6, { category: 'elective' })]), facts, { targetYears: 3 })
    expect(already.some((rec) => rec.course.code === 'CT30A1500')).toBe(false)
  })

  it('quotes the same weekly hours as the scenario (162 h over P1–P2 = 10.1, not 20.3)', () => {
    const facts = { CT30A1500: fact('CT30A1500', { totalHours: 162, offeringPattern: [1, 2] }) }
    const [rec] = recommendOptionalCourses(plan([]), facts, { targetYears: 3, limit: 8 })
    expect(rec.weeklyDelta).toBe(10.1)
    expect(rec.weeklyDelta).toBe(courseWeeklyHours({ totalHours: 162, credits: 6, periods: [1, 2] }))

    // Self-paced / 0-credit rows never add weekly load, here either.
    const mooc = { CT30A1500: fact('CT30A1500', { totalHours: 162, selfPaced: true }) }
    expect(recommendOptionalCourses(plan([]), mooc, { targetYears: 3, limit: 8 })[0].weeklyDelta).toBe(0)
  })
})
