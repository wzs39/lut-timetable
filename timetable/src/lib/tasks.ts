import type { Lesson } from '../types'

export interface Task {
  id: string
  title: string
  /** Optional course code or course title shown with the task. */
  course?: string
  /** ISO datetime for the deadline, when known. */
  dueAt?: string
  note?: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

const LS_TASKS = 'tt_tasks_v1'

function makeId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function loadTasks(): Task[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_TASKS) || '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(isTask)
  } catch {
    return []
  }
}

export function saveTasks(tasks: Task[]): Task[] {
  localStorage.setItem(LS_TASKS, JSON.stringify(tasks))
  return tasks
}

export function isTask(value: unknown): value is Task {
  if (!value || typeof value !== 'object') return false
  const task = value as Partial<Task>
  return (
    typeof task.id === 'string' &&
    typeof task.title === 'string' &&
    typeof task.completed === 'boolean' &&
    typeof task.createdAt === 'string' &&
    typeof task.updatedAt === 'string'
  )
}

export function pendingTasks(tasks: Task[]): Task[] {
  return sortTasks(tasks.filter((task) => !task.completed))
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (!a.dueAt && !b.dueAt) return a.createdAt.localeCompare(b.createdAt)
    if (!a.dueAt) return 1
    if (!b.dueAt) return -1
    return a.dueAt.localeCompare(b.dueAt) || a.createdAt.localeCompare(b.createdAt)
  })
}

export function isOverdue(task: Task, now = new Date()): boolean {
  return !task.completed && !!task.dueAt && new Date(task.dueAt).getTime() < now.getTime()
}

export function courseOptions(lessons: Lesson[]): string[] {
  return [...new Set(
    lessons
      .map((lesson) => lesson.code?.trim() || lesson.title.trim())
      .filter(Boolean),
  )].sort((a, b) => a.localeCompare(b))
}

export function createTask(input: Pick<Task, 'title' | 'course' | 'dueAt' | 'note'>): Task {
  const now = new Date().toISOString()
  return {
    id: makeId(),
    title: input.title.trim(),
    course: input.course?.trim() || undefined,
    dueAt: input.dueAt || undefined,
    note: input.note?.trim() || undefined,
    completed: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function updateTask(tasks: Task[], id: string, patch: Partial<Pick<Task, 'title' | 'course' | 'dueAt' | 'note' | 'completed'>>): Task[] {
  const now = new Date().toISOString()
  return saveTasks(tasks.map((task) =>
    task.id === id
      ? {
          ...task,
          ...patch,
          title: patch.title === undefined ? task.title : patch.title.trim(),
          course: patch.course === undefined ? task.course : patch.course.trim() || undefined,
          note: patch.note === undefined ? task.note : patch.note.trim() || undefined,
          dueAt: patch.dueAt === undefined ? task.dueAt : patch.dueAt || undefined,
          updatedAt: now,
        }
      : task,
  ))
}

export function addTask(tasks: Task[], input: Pick<Task, 'title' | 'course' | 'dueAt' | 'note'>): Task[] {
  return saveTasks([...tasks, createTask(input)])
}

export function removeTask(tasks: Task[], id: string): Task[] {
  return saveTasks(tasks.filter((task) => task.id !== id))
}
