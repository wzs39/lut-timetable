import { describe, expect, it } from 'vitest'
import { freeRoomsNow } from '../lib/freeRooms'
import type { Lesson } from '../types'

/** 2026-09-16 12:00 local */
const NOW = new Date(2026, 8, 16, 12, 0, 0)

function lesson(p: Partial<Lesson>): Lesson {
  return {
    id: Math.random().toString(36).slice(2),
    source: 'timeedit',
    title: 'X',
    start: p.start!,
    end: p.end!,
    ...p,
  }
}

function iso(y: number, m: number, d: number, h: number, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString()
}

describe('freeRoomsNow', () => {
  it('reports rooms whose lesson already ended (nextBusyAt null)', () => {
    const rooms = freeRoomsNow(
      [
        lesson({ location: 'M19_AUD1B Auditorio 1', start: iso(2026, 9, 16, 10), end: iso(2026, 9, 16, 11) }),
      ],
      NOW,
    )
    expect(rooms).toEqual([
      { building: 'M19', room: 'AUD1B', nextBusyAt: null },
    ])
  })

  it('excludes rooms busy right now', () => {
    const rooms = freeRoomsNow(
      [
        lesson({ location: 'NIE73_B211 Teorialuokka', start: iso(2026, 9, 16, 11), end: iso(2026, 9, 16, 13) }),
      ],
      NOW,
    )
    expect(rooms).toHaveLength(0)
  })

  it('excludes rooms busy within the horizon (default 60 min)', () => {
    const rooms = freeRoomsNow(
      [
        lesson({ location: 'M19_AUD2B Auditorio 2', start: iso(2026, 9, 16, 12, 30), end: iso(2026, 9, 16, 14) }),
      ],
      NOW,
    )
    expect(rooms).toHaveLength(0)
  })

  it('includes rooms whose next lesson is beyond the horizon, with nextBusyAt', () => {
    const rooms = freeRoomsNow(
      [
        lesson({ location: 'M19_AUD2B Auditorio 2', start: iso(2026, 9, 16, 15), end: iso(2026, 9, 16, 17) }),
      ],
      NOW,
    )
    expect(rooms).toEqual([
      { building: 'M19', room: 'AUD2B', nextBusyAt: iso(2026, 9, 16, 15) },
    ])
  })

  it('merges multiple lessons on one room and sorts results', () => {
    const rooms = freeRoomsNow(
      [
        lesson({ location: 'B2033_3017', start: iso(2026, 9, 16, 8), end: iso(2026, 9, 16, 10) }),
        lesson({ location: 'B2033_3017 Konepaja', start: iso(2026, 9, 16, 16), end: iso(2026, 9, 16, 18) }),
        lesson({ location: 'M19_AUD1B', start: iso(2026, 9, 16, 9), end: iso(2026, 9, 16, 10) }),
      ],
      NOW,
    )
    expect(rooms.map((r) => `${r.building}_${r.room}`)).toEqual([
      'B2033_3017',
      'M19_AUD1B',
    ])
    const b2033 = rooms.find((r) => r.room === '3017')!
    expect(b2033.nextBusyAt).toBe(iso(2026, 9, 16, 16))
  })

  it('caps output at 12 rooms', () => {
    const lessons = Array.from({ length: 20 }, (_, i) =>
      lesson({
        location: `M19_R${i} Room`,
        start: iso(2026, 9, 16, 8),
        end: iso(2026, 9, 16, 9),
      }),
    )
    expect(freeRoomsNow(lessons, NOW)).toHaveLength(12)
  })
})
