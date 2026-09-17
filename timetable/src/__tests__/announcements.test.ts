import { describe, expect, it } from 'vitest'
import {
  htmlToExcerpt,
  mergeAnnouncementLists,
  parseDiscussions,
  type Announcement,
} from '../lib/announcements'

const NOW = Date.now()
const daysAgo = (n: number) => Math.floor((NOW - n * 24 * 3600 * 1000) / 1000)
const BASE = 'https://moodle.lut.fi/mod/forum/discuss.php?f=42'

function disc(p: { id: number; subject?: string; modified?: number; message?: string; user?: string }) {
  return {
    discussionid: p.id,
    subject: p.subject,
    modified: p.modified,
    message: p.message,
    userfullname: p.user,
  }
}

describe('htmlToExcerpt', () => {
  it('strips tags, decodes common entities, collapses whitespace', () => {
    expect(
      htmlToExcerpt('<p>Room&nbsp;change: <b>A123</b> → B234</p><p>Bring laptop.</p>'),
    ).toBe('Room change: A123 → B234 Bring laptop.')
  })

  it('truncates with ellipsis and returns undefined for empty input', () => {
    const truncated = htmlToExcerpt('x'.repeat(200))
    expect(truncated?.length).toBe(160)
    expect(htmlToExcerpt('')).toBeUndefined()
    expect(htmlToExcerpt(undefined)).toBeUndefined()
    expect(htmlToExcerpt('<div>   </div>')).toBeUndefined()
  })
})

describe('parseDiscussions', () => {
  it('maps fields and builds deep links', () => {
    const out = parseDiscussions(
      [disc({ id: 7, subject: 'Assignment deadline extended', modified: daysAgo(1), message: '<p>New due: Friday.</p>', user: 'Teacher T.' })],
      BASE,
      'CT60A4050',
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      id: 'forum-7',
      subject: 'Assignment deadline extended',
      course: 'CT60A4050',
      url: `${BASE}&d=7`,
      author: 'Teacher T.',
      excerpt: 'New due: Friday.',
    })
  })

  it('filters posts older than the 14-day window', () => {
    const out = parseDiscussions(
      [
        disc({ id: 1, subject: 'fresh', modified: daysAgo(2) }),
        disc({ id: 2, subject: 'old', modified: daysAgo(30) }),
      ],
      BASE,
      undefined,
    )
    expect(out.map((a) => a.id)).toEqual(['forum-1'])
  })

  it('returns [] for non-array responses', () => {
    expect(parseDiscussions(null, BASE, undefined)).toEqual([])
    expect(parseDiscussions({}, BASE, undefined)).toEqual([])
  })
})

describe('mergeAnnouncementLists', () => {
  it('dedupes by id, sorts newest first, caps at 20', () => {
    const a: Announcement = { id: 'forum-1', subject: 'A', postedAt: new Date(NOW - 3600e3).toISOString() }
    const b: Announcement = { id: 'forum-2', subject: 'B', postedAt: new Date(NOW - 60e3).toISOString() }
    const c: Announcement = { id: 'forum-3', subject: 'C', postedAt: new Date(NOW - 60e3).toISOString() }
    const merged = mergeAnnouncementLists([[a, b], [b, c]])
    expect(merged.map((x) => x.id)).toEqual(['forum-2', 'forum-3', 'forum-1'])
    const many: Announcement[] = Array.from({ length: 30 }, (_, i) => ({
      id: `forum-x${i}`,
      subject: `X${i}`,
      postedAt: new Date(NOW - i * 1000).toISOString(),
    }))
    expect(mergeAnnouncementLists([many])).toHaveLength(20)
  })
})
