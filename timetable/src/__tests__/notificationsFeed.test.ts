import { describe, expect, it } from 'vitest'
import { countUnread, type MoodleNotification } from '../lib/notificationsFeed'

function notif(id: string, read: boolean): MoodleNotification {
  return { id, subject: id, body: '', read, kind: 'system' }
}

describe('countUnread', () => {
  it('returns 0 for null (belum pernah dimuat)', () => {
    expect(countUnread(null)).toBe(0)
  })

  it('returns 0 for empty list', () => {
    expect(countUnread([])).toBe(0)
  })

  it('counts all when nothing is read', () => {
    expect(countUnread([notif('a', false), notif('b', false)])).toBe(2)
  })

  it('returns 0 when everything is read', () => {
    expect(countUnread([notif('a', true), notif('b', true)])).toBe(0)
  })

  it('counts only unread in a mixed list', () => {
    expect(countUnread([notif('a', true), notif('b', false), notif('c', true), notif('d', false)])).toBe(2)
  })
})

// Klasifikasi kategori dari sinyal URL modul / customdata (bentuk LUT nyata).
describe('classifyNotification', () => {
  it('classifies by module URL path', async () => {
    const { classifyNotification } = await import('../lib/notificationsFeed')
    expect(classifyNotification('https://moodle.lut.fi/mod/forum/discuss.php?d=1', null)).toBe('forum')
    expect(classifyNotification('https://moodle.lut.fi/mod/assign/view.php?id=2', null)).toBe('submission')
    expect(classifyNotification('https://moodle.lut.fi/mod/quiz/view.php?id=3', null)).toBe('quiz')
    expect(classifyNotification('https://moodle.lut.fi/my/', null)).toBe('system')
    expect(classifyNotification(undefined, null)).toBe('system')
  })

  it('classifies by customdata keys when URL is absent', async () => {
    const { classifyNotification } = await import('../lib/notificationsFeed')
    expect(classifyNotification(undefined, { discussionid: '1' })).toBe('forum')
    expect(classifyNotification(undefined, { assignmentid: 2 })).toBe('submission')
    expect(classifyNotification(undefined, { quizid: '3' })).toBe('quiz')
  })

  it('parses kind into notifications from raw payload', async () => {
    const { parseNotification } = await import('../lib/notificationsFeed')
    const n = parseNotification({
      id: 1,
      subject: 'Quiz opens',
      contexturl: 'https://moodle.lut.fi/mod/quiz/view.php?id=9',
      customdata: JSON.stringify({ quizid: '95116' }),
    })
    expect(n?.kind).toBe('quiz')
  })
})

describe('submission receipts (kind receipt)', () => {
  it('classifies "Submission receipt (…)" subjects as receipt, not submission', async () => {
    const { classifyNotification } = await import('../lib/notificationsFeed')
    expect(
      classifyNotification('https://moodle.lut.fi/mod/assign/view.php?id=2', null, 'Submission receipt (Advanced Cybersecurity)'),
    ).toBe('receipt')
    expect(classifyNotification(undefined, { assignmentid: 2 }, 'Submission receipt (Quiz)')).toBe('receipt')
  })

  it('keeps real assign reminders as submission', async () => {
    const { classifyNotification } = await import('../lib/notificationsFeed')
    expect(classifyNotification('https://moodle.lut.fi/mod/assign/view.php?id=2', null, 'Overdue: Assignment 2')).toBe('submission')
    expect(classifyNotification('https://moodle.lut.fi/mod/assign/view.php?id=2', null, 'Due on Wednesday: Assignment 2')).toBe('submission')
    expect(classifyNotification('https://moodle.lut.fi/mod/assign/view.php?id=2', null, undefined)).toBe('submission')
  })

  it('classifies the real LUT receipt wording ("You have submitted …") as receipt', async () => {
    const { classifyNotification } = await import('../lib/notificationsFeed')
    expect(
      classifyNotification('https://moodle.lut.fi/mod/assign/view.php?id=2125813', null, 'You have submitted your assignment submission for KOTITEHTÄVÄ 2: TEKSTI 1, sanasto (vocabulary)'),
    ).toBe('receipt')
  })

  it('parses receipts from the raw payload via subject', async () => {
    const { parseNotification } = await import('../lib/notificationsFeed')
    const n = parseNotification({
      id: 7,
      subject: 'Submission receipt (KOTITEHTÄVÄ 1)',
      contexturl: 'https://moodle.lut.fi/mod/assign/view.php?id=42',
    })
    expect(n?.kind).toBe('receipt')
  })

  it('countUnread excludes hidden receipts so the nav badge matches what is visible', async () => {
    const { countUnread } = await import('../lib/notificationsFeed')
    const mk = (kind: MoodleNotification['kind'], read: boolean): MoodleNotification => ({ id: kind, subject: 'x', body: '', read, kind })
    expect(countUnread([mk('receipt', false), mk('receipt', false), mk('forum', false)])).toBe(1)
    expect(countUnread([mk('receipt', false)])).toBe(0)
  })
})

describe('unreadByKind', () => {
  const mk = (kind: MoodleNotification['kind'], read: boolean): MoodleNotification => ({ id: Math.random().toString(), subject: 'x', body: '', read, kind })

  it('counts unread per category including receipts', async () => {
    const { unreadByKind } = await import('../lib/notificationsFeed')
    const out = unreadByKind([mk('forum', false), mk('forum', false), mk('forum', true), mk('submission', false), mk('receipt', false), mk('quiz', true)])
    expect(out).toEqual({ forum: 2, submission: 1, quiz: 0, receipt: 1, system: 0 })
  })

  it('returns all zeros for null and empty lists', async () => {
    const { unreadByKind } = await import('../lib/notificationsFeed')
    expect(unreadByKind(null)).toEqual({ forum: 0, submission: 0, quiz: 0, receipt: 0, system: 0 })
    expect(unreadByKind([])).toEqual({ forum: 0, submission: 0, quiz: 0, receipt: 0, system: 0 })
  })
})

describe('notificationCourses (per-course grouping)', () => {
  const mk = (id: string, courseid: number | undefined, read: boolean): MoodleNotification => ({
    id, subject: id, body: '', read, kind: 'forum', courseid,
  })

  it('groups by courseid with unread-first stable ordering', async () => {
    const { notificationCourses } = await import('../lib/notificationsFeed')
    const out = notificationCourses([
      mk('a', 111, true), mk('b', 111, false),
      mk('c', 222, false), mk('d', 222, false), mk('e', 222, true),
      mk('no-course', undefined, false),
    ])
    expect(out).toEqual([
      { courseid: 222, count: 3, unread: 2 },
      { courseid: 111, count: 2, unread: 1 },
    ])
  })

  it('returns [] for null/empty and for notifications without courseid', async () => {
    const { notificationCourses } = await import('../lib/notificationsFeed')
    expect(notificationCourses(null)).toEqual([])
    expect(notificationCourses([mk('x', undefined, false)])).toEqual([])
  })
})
