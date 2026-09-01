import { describe, expect, it } from 'vitest'
import { layoutDay } from '../lib/layout'
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
