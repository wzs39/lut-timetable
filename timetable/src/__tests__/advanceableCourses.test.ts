import { describe, expect, it } from 'vitest'
import type { CourseFact } from '../lib/sisuCourseFacts'
import type { PersonalPlanCourse } from '../lib/personalStudyPlan'
import type { Lesson } from '../types'
import { classifyPassStyle, recommendAdvanceableCourses } from '../lib/advanceableCourses'

const fact = (code: string, overrides: Partial<CourseFact> = {}): CourseFact => ({
  code,
  credits: 3,
  gradeScale: '0-5',
  totalHours: 81,
  hoursSource: 'sisu',
  assessmentMethods: [],
  formalPrerequisites: [],
  offerings: [],
  offeringPattern: [],
  offeringConfidence: 'sisu-2026-27',
  examSittings: [],
  ...overrides,
})

const planCourse = (overrides: Partial<PersonalPlanCourse> & { code: string }): PersonalPlanCourse => ({
  title: overrides.code,
  credits: 3,
  category: 'intermediate',
  ...overrides,
})

const lesson = (code: string, start: string): Lesson => ({
  id: `${code}-${start}`, source: 'sisu', title: code, code, start, end: start,
})

const WINDOW = { windowStart: '2026-10-26', windowEnd: '2026-12-20', academicYear: '2026-2027' }

const OFFER_P2 = [{ id: 'o1', name: 'Contact teaching, Lahti', startDate: '2026-10-26', endDate: '2026-12-12', periods: [2] }]

describe('classifyPassStyle', () => {
  it('detects exam-driven courses', () => {
    expect(classifyPassStyle(fact('X', { assessmentCriteria: { en: '0-5. Exam 80 %, assignments 20 %' } }))).toBe('exam-heavy')
  })

  it('detects attendance-driven courses', () => {
    expect(classifyPassStyle(fact('X', { assessmentCriteria: { en: 'Classroom performance 20 %, final report 30 %' } }))).toBe('attendance')
  })

  it('detects course-work courses with no exam', () => {
    expect(classifyPassStyle(fact('X', { assessmentCriteria: { en: 'Weekly assignments 30 %, final project 40 %' } }))).toBe('course-work')
  })

  it('returns pass-fail from the grade scale even without criteria text', () => {
    expect(classifyPassStyle(fact('X', { gradeScale: 'pass-fail' }))).toBe('pass-fail')
  })

  it('never guesses when the teacher published no criteria', () => {
    expect(classifyPassStyle(fact('X'))).toBe('unknown')
  })
})

describe('recommendAdvanceableCourses', () => {
  it('returns compulsory courses that SISU teaches now but the plan schedules later', () => {
    const rows = recommendAdvanceableCourses(
      [planCourse({ code: 'CT60A5540', studyYear: '2027-2028', periods: [2] })],
      { CT60A5540: fact('CT60A5540', { offerings: OFFER_P2, assessmentCriteria: { en: 'Exam 80 %' } }) },
      WINDOW,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].requirement).toBe('compulsory-major')
    expect(rows[0].requirementLabel).toBe('必修·专业课')
    expect(rows[0].netCredits).toBe(0) // 提前修不增加总学分
    expect(rows[0].passStyle).toBe('exam-heavy')
  })

  it('skips courses the student is already registered for', () => {
    const rows = recommendAdvanceableCourses(
      [planCourse({ code: 'CT60A5540', studyYear: '2027-2028', periods: [2] })],
      { CT60A5540: fact('CT60A5540', { offerings: OFFER_P2 }) },
      { ...WINDOW, lessons: [lesson('CT60A5540', '2026-11-03T10:00:00')] },
    )
    expect(rows).toHaveLength(0)
  })

  it('skips courses already planned for the current academic year', () => {
    const rows = recommendAdvanceableCourses(
      [planCourse({ code: 'CT60A5540', studyYear: '2026-2027', periods: [2] })],
      { CT60A5540: fact('CT60A5540', { offerings: OFFER_P2 }) },
      WINDOW,
    )
    expect(rows).toHaveLength(0)
  })

  it('never recommends elective courses — those belong to recommendOptionalCourses', () => {
    const rows = recommendAdvanceableCourses(
      [planCourse({ code: 'HDD4020', category: 'elective', studyYear: '2027-2028', periods: [1, 2] })],
      { HDD4020: fact('HDD4020', { offerings: OFFER_P2 }) },
      WINDOW,
    )
    expect(rows).toHaveLength(0)
  })

  it('excludes minor courses unless explicitly asked for', () => {
    const plan = [planCourse({ code: 'BH60A6802', category: 'minor', studyYear: '2027-2028', periods: [4] })]
    const facts = { BH60A6802: fact('BH60A6802', { offerings: OFFER_P2 }) }
    expect(recommendAdvanceableCourses(plan, facts, WINDOW)).toHaveLength(0)
    expect(recommendAdvanceableCourses(plan, facts, { ...WINDOW, includeMinor: true })).toHaveLength(1)
  })

  it('skips zero-credit placeholder rows such as the maturity test', () => {
    const rows = recommendAdvanceableCourses(
      [planCourse({ code: 'LUTKYPSAT', credits: 0, studyYear: '2028-2029', periods: [1] })],
      { LUTKYPSAT: fact('LUTKYPSAT', { credits: 0, totalHours: 0, offerings: OFFER_P2 }) },
      WINDOW,
    )
    expect(rows).toHaveLength(0)
  })

  it('ranks major compulsory above general studies and lightest workload first', () => {
    const plan = [
      planCourse({ code: 'AAA1000', category: 'general', studyYear: '2028-2029', periods: [2] }),
      planCourse({ code: 'BBB2000', category: 'intermediate', studyYear: '2028-2029', periods: [2], credits: 6 }),
      planCourse({ code: 'CCC3000', category: 'intermediate', studyYear: '2028-2029', periods: [2] }),
    ]
    const facts = {
      AAA1000: fact('AAA1000', { offerings: OFFER_P2 }),
      BBB2000: fact('BBB2000', { credits: 6, totalHours: 162, offerings: OFFER_P2 }),
      CCC3000: fact('CCC3000', { offerings: OFFER_P2 }),
    }
    const rows = recommendAdvanceableCourses(plan, facts, WINDOW)
    expect(rows.map((row) => row.code)).toEqual(['CCC3000', 'BBB2000', 'AAA1000'])
  })

  it('reports separate exam sittings that fall outside the teaching window', () => {
    const rows = recommendAdvanceableCourses(
      [planCourse({ code: 'CT60A5540', studyYear: '2027-2028', periods: [2] })],
      {
        CT60A5540: fact('CT60A5540', {
          offerings: OFFER_P2,
          // Exams live in their own field: the snapshot keeps them out of `offerings`
          // so a December exam does not stretch the teaching window.
          examSittings: [
            { name: 'Exam, Lahti', startDate: '2026-12-02', endDate: '2026-12-03' },
            { name: 'Exam, Lahti', startDate: '2027-03-05', endDate: '2027-03-06' },
          ],
        }),
      },
      WINDOW,
    )
    expect(rows[0]?.examDates).toEqual(['2026-12-02', '2027-03-05'])
  })

  it('honours the limit', () => {
    const plan = ['A1', 'B1', 'C1'].map((code) => planCourse({ code, studyYear: '2028-2029', periods: [2] }))
    const facts = Object.fromEntries(plan.map((course) => [course.code, fact(course.code, { offerings: OFFER_P2 })]))
    expect(recommendAdvanceableCourses(plan, facts, { ...WINDOW, limit: 2 })).toHaveLength(2)
  })
})
