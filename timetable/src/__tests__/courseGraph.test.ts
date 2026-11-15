// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyStudyBlockCompletionToTasks,
  applyTaskCompletionToStudyBlocks,
  buildCourseGraph,
  findUnifiedCourse,
  syncTaskAndStudyBlocksCompletion,
} from '../lib/courseGraph'
import type { EnrolledCourse } from '../lib/courses'
import type { CourseGrades } from '../lib/grades'
import type { SisuCourseFact } from '../lib/sisuCourseFacts'
import type { StudyBlock } from '../lib/studyBlocks'
import type { Task } from '../lib/tasks'
import type { Lesson } from '../types'

const NOW = new Date('2026-10-15T10:00:00.000Z')

function mkLesson(p: Partial<Lesson>): Lesson {
  return {
    id: p.id ?? 'l-1',
    source: p.source ?? 'timeedit',
    title: p.title ?? 'Design and Analysis of Algorithms',
    code: p.code ?? 'CT60A2411',
    start: p.start ?? '2026-10-15T12:00:00.000Z',
    end: p.end ?? '2026-10-15T14:00:00.000Z',
    type: p.type ?? 'lecture',
    location: p.location ?? '1314',
    ...p,
  }
}

function mkTask(p: Partial<Task>): Task {
  return {
    id: p.id ?? 't-1',
    title: p.title ?? 'Homework 1',
    course: p.course ?? 'CT60A2411',
    completed: p.completed ?? false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...p,
  }
}

function mkBlock(p: Partial<StudyBlock>): StudyBlock {
  return {
    id: p.id ?? 'sb-1',
    sourceKind: p.sourceKind ?? 'task',
    sourceId: p.sourceId ?? 't-1',
    title: p.title ?? 'Study Homework 1',
    courseCode: p.courseCode ?? 'CT60A2411',
    startAt: p.startAt ?? '2026-10-16T09:00:00.000Z',
    endAt: p.endAt ?? '2026-10-16T11:00:00.000Z',
    dueAt: p.dueAt ?? '2026-10-20T21:00:00.000Z',
    completed: p.completed ?? false,
    createdAt: p.createdAt ?? '2026-10-01T00:00:00.000Z',
    ...p,
  }
}

describe('buildCourseGraph & findUnifiedCourse', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('fuses TimeEdit lessons, Moodle enrolled courses, grades, tasks, studyBlocks, and SISU facts into one UnifiedCourseNode', () => {
    const lessons: Lesson[] = [
      mkLesson({ id: 'l-1', code: 'CT60A2411-3005', title: 'Design and Analysis of Algorithms' }),
    ]
    const enrolled: EnrolledCourse[] = [
      {
        courseid: 404,
        shortname: 'CT60A2411_2026',
        fullname: 'CT60A2411 Design and Analysis of Algorithms',
      },
    ]
    const grades: CourseGrades[] = [
      {
        course: 'CT60A2411',
        courseId: 404,
        matched: true,
        average: 85,
        items: [{ name: 'Midterm', grade: 85, max: 100, classAvg: 72, weight: 100 }],
      },
    ]
    const tasks: Task[] = [mkTask({ id: 't-1', course: 'CT60A2411-3005', dueAt: '2026-10-20T21:00:00.000Z' })]
    const studyBlocks: StudyBlock[] = [mkBlock({ id: 'sb-1', courseCode: 'CT60A2411', sourceKind: 'task', sourceId: 't-1' })]
    const liveSisuFacts: Record<string, SisuCourseFact> = {
      CT60A2411: {
        id: 'lut-cu-2411',
        code: 'CT60A2411',
        name: 'Design and Analysis of Algorithms',
        credits: 6,
        periods: ['P1', 'P2'],
        level: 'intermediate',
        totalHours: 162,
      },
    }

    const graph = buildCourseGraph({
      lessons,
      enrolled,
      grades,
      tasks,
      studyBlocks,
      liveSisuFacts,
      now: NOW,
    })

    expect(graph.nodes).toHaveLength(1)
    const node = graph.nodes[0]
    expect(node.key).toBe('CT60A2411')
    expect(node.code).toBe('CT60A2411')
    expect(node.sources).toContain('timeedit')
    expect(node.sources).toContain('moodle')
    expect(node.sources).toContain('sisu')
    expect(node.moodleCourseId).toBe(404)
    expect(node.sisuId).toBe('lut-cu-2411')
    expect(node.credits).toBe(6)
    expect(node.totalStudyHours).toBe(162)
    expect(node.lessons).toHaveLength(1)
    expect(node.tasks).toHaveLength(1)
    expect(node.studyBlocks).toHaveLength(1)

    expect(findUnifiedCourse(graph, { code: 'ct60a2411-3009' })?.key).toBe('CT60A2411')
    expect(findUnifiedCourse(graph, { courseId: 404 })?.key).toBe('CT60A2411')
    expect(findUnifiedCourse(graph, { title: 'design and analysis of algorithms' })?.key).toBe('CT60A2411')
  })

  it('detects moodle-only, timetable-only, and weights-missing discrepancies', () => {
    const enrolled: EnrolledCourse[] = [
      { courseid: 101, shortname: 'CS10A0010', fullname: 'CS10A0010 Only On Moodle' },
      { courseid: 202, shortname: 'BM20A1000', fullname: 'BM20A1000 Both Active' },
    ]
    const lessons: Lesson[] = [
      mkLesson({ id: 'l-te', code: 'EE30A5000', title: 'Only In TimeEdit' }),
      mkLesson({ id: 'l-both', code: 'BM20A1000', title: 'Both Active' }),
    ]
    const grades: CourseGrades[] = [
      {
        course: 'BM20A1000',
        courseId: 202,
        matched: true,
        average: 70,
        items: [{ name: 'Exam', grade: 70, max: 100, classAvg: null, weight: null }],
      },
    ]

    const graph = buildCourseGraph({
      lessons,
      enrolled,
      grades,
      tasks: [],
      studyBlocks: [],
      now: NOW,
    })

    const kinds = graph.discrepancies.map((d) => `${d.courseKey}:${d.kind}`)
    expect(kinds).toContain('CS10A0010:moodle-only')
    expect(kinds).toContain('EE30A5000:timetable-only')
    expect(kinds).toContain('BM20A1000:weights-missing')
  })
})

describe('bidirectional completion sync between Task and StudyBlock', () => {
  it('marks linked study blocks completed when task is toggled and syncs back from study block to task', () => {
    const tasks: Task[] = [mkTask({ id: 'task-42', completed: false })]
    const blocks: StudyBlock[] = [
      mkBlock({ id: 'b-1', sourceKind: 'task', sourceId: 'task-42', completed: false }),
      mkBlock({ id: 'b-2', sourceKind: 'sisu-plan', sourceId: 'CT60A2411', completed: false }),
    ]

    const updatedBlocks = applyTaskCompletionToStudyBlocks(blocks, 'task-42', true)
    expect(updatedBlocks[0].completed).toBe(true)
    expect(updatedBlocks[1].completed).toBe(false)

    const updatedTasks = applyStudyBlockCompletionToTasks(tasks, updatedBlocks[0], true)
    expect(updatedTasks[0].completed).toBe(true)

    const roundTrip = syncTaskAndStudyBlocksCompletion({
      taskId: 'task-42',
      completed: false,
      tasks: updatedTasks,
      studyBlocks: updatedBlocks,
    })
    expect(roundTrip.tasks[0].completed).toBe(false)
    expect(roundTrip.studyBlocks[0].completed).toBe(false)
  })
})
