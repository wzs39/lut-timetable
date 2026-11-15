import { describe, expect, it } from 'vitest'
import { buildCrunchRadar } from '../lib/crunchRadar'
import type { StudyBlock } from '../lib/studyBlocks'
import type { Task } from '../lib/tasks'
import type { Lesson } from '../types'

const NOW = new Date(2026, 9, 12, 9, 0, 0) // 2026-10-12 09:00 local

function isoLocal(daysFromNow: number, hour: number, minute = 0): string {
  const d = new Date(NOW)
  d.setDate(d.getDate() + daysFromNow)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

describe('buildCrunchRadar', () => {
  it('returns calm 14-day radar when schedule is empty', () => {
    const report = buildCrunchRadar({
      lessons: [],
      tasks: [],
      studyBlocks: [],
      now: NOW,
    })
    expect(report.days).toHaveLength(14)
    expect(report.peakDay?.crunchScore ?? 0).toBe(0)
    expect(report.peakDay?.level ?? 'calm').toBe('calm')
    expect(report.alerts).toHaveLength(0)
  })

  it('computes daily workload, deadline pressure, and emits alerts for collisions, exam crunch, unplanned DDLs, and overload days', () => {
    const lessons: Lesson[] = [
      // Overlapping lessons on Day 0 -> collision alert
      {
        id: 'l-1',
        source: 'timeedit',
        code: 'CT60A2411',
        title: 'Algorithms Lecture',
        start: isoLocal(0, 10, 0),
        end: isoLocal(0, 12, 0),
        type: 'lecture',
      },
      {
        id: 'l-2',
        source: 'timeedit',
        code: 'BM20A9200',
        title: 'Math Lecture',
        start: isoLocal(0, 11, 0),
        end: isoLocal(0, 13, 0),
        type: 'lecture',
      },
      // Exam on Day 2 -> exam-crunch alert when combined with nearby DDL
      {
        id: 'l-exam',
        source: 'timeedit',
        code: 'CT60A2411',
        title: 'Algorithms Midterm Exam',
        start: isoLocal(2, 9, 0),
        end: isoLocal(2, 12, 0),
        type: 'exam',
      },
      // Long lab on Day 2 to push total hours > 7h (overload-day)
      {
        id: 'l-lab',
        source: 'timeedit',
        code: 'CT60A2411',
        title: 'Intensive Lab',
        start: isoLocal(2, 13, 0),
        end: isoLocal(2, 18, 0),
        type: 'lab',
      },
    ]

    const tasks: Task[] = [
      {
        id: 't-unplanned',
        title: 'Major Project Submission',
        course: 'CT60A2411',
        dueAt: isoLocal(2, 23, 59),
        completed: false,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
      {
        id: 't-second',
        title: 'Math Problem Set',
        course: 'BM20A9200',
        dueAt: isoLocal(2, 21, 0),
        completed: false,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    ]

    const studyBlocks: StudyBlock[] = []

    const report = buildCrunchRadar({
      lessons,
      tasks,
      studyBlocks,
      now: NOW,
    })

    expect(report.days).toHaveLength(14)
    expect(report.totalPendingInWindow).toBe(2)
    expect(report.unscheduledTasksInWindow).toHaveLength(2)
    expect(report.peakDay).not.toBeNull()
    expect(report.peakDay!.crunchScore).toBeGreaterThan(50)

    const alertKinds = report.alerts.map((a) => a.kind)
    expect(alertKinds).toContain('collision')
    expect(alertKinds).toContain('exam-crunch')
    expect(alertKinds).toContain('unplanned-ddl')
    expect(alertKinds).toContain('overload-day')
  })
})
