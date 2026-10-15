import { describe, expect, it } from 'vitest'
import { activityDeadlinesFromTasks, activityCmidOf } from '../lib/activityDeadlines'
import type { Task } from '../lib/tasks'

const task = (id: string, url: string | undefined, dueAt?: string): Task => ({
  id, title: id, url, dueAt, completed: false,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
})

describe('activity deadline cmid association', () => {
  it('extracts cmid from assign and quiz activity links, including extra query params', () => {
    expect(activityCmidOf('https://moodle.lut.fi/mod/assign/view.php?id=123')).toBe(123)
    expect(activityCmidOf('https://moodle.lut.fi/mod/quiz/view.php?x=1&id=456')).toBe(456)
    expect(activityCmidOf('https://moodle.lut.fi/calendar/view.php?event=789')).toBeUndefined()
    expect(activityCmidOf(undefined)).toBeUndefined()
  })

  it('builds deadlines by cmid, ignores tasks without deadlines, and does not depend on completion', () => {
    const dueA = '2026-10-20T12:00:00.000Z'
    const dueB = '2026-10-21T12:00:00.000Z'
    const map = activityDeadlinesFromTasks([
      task('moodle-act:1', 'https://moodle.lut.fi/mod/quiz/view.php?id=456', dueA),
      task('moodle:2@calendar', 'https://moodle.lut.fi/mod/assign/view.php?id=789'),
      task('manual', 'https://moodle.lut.fi/mod/assign/view.php?id=123', dueB),
      task('moodle-act:3', 'https://moodle.lut.fi/mod/quiz/view.php?id=999', 'invalid'),
    ])
    expect([...map]).toEqual([[456, dueA]])
  })
})
