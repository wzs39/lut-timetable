import { describe, expect, it } from 'vitest'
import {
  applySubmissionStatus,
  combineStatus,
  parseAssignments,
  parseGrades,
  parseSubmissions,
  taskMatchKey,
  type SubmissionStatus,
} from '../lib/submissions'
import type { Task } from '../lib/tasks'

// Synthetic fixtures shaped like Moodle's mod_assign responses —
// no real users, courses or tokens.
function assignmentsResponse() {
  return {
    courses: [
      {
        id: 101,
        shortname: 'CT60A0250',
        fullname: 'Fundamentals of Programming',
        assignments: [
          { id: 11, cmid: 111, name: 'Exercise 1', duedate: 1759000000 },
          { id: 12, cmid: 112, name: 'Exercise 2', duedate: 1760000000 },
        ],
      },
      {
        id: 202,
        shortname: 'CS30A0601',
        assignments: [{ id: 13, name: 'Quiz A' }],
      },
    ],
  }
}

function submissionsResponse() {
  return {
    assignments: [
      {
        assignmentid: 11,
        submissions: [{ userid: 7, status: 'submitted', timemodified: 1758900000 }],
      },
      {
        assignmentid: 12,
        submissions: [{ userid: 7, status: 'submitted', timemodified: 1758900100 }],
      },
      {
        assignmentid: 13,
        submissions: [{ userid: 7, status: 'draft' }],
      },
    ],
  }
}

function gradesResponse() {
  return {
    assignments: [
      {
        assignmentid: 12,
        grades: [
          { userid: 7, grade: '9/10', timemodified: 1758950000, feedbacktext: 'Nice work' },
        ],
      },
    ],
  }
}

function task(p: Partial<Task> & { title: string }): Task {
  const now = new Date().toISOString()
  return {
    id: p.id ?? 'moodle:evt1',
    title: p.title,
    course: p.course,
    dueAt: p.dueAt,
    note: p.note,
    completed: p.completed ?? false,
    createdAt: now,
    updatedAt: now,
  }
}

describe('parseAssignments', () => {
  it('flattens courses × assignments with due dates', () => {
    const out = parseAssignments(assignmentsResponse())
    expect(out).toHaveLength(3)
    expect(out[0]).toMatchObject({ id: 11, name: 'Exercise 1', course: 'CT60A0250' })
    expect(out[0].dueAt).toBe(new Date(1759000000 * 1000).toISOString())
    expect(out[2].dueAt).toBeUndefined()
  })

  it('returns [] for malformed responses', () => {
    expect(parseAssignments(null)).toEqual([])
    expect(parseAssignments({})).toEqual([])
  })
})

describe('parseSubmissions / parseGrades / combineStatus', () => {
  it('filters to the given userid and derives state per assignment', () => {
    const subs = parseSubmissions(submissionsResponse(), 7)
    expect(subs.get(11)).toMatchObject({ state: 'submitted' })
    expect(subs.get(13)).toMatchObject({ state: 'draft' })
    expect(subs.get(99)).toBeUndefined()
    expect(subs.get(11)?.submittedAt).toBe(new Date(1758900000 * 1000).toISOString())
  })

  it('grades join over submissions: graded wins, feedback carried', () => {
    const subs = parseSubmissions(submissionsResponse(), 7)
    const grades = parseGrades(gradesResponse(), 7)
    expect(grades.get(12)).toMatchObject({ grade: '9/10', feedback: 'Nice work' })
    const combined = combineStatus(subs, grades)
    expect(combined.get(12)?.state).toBe('graded')
    expect(combined.get(12)?.grade).toBe('9/10')
    expect(combined.get(11)?.state).toBe('submitted')
    expect(combined.get(11)?.grade).toBeUndefined()
  })

  it('ignores other users’ grades', () => {
    const grades = parseGrades(
      { assignments: [{ assignmentid: 11, grades: [{ userid: 8, grade: '2/10' }] }] },
      7,
    )
    expect(grades.size).toBe(0)
  })
})

describe('taskMatchKey', () => {
  it('normalizes case, punctuation and whitespace; includes due day, NOT course label', () => {
    const a = taskMatchKey({ title: 'Exercise 1: Basics!', course: 'CT60A0250', dueAt: '2026-09-28T14:00:00Z' })
    const b = taskMatchKey({ title: 'exercise-1-basics', course: 'CT60A4050', dueAt: '2026-09-28T23:59:59Z' })
    expect(a).toBe(b) // course label shape differs between feed & task: must not matter
    expect(taskMatchKey({ title: 'Exercise 1' })).not.toBe(a)
    expect(taskMatchKey({ title: 'Exercise 1', dueAt: '2026-09-29T14:00:00Z' })).not.toBe(a)
  })
})

describe('applySubmissionStatus', () => {
  const due = '2026-09-28T14:00:00.000Z'

  it('auto-archives uncompleted tasks whose submission arrived; tags note once', () => {
    const t = task({ title: 'Exercise 1', course: 'CT60A0250', dueAt: due })
    const key = taskMatchKey({ title: 'Exercise 1', course: 'CT60A0250', dueAt: due })
    const status = new Map<string, SubmissionStatus>([
      [key, { state: 'submitted', submittedAt: '2026-09-27T10:00:00Z' }],
    ])
    const r = applySubmissionStatus([t], status)
    expect(r.archived).toBe(1)
    expect(r.tasks[0]!.completed).toBe(true)
    expect(r.tasks[0]!.note).toContain('[Moodle]')
    // Re-apply: idempotent, no double-archive count, tag not duplicated
    const r2 = applySubmissionStatus(r.tasks, status)
    expect(r2.archived).toBe(0)
    const note2 = r2.tasks[0]!.note ?? ''
    expect(note2.match(/\[Moodle\]/g)?.length).toBe(1)
  })

  it('records the grade for graded submissions', () => {
    const t = task({ title: 'Exercise 2', course: 'CT60A0250', dueAt: due })
    const key = taskMatchKey({ title: 'Exercise 2', course: 'CT60A0250', dueAt: due })
    const status = new Map<string, SubmissionStatus>([[key, { state: 'graded', grade: '9/10' }]])
    const r = applySubmissionStatus([t], status)
    expect(r.tasks[0]!.completed).toBe(true)
    expect(r.tasks[0]!.note).toContain('9/10')
  })

  it('never touches manual tasks or tasks with no status', () => {
    const manual = task({ id: 'manual-1', title: 'My own task' })
    const r = applySubmissionStatus([manual], new Map())
    expect(r.archived).toBe(0)
    expect(r.tasks[0].completed).toBe(false)
  })

  it('draft/new status does not archive', () => {
    const t = task({ title: 'Quiz A', course: 'CS30A0601' })
    const key = taskMatchKey({ title: 'Quiz A', course: 'CS30A0601' })
    const status = new Map<string, SubmissionStatus>([[key, { state: 'draft' }]])
    const r = applySubmissionStatus([t], status)
    expect(r.archived).toBe(0)
    expect(r.tasks[0].completed).toBe(false)
  })

  it('once tagged, user’s completed state always wins on later syncs', () => {
    const t = task({
      title: 'Exercise 1',
      course: 'CT60A0250',
      dueAt: due,
      completed: false, // user manually un-completed after the first archive
      note: '[Moodle] ✔',
    })
    const key = taskMatchKey({ title: 'Exercise 1', course: 'CT60A0250', dueAt: due })
    const status = new Map<string, SubmissionStatus>([[key, { state: 'submitted' }]])
    const r = applySubmissionStatus([t], status)
    expect(r.tasks[0]!.completed).toBe(false) // manual state respected
    const note1 = r.tasks[0]!.note ?? ''
    expect(note1.match(/\[Moodle\]/g)?.length).toBe(1) // no re-tag
  })
})
