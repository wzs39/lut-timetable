import { describe, expect, it } from 'vitest'
import type { Lesson } from '../types'
import {
  LONG_DAY_MIN,
  LONG_GAP_MIN,
  MAX_INSIGHTS,
  weekInsights,
} from '../lib/weekInsights'

/**
 * 【本周提示契约】三类信号按「赶不上 > 满课 > 空档」排序，最多三条；
 * 已经过去的时段与过去的日子一律不提示。
 * 2026-10-19 是周一。
 */

let seq = 0
const lesson = (day: number, h: number, m: number, durH: number, location: string, id = `l${seq++}`): Lesson =>
  ({
    id,
    title: 'Course',
    code: 'CT60A0001',
    location,
    start: new Date(2026, 9, day, h, m, 0, 0).toISOString(),
    end: new Date(2026, 9, day, h, m + durH * 60, 0, 0).toISOString(),
    source: 'sisu',
  }) as unknown as Lesson

const NOW = new Date(2026, 9, 19, 8, 0, 0, 0)

describe('weekInsights', () => {
  it('flags a tight cross-building hop first', () => {
    const a = lesson(19, 10, 0, 1, 'M19_AUD1B')
    const b = lesson(19, 11, 5, 1, 'NIE73_B211')
    const out = weekInsights([a, b], NOW)
    expect(out[0]).toMatchObject({
      kind: 'tight-hop',
      lessonId: a.id,
      minutes: 5,
      to: 'NIE73_B211',
      crossBuilding: true,
    })
  })

  it('flags a long gap and points at the later lesson', () => {
    const a = lesson(19, 9, 0, 1, 'M19_AUD1B')
    const b = lesson(19, 13, 0, 1, 'M19_AUD1B')
    const out = weekInsights([a, b], NOW)
    const gap = out.find((i) => i.kind === 'long-gap')
    expect(gap).toMatchObject({ lessonId: b.id, minutes: 3 * 60 })
    expect(gap!.minutes).toBeGreaterThanOrEqual(LONG_GAP_MIN)
  })

  it('flags a long day', () => {
    const out = weekInsights(
      [lesson(20, 8, 0, 4, 'M19_AUD1B'), lesson(20, 13, 0, 3, 'M19_AUD1B')],
      NOW,
    )
    const day = out.find((i) => i.kind === 'long-day')
    expect(day).toMatchObject({ minutes: 7 * 60 })
    expect(day!.minutes).toBeGreaterThanOrEqual(LONG_DAY_MIN)
  })

  it('sorts by severity, then day, and caps the list', () => {
    const lessons = [
      // 周二：7 小时满课
      lesson(20, 8, 0, 4, 'M19_AUD1B'),
      lesson(20, 13, 0, 1, 'M19_AUD1B'),
      lesson(20, 15, 0, 2, 'M19_AUD1B'),
      // 周三：4 小时空档
      lesson(21, 9, 0, 1, 'M19_AUD1B'),
      lesson(21, 14, 0, 1, 'M19_AUD1B'),
      // 周一：赶不上
      lesson(19, 9, 0, 1, 'M19_AUD1B'),
      lesson(19, 10, 5, 1, 'NIE73_B211'),
    ]
    const out = weekInsights(lessons, NOW)
    expect(out).toHaveLength(MAX_INSIGHTS)
    expect(out.map((i) => i.kind)).toEqual(['tight-hop', 'long-day', 'long-gap'])
    expect(out[0].day).toBe('2026-10-19')
    expect(out[1].day).toBe('2026-10-20')
  })

  it('ignores past days and gaps that already elapsed', () => {
    const past = [lesson(18, 9, 0, 1, 'M19_AUD1B'), lesson(18, 13, 0, 1, 'M19_AUD1B')]
    expect(weekInsights(past, NOW)).toEqual([])

    const later = new Date(2026, 9, 19, 18, 0, 0, 0)
    const today = [lesson(19, 9, 0, 1, 'M19_AUD1B'), lesson(19, 13, 0, 1, 'M19_AUD1B')]
    expect(weekInsights(today, later).some((i) => i.kind === 'long-gap')).toBe(false)
  })

  it('returns nothing for empty or malformed input', () => {
    expect(weekInsights([], NOW)).toEqual([])
    const bad = { ...lesson(19, 9, 0, 1, 'M19'), start: 'x', end: 'y' } as Lesson
    expect(weekInsights([bad], NOW)).toEqual([])
  })
})
