import { describe, expect, it } from 'vitest'
import { isoWeekNumber, formatWeekRange, startOfWeek } from '../lib/date'

describe('isoWeekNumber', () => {
  it('returns ISO-8601 week numbers', () => {
    expect(isoWeekNumber(new Date(2026, 8, 7))).toBe(37)
    expect(isoWeekNumber(new Date(2026, 9, 21))).toBe(43)
  })

  it('handles year-boundary weeks', () => {
    expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1)
    expect(isoWeekNumber(new Date(2021, 0, 1))).toBe(53) // Thu 2021-01-01 is ISO week 53 of 2020
    expect(isoWeekNumber(new Date(2026, 11, 31))).toBe(53)
  })

  it('is stable across any day of the same week', () => {
    const thu = new Date(2026, 8, 10)
    expect(isoWeekNumber(startOfWeek(thu))).toBe(isoWeekNumber(thu))
  })
})

describe('formatWeekRange', () => {
  it('formats a whole week with the year', () => {
    expect(formatWeekRange(new Date(2026, 8, 7), 'en-US')).toBe(
      'Mon, Sep 7, 2026 – Sun, Sep 13',
    )
  })

  it('handles a month boundary inside the week', () => {
    const range = formatWeekRange(new Date(2026, 8, 28), 'en-US')
    expect(range).toContain('Sep 28')
    expect(range).toContain('Oct 4')
  })

  it('always starts on the Monday of the week', () => {
    expect(formatWeekRange(startOfWeek(new Date(2026, 8, 10)), 'en-US').startsWith('Mon')).toBe(true)
  })
})
