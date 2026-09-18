import { beforeEach, describe, expect, it } from 'vitest'
import {
  flattenDescription,
  mergeCompletion,
  parseCompletionStatus,
  parseCourseContents,
} from '../lib/contents'
import { markRead, parseNotification, parseNotifications, loadReadIds } from '../lib/notificationsFeed'

// storage.ts 读写 window.localStorage — 测试需先垫上
const store = new Map<string, string>()
globalThis.localStorage = {
  length: 0,
  key: (_i: number) => null,
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, String(value)),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
}

beforeEach(() => store.clear())

describe('parseCourseContents', () => {
  it('keeps visible sections/modules and flattens array descriptions', () => {
    const res = [
      {
        id: 1,
        name: 'Week 1',
        visible: 1,
        modules: [
          {
            id: 11,
            name: 'Lecture slides',
            modname: 'resource',
            url: 'https://moodle.lut.fi/mod/resource/view.php?id=11',
            visible: 1,
            description: [{ name: 'Intro', value: '<p>Hello <b>world</b></p>' }],
          },
          { id: 12, name: 'Hidden quiz', modname: 'quiz', visible: 0 },
        ],
      },
      { id: 2, name: 'Hidden section', visible: 0, modules: [{ id: 13, name: 'x', modname: 'url' }] },
    ]
    const sections = parseCourseContents(res)
    expect(sections).toHaveLength(1)
    expect(sections[0].modules).toHaveLength(1)
    expect(sections[0].modules[0]).toMatchObject({ id: 11, name: 'Lecture slides', modname: 'resource' })
    expect(sections[0].modules[0].description).toBe('Hello world')
  })

  it('drops malformed entries', () => {
    expect(parseCourseContents([{ id: 1 }, { name: 'x' }, 'nope'])).toEqual([])
    expect(parseCourseContents(null)).toEqual([])
  })
})

describe('completion', () => {
  it('maps cmid → state', () => {
    const map = parseCompletionStatus({ statuslist: [{ cmid: 11, state: 1 }, { cmid: 12, state: 2 }, { cmid: 13 }] })
    expect(map.get(11)).toBe(1)
    expect(map.get(12)).toBe(2)
    expect(map.has(13)).toBe(false)
    expect(parseCompletionStatus(null).size).toBe(0)
  })

  it('merges completion into content tree without mutating input', () => {
    const sections = parseCourseContents([
      { id: 1, name: 'S', visible: 1, modules: [{ id: 11, name: 'A', modname: 'quiz', visible: 1 }] },
    ])
    const merged = mergeCompletion(sections, new Map([[11, 1]]))
    expect(merged[0].modules[0].completion).toBe(1)
    expect(sections[0].modules[0].completion).toBeUndefined()
  })
})

describe('flattenDescription', () => {
  it('handles string and array forms', () => {
    expect(flattenDescription('<p>Line</p>')).toBe('Line')
    expect(flattenDescription([{ value: 'a' }, { value: '<i>b</i>' }])).toBe('a b')
    expect(flattenDescription(undefined)).toBeUndefined()
    expect(flattenDescription('<script/>')).toBeUndefined()
  })
})

describe('notifications', () => {
  const raw = {
    notifications: [
      {
        id: 1,
        subject: 'Feedback released',
        fullmessagehtml: '<p>Your IHA1 feedback is ready.</p>',
        contexturl: 'https://moodle.lut.fi/mod/assign/view.php?id=9&amp;d=1',
        timecreated: 1758000000,
        read: 0,
        userfromfullname: 'Teacher T',
        courseid: 55,
      },
      { id: 2, subject: 'No url one', timecreated: 1757000000, read: 1 },
      { id: null, subject: 'bad' },
    ],
  }

  it('parses and sorts newest first', () => {
    const list = parseNotifications(raw)
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe('ntf-1')
    expect(list[0].body).toBe('Your IHA1 feedback is ready.')
    expect(list[0].url).toBe('https://moodle.lut.fi/mod/assign/view.php?id=9&d=1')
    expect(list[0].read).toBe(false)
    expect(list[1].read).toBe(true)
  })

  it('read-state: local markRead overrides server unread; server read stays read', () => {
    const before = loadReadIds()
    const list = parseNotifications(raw, new Set(['ntf-1']))
    expect(list[0].read).toBe(true)
    // server read (ntf-2) tetap read tanpa readSet
    const plain = parseNotifications(raw)
    expect(plain[1].read).toBe(true)
    markRead('ntf-999')
    expect(loadReadIds().has('ntf-999')).toBe(true)
    expect(before.has('ntf-1')).toBe(false)
  })

  it('parseNotification returns null for invalid rows', () => {
    expect(parseNotification({ id: undefined, subject: 'x' })).toBeNull()
    expect(parseNotification({ id: 1, subject: '' })).toBeNull()
  })
})
