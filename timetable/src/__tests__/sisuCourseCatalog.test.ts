// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  HDD_COURSES,
  buildPlannerCourses,
  isSseRelevantCourse,
  loadSisuCoursePreferences,
  rankPlannerCourses,
  saveSisuCoursePreferences,
} from '../lib/sisuCourseCatalog'
import type { Lesson } from '../types'
import type { EnrolledCourse } from '../lib/courses'
import { planItemIdentity, selectedPlannerCourseCredits, selectedPlannerCourses, togglePlannerCourseSelection, visiblePlannerCourses } from '../lib/sisuCourseSelection'

beforeEach(() => localStorage.clear())

const lesson = (code: string | undefined, title: string): Lesson => ({
  id: `${code ?? 'none'}-lesson`, source: 'sisu', code, title,
  start: '2026-09-01T08:00:00.000Z', end: '2026-09-01T09:00:00.000Z',
})

describe('SISU course planner catalogue', () => {
  it('contains all 16 courses in the official SSE 2026–2027 HDD table', () => {
    expect(HDD_COURSES).toHaveLength(16)
    expect(HDD_COURSES.reduce((sum, item) => sum + (item.credits ?? 0), 0)).toBe(65)
    expect(HDD_COURSES.find((item) => item.code === 'HDD5000')?.credits).toBe(0)
  })

  it('merges official HDD, Moodle enrolments and timetable courses without duplicating known codes', () => {
    const enrolled: EnrolledCourse[] = [
      { courseid: 86, shortname: 'HDD5020', fullname: 'HDD5020 Foundations of Information Processing (HDD)' },
      { courseid: 30361, shortname: 'CT60A4050', fullname: 'CT60A4050 Fundamentals of Software Engineering - Blended teaching' },
    ]
    const lessons = [
      lesson('HDD5020', 'HDD5020 Foundations of Information Processing'),
      lesson('CT60A4050', 'CT60A4050 Fundamentals of Software Engineering'),
      lesson(undefined, 'Local seminar'),
    ]
    const courses = buildPlannerCourses(lessons, enrolled)
    expect(courses).toHaveLength(HDD_COURSES.length + 2)
    expect(courses.find((item) => item.code === 'HDD5020')?.sources).toEqual(['programme', 'moodle', 'timetable'])
    expect(courses.find((item) => item.code === 'CT60A4050')?.sources).toEqual(['moodle', 'timetable'])
    expect(courses.find((item) => item.name === 'Local seminar')?.credits).toBeUndefined()
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
    expect(merge(undefined, 'CT60A4050 Local seminar').filter((item) => item.code === 'CT60A4050')).toHaveLength(1)
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

  it('matches enrolment identity by Moodle id through the canonical identity index', () => {
    const courses = buildPlannerCourses([], [
      { courseid: 30361, shortname: 'SWE', fullname: 'Software Engineering' },
    ], [], {
      codeFor: (id: number) => id === 30361 ? 'CT60A4050' : null,
      forName: () => null,
    } as never)
    expect(courses.find((item) => item.code === 'CT60A4050')?.sources).toContain('moodle')
  })

  it('toggles one normalized identity and keeps selected public records available across searches', () => {
    const course = buildPlannerCourses([], [], [{ id: 'otm-1', code: 'CT60A4050-3001', name: 'Software course', credits: 6 }])
      .find((item) => item.code === 'CT60A4050')!
    const preferences = { focus: 'software' as const, selectedCourseKeys: [], selectedCourses: [] }
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

  it('shows only current SISU query hits plus selected and planned courses', () => {
    const courses = buildPlannerCourses([], [], [
      { id: 'hit', code: 'CT60A4050', name: 'Software Engineering' },
      { id: 'stale', code: 'CT60A4100', name: 'Systems Design' },
    ])
    const visible = visiblePlannerCourses({
      courses, focus: 'software', query: 'software', currentResultQuery: 'software',
      currentResultIdentities: ['code:CT60A4050'], selectedKeys: ['code:CT60A4100'],
      plannedIdentities: new Set(), onlySseRelevant: false,
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

  it('merges public SISU matches with timetable, Moodle and HDD records without inventing metadata', () => {
    const publicCourses = [
      {
        id: 'public-software',
        code: 'CT60A4050',
        name: 'Fundamentals of Software Engineering',
        creditRange: { min: 3, max: 6 },
        studyFields: ['Software engineering'],
        searchTags: ['software'],
      },
      {
        id: 'public-hdd',
        code: 'HDD5030',
        name: 'Data Structures and Algorithms',
        credits: 6,
      },
    ]
    const courses = buildPlannerCourses(
      [lesson('CT60A4050', 'CT60A4050 Fundamentals of Software Engineering')],
      [{ courseid: 30361, shortname: 'CT60A4050', fullname: 'CT60A4050 Fundamentals of Software Engineering' }],
      publicCourses,
    )
    const software = courses.find((item) => item.code === 'CT60A4050')
    const hdd = courses.find((item) => item.code === 'HDD5030')

    expect(courses.filter((item) => item.code === 'CT60A4050')).toHaveLength(1)
    expect(software).toMatchObject({
      sources: ['sisu', 'moodle', 'timetable'],
      creditRange: { min: 3, max: 6 },
      studyYears: [],
    })
    expect(software?.credits).toBeUndefined()
    expect(isSseRelevantCourse(software!)).toBe(true)
    expect(hdd).toMatchObject({ credits: 6, sources: ['programme', 'sisu'], studyYears: ['2026-2027'] })
    expect(courses.filter((item) => item.code === 'HDD5030')).toHaveLength(1)
    expect(selectedPlannerCourseCredits(selectedPlannerCourses(courses, ['CT60A4050']))).toEqual({ credits: 0, unknown: 1 })
  })

  it('ranks by chosen focus while keeping all course sources available', () => {
    const courses = buildPlannerCourses([lesson('CT60A4050', 'Fundamentals of Software Engineering')])
    const ranked = rankPlannerCourses(courses, 'ai')
    expect(ranked).toHaveLength(HDD_COURSES.length + 1)
    expect(ranked.slice(0, 3).map((item) => item.code)).toEqual(['HDD5010', 'HDD5030', 'HDD5040'])
    expect(ranked.find((item) => item.code === 'CT60A4050')?.tags).toContain('software')
    const relevanceFirst = [
      { key: 'software', code: 'CT60A4050', name: 'Other', category: 'public' as const, tags: [], sources: ['sisu'] as const, relevanceText: 'software' },
      { key: 'plain', code: 'ZZ100', name: 'Other', category: 'public' as const, tags: [], sources: ['sisu'] as const, relevanceText: 'none' },
    ]
    const rankedSoftware = rankPlannerCourses(relevanceFirst, 'software')
    expect(rankedSoftware.map((item) => item.key)).toEqual(['software', 'plain'])
    expect(isSseRelevantCourse({ ...relevanceFirst[0], relevanceText: 'sociology and media studies' })).toBe(false)
    expect(isSseRelevantCourse({ ...relevanceFirst[0], relevanceText: 'Tietojenkäsittelytiede' })).toBe(true)
    expect(isSseRelevantCourse({ ...relevanceFirst[0], relevanceText: 'university tietojenkäsittely' })).toBe(true)
    expect(isSseRelevantCourse({ ...relevanceFirst[0], relevanceText: 'university software licenses' })).toBe(false)
    expect(isSseRelevantCourse({ ...relevanceFirst[0], relevanceText: 'Software Engineering' })).toBe(true)
    expect(isSseRelevantCourse({ ...relevanceFirst[0], relevanceText: 'the relationship between physics and networks' })).toBe(false)
    expect(isSseRelevantCourse({ ...relevanceFirst[0], relevanceText: 'theoretical physics' })).toBe(false)
    expect(isSseRelevantCourse({ ...relevanceFirst[0], relevanceText: 'Data Structures and Algorithms' })).toBe(true)
    expect(isSseRelevantCourse({ ...relevanceFirst[0], relevanceText: 'Tietojenkasittelytieteen perusteet' })).toBe(true)
  })

  it('persists unique selections and only totals credits with verified values', () => {
    expect(loadSisuCoursePreferences()).toEqual({ focus: 'software', selectedCourseKeys: [], selectedCourses: [] })
    const preferences = saveSisuCoursePreferences({
      focus: 'systems',
      selectedCourseKeys: ['HDD5030', 'HDD4110', 'HDD5030', 'moodle:unknown'],
      selectedCourses: [{ id: 'public-id', code: 'CT60A4050', name: 'Software test course', credits: 3 }],
    })
    expect(loadSisuCoursePreferences()).toEqual(preferences)
    const courses = buildPlannerCourses([lesson('CT60A4050', 'Fundamentals of Software Engineering')])
    expect(selectedPlannerCourseCredits(selectedPlannerCourses(courses, ['HDD5030', 'CT60A4050']))).toEqual({ credits: 6, unknown: 1 })
  })
})
