import { describe, expect, it } from 'vitest'
import { upcomingExams } from '../lib/exams'
import type { Lesson } from '../types'

function lesson(p: Partial<Lesson>): Lesson {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    source: 'sisu',
    title: p.title ?? 'Exam',
    start: p.start!,
    end: p.end!,
    ...p,
  }
}

/** 2026-09-15 10:00 local */
const NOW = new Date(2026, 8, 15, 10, 0, 0)

function iso(y: number, m: number, d: number, h = 12, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString()
}

describe('upcomingExams', () => {
  it('returns only exams that have not ended, sorted by start', () => {
    const lessons = [
      lesson({ type: 'exam', title: 'Future', start: iso(2026, 10, 21, 16, 30), end: iso(2026, 10, 21, 19, 30) }),
      lesson({ type: 'exam', title: 'Past', start: iso(2026, 9, 1), end: iso(2026, 9, 1, 15) }),
      lesson({ type: 'lecture', title: 'Not exam', start: iso(2026, 10, 1), end: iso(2026, 10, 1, 15) }),
      lesson({ type: 'exam', title: 'Earlier future', start: iso(2026, 9, 20), end: iso(2026, 9, 20, 15) }),
    ]
    const exams = upcomingExams(lessons, NOW)
    expect(exams.map((e) => e.lesson.title)).toEqual(['Earlier future', 'Future'])
  })

  it('includes live exams with inDays=0', () => {
    const lessons = [
      lesson({
        type: 'exam',
        start: iso(2026, 9, 15, 9, 0),
        end: iso(2026, 9, 15, 12, 0),
      }),
    ]
    const [e] = upcomingExams(lessons, NOW)
    expect(e).toBeDefined()
    expect(e.live).toBe(true)
    expect(e.inDays).toBe(0)
  })

  it('counts days until start from local midnight (tomorrow = 1)', () => {
    const lessons = [
      lesson({
        type: 'exam',
        start: iso(2026, 9, 21, 16, 30),
        end: iso(2026, 9, 21, 19, 30),
      }),
    ]
    const [e] = upcomingExams(lessons, NOW)
    expect(e.inDays).toBe(6)
    expect(e.live).toBe(false)
  })

  it('excludes exams that ended earlier today', () => {
    const lessons = [
      lesson({
        type: 'exam',
        start: iso(2026, 9, 15, 8, 0),
        end: iso(2026, 9, 15, 9, 0),
      }),
    ]
    expect(upcomingExams(lessons, NOW)).toHaveLength(0)
  })
})
