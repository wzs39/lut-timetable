// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildPlannerCourses,
  loadSisuCoursePreferences,
  saveSisuCoursePreferences,
} from '../lib/sisuCourseCatalog'
import type { Lesson } from '../types'
import type { EnrolledCourse } from '../lib/courses'
import type { SisuPlanItem } from '../lib/sisuStudyPlan'
import { planItemIdentity, selectedPlannerCourseCredits, selectedPlannerCourses, togglePlannerCourseSelection, visiblePlannerCourses } from '../lib/sisuCourseSelection'

beforeEach(() => localStorage.clear())

const lesson = (code: string | undefined, title: string): Lesson => ({
  id: `${code ?? 'none'}-lesson`, source: 'sisu', code, title,
  start: '2026-09-01T08:00:00.000Z', end: '2026-09-01T09:00:00.000Z',
})

const planItem = (code: string, title: string, patch: Partial<SisuPlanItem> = {}): SisuPlanItem => ({
  id: `sisu:${code}`, kind: 'course', title, courseCode: code, credits: 6,
  category: 'intermediate', studyYear: '2026-2027', periods: [1, 2], completed: false,
  createdAt: '2026-08-20T00:00:00.000Z', timingSource: 'pdf-plan', ...patch,
})

describe('SISU course catalogue', () => {
  it('seeds plan courses and merges Moodle/timetable records by known code', () => {
    const enrolled: EnrolledCourse[] = [
      { courseid: 86, shortname: 'HDD5020', fullname: 'HDD5020 Foundations of Information Processing (HDD)' },
      { courseid: 30361, shortname: 'CT60A4050', fullname: 'CT60A4050 Fundamentals of Software Engineering - Blended teaching' },
    ]
    const lessons = [
      lesson('HDD5020', 'HDD5020 Foundations of Information Processing'),
      lesson('CT60A4050', 'CT60A4050 Fundamentals of Software Engineering'),
      lesson(undefined, 'Local seminar'),
    ]
    const plan = [planItem('HDD5020', 'Foundations of Information Processing'), planItem('CT60A4050', 'Fundamentals of Software Engineering')]
    const courses = buildPlannerCourses(lessons, enrolled, [], undefined, plan)
    expect(courses).toHaveLength(3)
    expect(courses.find((item) => item.code === 'HDD5020')?.sources).toEqual(['plan', 'moodle', 'timetable'])
    expect(courses.find((item) => item.code === 'CT60A4050')?.sources).toEqual(['plan', 'moodle', 'timetable'])
    expect(courses.find((item) => item.name === 'Local seminar')?.credits).toBeUndefined()
    expect(courses.find((item) => item.code === 'HDD5020')?.category).toBe('intermediate')
  })

  it('does not merge a code-less Moodle course to a coded timetable course by title alone', () => {
    const courses = buildPlannerCourses(
      [lesson('CT60A4050', 'Applied Mathematics')],
      [{ courseid: 404, shortname: 'Applied Mathematics', fullname: 'Applied Mathematics' }],
    )
    expect(courses.filter((item) => item.name === 'Applied Mathematics')).toHaveLength(2)
  })

  it('preserves exact-title fallback only when both Moodle and timetable courses have no code', () => {
    const merge = (lessonCode?: string, shortname = 'Local seminar') => buildPlannerCourses(
      [lesson(lessonCode, lessonCode ? `${lessonCode} Local seminar` : 'Local seminar')],
      [{ courseid: 404, shortname, fullname: shortname }],
    )
    expect(merge().filter((item) => item.name === 'Local seminar')).toHaveLength(1)
    expect(merge('CT60A4050').filter((item) => item.name === 'Local seminar')).toHaveLength(2)
  })

  it('merges Moodle and timetable courses only through the canonical course identity index', () => {
    const identityIndex = {
      codeFor: (id: number) => id === 404 ? 'CT60A4050' : null,
      forName: () => null,
    } as never
    const courses = buildPlannerCourses(
      [lesson('CT60A4050', 'Applied Mathematics')],
      [{ courseid: 404, shortname: 'MATH101', fullname: 'Mathematics for engineers' }],
      [],
      identityIndex,
    )
    expect(courses.filter((item) => item.code === 'CT60A4050')).toHaveLength(1)
    expect(courses.find((item) => item.code === 'CT60A4050')?.sources).toEqual(['moodle', 'timetable'])
  })

  it('toggles one normalized identity and keeps selected public records across searches', () => {
    const course = buildPlannerCourses([], [], [{ id: 'otm-1', code: 'CT60A4050-3001', name: 'Software course', credits: 6 }])
      .find((item) => item.code === 'CT60A4050')!
    const preferences = { selectedCourseKeys: [], selectedCourses: [] }
    const selected = togglePlannerCourseSelection(preferences, course)
    expect(selected.selectedCourseKeys).toEqual(['code:CT60A4050'])
    expect(selected.selectedCourses).toHaveLength(1)
    expect(selectedPlannerCourses(buildPlannerCourses([], [], selected.selectedCourses), selected.selectedCourseKeys)).toHaveLength(1)
    expect(togglePlannerCourseSelection(selected, course).selectedCourseKeys).toEqual([])
  })

  it('matches plan entries by normalized course code, falling back to normalized title', () => {
    expect(planItemIdentity({ courseCode: ' CT60A4050-3001 ', title: 'Old title' })).toBe('code:CT60A4050')
    expect(planItemIdentity({ title: '  Local   seminar ' })).toBe('title:local seminar')
  })

  it('shows only current SISU query hits plus persisted selections', () => {
    const courses = buildPlannerCourses([], [], [
      { id: 'hit', code: 'CT60A4050', name: 'Software Engineering' },
      { id: 'stale', code: 'CT60A4100', name: 'Systems Design' },
    ])
    const visible = visiblePlannerCourses({
      courses, query: 'software', currentResultQuery: 'software',
      currentResultIdentities: ['code:CT60A4050'], selectedKeys: ['code:CT60A4100'],
    })
    expect(visible.map((item) => item.code)).toEqual(['CT60A4050', 'CT60A4100'])
  })

  it('keeps duplicate course titles separate when their SISU identities differ', () => {
    const courses = buildPlannerCourses([], [], [
      { id: 'one', code: 'CT60A8001', name: 'Technical Computing Software', credits: 3 },
      { id: 'two', code: 'CT60A8002', name: 'Technical Computing Software', credits: 6 },
    ])
    expect(courses.filter((item) => item.name === 'Technical Computing Software')).toHaveLength(2)
    expect(courses.find((item) => item.code === 'CT60A8001')?.credits).toBe(3)
    expect(courses.find((item) => item.code === 'CT60A8002')?.credits).toBe(6)
  })

  it('merges public SISU matches with plan, Moodle and timetable records without inventing metadata', () => {
    const publicCourses = [
      {
        id: 'public-software',
        code: 'CT60A4050',
        name: 'Fundamentals of Software Engineering',
        creditRange: { min: 3, max: 6 },
        studyFields: ['Software engineering'],
        searchTags: ['software'],
      },
    ]
    const courses = buildPlannerCourses(
      [lesson('CT60A4050', 'CT60A4050 Fundamentals of Software Engineering')],
      [{ courseid: 30361, shortname: 'CT60A4050', fullname: 'CT60A4050 Fundamentals of Software Engineering' }],
      publicCourses,
      undefined,
      [planItem('CT60A4050', 'Fundamentals of Software Engineering')],
    )
    const software = courses.find((item) => item.code === 'CT60A4050')
    expect(courses.filter((item) => item.code === 'CT60A4050')).toHaveLength(1)
    expect(software).toMatchObject({
      sources: ['plan', 'sisu', 'moodle', 'timetable'],
      creditRange: { min: 3, max: 6 },
      studyYears: ['2026-2027'],
    })
    expect(software?.credits).toBe(6)
  })

  it('persists unique selections and only totals credits with verified values', () => {
    expect(loadSisuCoursePreferences()).toEqual({ selectedCourseKeys: [], selectedCourses: [] })
    const preferences = saveSisuCoursePreferences({
      selectedCourseKeys: ['HDD5030', 'HDD4110', 'HDD5030', 'moodle:unknown'],
      selectedCourses: [{ id: 'public-id', code: 'CT60A4050', name: 'Software test course', credits: 3 }],
    })
    expect(loadSisuCoursePreferences()).toEqual(preferences)
    const courses = buildPlannerCourses(
      [lesson('CT60A4050', 'Fundamentals of Software Engineering')],
      [],
      [],
      undefined,
      [planItem('HDD5030', 'Data Structures and Algorithms')],
    )
    expect(selectedPlannerCourseCredits(selectedPlannerCourses(courses, ['HDD5030', 'CT60A4050']))).toEqual({ credits: 6, unknown: 1 })
  })
})
