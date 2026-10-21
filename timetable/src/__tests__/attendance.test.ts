import { describe, expect, it } from 'vitest'
import type { Lesson } from '../types'
import {
  ATTENDANCE_WARN_RATE,
  attendanceFor,
  courseAttendance,
  lessonOccurrenceKey,
  setAttendance,
  type AttendanceMap,
} from '../lib/attendance'

/**
 * 【出勤契约】键必须跟着「课程发生」走（uid → 代码|开始），不能跟着
 * 同步生成的 lesson.id 走；停课不计分母；未结束的课不计入；80% 整不算预警。
 */

const NOW = new Date(2026, 9, 20, 18, 0, 0, 0)

let seq = 0
const lesson = (
  start: Date,
  end: Date,
  opts: { code?: string; uid?: string; title?: string } = {},
): Lesson =>
  ({
    id: `l${seq++}`,
    title: opts.title ?? 'Course',
    code: opts.code ?? 'CT60A0001',
    uid: opts.uid,
    start: start.toISOString(),
    end: end.toISOString(),
    source: 'sisu',
  }) as unknown as Lesson

const at = (day: number, h: number) => new Date(2026, 9, day, h, 0, 0, 0)

describe('lessonOccurrenceKey', () => {
  it('prefers the ICS uid so re-sync keeps the same key', () => {
    const a = lesson(at(19, 10), at(19, 12), { uid: 'abc@sisu' })
    const b = lesson(at(19, 10), at(19, 12), { uid: 'abc@sisu' })
    expect(lessonOccurrenceKey(a)).toBe('abc@sisu')
    expect(lessonOccurrenceKey(b)).toBe(lessonOccurrenceKey(a))
  })

  it('falls back to normalized code + start', () => {
    const l = lesson(at(19, 10), at(19, 12), { code: ' ct60a0001 ' })
    expect(lessonOccurrenceKey(l)).toBe(`CT60A0001|${l.start}`)
  })

  it('returns empty for records that cannot be keyed', () => {
    const l = { ...lesson(at(19, 10), at(19, 12)), start: 'nope' } as Lesson
    expect(lessonOccurrenceKey(l)).toBe('')
  })
})

describe('attendance records', () => {
  it('sets, reads and clears a status', () => {
    const l = lesson(at(19, 10), at(19, 12), { uid: 'u1' })
    let map: AttendanceMap = {}
    map = setAttendance(map, l, 'attended', NOW)
    expect(attendanceFor(map, l)).toBe('attended')
    map = setAttendance(map, l, null, NOW)
    expect(attendanceFor(map, l)).toBeNull()
  })

  it('does not write when the lesson has no usable key', () => {
    const bad = { ...lesson(at(19, 10), at(19, 12)), start: 'x' } as Lesson
    const map = setAttendance({}, bad, 'missed', NOW)
    expect(map).toEqual({})
  })
})

describe('courseAttendance', () => {
  const attended = (n: number, from = 1): Lesson[] =>
    Array.from({ length: n }, (_, i) => lesson(at(from + i, 10), at(from + i, 12), { uid: `a${from + i}` }))
  const missed = (n: number, from = 1): Lesson[] =>
    Array.from({ length: n }, (_, i) => lesson(at(from + i, 10), at(from + i, 12), { uid: `m${from + i}` }))

  function recordAll(lessons: Lesson[], status: 'attended' | 'missed' | 'cancelled'): AttendanceMap {
    return lessons.reduce((acc, l) => setAttendance(acc, l, status, NOW), {} as AttendanceMap)
  }

  it('computes the rate and warns below the threshold', () => {
    const a = attended(4)
    const m = missed(1, 10)
    const stats = courseAttendance([...a, ...m], { ...recordAll(a, 'attended'), ...recordAll(m, 'missed') }, 'CT60A0001', NOW)
    expect(stats).toMatchObject({ attended: 4, missed: 1, cancelled: 0, total: 5, warn: false })
    expect(stats.rate).toBeCloseTo(0.8)
  })

  it('keeps exactly 80% out of the warning band', () => {
    const a = attended(8, 1)
    const m = missed(2, 9)
    const stats = courseAttendance([...a, ...m], { ...recordAll(a, 'attended'), ...recordAll(m, 'missed') }, 'CT60A0001', NOW)
    expect(stats.rate).toBeCloseTo(ATTENDANCE_WARN_RATE)
    expect(stats.warn).toBe(false)
  })

  it('excludes cancellations from the denominator', () => {
    const a = attended(2)
    const c = [lesson(at(10, 10), at(10, 12), { uid: 'c1' })]
    const stats = courseAttendance(
      [...a, ...c],
      { ...recordAll(a, 'attended'), ...recordAll(c, 'cancelled') },
      'CT60A0001',
      NOW,
    )
    expect(stats).toMatchObject({ attended: 2, cancelled: 1, total: 2 })
    expect(stats.rate).toBe(1)
  })

  it('ignores future lessons, other courses and unrecorded lessons', () => {
    const future = [lesson(at(25, 10), at(25, 12), { uid: 'f1' })]
    const other = [lesson(at(1, 10), at(1, 12), { uid: 'o1', code: 'BM20A9200' })]
    const unrecorded = [lesson(at(2, 10), at(2, 12), { uid: 'u2' })]
    const stats = courseAttendance(
      [...future, ...other, ...unrecorded],
      recordAll(other, 'missed'),
      'CT60A0001',
      NOW,
    )
    expect(stats).toMatchObject({ attended: 0, missed: 0, total: 0, rate: null, warn: false })
  })

  it('omits the denominator when nothing is recorded', () => {
    const stats = courseAttendance([lesson(at(1, 10), at(1, 12))], {}, 'CT60A0001', NOW)
    expect(stats.rate).toBeNull()
  })
})
