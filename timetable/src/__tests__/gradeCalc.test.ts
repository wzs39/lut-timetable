import { describe, expect, it } from 'vitest'
import {
  clamp,
  contributionOf,
  courseProjection,
  effectiveGrade,
  filterGrades,
  getFinalCourseGrade,
  gradedWeight,
  sortGrades,
  ungradedCount,
  weightedEstimate,
} from '../lib/gradeCalc'
import type { CourseGrades } from '../lib/grades'
import type { GradeItem } from '../lib/grades'

const item = (over: Partial<GradeItem>): GradeItem => ({
  name: 'item',
  grade: null,
  max: 100,
  classAvg: null,
  weight: null,
  ...over,
})

describe('weightedEstimate', () => {
  it('weights items proportionally', () => {
    const items = [
      item({ grade: 90, weight: 20 }),
      item({ grade: 80, weight: 80 }),
    ]
    // 90*0.2 + 80*0.8 = 82
    expect(weightedEstimate(items).value).toBeCloseTo(82, 5)
  })

  it('ignores ungraded items and renormalizes over covered weight', () => {
    const items = [
      item({ grade: 90, weight: 20 }),
      item({ grade: null, weight: 80 }),
    ]
    // only 20% covered -> 90
    const r = weightedEstimate(items)
    expect(r.value).toBeCloseTo(90, 5)
    expect(r.coveredWeight).toBeCloseTo(20, 5)
  })

  it('excludes weightless items from the divisor', () => {
    const items = [
      item({ grade: 60, weight: null }),
      item({ grade: 100, weight: 50 }),
    ]
    expect(weightedEstimate(items).value).toBeCloseTo(100, 5)
  })

  it('applies what-if overrides to ungraded and graded items', () => {
    const items = [
      item({ grade: 90, weight: 20 }),
      item({ grade: null, weight: 80 }),
    ]
    // expect the ungraded exam at 70: (90*20 + 70*80)/100 = 74
    expect(weightedEstimate(items, { 1: 70 }).value).toBeCloseTo(74, 5)
    // override the graded one too: (50*20 + 70*80)/100 = 66
    expect(weightedEstimate(items, { 0: 50, 1: 70 }).value).toBeCloseTo(66, 5)
  })

  it('clamps overrides into 0..100', () => {
    const items = [item({ grade: null, weight: 100 })]
    expect(weightedEstimate(items, { 0: 250 }).value).toBe(100)
    expect(weightedEstimate(items, { 0: -5 }).value).toBe(0)
  })

  it('returns null when nothing is computable', () => {
    expect(weightedEstimate([item({ grade: null, weight: 100 })]).value).toBeNull()
    expect(weightedEstimate([]).value).toBeNull()
  })
})

describe('helpers', () => {
  it('effectiveGrade prefers override, clamps, else falls back', () => {
    const it0 = item({ grade: 55 })
    expect(effectiveGrade(it0, undefined)).toBe(55)
    expect(effectiveGrade(it0, 70)).toBe(70)
    expect(effectiveGrade(item({ grade: null }), 130)).toBe(100)
  })

  it('ungradedCount and gradedWeight', () => {
    const items = [
      item({ grade: 90, weight: 20 }),
      item({ grade: null, weight: 80 }),
      item({ grade: null, weight: null }),
    ]
    expect(ungradedCount(items)).toBe(1)
    expect(gradedWeight(items)).toBeCloseTo(20, 5)
  })

  it('courseProjection summarises a course', () => {
    const c = {
      course: 'X',
      matched: false,
      average: null,
      items: [
        item({ grade: 90, weight: 20 }),
        item({ grade: null, weight: 80 }),
      ],
    }
    const p = courseProjection(c, { 1: 70 })
    // what-if: official tak ada → total berjalan = 20%·90 + 80%·70 = 74
    expect(p.current).toBeCloseTo(74, 5)
    expect(p.coveredAvg).toBeCloseTo(74, 5)
    expect(p.coveredWeight).toBe(100)
    expect(p.ungraded).toBe(1)
    expect(p.gradedWeight).toBeCloseTo(20, 5)
  })

  it('prefers the official Moodle total over the local running sum', () => {
    const c = {
      course: 'X',
      matched: false,
      average: null,
      officialTotal: 21.4,
      items: [
        item({ grade: 100, weight: 7.1 }),
        item({ grade: 100, weight: 7.1 }),
        item({ grade: null, weight: 85.8 }),
      ],
    }
    const p = courseProjection(c)
    expect(p.current).toBeCloseTo(21.4, 5) // angka resmi, bukan 14.2 hitungan lokal
    expect(p.coveredAvg).toBeCloseTo(100, 5)
  })

  it('what-if override switches the headline to the running total', () => {
    const c = {
      course: 'X',
      matched: false,
      average: null,
      officialTotal: 21.4,
      items: [
        item({ grade: 100, weight: 7.1 }),
        item({ grade: null, weight: 92.9 }),
      ],
    }
    // official diabaikan saat override: 7.1%·100 + 92.9%·60 = 62.84
    expect(courseProjection(c, { 1: 60 }).current).toBeCloseTo(62.84, 2)
  })

  it('weighted course with nothing graded and no official total shows — not 0', () => {
    const c = {
      course: 'X',
      matched: false,
      average: null,
      items: [item({ grade: null, weight: 100 })],
    }
    expect(courseProjection(c).current).toBeNull()
  })

  it('contributionOf = weight × grade / 100, live with overrides', () => {
    expect(contributionOf(item({ grade: 100, weight: 7.1 }))).toBeCloseTo(7.1, 5)
    expect(contributionOf(item({ grade: null, weight: 7.1 }), 50)).toBeCloseTo(3.55, 5)
    expect(contributionOf(item({ grade: null, weight: 7.1 }))).toBeNull()
    expect(contributionOf(item({ grade: 90, weight: null }))).toBeNull()
  })

  it('clamp', () => {
    expect(clamp(NaN)).toBe(0)
    expect(clamp(120)).toBe(100)
    expect(clamp(-3)).toBe(0)
    expect(clamp(55)).toBe(55)
  })
})

// LUT nyata: semua item tanpa bobot → proyeksi fallback rata-rata sederhana.
describe('courseProjection — no-weight fallback', () => {
  it('averages graded items when no weights exist', () => {
    const c = {
      course: 'X',
      matched: false,
      average: null,
      items: [
        item({ grade: 100, weight: null }),
        item({ grade: 50, weight: null }),
        item({ grade: null, weight: null }),
      ],
    }
    const p = courseProjection(c)
    expect(p.current).toBeCloseTo(75, 5)
    expect(p.coveredAvg).toBeNull()
    expect(p.coveredWeight).toBe(0)
  })

  it('honours what-if override in no-weight mode', () => {
    const c = {
      course: 'X',
      matched: false,
      average: null,
      items: [item({ grade: null, weight: null }), item({ grade: 80, weight: null })],
    }
    const p = courseProjection(c, { 0: 60 })
    expect(p.current).toBeCloseTo(70, 5)
  })

  it('returns null projection when nothing graded', () => {
    const c = { course: 'X', matched: false, average: null, items: [item({ grade: null, weight: null })] }
    expect(courseProjection(c).current).toBeNull()
  })
})

// sortGrades / filterGrades — daftar nilai
describe('sortGrades', () => {
  const mk = (course: string, average: number | null, matched = false, ungradedN = 0): CourseGrades => ({
    course,
    matched,
    average,
    courseId: undefined,
    items: Array.from({ length: ungradedN }, (_, i) => ({ name: `i${i}`, grade: null, max: 10, classAvg: null, weight: null })),
  })
  const list = [mk('CT60A0250', 93.5, true, 1), mk('BM20A9200', 21.4, true, 11), mk('KE00BX35', null, false, 4)]

  it('sorts by code by default', () => {
    expect(sortGrades(list, 'code').map((c) => c.course)).toEqual(['BM20A9200', 'CT60A0250', 'KE00BX35'])
  })

  it('sorts by grade desc/asc, nulls last', () => {
    expect(sortGrades(list, 'grade-desc').map((c) => c.course)).toEqual(['CT60A0250', 'BM20A9200', 'KE00BX35'])
    expect(sortGrades(list, 'grade-asc').map((c) => c.course)).toEqual(['BM20A9200', 'CT60A0250', 'KE00BX35'])
  })

  it('sorts by ungraded count descending', () => {
    expect(sortGrades(list, 'ungraded').map((c) => c.course)).toEqual(['BM20A9200', 'KE00BX35', 'CT60A0250'])
  })

  it('puts matched courses first', () => {
    expect(sortGrades(list, 'matched').map((c) => c.matched)).toEqual([true, true, false])
  })

  it('does not mutate the input', () => {
    const snapshot = [...list]
    sortGrades(list, 'grade-asc')
    expect(list).toEqual(snapshot)
  })
})

describe('filterGrades', () => {
  const mk = (course: string, title: string | undefined, matched: boolean): CourseGrades => ({
    course,
    courseTitle: title,
    matched,
    average: null,
    items: [],
  })
  const list = [
    mk('BM20A9200', 'Mathematics A', true),
    mk('KE00BX35', 'English Pronunciation', false),
  ]

  it('filters by keyword across code and title', () => {
    expect(filterGrades(list, { q: 'math' }).map((c) => c.course)).toEqual(['BM20A9200'])
    expect(filterGrades(list, { q: 'pronun' }).map((c) => c.course)).toEqual(['KE00BX35'])
    expect(filterGrades(list, { q: 'bm20' }).length).toBe(1)
  })

  it('filters by matched status', () => {
    expect(filterGrades(list, { only: 'matched' }).length).toBe(1)
    expect(filterGrades(list, { only: 'unmatched' })[0].course).toBe('KE00BX35')
    expect(filterGrades(list, {}).length).toBe(2)
  })

  it('combines keyword and status', () => {
    expect(filterGrades(list, { q: 'a', only: 'unmatched' }).length).toBe(1)
  })
})

// 【锁定】SATU rantai prioritas nilai akhir — parse & kartu memakai fungsi ini.
describe('getFinalCourseGrade — unified priority chain', () => {
  it('1. official total wins when no what-if override', () => {
    const items = [item({ grade: 100, weight: 7.1 }), item({ grade: null, weight: 92.9 })]
    expect(getFinalCourseGrade(items, 21.4)).toBe(21.4)
  })

  it('2. override skips the (stale) official and uses the running total', () => {
    const items = [item({ grade: 100, weight: 7.1 }), item({ grade: null, weight: 92.9 })]
    // 7.1%·100 + 92.9%·60 = 62.84
    expect(getFinalCourseGrade(items, 21.4, { 1: 60 })).toBeCloseTo(62.84, 2)
  })

  it('3. weighted course, nothing graded → null (Moodle "-"), not simple average', () => {
    const items = [item({ grade: null, weight: 50 }), item({ grade: null, weight: 50 })]
    expect(getFinalCourseGrade(items, null)).toBeNull()
  })

  it('4. no-weight course falls back to simple average of graded items', () => {
    const items = [item({ grade: 100, weight: null }), item({ grade: 50, weight: null })]
    expect(getFinalCourseGrade(items, null)).toBe(75)
  })

  it('5. no-weight course WITH official prefers official (unified semantics)', () => {
    const items = [item({ grade: 100, weight: null }), item({ grade: 50, weight: null })]
    // dulu rantai parse/proyeksi berbeda di sini; sekarang resmi selalu menang
    expect(getFinalCourseGrade(items, 60)).toBe(60)
  })

  it('6. nothing at all → null', () => {
    expect(getFinalCourseGrade([item({ grade: null, weight: null })], null)).toBeNull()
  })
})
