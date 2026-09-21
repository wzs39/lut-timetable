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
  it('writes one row per enrolled course, code straight from the Moodle shortname', () => {
    const rows = saveIdentityFromEnrol(enrolled, lessons)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ courseid: 29428, code: 'CT60A4050' })
    // 课程码直接来自 shortname 开头 —— 不再要求课表里恰好有同码课程：
    // 无课表的 web-only 课程也拿到 code（旧实现为 null）。
    expect(rows[1]).toMatchObject({ courseid: 29999, code: 'XX00AA11' })
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
    expect(idx.codeFor(29999)).toBe('XX00AA11')
  })

  it('empty storage → empty index, no throw', () => {
    const idx = loadIdentityIndex()
    expect(idx.size).toBe(0)
    expect(idx.codeFor(1)).toBeNull()
  })
})

// 【修复锁定】LUT 真实 shortname 带后缀（"BM20A9200 Contact teaching, …"）——
// 旧实现用 normalizeCourseCode（只清洗纯代码）匹配 → 所有行 code=null，
// idForCode 永远空，LessonDetail 的 Moodle 直链全体失效。
describe('saveIdentityFromEnrol — real LUT shortname extraction', () => {
  it('extracts the code from suffixed shortnames and joins lesson codes', () => {
    localStorage.clear()
    const rows = saveIdentityFromEnrol(
      [
        { courseid: 30565, shortname: 'BM20A9200 Contact teaching, Lahti 31.8.2026-11.12.2026', fullname: 'BM20A9200 Mathematics A - Contact teaching, Lahti' },
        { courseid: 29428, shortname: 'LUT digital orientation 2026-2027', fullname: 'LUT digital orientation 2026-2027' },
      ],
      [{ id: 'l1', source: 'sisu', title: 'Math A', code: 'BM20A9200', start: '2026-09-14T08:00:00.000Z', end: '2026-09-14T10:00:00.000Z' }],
    )
    expect(rows.find((r) => r.courseid === 30565)?.code).toBe('BM20A9200')
    // 无可提取码的行（无码 shortname）保持 null
    expect(rows.find((r) => r.courseid === 29428)?.code).toBeNull()
    // idForCode 方向打通
    expect(loadIdentityIndex().idForCode('BM20A9200')).toBe(30565)
  })

  // 【TimeEdit → Moodle 对齐】TE 课（如 K200DJ96 Finnish 1）与 Moodle 课程共享
  // 同一课程码时，identity 表直接从 shortname 提取即可闭环：
  // 课表 lesson(code=K200DJ96) → idForCode → course/view.php?id=33295。
  // 不再要求课表里恰好有这门课（CT60A4500 等真实课程曾因此永远 null）。
  it('maps LAB/TimeEdit campus codes (K200DJ96) without needing timetable lessons', () => {
    localStorage.clear()
    const rows = saveIdentityFromEnrol(
      [
        { courseid: 33295, shortname: 'K200DJ96 Contact teaching Lahti P1, K200DJ96-3015', fullname: 'K200DJ96 Finnish 1 (LAB) - Contact teaching' },
        { courseid: 30366, shortname: 'CT60A4500 Blended teaching, Lahti 31.8.2026-20.12.2026', fullname: 'CT60A4500 Interactive Design - Blended teaching' },
      ],
      [], // 空课表：纯 enrol 侧也要有完整映射
    )
    expect(rows.find((r) => r.courseid === 33295)?.code).toBe('K200DJ96')
    expect(rows.find((r) => r.courseid === 30366)?.code).toBe('CT60A4500')
    const idx = loadIdentityIndex()
    expect(idx.idForCode('K200DJ96')).toBe(33295)
    // 带组号后缀的码（K200DJ96-3015）归一化后同样命中
    expect(idx.idForCode('K200DJ96-3015')).toBe(33295)
    expect(idx.idForCode('CT60A4500')).toBe(30366)
  })
})
