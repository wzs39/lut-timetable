import { describe, expect, it } from 'vitest'
import { layoutDay, conflictGroupsOf } from '../lib/layout'
import type { Lesson } from '../types'

function lesson(id: string, start: string, end: string, code = id): Lesson {
  return { id, source: 'sisu', title: id, code, start, end }
}

describe('layoutDay', () => {
  it('gives non-overlapping lessons a full-width single column', () => {
    const placed = layoutDay(
      [
        lesson('a', '2026-09-01T07:00:00Z', '2026-09-01T09:00:00Z'),
        lesson('b', '2026-09-01T09:00:00Z', '2026-09-01T11:00:00Z'),
      ],
      '2026-09-01',
    )
    expect(placed).toHaveLength(2)
    expect(placed.every((p) => p.col === 0 && p.cols === 1)).toBe(true)
    expect(placed.every((p) => !p.conflict)).toBe(true)
  })

  it('puts overlapping lessons side by side in separate columns', () => {
    const placed = layoutDay(
      [
        lesson('a', '2026-09-01T07:00:00Z', '2026-09-01T09:00:00Z'),
        lesson('b', '2026-09-01T08:00:00Z', '2026-09-01T10:00:00Z'),
      ],
      '2026-09-01',
    )
    expect(placed.every((p) => p.cols === 2 && p.conflict)).toBe(true)
    expect(placed.find((p) => p.lesson.id === 'a')?.col).toBe(0)
    expect(placed.find((p) => p.lesson.id === 'b')?.col).toBe(1)
  })

  it('reuses a column when the third lesson fits after the second ends', () => {
    // A 09-11, B 09:30-10:30 (bentrok dengan A), C 10:30-11:30 (masih
    // tumpang tindih cluster karena clusterEnd = 11:00, tapi muat di kolom B)
    const placed = layoutDay(
      [
        lesson('a', '2026-09-01T09:00:00Z', '2026-09-01T11:00:00Z'),
        lesson('b', '2026-09-01T09:30:00Z', '2026-09-01T10:30:00Z'),
        lesson('c', '2026-09-01T10:30:00Z', '2026-09-01T11:30:00Z'),
      ],
      '2026-09-01',
    )
    const byId = Object.fromEntries(placed.map((p) => [p.lesson.id, p]))
    expect(byId.a.col).toBe(0)
    expect(byId.b.col).toBe(1)
    expect(byId.c.col).toBe(1) // kolom B sudah bebas pada 10:30
    expect(byId.c.cols).toBe(2)
  })

  it('separates morning and afternoon sessions into different clusters', () => {
    const placed = layoutDay(
      [
        lesson('morning', '2026-09-01T07:00:00Z', '2026-09-01T09:00:00Z'),
        lesson('afternoon', '2026-09-01T12:00:00Z', '2026-09-01T14:00:00Z'),
        lesson('afternoon2', '2026-09-01T12:00:00Z', '2026-09-01T14:00:00Z'),
      ],
      '2026-09-01',
    )
    const m = placed.find((p) => p.lesson.id === 'morning')!
    const a = placed.find((p) => p.lesson.id === 'afternoon')!
    expect(m.conflict).toBe(false)
    expect(a.conflict).toBe(true)
    // clusterKey berbeda antar cluster
    expect(m.clusterKey).not.toBe(a.clusterKey)
  })

  it('builds a stable shared clusterKey for lessons in the same conflict cluster', () => {
    const placed = layoutDay(
      [
        lesson('a', '2026-09-01T07:00:00Z', '2026-09-01T09:00:00Z', 'CT60A0250'),
        lesson('b', '2026-09-01T07:00:00Z', '2026-09-01T09:00:00Z', 'CT10A9900'),
      ],
      '2026-09-01',
    )
    expect(placed[0].clusterKey).toBe(placed[1].clusterKey)
    expect(placed[0].clusterKey.startsWith('2026-09-01|')).toBe(true)
  })

  it('handles an empty day', () => {
    expect(layoutDay([], '2026-09-01')).toEqual([])
  })

  it('does not mutate the input array order', () => {
    const input = [
      lesson('b', '2026-09-01T09:00:00Z', '2026-09-01T11:00:00Z'),
      lesson('a', '2026-09-01T07:00:00Z', '2026-09-01T09:00:00Z'),
    ]
    layoutDay(input, '2026-09-01')
    expect(input[0].id).toBe('b')
  })
})

function withUid(id: string, code: string, start: string, end: string): Lesson {
  return { id, source: 'sisu', title: id, code, start, end, uid: `uid-${id}` }
}

describe('layoutDay (course-aware conflicts)', () => {
  it('does not treat parallel groups of the same course as a conflict', () => {
    const placed = layoutDay(
      [
        withUid('p1', 'K200DJ96-3015', '2026-09-03T07:00:00Z', '2026-09-03T09:00:00Z'),
        withUid('p2', 'K200DJ96-3016', '2026-09-03T07:00:00Z', '2026-09-03T09:00:00Z'),
      ],
      '2026-09-03',
    )
    expect(placed).toHaveLength(2)
    // side by side (two columns) so both are readable…
    expect(placed[0].cols).toBe(2)
    // …but neither is flagged as a collision
    expect(placed.every((p) => !p.conflict)).toBe(true)
  })

  it('flags a same-course pair only when a DIFFERENT course overlaps too', () => {
    const placed = layoutDay(
      [
        withUid('p1', 'K200DJ96-3015', '2026-09-03T07:00:00Z', '2026-09-03T09:00:00Z'),
        withUid('p2', 'K200DJ96-3016', '2026-09-03T07:00:00Z', '2026-09-03T09:00:00Z'),
        withUid('q', 'CT60A0250', '2026-09-03T08:00:00Z', '2026-09-03T10:00:00Z'),
      ],
      '2026-09-03',
    )
    const byId = Object.fromEntries(placed.map((p) => [p.lesson.id, p]))
    expect(byId.p1.conflict).toBe(true)
    expect(byId.p2.conflict).toBe(true)
    expect(byId.q.conflict).toBe(true)
    // all three live in one collision cluster
    expect(byId.p1.clusterKey).toBe(byId.q.clusterKey)
  })
})

describe('conflictGroupsOf', () => {
  const placed = () =>
    layoutDay(
      [
        withUid('a', 'CT10A9900', '2026-09-01T12:00:00Z', '2026-09-01T14:00:00Z'),
        withUid('b', 'CT60A0250', '2026-09-01T12:00:00Z', '2026-09-01T14:00:00Z'),
        withUid('c', 'HDD4010', '2026-09-01T12:00:00Z', '2026-09-01T14:00:00Z'),
        withUid('d', 'CT60A4050', '2026-09-01T08:00:00Z', '2026-09-01T10:00:00Z'),
        withUid('e', 'BM20A9200', '2026-09-01T08:30:00Z', '2026-09-01T10:30:00Z'),
      ],
      '2026-09-01',
    )

  it('groups by clusterKey and counts collision GROUPS, not lessons', () => {
    const groups = conflictGroupsOf(placed())
    // two collisions: the 08:00 pair and the 12:00 triple
    expect(groups).toHaveLength(2)
    expect(groups[0].lessons).toHaveLength(2) // pair
    expect(groups[1].lessons).toHaveLength(3) // triple
    expect(groups[0].lessons.every((p) => p.conflict)).toBe(true)
    // shared key across all members of a group, stable date-prefixed format
    expect(groups[0].key.startsWith('2026-09-01|')).toBe(true)
    expect(new Set(groups[1].lessons.map((p) => p.clusterKey)).size).toBe(1)
  })

  it('sorts groups from the earliest slot', () => {
    const groups = conflictGroupsOf(placed())
    expect(groups[0].lessons[0].lesson.id).toBe('d')
    expect(groups[1].lessons[0].lesson.id).toBe('a')
  })

  it('returns an empty list for a conflict-free day', () => {
    const free = layoutDay(
      [
        withUid('x', 'X1', '2026-09-01T07:00:00Z', '2026-09-01T09:00:00Z'),
        withUid('y', 'Y1', '2026-09-01T09:00:00Z', '2026-09-01T11:00:00Z'),
      ],
      '2026-09-01',
    )
    expect(conflictGroupsOf(free)).toEqual([])
  })
})
