// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  saveIdentityFromEnrol,
  loadIdentities,
  loadIdentityIndex,
  CourseIdentityIndex,
  type CourseIdentity,
} from '../lib/courseIdentity'
import type { EnrolledCourse } from '../lib/courses'
import type { Lesson } from '../types'

const enrolled: EnrolledCourse[] = [
  { courseid: 29428, shortname: 'CT60A4050', fullname: 'CT60A4050 Fundamentals of Software Engineering - Blended teaching, Lahti 31.8.2026' },
  { courseid: 29999, shortname: 'XX00AA11 Online', fullname: 'XX00AA11 Online Course - web-only, no timetable' },
]

const lessons: Lesson[] = [
  {
    id: 'l1',
    source: 'sisu',
    title: 'Software Engineering',
    code: 'CT60A4050',
    start: '2026-09-14T08:00:00.000Z',
    end: '2026-09-14T10:00:00.000Z',
  },
]

beforeEach(() => {
  localStorage.clear()
})

describe('courseIdentity persistence', () => {
  it('writes one row per enrolled course, code only when the timetable matches', () => {
    const rows = saveIdentityFromEnrol(enrolled, lessons)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ courseid: 29428, code: 'CT60A4050' })
    expect(rows[1].code).toBeNull() // web-only course: no lesson with that code
    expect(loadIdentities()).toHaveLength(2)
  })

  it('survives quota errors: saveIdentityFromEnrol still returns rows', () => {
    const orig = Storage.prototype.setItem
    Storage.prototype.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError')
    }
    try {
      const rows = saveIdentityFromEnrol(enrolled, lessons)
      expect(rows).toHaveLength(2)
    } finally {
      Storage.prototype.setItem = orig
    }
  })
})

describe('CourseIdentityIndex lookups', () => {
  const index = new CourseIdentityIndex([
    { courseid: 29428, code: 'CT60A4050', shortname: 'CT60A4050', fullname: 'CT60A4050 Fundamentals of Software Engineering' },
    { courseid: 30001, code: null, shortname: 'XX00AA11 Online', fullname: 'XX00AA11 Online Course' },
  ])

  it('codeFor: Moodle courseid → timetable code (null when unmapped)', () => {
    expect(index.codeFor(29428)).toBe('CT60A4050')
    expect(index.codeFor(30001)).toBeNull()
    expect(index.codeFor(null)).toBeNull()
    expect(index.codeFor(undefined)).toBeNull()
    expect(index.codeFor(1)).toBeNull()
  })

  it('idForCode: normalized code → courseid', () => {
    expect(index.idForCode('ct60a4050')).toBe(29428)
    expect(index.idForCode('CT60A4050')).toBe(29428)
    expect(index.idForCode('NOPE123')).toBeNull()
    expect(index.idForCode(undefined)).toBeNull()
  })

  it('forName: exact shortname and substring names', () => {
    expect(index.forName('ct60a4050')?.courseid).toBe(29428)
    expect(index.forName('CT60A4050 Fundamentals of Software Engineering - Blended')?.courseid).toBe(29428)
    expect(index.forName('mystery course')).toBeNull()
    expect(index.forName('')).toBeNull()
    expect(index.forName(undefined)).toBeNull()
  })

  it('names: shortname/title per courseid', () => {
    expect(index.shortnameFor(30001)).toBe('XX00AA11 Online')
    expect(index.titleFor(30001)).toContain('Online Course')
    expect(index.shortnameFor(42)).toBeNull()
  })

  it('size reflects rows', () => {
    expect(index.size).toBe(2)
    expect(new CourseIdentityIndex([] as CourseIdentity[]).size).toBe(0)
  })
})

describe('loadIdentityIndex from storage', () => {
  it('round-trips through localStorage', () => {
    saveIdentityFromEnrol(enrolled, lessons)
    const idx = loadIdentityIndex()
    expect(idx.codeFor(29428)).toBe('CT60A4050')
    expect(idx.codeFor(29999)).toBeNull()
  })

  it('empty storage → empty index, no throw', () => {
    const idx = loadIdentityIndex()
    expect(idx.size).toBe(0)
    expect(idx.codeFor(1)).toBeNull()
  })
})
