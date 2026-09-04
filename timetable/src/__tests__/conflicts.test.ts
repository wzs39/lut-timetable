import { describe, expect, it } from 'vitest'
import type { Lesson } from '../types'
import {
  courseKeyOf,
  matchCourses,
  findCourseConflicts,
  overlaps,
} from '../lib/conflicts'

function lesson(
  id: string,
  code: string | undefined,
  title: string,
  start: string,
  end: string,
): Lesson {
  return { id, source: 'sisu', code, title, start, end }
}

const L = (
  id: string,
  code: string,
  start: string,
  end: string,
): Lesson => lesson(id, code, `${code} Title`, start, end)

describe('courseKeyOf', () => {
  it('normalizes group numbers away so parallel groups share a key', () => {
    const a = lesson('a', 'K200DJ96-3015', 'Finnish 1', 'x', 'y')
    const b = lesson('b', 'K200DJ96-3016', 'Finnish 1', 'x', 'y')
    expect(courseKeyOf(a)).toBe('K200DJ96')
    expect(courseKeyOf(b)).toBe('K200DJ96')
  })

  it('extracts a code from the title when lesson.code is missing', () => {
    const l = lesson('a', undefined, 'CT60A0250 · Fundamentals', 'x', 'y')
    expect(courseKeyOf(l)).toBe('CT60A0250')
  })
})

describe('matchCourses', () => {
  it('finds courses by code or by name keywords', () => {
    const lessons = [
      lesson('1', 'K200DJ96', 'Finnish 1 · KKIE26LABH · KKIE26LUTH', '2026-09-01T06:00:00Z', '2026-09-01T08:00:00Z'),
      lesson('2', 'BM20A9200', 'Mathematics A', '2026-09-01T06:00:00Z', '2026-09-01T08:00:00Z'),
    ]
    expect(matchCourses(lessons, 'finnish')).toHaveLength(1)
    expect(matchCourses(lessons, 'k200dj96')[0].count).toBe(1)
    expect(matchCourses(lessons, 'zzz')).toHaveLength(0)
  })

  it('deduplicates parallel groups of one course into a single candidate', () => {
    const lessons = [
      lesson('1', 'K200DJ96-3015', 'Finnish 1 · 3015', '2026-09-01T06:00:00Z', '2026-09-01T08:00:00Z'),
      lesson('2', 'K200DJ96-3016', 'Finnish 1 · 3016', '2026-09-03T06:00:00Z', '2026-09-03T08:00:00Z'),
    ]
    const found = matchCourses(lessons, 'finnish')
    expect(found).toHaveLength(1)
    expect(found[0].count).toBe(2)
  })
})

describe('overlaps', () => {
  it('detects partial and full overlaps, ignores adjacency', () => {
    const a = L('a', 'AA1', '2026-09-01T08:00:00Z', '2026-09-01T10:00:00Z')
    expect(overlaps(a, L('b', 'BB1', '2026-09-01T09:00:00Z', '2026-09-01T11:00:00Z'))).toBe(true)
    expect(overlaps(a, L('c', 'BB1', '2026-09-01T08:00:00Z', '2026-09-01T10:00:00Z'))).toBe(true)
    expect(overlaps(a, L('d', 'BB1', '2026-09-01T10:00:00Z', '2026-09-01T12:00:00Z'))).toBe(false)
    expect(overlaps(a, L('e', 'BB1', '2026-09-02T08:00:00Z', '2026-09-02T10:00:00Z'))).toBe(false)
  })
})

describe('findCourseConflicts', () => {
  const lessons = [
    // Finnish 09:00-11:00 clash with Math 10:00-12:00 (partial)
    lesson('f1', 'K200DJ96', 'Finnish 1', '2026-09-01T07:00:00Z', '2026-09-01T09:00:00Z'),
    lesson('m1', 'BM20A9200', 'Mathematics A', '2026-09-01T08:00:00Z', '2026-09-01T10:00:00Z'),
    // Finnish 14:00-16:00 clash with both SW-eng lecture and tutorial (nested)
    lesson('f2', 'K200DJ96', 'Finnish 1', '2026-09-02T12:00:00Z', '2026-09-02T14:00:00Z'),
    lesson('s1', 'CT60A4050', 'SW Engineering', '2026-09-02T12:00:00Z', '2026-09-02T14:00:00Z'),
    lesson('s2', 'CT60A0250', 'Programming', '2026-09-02T12:30:00Z', '2026-09-02T13:30:00Z'),
    // A clean Finnish slot with no clash
    lesson('f3', 'K200DJ96', 'Finnish 1', '2026-09-03T07:00:00Z', '2026-09-03T09:00:00Z'),
    // Parallel Finnish group at the same time as f3 — same course, NOT a conflict
    lesson('f4', 'K200DJ96-3016', 'Finnish 1', '2026-09-03T07:00:00Z', '2026-09-03T09:00:00Z'),
  ]

  it('reports every clashing slot with the other lessons involved', () => {
    const rep = findCourseConflicts(lessons, 'K200DJ96')
    expect(rep.occurrences).toBe(4) // f1,f2,f3,f4
    expect(rep.slots).toBe(2)
    expect(rep.otherCourses).toBe(3)
    expect(rep.details[0].mine.id).toBe('f1')
    expect(rep.details[0].others.map((o) => o.id)).toEqual(['m1'])
    // second slot has two other lessons (nested conflict)
    expect(rep.details[1].others.map((o) => o.id).sort()).toEqual(['s1', 's2'])
  })

  it('ignores parallel groups of the same course', () => {
    const rep = findCourseConflicts(lessons, 'K200DJ96')
    // f3/f4 same-time same-course must not appear as conflicts
    expect(rep.details.some((d) => d.mine.id === 'f3')).toBe(false)
    expect(rep.details.some((d) => d.mine.id === 'f4')).toBe(false)
  })

  it('returns an empty report for an unknown or conflict-free course', () => {
    const rep = findCourseConflicts(lessons, 'ZZZ999')
    expect(rep).toEqual({ occurrences: 0, slots: 0, otherCourses: 0, details: [] })
    // a course that appears only once without clashes
    const rep2 = findCourseConflicts(lessons, 'HDD4010')
    expect(rep2.slots).toBe(0)
    expect(rep2.otherCourses).toBe(0)
  })
})
