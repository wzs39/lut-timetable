import { beforeEach, describe, expect, it } from 'vitest'
import {
  assignmentFromEvent,
  matchCourseCode,
  mergeMoodleAssignments,
  moodleEventUrl,
  normalizeMoodleUrl,
  parseMoodleAssignments,
} from '../lib/moodle'
import { buildIcs } from '../lib/ics'
import type { Lesson } from '../types'
import type { Task } from '../lib/tasks'

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
} as Storage

beforeEach(() => store.clear())

const lessons: Lesson[] = [
  {
    id: 'l1', source: 'sisu', title: 'Software Engineering', code: 'CT60A4050',
    start: '2026-09-01T07:00:00.000Z', end: '2026-09-01T09:00:00.000Z',
  },
]

describe('normalizeMoodleUrl', () => {
  it('accepts an export.php URL with userid + authtoken', () => {
    const url =
      'https://moodle.lut.fi/calendar/export.php?preset_what=all&preset_time=recentupcoming&userid=12345&authtoken=abc123def' // placeholder sintetis
    expect(normalizeMoodleUrl(url)).toBe(url)
  })

  it('accepts the export_execute.php subscription URL with custom preset', () => {
    const url =
      'https://moodle.lut.fi/calendar/export_execute.php?userid=1234567&authtoken=SYNTHETIC-NOT-A-REAL-TOKEN&preset_what=all&preset_time=custom' // placeholder sintetis — bukan token Moodle asli
    expect(normalizeMoodleUrl(url)).toBe(url)
  })

  it('accepts a direct .ics URL on moodle.lut.fi', () => {
    const url = 'https://moodle.lut.fi/calendar/export_execute.php.ics?userid=1&authtoken=x'
    expect(normalizeMoodleUrl(url)).toBe(url)
  })

  it('rejects other hosts and pages without a token', () => {
    expect(normalizeMoodleUrl('https://moodle.example.com/my/')).toBeNull()
    expect(normalizeMoodleUrl('https://moodle.lut.fi/my/')).toBeNull()
    expect(
      normalizeMoodleUrl('https://moodle.lut.fi/calendar/export.php?userid=1'),
    ).toBeNull()
    expect(normalizeMoodleUrl('not a url')).toBeNull()
  })
})

describe('assignmentFromEvent', () => {
  it('derives the event page URL from a Moodle UID when the feed has no URL property', () => {
    const a = assignmentFromEvent({
      uid: '4666790@moodle.lut.fi',
      summary: 'Attendance',
      categories: 'CT60A4050 Blended teaching, Lahti 31.8.2026-11.12.2026',
      start: new Date('2026-09-16T13:00:00.000Z'),
      end: new Date('2026-09-16T13:15:00.000Z'),
    })
    expect(a!.url).toBe('https://moodle.lut.fi/calendar/view.php?event=4666790')
  })

  it('prefers the feed URL property over the UID-derived one', () => {
    const a = assignmentFromEvent({
      uid: '4666790@moodle.lut.fi',
      summary: 'Essay due',
      url: 'https://moodle.lut.fi/mod/assign/view.php?id=99',
      start: new Date('2026-09-16T13:00:00.000Z'),
      end: new Date('2026-09-16T13:15:00.000Z'),
    })
    expect(a!.url).toBe('https://moodle.lut.fi/mod/assign/view.php?id=99')
  })

  it('moodleEventUrl rejects foreign UID shapes', () => {
    expect(moodleEventUrl('assignment-42-lut')).toBeUndefined()
    expect(moodleEventUrl('4666790@other.host')).toBeUndefined()
    expect(moodleEventUrl('')).toBeUndefined()
  })

  it('extracts course from CATEGORIES and keeps the description as note', () => {
    const a = assignmentFromEvent({
      uid: 'assignment-42-lut',
      summary: 'Individual Home Assignment 1 due',
      description: 'Software Engineering\nSubmit on Moodle before 16:00',
      categories: 'Software Engineering, 2026 Autumn',
      url: 'https://moodle.lut.fi/mod/assign/view.php?id=42',
      start: new Date('2026-09-16T13:00:00.000Z'),
      end: new Date('2026-09-16T13:15:00.000Z'),
    })
    expect(a).not.toBeNull()
    expect(a!.uid).toBe('assignment-42-lut')
    expect(a!.course).toBe('Software Engineering')
    expect(a!.note).toBe('Submit on Moodle before 16:00')
    expect(a!.dueAt).toBe('2026-09-16T13:00:00.000Z')
    expect(a!.startAt).toBeUndefined() // short event = pure deadline
    expect(a!.url).toContain('mod/assign')
  })

  it('treats a long event span as open→due', () => {
    const a = assignmentFromEvent({
      uid: 'u-span',
      summary: 'Group project submission',
      start: new Date('2026-09-10T08:00:00.000Z'),
      end: new Date('2026-09-16T16:00:00.000Z'),
    })
    expect(a!.startAt).toBe('2026-09-10T08:00:00.000Z')
    expect(a!.dueAt).toBe('2026-09-16T16:00:00.000Z')
  })

  it('collapses a LUT CATEGORIES string to the bare course code (online courses)', () => {
    // Real-world shape: online courses never match the timetable, so this
    // short label is what the user sees on every task card.
    const a = assignmentFromEvent({
      uid: 'u-online',
      summary: 'Attendance',
      categories: 'KE00DA03 Contact teaching (LUT) Lahti, P1&2 KE00DA03-3015',
      start: new Date('2026-09-17T11:00:00.000Z'),
      end: new Date('2026-09-17T13:00:00.000Z'),
    })
    expect(a!.course).toBe('KE00DA03')
    // Span event: the session time is preserved as startAt.
    expect(a!.startAt).toBe('2026-09-17T11:00:00.000Z')
    expect(a!.dueAt).toBe('2026-09-17T13:00:00.000Z')
  })

  it('keeps non-code course names intact', () => {
    const a = assignmentFromEvent({
      uid: 'u2',
      summary: 'Essay due',
      categories: 'Climate.now course, 2026',
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T10:15:00.000Z'),
    })
    // "Climate.now" matches the code regex partially — the guard requires
    // the label to START with the code, so the full name survives.
    expect(a!.course).toBe('Climate.now course')
  })

  it('falls back to the first description line for the course', () => {
    const a = assignmentFromEvent({
      uid: 'u1',
      summary: 'Quiz 1',
      description: 'Mathematics A',
      start: new Date('2026-09-20T10:00:00.000Z'),
      end: new Date('2026-09-20T10:15:00.000Z'),
    })
    expect(a!.course).toBe('Mathematics A')
    expect(a!.note).toBeUndefined()
  })

  it('returns null without uid or summary', () => {
    const far = new Date('2026-09-21T00:00:00.000Z')
    expect(assignmentFromEvent({ summary: 'x', start: far, end: far })).toBeNull()
    expect(assignmentFromEvent({ uid: 'u', start: far, end: far })).toBeNull()
  })
})

describe('matchCourseCode', () => {
  it('maps a Moodle course name to a timetable course code', () => {
    expect(matchCourseCode('Software Engineering', lessons)).toBe('CT60A4050')
  })

  it('finds a LUT code embedded in the Moodle name', () => {
    expect(matchCourseCode('CT60A4050 SWE1', lessons)).toBe('CT60A4050')
  })

  it('returns undefined for unknown courses', () => {
    expect(matchCourseCode('Unrelated Course', lessons)).toBeUndefined()
    expect(matchCourseCode(undefined, lessons)).toBeUndefined()
  })
})

describe('mergeMoodleAssignments', () => {
  const task = (patch: Partial<Task>): Task => ({
    id: patch.id ?? 'm1',
    title: patch.title ?? 'T',
    course: patch.course,
    dueAt: patch.dueAt,
    note: patch.note,
    url: patch.url,
    completed: patch.completed ?? false,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  })

  const assignment = (patch: Record<string, unknown> = {}) => ({
    uid: 'assignment-42-lut',
    title: 'Individual Home Assignment 1 due',
    course: 'Software Engineering',
    dueAt: '2026-09-16T13:00:00.000Z',
    ...patch,
  })

  it('adds assignments as moodle-prefixed tasks', () => {
    const r = mergeMoodleAssignments([], [assignment()], lessons)
    expect(r.added).toBe(1)
    expect(r.tasks[0].id).toBe('moodle:assignment-42-lut')
    expect(r.tasks[0].course).toBe('CT60A4050') // matched from timetable
  })

  it('updates in place on re-sync without duplicating', () => {
    const first = mergeMoodleAssignments([], [assignment()], lessons)
    const changed = [assignment({ title: 'IHA 1 (extended)', dueAt: '2026-09-18T13:00:00.000Z' })]
    const second = mergeMoodleAssignments(first.tasks, changed, lessons)
    expect(second.tasks).toHaveLength(1)
    expect(second.tasks[0].title).toBe('IHA 1 (extended)')
    expect(second.tasks[0].dueAt).toBe('2026-09-18T13:00:00.000Z')
    expect(second.added).toBe(0)
    expect(second.updated).toBe(1)
  })

  it('preserves completion status across re-syncs', () => {
    const first = mergeMoodleAssignments([], [assignment()], lessons)
    const completed = first.tasks.map((t) => ({ ...t, completed: true }))
    const second = mergeMoodleAssignments(completed, [assignment()], lessons)
    expect(second.tasks[0].completed).toBe(true)
  })

  it('drops Moodle tasks that vanished from the feed, keeps manual ones', () => {
    const manual = task({ id: 'manual-1', title: 'Buy calculator' })
    const feed = mergeMoodleAssignments([manual], [assignment()], lessons)
    expect(feed.tasks.map((t) => t.id)).toContain('manual-1')
    const empty = mergeMoodleAssignments(feed.tasks, [], lessons)
    expect(empty.tasks.map((t) => t.id)).toEqual(['manual-1'])
  })

  it('falls back to the raw Moodle course name when nothing matches', () => {
    const r = mergeMoodleAssignments(
      [],
      [assignment({ course: 'Unrelated Moodle Course' })],
      lessons,
    )
    expect(r.tasks[0].course).toBe('Unrelated Moodle Course')
  })

  it('shortens an unmatched LUT long shortname to its leading course code', () => {
    // 网课：不在课表里，shortname 是 LUT 长形态 → 应显示短代码（与 timeline 路径一致）
    const r = mergeMoodleAssignments(
      [],
      [assignment({ course: 'BH60A7201 Blended teaching 31.8.2026-30.7.2027' })],
      lessons,
    )
    expect(r.tasks[0].course).toBe('BH60A7201')
  })

  it('keeps timetable-matched code behaviour intact', () => {
    const r = mergeMoodleAssignments([], [assignment()], lessons)
    expect(r.tasks[0].course).toBe('CT60A4050')
  })
})

describe('parseMoodleAssignments (round-trip via ICS)', () => {
  it('parses ICS events into assignments (uid falls back to the export UID)', () => {
    const ics = buildIcs([
      {
        id: 'x', source: 'manual', title: 'Quiz 1',
        start: '2026-09-20T10:00:00.000Z', end: '2026-09-20T11:00:00.000Z',
      },
    ])
    const out = parseMoodleAssignments(ics)
    expect(out).toHaveLength(1)
    expect(out[0].uid).toBe('x@lut-timetable')
    expect(out[0].title).toBe('Quiz 1')
  })

  it('skips events without a summary', () => {
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
      'UID:empty-1', 'DTSTART:20260920T100000Z', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    expect(parseMoodleAssignments(ics)).toHaveLength(0)
  })
})

