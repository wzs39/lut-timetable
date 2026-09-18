import { describe, expect, it } from 'vitest'
import { countUnread, type MoodleNotification } from '../lib/notificationsFeed'

function notif(id: string, read: boolean): MoodleNotification {
  return { id, subject: id, body: '', read }
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
