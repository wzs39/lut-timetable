import { beforeEach, describe, expect, it } from 'vitest'
import {
  addTask,
  createTask,
  dueOn,
  dueWithin,
  isOverdue,
  pendingTasks,
  sortTasks,
  updateTask,
  type Task,
} from '../lib/tasks'

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
} as Storage

beforeEach(() => store.clear())

const task = (patch: Partial<Task> = {}): Task => ({
  id: patch.id ?? 'task-1',
  title: patch.title ?? 'Read chapter 1',
  course: patch.course,
  dueAt: patch.dueAt,
  note: patch.note,
  completed: patch.completed ?? false,
  createdAt: patch.createdAt ?? '2026-09-01T10:00:00.000Z',
  updatedAt: patch.updatedAt ?? '2026-09-01T10:00:00.000Z',
})

describe('task ordering and status', () => {
  it('counts only unfinished tasks and orders them by deadline', () => {
    const tasks = [
      task({ id: 'done', completed: true, dueAt: '2026-09-02T10:00:00.000Z' }),
      task({ id: 'later', dueAt: '2026-09-04T10:00:00.000Z' }),
      task({ id: 'soon', dueAt: '2026-09-03T10:00:00.000Z' }),
      task({ id: 'none', dueAt: undefined }),
    ]
    expect(pendingTasks(tasks).map((item) => item.id)).toEqual(['soon', 'later', 'none'])
  })

  it('puts undated tasks after dated tasks', () => {
    const tasks = [task({ id: 'none' }), task({ id: 'dated', dueAt: '2026-09-02T10:00:00.000Z' })]
    expect(sortTasks(tasks).map((item) => item.id)).toEqual(['dated', 'none'])
  })

  it('detects overdue unfinished tasks but not completed tasks', () => {
    const now = new Date('2026-09-03T12:00:00.000Z')
    expect(isOverdue(task({ dueAt: '2026-09-03T11:59:00.000Z' }), now)).toBe(true)
    expect(isOverdue(task({ dueAt: '2026-09-03T11:59:00.000Z', completed: true }), now)).toBe(false)
    expect(isOverdue(task({ dueAt: '2026-09-03T13:00:00.000Z' }), now)).toBe(false)
  })

  it('dueOn returns only still-pending deadlines of that day (not overdue)', () => {
    const now = new Date(2026, 8, 3, 12, 0) // local 9/3 12:00 (= 09:00Z in UTC+3)
    const tasks = [
      task({ id: 'past-today', dueAt: '2026-09-03T07:00:00.000Z' }), // 10:00 local — already past
      task({ id: 'later-today', dueAt: '2026-09-03T15:00:00.000Z' }), // 18:00 local — still ahead
      task({ id: 'completed-today', dueAt: '2026-09-03T17:00:00.000Z', completed: true }),
      task({ id: 'tomorrow', dueAt: '2026-09-04T09:00:00.000Z' }),
    ]
    expect(dueOn(tasks, now).map((t) => t.id)).toEqual(['later-today'])
  })

  it('dueWithin counts down the coming window only', () => {
    const now = new Date('2026-09-03T12:00:00.000Z')
    const tasks = [
      task({ id: 'in2h', dueAt: '2026-09-03T14:00:00.000Z' }),
      task({ id: 'in30h', dueAt: '2026-09-04T18:00:00.000Z' }),
      task({ id: 'past', dueAt: '2026-09-03T10:00:00.000Z' }),
    ]
    expect(dueWithin(tasks, 24, now).map((t) => t.id)).toEqual(['in2h'])
  })
})

describe('task persistence and mutations', () => {
  it('creates and persists a trimmed task', () => {
    const created = createTask({
      title: '  Submit assignment  ',
      course: ' CT60A0250 ',
      dueAt: '2026-09-16T16:00',
      note: '  Upload the PDF  ',
    })
    expect(created.title).toBe('Submit assignment')
    expect(created.course).toBe('CT60A0250')
    expect(created.note).toBe('Upload the PDF')
    expect(created.completed).toBe(false)
  })

  it('adds a task and updates completion/title without changing its id', () => {
    const added = addTask([], { title: 'Read', course: 'HDD4010' })
    expect(added).toHaveLength(1)
    const id = added[0].id
    const updated = updateTask(added, id, { title: '  Read and summarize  ', completed: true })
    expect(updated[0]).toMatchObject({ id, title: 'Read and summarize', completed: true })
    expect(updated[0].course).toBe('HDD4010')
    expect(updated[0].dueAt).toBeUndefined()
    expect(JSON.parse(store.get('tt_tasks_v1') || '[]')[0]).toMatchObject({
      id,
      completed: true,
    })

    const withDetails = addTask([], {
      title: 'Assignment',
      course: 'CT60A0250',
      dueAt: '2026-09-16T16:00',
      note: 'Upload PDF',
    })
    const completed = updateTask(withDetails, withDetails[0].id, { completed: true })
    expect(completed[0]).toMatchObject({
      course: 'CT60A0250',
      dueAt: '2026-09-16T16:00',
      note: 'Upload PDF',
      completed: true,
    })
  })
})
