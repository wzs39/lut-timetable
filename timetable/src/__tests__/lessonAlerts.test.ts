import { describe, expect, it } from 'vitest'
import {
  extractRoom,
  noticeForLesson,
  noticesForLessons,
  parseNotice,
  extractCourseCode,
} from '../lib/lessonAlerts'
import type { Announcement } from '../lib/announcements'
import type { Lesson } from '../types'

const ann = (over: Partial<Announcement>): Announcement => ({
  id: 'forum-1',
  subject: 'Notice',
  ...over,
})

const lesson = (over: Partial<Lesson>): Lesson => ({
  id: 'l1',
  title: 'Software Engineering',
  code: 'CT60A4050',
  source: 'sisu',
  start: '2026-09-17T08:00:00.000Z',
  end: '2026-09-17T10:00:00.000Z',
  ...over,
})

describe('extractCourseCode', () => {
  it('finds LUT-style codes in mixed text', () => {
    expect(extractCourseCode('CT60A4050 lecture moved')).toBe('CT60A4050')
    expect(extractCourseCode('BM40A0102: room change')).toBe('BM40A0102')
    expect(extractCourseCode('no code here, just words')).toBeNull()
  })
})

describe('extractRoom', () => {
  it('takes the right side of an arrow', () => {
    expect(extractRoom("Thursday lecture room changed: A123 → B234")).toBe('B234')
    expect(extractRoom('教室从 A123 换到 B234')).toBe('B234')
  })
  it('handles "moved to" phrasing', () => {
    expect(extractRoom('Lecture moved to room 2513')).toBe('2513')
    expect(extractRoom('session moves to hall C2')).toBe('C2')
  })
  it('rejects non-room words', () => {
    expect(extractRoom('deadline moved to next week')).toBeUndefined()
  })
})

describe('parseNotice', () => {
  it('room-change (EN, the real post that drove the feature)', () => {
    const a = ann({
      subject: 'Thursday lecture room changed',
      excerpt: 'Due to maintenance, the session moves to B234.',
    })
    const n = parseNotice(a)
    expect(n?.kind).toBe('room-change')
    expect(n?.room).toBe('B234')
  })
  it('room-change (zh)', () => {
    const n = parseNotice(ann({ subject: '教室变更通知', excerpt: '本周四的课 教室改为 B234' }))
    expect(n?.kind).toBe('room-change')
    expect(n?.room).toBe('B234')
  })
  it('deadline-change', () => {
    const n = parseNotice(ann({ subject: 'IHA1 deadline extended by 48h' }))
    expect(n?.kind).toBe('deadline-change')
    expect(n?.room).toBeUndefined()
  })
  it('ordinary post → null', () => {
    expect(parseNotice(ann({ subject: 'Welcome to the course!', excerpt: 'Reading list is up.' }))).toBeNull()
  })
})

describe('noticeForLesson', () => {
  const roomAnns = [
    ann({
      id: 'forum-10',
      course: 'CT60A4050',
      subject: 'Thursday lecture room changed: A123 → B234',
      excerpt: 'Due to maintenance, Thursday session moves to B234.',
      postedAt: '2026-09-15T09:00:00.000Z',
    }),
    ann({
      id: 'forum-11',
      course: 'CT60A0250',
      subject: 'IHA1 deadline extended by 48h',
      postedAt: '2026-09-16T09:00:00.000Z',
    }),
  ]

  it('matches by course code and 7-day window', () => {
    const l = lesson({ start: '2026-09-17T08:00:00.000Z', end: '2026-09-17T10:00:00.000Z' })
    const n = noticeForLesson(roomAnns, l)
    expect(n?.kind).toBe('room-change')
    expect(n?.room).toBe('B234')
  })

  it('does NOT leak announcements across courses', () => {
    const l = lesson({ code: 'CT61A9999' })
    expect(noticeForLesson(roomAnns, l)).toBeNull()
  })

  it('old announcement (posted >7d before lesson) expires', () => {
    const l = lesson({ start: '2026-10-05T08:00:00.000Z', end: '2026-10-05T10:00:00.000Z' })
    expect(noticeForLesson(roomAnns, l)).toBeNull()
  })

  it('announcement posted after the lesson does not apply', () => {
    const l = lesson({ start: '2026-09-14T08:00:00.000Z', end: '2026-09-14T10:00:00.000Z' })
    expect(noticeForLesson(roomAnns, l)).toBeNull()
  })

  it('deadline notice attaches to its own course lesson', () => {
    const l = lesson({ code: 'CT60A0250' })
    const n = noticeForLesson(roomAnns, l)
    expect(n?.kind).toBe('deadline-change')
  })

  it('empty/null input → null', () => {
    expect(noticeForLesson(null, lesson({}))).toBeNull()
    expect(noticeForLesson([], lesson({}))).toBeNull()
  })
})

describe('noticesForLessons', () => {
  it('maps by lesson id', () => {
    const roomAnns = [
      ann({
        id: 'forum-10',
        course: 'CT60A4050',
        subject: 'Thursday lecture room changed: A123 → B234',
        postedAt: '2026-09-15T09:00:00.000Z',
      }),
      ann({
        id: 'forum-11',
        course: 'CT60A0250',
        subject: 'IHA1 deadline extended by 48h',
        postedAt: '2026-09-16T09:00:00.000Z',
      }),
    ]
    const lessons = [
      lesson({ id: 'a', code: 'CT60A4050' }),
      lesson({ id: 'b', code: 'CT60A0250' }),
      lesson({ id: 'c', code: 'CT99X0000' }),
    ]
    const m = noticesForLessons(roomAnns, lessons)
    expect(m.a?.kind).toBe('room-change')
    expect(m.b?.kind).toBe('deadline-change')
    expect(m.c).toBeUndefined()
  })
})
