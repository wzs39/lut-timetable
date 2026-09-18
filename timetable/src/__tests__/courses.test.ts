import { describe, expect, it } from 'vitest'
import {
  matchCourseCode,
  parseEnrolledCourses,
  type EnrolledCourse,
} from '../lib/courses'
import type { Lesson } from '../types'

const lessons: Lesson[] = [
  {
    id: 'l1',
    source: 'sisu',
    title: 'Software Engineering',
    code: 'CT60A4050',
    start: '2026-09-14T08:00:00.000Z',
    end: '2026-09-14T10:00:00.000Z',
  },
  {
    id: 'l2',
    source: 'sisu',
    title: 'Fundamentals of Programming',
    code: 'CT60A0250',
    start: '2026-09-14T12:00:00.000Z',
    end: '2026-09-14T14:00:00.000Z',
  },
]

const enrolled: EnrolledCourse[] = [
  { courseid: 101, shortname: 'CT60A4050', fullname: 'Software Engineering' },
  { courseid: 202, shortname: 'CT30A3232', fullname: 'Databases' }, // not in timetable
]

describe('parseEnrolledCourses', () => {
  it('keeps id + shortname + fullname, skipping malformed rows', () => {
    const out = parseEnrolledCourses([
      { id: 101, shortname: 'CT60A4050', fullname: 'Software Engineering' },
      { id: 'x', shortname: 'bad' },
      { shortname: 'no-id' },
      { id: 202, fullname: 'Only Fullname' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ courseid: 101, shortname: 'CT60A4050' })
    expect(out[1].shortname).toBe('Only Fullname') // falls back to fullname
  })

  it('returns [] for non-array responses', () => {
    expect(parseEnrolledCourses(null)).toEqual([])
    expect(parseEnrolledCourses({})).toEqual([])
  })
})

describe('matchCourseCode priority chain', () => {
  it('priority 1 — authoritative shortname matches timetable code even when the label is messy', () => {
    // "CT60A4050 SWE1 (2026)" contains the official shortname; title-guess would fail
    expect(matchCourseCode('CT60A4050 SWE1 (2026)', lessons, enrolled)).toBe('CT60A4050')
    // exact shortname
    expect(matchCourseCode('CT60A4050', lessons, enrolled)).toBe('CT60A4050')
  })

  it('priority 1 — official fullname match via enrol anchor', () => {
    // Label is the fullname from Moodle; enrolled list anchors it to the code
    expect(matchCourseCode('Databases', lessons, enrolled)).toBeUndefined() // course not in timetable
    expect(matchCourseCode('Software Engineering', lessons, enrolled)).toBe('CT60A4050')
  })

  it('priority 2 — code-regex inside the name, validated against the timetable', () => {
    // No enrol list given → falls to regex; code exists in timetable
    expect(matchCourseCode('CT60A0250 Exercise 1', lessons, null)).toBe('CT60A0250')
    // Code-shaped but NOT in timetable → must not invent a match
    expect(matchCourseCode('XX99X999 made-up', lessons, null)).toBeUndefined()
  })

  it('priority 3 — title containment fallback still works as last resort', () => {
    expect(matchCourseCode('software engineering', lessons, null)).toBe('CT60A4050')
    expect(matchCourseCode('Unrelated Course', lessons, null)).toBeUndefined()
  })

  it('is symmetric with the legacy signature (no enrol list) — moodle.test.ts cases hold', () => {
    expect(matchCourseCode(undefined, lessons, null)).toBeUndefined()
    expect(matchCourseCode('   ', lessons, null)).toBeUndefined()
  })
})

// Nama manusiawi dari fullname LUT.
describe('extractCourseTitle', () => {
  it('extracts the title between code and " - " separator', async () => {
    const { extractCourseTitle } = await import('../lib/courses')
    expect(extractCourseTitle('BM20A9200 Mathematics A - Contact teaching, Lahti 31.8.2026-11.12.2026')).toBe('Mathematics A')
    expect(extractCourseTitle('KE00BX35 English Pronunciation - Online teaching non-stop, KE00BX35-3018 31.8.2026-16.5.2027')).toBe('English Pronunciation')
  })

  it('decodes entities and handles missing title', async () => {
    const { extractCourseTitle } = await import('../lib/courses')
    expect(extractCourseTitle('KE00DA03 English for the Hebei University of Technology - Contact teaching (LUT) Lahti, P1&amp;2 KE00DA03-3015 31.8.2026-13.12.2026')).toBe('English for the Hebei University of Technology')
    expect(extractCourseTitle(undefined)).toBeUndefined()
  })
})
