// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { CourseSection } from '../lib/contents'
import { buildCourseDossier } from '../lib/courseDossier'
import { buildCourseGraph } from '../lib/courseGraph'
import type { EnrolledCourse } from '../lib/courses'
import type { CourseGrades } from '../lib/grades'
import type { StudyBlock } from '../lib/studyBlocks'
import type { Task } from '../lib/tasks'
import type { Lesson } from '../types'

const NOW = new Date('2026-10-15T12:00:00.000Z')

describe('buildCourseDossier', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('aggregates attendance, past/upcoming lessons, pending/completed tasks, courseware resources, grade targets, notes, and focus hours', () => {
    const lessons: Lesson[] = [
      {
        id: 'l-past',
        source: 'timeedit',
        code: 'CT60A2411',
        title: 'Algorithms',
        start: '2026-10-10T08:00:00.000Z',
        end: '2026-10-10T10:00:00.000Z',
        type: 'lecture',
      },
      {
        id: 'l-future',
        source: 'timeedit',
        code: 'CT60A2411',
        title: 'Algorithms',
        start: '2026-10-20T08:00:00.000Z',
        end: '2026-10-20T10:00:00.000Z',
        type: 'exercise',
      },
    ]
    const enrolled: EnrolledCourse[] = [
      {
        courseid: 501,
        shortname: 'CT60A2411',
        fullname: 'CT60A2411 Algorithms',
      },
    ]
    const grades: CourseGrades[] = [
      {
        course: 'CT60A2411',
        courseId: 501,
        matched: true,
        average: 90,
        items: [
          { name: 'Quiz', grade: 90, max: 100, classAvg: 75, weight: 40 },
          { name: 'Final Exam', grade: null, max: 100, classAvg: null, weight: 60 },
        ],
      },
    ]
    const tasks: Task[] = [
      {
        id: 't-pending',
        title: 'Graph Homework',
        course: 'CT60A2411',
        dueAt: '2026-10-18T21:00:00.000Z',
        completed: false,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 't-done',
        title: 'Intro Quiz',
        course: 'CT60A2411',
        dueAt: '2026-10-05T21:00:00.000Z',
        completed: true,
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-05T00:00:00.000Z',
      },
    ]
    const studyBlocks: StudyBlock[] = [
      {
        id: 'sb-1',
        sourceKind: 'task',
        sourceId: 't-pending',
        title: 'Solve Graph Homework',
        courseCode: 'CT60A2411',
        startAt: '2026-10-16T10:00:00.000Z',
        endAt: '2026-10-16T12:00:00.000Z',
        dueAt: '2026-10-18T21:00:00.000Z',
        completed: true,
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ]
    const sections: CourseSection[] = [
      {
        id: 1,
        name: 'Week 1 Lecture Slides',
        visible: true,
        modules: [
          {
            id: 10,
            name: 'Lecture 1 Slides (lec1.pdf)',
            modname: 'resource',
            url: 'https://moodle.lut.fi/mod/resource/view.php?id=10',
            visible: true,
          },
        ],
      },
    ]

    const graph = buildCourseGraph({
      lessons,
      enrolled,
      grades,
      tasks,
      studyBlocks,
      liveSisuFacts: {
        CT60A2411: {
          id: 'sisu-ct60a2411',
          code: 'CT60A2411',
          name: 'Algorithms',
          credits: 6,
          periods: ['P1'],
          level: 'intermediate',
          totalHours: 162,
        },
      },
      now: NOW,
    })

    const node = graph.nodes[0]
    const dossier = buildCourseDossier(node, {
      attendanceLog: {
        'CT60A2411|2026-10-10T08:00:00.000Z': {
          status: 'attended',
          at: NOW.toISOString(),
        },
      },
      notesMap: {
        'CT60A2411|lecture': {
          note: 'Remember Master Theorem cases',
          updatedAt: NOW.toISOString(),
        },
        'CT60A2411|exam': {
          note: 'Bring calculator and student ID',
          updatedAt: NOW.toISOString(),
        },
      },
      focusMinutesByCourse: { CT60A2411: 120 },
      sections,
      targetGradeLevel: 4,
      now: NOW,
    })

    expect(dossier.attendance.attended).toBe(1)
    expect(dossier.recentAndUpcomingLessons.past).toHaveLength(1)
    expect(dossier.recentAndUpcomingLessons.upcoming).toHaveLength(1)
    expect(dossier.tasks.pending).toHaveLength(1)
    expect(dossier.tasks.completed).toHaveLength(1)
    expect(dossier.resources.flatFiles).toHaveLength(1)
    expect(dossier.resources.flatFiles[0].name).toContain('lec1.pdf')
    expect(dossier.gradeAnalysis.projection).not.toBeNull()
    expect(dossier.gradeAnalysis.targetPlansByGrade).toHaveLength(5)
    // Earned = 90 * 0.4 = 36; target 4 (80) needs 44 from 60% weight -> 73.33%
    expect(dossier.gradeAnalysis.itemMinimumsForTarget).toHaveLength(1)
    expect(dossier.gradeAnalysis.itemMinimumsForTarget[0].minPercentBalanced).toBeCloseTo(73.33, 1)
    expect(dossier.notes).toHaveLength(2)
    expect(dossier.focus.focusMinutes).toBe(120)
    expect(dossier.focus.focusHours).toBe(2)
    expect(dossier.focus.attendedLectureHours).toBe(2)
    expect(dossier.focus.completedStudyBlockHours).toBe(2)
    expect(dossier.focus.sisuTotalHours).toBe(162)
  })
})
