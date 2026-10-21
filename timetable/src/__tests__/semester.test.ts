import { describe, expect, it } from 'vitest'
import type { Lesson } from '../types'
import type { Task } from '../lib/tasks'
import {
  MAX_LOAD_LEVEL,
  MAX_SEMESTER_WEEKS,
  MIN_SEMESTER_WEEKS,
  semesterOverview,
  semesterWindow,
} from '../lib/semester'

/**
 * 【学期全景契约】窗口从课表首末课推导，按本地自然周（周一起）分桶；
 * 负荷等级相对窗口内最忙的一周归一化；任务按截止日归周，没截止的不算。
 */

let seq = 0
const lesson = (start: Date, end: Date): Lesson =>
  ({
    id: `l${seq++}`,
    title: 'Course',
    code: 'CT60A0001',
    start: start.toISOString(),
    end: end.toISOString(),
    source: 'sisu',
  }) as unknown as Lesson

const task = (due: Date | null): Task =>
  ({ id: `t${seq++}`, title: 'Task', completed: false, dueAt: due?.toISOString() }) as unknown as Task

// 2026-10-05 是周一；NOW = 2026-10-20（周二，第 3 周）
const WEEK1 = new Date(2026, 9, 5, 10, 0, 0, 0)
const NOW = new Date(2026, 9, 20, 12, 0, 0, 0)

describe('semesterWindow', () => {
  it('derives monday-aligned weeks from the first and last lesson', () => {
    const last = new Date(2026, 11, 21, 9, 0, 0, 0) // 2026-12-21
    const { first, weeks } = semesterWindow([lesson(WEEK1, new Date(2026, 9, 5, 12)), lesson(last, new Date(2026, 11, 21, 11))], NOW)
    expect(first).toEqual(new Date(2026, 9, 5, 0, 0, 0, 0))
    expect(weeks).toBe(12)
  })

  it('falls back to ±8 weeks around now when there are no lessons', () => {
    const { first, weeks } = semesterWindow([], NOW)
    expect(weeks).toBe(17)
    expect(first).toEqual(new Date(2026, 7, 24, 0, 0, 0, 0)) // 8 weeks before 10-19
  })

  it('pads short ranges up to the minimum', () => {
    const { weeks } = semesterWindow([lesson(WEEK1, new Date(2026, 9, 5, 12))], NOW)
    expect(weeks).toBe(MIN_SEMESTER_WEEKS)
  })

  it('truncates long ranges around the current week', () => {
    const far = new Date(2027, 6, 1, 10, 0, 0, 0)
    const { weeks, first } = semesterWindow([lesson(WEEK1, new Date(2026, 9, 5, 12)), lesson(far, far)], NOW)
    expect(weeks).toBe(MAX_SEMESTER_WEEKS)
    expect(first.getTime()).toBeLessThanOrEqual(NOW.getTime())
    expect(new Date(first).getTime() + weeks * 7 * 24 * 3600 * 1000).toBeGreaterThan(NOW.getTime())
  })
})

describe('semesterOverview', () => {
  it('buckets lessons by local week and tasks by due date', () => {
    const lessons = [
      lesson(new Date(2026, 9, 5, 10), new Date(2026, 9, 5, 12)),
      lesson(new Date(2026, 9, 7, 10), new Date(2026, 9, 7, 12)),
      lesson(new Date(2026, 11, 21, 9), new Date(2026, 11, 21, 11)),
    ]
    const tasks = [task(new Date(2026, 9, 21, 23, 59))]
    const o = semesterOverview(lessons, tasks, NOW)

    expect(o.weeks).toHaveLength(12)
    expect(o.weeks[0]).toMatchObject({ start: '2026-10-05', lessons: 2, tasks: 0 })
    expect(o.weeks[2]).toMatchObject({ start: '2026-10-19', lessons: 0, tasks: 1 })
    expect(o.weeks[11]).toMatchObject({ start: '2026-12-21', lessons: 1 })
    expect(o.currentIndex).toBe(2)
    expect(o.progress).toBeGreaterThan(0)
    expect(o.progress).toBeLessThan(1)
  })

  it('normalizes load against the busiest week of the window', () => {
    const lessons = [
      lesson(new Date(2026, 9, 5, 10), new Date(2026, 9, 5, 12)),
      lesson(new Date(2026, 9, 6, 10), new Date(2026, 9, 6, 12)),
      lesson(new Date(2026, 11, 21, 9), new Date(2026, 11, 21, 11)),
    ]
    const o = semesterOverview(lessons, [], NOW)
    expect(o.weeks[0].load).toBe(MAX_LOAD_LEVEL)
    expect(o.weeks[11].load).toBe(3) // 1/2 × 5 → ceil
    expect(o.weeks[5].load).toBe(0)
  })

  it('assigns a late sunday lesson to the week that starts that monday', () => {
    const o = semesterOverview(
      [
        lesson(new Date(2026, 9, 11, 23, 30), new Date(2026, 9, 12, 0, 30)),
        lesson(new Date(2026, 9, 12, 0, 30), new Date(2026, 9, 12, 1, 0)),
      ],
      [],
      NOW,
    )
    expect(o.weeks[0].lessons).toBe(1)
    expect(o.weeks[1].lessons).toBe(1)
  })

  it('ignores tasks without a due date and invalid timestamps', () => {
    const bad = { ...lesson(WEEK1, WEEK1), start: 'not-a-date' } as Lesson
    const o = semesterOverview([bad], [task(null)], NOW)
    expect(o.weeks.every((w) => w.lessons === 0 && w.tasks === 0 && w.load === 0)).toBe(true)
  })
})
