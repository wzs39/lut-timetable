import { describe, expect, it } from 'vitest'
import {
  isoWeekNumber,
  formatWeekRange,
  nextLessonDay,
  startOfWeek,
  findCourseTarget,
  findLessonByTitle,
  sameDayQueue,
} from '../lib/date'
import type { Lesson } from '../types'

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

describe('nextLessonDay', () => {
  const lesson = (start: string): Lesson => ({
    id: start,
    source: 'sisu',
    title: 'Test',
    start,
    end: start,
  })

  it('finds the first day after today that has lessons, skipping empty days', () => {
    const lessons = [
      lesson('2026-09-12T09:00:00.000Z'),
      lesson('2026-09-15T10:00:00.000Z'),
    ]
    const day = nextLessonDay(lessons, new Date('2026-09-10T20:00:00.000Z'))
    // Compare LOCAL calendar date: toISOString() would shift back a day in UTC+ timezones
    expect(day?.getFullYear()).toBe(2026)
    expect(day?.getMonth()).toBe(8)
    expect(day?.getDate()).toBe(12)
  })

  it('returns null when no later lesson exists', () => {
    expect(nextLessonDay([lesson('2026-09-10T09:00:00.000Z')], new Date('2026-09-10T20:00:00.000Z'))).toBeNull()
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

describe('findCourseTarget', () => {
  const lesson = (id: string, code: string, start: string): Lesson => ({
    id,
    source: 'sisu',
    title: 'Test',
    code,
    start,
    end: start,
  })

  // Waktu RELATIF terhadap sekarang: fixture literal (2026-09-25 dst.) akan
  // kedaluwarsa dan membuat tes ini merah sendiri begitu tanggalnya lewat.
  const HOUR = 3600 * 1000
  const DAY = 24 * HOUR
  const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString()

  const lessons = [
    lesson('past', 'CT60A0250', at(-3 * DAY)),
    lesson('future1', 'CT60A0250', at(2 * HOUR)),
    lesson('future2', 'CT60A0250', at(3 * DAY)),
    lesson('other', 'BM20A9200', at(-1 * DAY)),
  ]

  it('returns the earliest upcoming session for the course prefix (case-insensitive)', () => {
    const target = findCourseTarget(lessons, 'ct60a0250')
    expect(target?.id).toBe('future1')
  })

  it('falls back to the latest past session when nothing is upcoming', () => {
    const pastOnly = lessons.filter((l) => l.id !== 'future1' && l.id !== 'future2')
    const target = findCourseTarget(pastOnly, 'CT60A0250')
    expect(target?.id).toBe('past')
  })

  it('matches by prefix, so a longer stored code still matches a short query', () => {
    const withLongCode = [lesson('long', 'CT60A0250-2026', at(4 * DAY))]
    expect(findCourseTarget(withLongCode, 'ct60a0250')?.id).toBe('long')
  })

  it('returns undefined for a code with no lessons', () => {
    expect(findCourseTarget(lessons, 'XX00A0000')).toBeUndefined()
  })

  /** 无代码的手动课：命令面板选中后按标题跳转，口径与按代码一致 */
  describe('findLessonByTitle', () => {
    const manual = (id: string, title: string, offsetMs: number): Lesson => ({
      id,
      source: 'manual',
      title,
      start: at(offsetMs),
      end: at(offsetMs),
    })
    const list = [
      manual('past', 'Reading group', -2 * DAY),
      manual('soon', 'Reading group', 2 * HOUR),
      manual('later', 'Reading group', 2 * DAY),
      manual('other', 'Different course', 2 * HOUR),
    ]

    it('picks the earliest upcoming session, ignoring case and padding', () => {
      expect(findLessonByTitle(list, '  reading GROUP ')?.id).toBe('soon')
    })

    it('falls back to the latest past session when nothing is upcoming', () => {
      const pastOnly = [list[0]] // 「past」：2 天前
      expect(findLessonByTitle(pastOnly, 'Reading group')?.id).toBe('past')
    })

    it('returns undefined for empty or unknown titles', () => {
      expect(findLessonByTitle(list, '   ')).toBeUndefined()
      expect(findLessonByTitle(list, 'no such course')).toBeUndefined()
    })
  })

  /** 课程详情面板的「上一节/下一节」——同一天内的队列位置 */
  describe('sameDayQueue', () => {
    // 固定本地日历日（2026-09-21/22）：不能用「now + N 小时」当 fixture，
    // 否则跨午夜运行时分属两天，测试自己变红。
    const on = (id: string, dayNum: number, hour: number): Lesson => ({
      id,
      source: 'sisu',
      title: `L${id}`,
      code: 'CODE1',
      start: new Date(2026, 8, dayNum, hour, 0).toISOString(),
      end: new Date(2026, 8, dayNum, hour + 1, 0).toISOString(),
    })

    it('reports position inside the same day, sorted by start', () => {
      const list = [on('b', 21, 12), on('a', 21, 8), on('c', 21, 14)]
      expect(sameDayQueue(list, 'b')).toEqual({
        index: 1,
        total: 3,
        prevId: 'a',
        nextId: 'c',
      })
    })

    it('leaves prev/next undefined at the day edges', () => {
      const list = [on('a', 21, 8), on('b', 21, 10)]
      expect(sameDayQueue(list, 'a')).toMatchObject({ index: 0, prevId: undefined, nextId: 'b' })
      expect(sameDayQueue(list, 'b')).toMatchObject({ index: 1, prevId: 'a', nextId: undefined })
    })

    it('never crosses into another day', () => {
      const list = [on('today', 21, 10), on('tomorrow', 22, 9)]
      expect(sameDayQueue(list, 'today')).toMatchObject({ total: 1, nextId: undefined })
    })

    it('returns null for an unknown id', () => {
      expect(sameDayQueue([on('a', 21, 8)], 'zzz')).toBeNull()
    })
  })
})
