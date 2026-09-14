import { describe, expect, it } from 'vitest'
import { dueNotifId, wantedReminders, DUE_REMIND_BEFORE_H } from '../lib/dueNotifications'
import type { Task } from '../lib/tasks'

const NOW = new Date('2026-09-14T12:00:00+03:00').getTime()

function task(p: Partial<Task> & { id: string }): Task {
  return {
    title: p.id,
    completed: false,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...p,
  } as Task
}

describe('wantedReminders', () => {
  it('schedules exactly two reminders (24h + 1h) for a pending task', () => {
    const due = new Date('2026-09-16T16:00:00+03:00').getTime()
    const w = wantedReminders([task({ id: 'a', dueAt: new Date(due).toISOString() })], NOW)
    expect(w.size).toBe(2)
    const hrs = [...w.values()].map((r) => (due - r.at.getTime()) / 3600000)
    expect(hrs.sort((a, b) => a - b)).toEqual([1, 24])
  })

  it('skips reminder points already in the past', () => {
    // due in 2h -> the 24h-before point is past; only the 1h point is schedulable
    const due = NOW + 2 * 3600 * 1000
    const w = wantedReminders([task({ id: 'b', dueAt: new Date(due).toISOString() })], NOW)
    expect(w.size).toBe(1)
    const only = [...w.values()][0]
    expect(only.beforeH).toBe(1)
    expect(only.at.getTime()).toBe(due - 3600 * 1000)
  })

  it('skips completed, overdue and due-date-less tasks', () => {
    const past = new Date(NOW - 3600 * 1000).toISOString()
    const future = new Date(NOW + 48 * 3600 * 1000).toISOString()
    const w = wantedReminders(
      [
        task({ id: 'c1', dueAt: future, completed: true }),
        task({ id: 'c2', dueAt: past }),
        task({ id: 'c3', completed: false }),
      ],
      NOW,
    )
    expect(w.size).toBe(0)
  })

  it('ignores deadlines beyond the 7-day scheduling window', () => {
    const far = new Date(NOW + 8 * 24 * 3600 * 1000).toISOString()
    expect(wantedReminders([task({ id: 'd', dueAt: far })], NOW).size).toBe(0)
  })

  it('ids are stable, positive, and distinct per lead time', () => {
    const id24 = dueNotifId('a', 24)
    const id1 = dueNotifId('a', 1)
    expect(id24).toBeGreaterThan(0)
    expect(id1).toBeGreaterThan(0)
    expect(id24).not.toBe(id1)
    expect(dueNotifId('a', 24)).toBe(id24)
  })

  it('DUE_REMIND_BEFORE_H contains the requested 24h and 1h reminders', () => {
    expect([...DUE_REMIND_BEFORE_H]).toEqual([24, 1])
  })
})
