import { describe, expect, it } from 'vitest'
import {
  parseGradeItems,
  gradesErrorKind,
  type CourseGrades,
} from '../lib/grades'
import type { Lesson } from '../types'

// Synthetic fixtures shaped like Moodle's gradereport_user_get_grade_items
// response — no real tokens, ids or personal data.
const lessons: Lesson[] = [
  {
    id: 'l1',
    source: 'sisu',
    title: 'Fundamentals of Programming',
    code: 'CT60A0250',
    start: '2026-09-14T08:00:00.000Z',
    end: '2026-09-14T10:00:00.000Z',
  },
]
void lessons

function wsResponse() {
  return {
    usergrades: [
      {
        courseid: 101,
        usergrade: { grade: 0.845, displaytext: 'CT60A0250 Fundamentals of Programming' },
        gradeitems: [
          {
            itemname: 'Exercise 1',
            itemtype: 'manual',
            graderaw: 9,
            grademax: 10,
            gradeaverage: 7.5,
            weightraw: 0.2,
            feedback: 'Good start',
          },
          {
            itemname: 'Exam',
            itemtype: 'mod',
            graderaw: 42,
            grademax: 50,
            gradeaverage: 35,
            weightraw: 0.8,
          },
        ],
      },
      {
        courseid: 202,
        usergrade: { grade: 1 },
        gradeitems: [{ itemname: 'Quiz 1', itemtype: 'mod', graderaw: 5, grademax: 5 }],
      },
    ],
  }
}

describe('parseGradeItems', () => {
  it('maps items to percent with class average and weight', () => {
    const [c] = parseGradeItems(wsResponse())
    expect(c.items).toHaveLength(2)
    expect(c.items[0].grade).toBe(90)
    expect(c.items[0].classAvg).toBe(75)
    expect(c.items[0].weight).toBe(20)
    expect(c.items[0].feedback).toBe('Good start')
    expect(c.items[1].grade).toBe(84)
    expect(c.items[1].feedback).toBeUndefined()
  })

  it('keeps courseId and reads the overall ratio as a percent', () => {
    const [c1, c2] = parseGradeItems(wsResponse())
    expect(c1.courseId).toBe(101)
    expect(c1.average).toBe(84.5)
    expect(c2.average).toBe(100)
  })

  it('returns [] for malformed/empty responses', () => {
    expect(parseGradeItems(null)).toEqual([])
    expect(parseGradeItems({})).toEqual([])
    expect(parseGradeItems({ usergrades: [] })).toEqual([])
    expect(
      parseGradeItems({ usergrades: [{ courseid: 1, gradeitems: [] }] }),
    ).toEqual([])
  })

  it('handles string graders and missing max as null', () => {
    const [c] = parseGradeItems({
      usergrades: [
        {
          courseid: 1,
          gradeitems: [
            { itemname: 'X', graderaw: '4', grademax: '8' },
            { itemname: 'Y', graderaw: 3, grademax: 0 },
          ],
        },
      ],
    })
    expect(c.items[0].grade).toBe(50)
    expect(c.items[1].grade).toBeNull()
  })
})

describe('gradesErrorKind', () => {
  it('recognizes typed errors and rejects plain values', () => {
    const bad = { kind: 'badToken', detail: 'Invalid token' } as const
    expect(gradesErrorKind(bad)?.kind).toBe('badToken')
    expect(gradesErrorKind(new Error('boom'))).toBeNull()
    expect(gradesErrorKind('boom')).toBeNull()
    expect(gradesErrorKind(null)).toBeNull()
  })
})

describe('fetchGrades course matching (via parse + matchCode path)', () => {
  it('course matching is exercised in fetchGrades; here we pin parse shape', () => {
    const parsed: CourseGrades[] = parseGradeItems(wsResponse())
    expect(parsed.every((c) => c.courseId != null)).toBe(true)
    expect(parsed.every((c) => c.matched === false)).toBe(true)
  })
})

// LUT nyata (v0.2.16+): usergrades TIDAK punya usergrade/displaytext,
// item tanpa bobot. Rata-rata harus fallback ke rata-rata item bernilai.
describe('parseGradeItems — LUT real payload shape', () => {
  const realShape = {
    usergrades: [
      {
        courseid: 30361,
        gradeitems: [
          { itemname: 'Quiz: Honor code', graderaw: 5, grademax: 5, itemtype: 'mod' },
          { itemname: 'MOOC certificate', graderaw: null, grademax: 2, itemtype: 'mod' },
        ],
      },
    ],
  }

  it('computes overall average from graded items when usergrade is absent', () => {
    const [c] = parseGradeItems(realShape)
    expect(c.average).toBe(100) // hanya Quiz yang bernilai (5/5)
    expect(c.items[0].grade).toBe(100)
    expect(c.items[1].grade).toBeNull() // belum dinilai
    expect(c.items[0].weight).toBeNull() // LUT tidak mengirim bobot
  })

  it('keeps average null when nothing is graded', () => {
    const [c] = parseGradeItems({
      usergrades: [
        { courseid: 1, gradeitems: [{ itemname: 'X', graderaw: null, grademax: 8 }] },
      ],
    })
    expect(c.average).toBeNull()
  })
})

// Bentuk LUT nyata: weightraw rasio 0–1 + baris total 'course' + tanpa usergrade.
describe('parseGradeItems — LUT weightraw + course total row', () => {
  const lut = {
    usergrades: [
      {
        courseid: 30565,
        gradeitems: [
          { itemname: 'Week 1 homework', itemtype: 'manual', graderaw: 8, grademax: 8, weightraw: 0.07143 },
          { itemname: 'Week 2 homework', itemtype: 'manual', graderaw: 8, grademax: 8, weightraw: 0.07143 },
          { itemname: 'Week 4 homework', itemtype: 'manual', graderaw: null, grademax: 8, weightraw: 0.07143 },
          { itemtype: 'course', graderaw: 16, grademax: 24, weightraw: 0.21429 },
        ],
      },
    ],
  }

  it('reads weight from weightraw ratio (0.07143 → 7.1%)', () => {
    const [c] = parseGradeItems(lut)
    expect(c.items[0].weight).toBeCloseTo(7.1, 1)
  })

  it('uses the official course-total row as the current grade', () => {
    const [c] = parseGradeItems(lut)
    expect(c.average).toBeCloseTo(66.7, 1) // 16/24 — belum dinilai dihitung 0
    // Baris total TIDAK ikut sebagai item penilaian.
    expect(c.items.map((i) => i.name)).toEqual(['Week 1 homework', 'Week 2 homework', 'Week 4 homework'])
  })

  it('excludes the course row from weighted estimate so projection stays what-if', () => {
    const [c] = parseGradeItems(lut)
    // Dua item dinilai penuh dari tiga berbobot → proyeksi 66.7 (2×7.14/3×7.14…)
    expect(c.items).toHaveLength(3)
  })
})

// Baris 'category' (subtotal kategori, itemname null) bukan item penilaian.
// officialTotal dipisah dari `average` agar UI memprioritaskan angka resmi.
describe('parseGradeItems — category rows, officialTotal & weighted fallback', () => {
  const nested = {
    usergrades: [
      {
        courseid: 32632,
        gradeitems: [
          { itemname: 'Baseline video', itemtype: 'mod', graderaw: null, grademax: 2, weightraw: 1 },
          { itemname: null, itemtype: 'category', graderaw: null, grademax: 5, weightraw: null },
          { itemname: null, itemtype: 'category', graderaw: null, grademax: 5, weightraw: 0.25 },
          { itemname: 'Vocabulary', itemtype: 'mod', graderaw: 5, grademax: 5, weightraw: null },
          { itemname: null, itemtype: 'course', graderaw: null, grademax: 5 },
        ],
      },
    ],
  }

  it('drops category subtotal rows from the item list', () => {
    const [c] = parseGradeItems(nested)
    expect(c.items.map((i) => i.name)).toEqual(['Baseline video', 'Vocabulary'])
  })

  it('officialTotal is null when the course row has no grade', () => {
    const [c] = parseGradeItems(nested)
    expect(c.officialTotal).toBeNull()
  })

  it('weighted course with zero running total shows null (unified chain, Moodle "-")', () => {
    const [c] = parseGradeItems(nested)
    // Baseline berbobot tapi belum dinilai; Vocabulary 100% tanpa bobot
    // → Σ w·pct = 0 → null, BUKAN jatuh ke rata-rata sederhana 100
    // (rantai terpadu = semantik courseProjection; Moodle juga "-").
    expect(c.average).toBeNull()
  })

  it('uses Σ weight × percent (Moodle contribution) before simple average', () => {
    const [c] = parseGradeItems({
      usergrades: [
        {
          courseid: 1,
          gradeitems: [
            { itemname: 'A', itemtype: 'manual', graderaw: 10, grademax: 10, weightraw: 0.7 },
            { itemname: 'B', itemtype: 'mod', graderaw: 10, grademax: 20, weightraw: 0.3 },
          ],
        },
      ],
    })
    // 0.7·100 + 0.3·50 = 85 — beda dari rata-rata sederhana 75.
    expect(c.average).toBe(85)
  })

  it('reads officialTotal from the course-total row', () => {
    const [c] = parseGradeItems({
      usergrades: [
        {
          courseid: 1,
          gradeitems: [
            { itemname: 'Week 1', itemtype: 'manual', graderaw: 8, grademax: 8, weightraw: 0.07143 },
            { itemname: null, itemtype: 'course', graderaw: 24, grademax: 112 },
          ],
        },
      ],
    })
    expect(c.officialTotal).toBeCloseTo(21.4, 1)
    expect(c.average).toBeCloseTo(21.4, 1)
    expect(c.items).toHaveLength(1) // baris course tidak bocor ke item
  })
})

// 【2026-09-26】Bobot kategori (baris 'category' berbobot) diratakan ke item
// anggota tanpa bobot sendiri — pola nyata LUT: KE00DA03 (25% kategori dengan
// satu anggota) & CT60A4050 (Attendance 10% dengan 10 anggota).
describe('parseGradeItems — category weight inheritance', () => {
  // Bentuk nyata: kategori berbobot + anggota tanpa weightraw + anggota
  // berbobot sendiri + kategori tanpa bobot + weightraw 0 (tidak dihitung).
  const nested = {
    usergrades: [
      {
        courseid: 900,
        gradeitems: [
          // Kategori "Assignments" 25% dengan 2 anggota tanpa bobot → 12.5 each
          { itemname: 'HA1', itemtype: 'mod', graderaw: 5, grademax: 10, categoryid: 421060 },
          { itemname: 'HA2', itemtype: 'mod', graderaw: null, grademax: 10, categoryid: 421060 },
          { itemname: null, itemtype: 'category', iteminstance: 421060, weightraw: 0.25, grademax: 20 },
          // Kategori "Other" 25% dengan SATU anggota tanpa bobot → 25
          { itemname: 'Optional practice', itemtype: 'mod', graderaw: null, grademax: 5, categoryid: 420910 },
          { itemname: null, itemtype: 'category', iteminstance: 420910, weightraw: 0.25, grademax: 5 },
          // Anggota berbobot sendiri: TIDAK disentuh (dosen yang menentukan)
          { itemname: 'Baseline video', itemtype: 'mod', graderaw: 2, grademax: 2, weightraw: 1, categoryid: 420620 },
          { itemname: null, itemtype: 'category', iteminstance: 420620, grademax: 2 },
          // Kategori TANPA bobot: anggotanya tetap null (jangan mengarang bobot)
          { itemname: 'Free form', itemtype: 'mod', graderaw: 1, grademax: 1, categoryid: 429990 },
          { itemname: null, itemtype: 'category', iteminstance: 429990, grademax: 1 },
          // Tanpa kategori (loose): tetap null
          { itemname: 'Loose item', itemtype: 'mod', graderaw: 3, grademax: 3 },
        ],
      },
    ],
  }

  it('spreads a weighted category evenly over its unweighted members', () => {
    const [c] = parseGradeItems(nested)
    const byName = (n: string) => c.items.find((i) => i.name === n)!
    expect(byName('HA1').weight).toBeCloseTo(12.5, 2)
    expect(byName('HA2').weight).toBeCloseTo(12.5, 2)
    // Satu anggota → dapat bobot penuh kategorinya
    expect(byName('Optional practice').weight).toBe(25)
  })

  it('never touches items with their own weightraw, loose items, or unweighted-category members', () => {
    const [c] = parseGradeItems(nested)
    const byName = (n: string) => c.items.find((i) => i.name === n)!
    expect(byName('Baseline video').weight).toBe(100)
    expect(byName('Free form').weight).toBeNull()
    expect(byName('Loose item').weight).toBeNull()
  })

  it('drops category and course rows from the item list', () => {
    const [c] = parseGradeItems(nested)
    expect(c.items.map((i) => i.name)).toEqual([
      'HA1', 'HA2', 'Optional practice', 'Baseline video', 'Free form', 'Loose item',
    ])
  })

  it('uses inherited weights in the running total (ungraded count as 0)', () => {
    // Baseline 100%×100% = 100 poin + HA1 5/10 × 12.5% = 6.25 → 106.25;
    // HA2/Optional belum dinilai dihitung 0 (bukan dikecualikan).
    const [c] = parseGradeItems(nested)
    expect(c.average).toBeCloseTo(106.25, 2)
  })
})

// Item skala (scaleid ≠ null): nilai teks resmi ("Passed") dipertahankan —
// persen 1/2 = 50% menyesatkan untuk skala Fail–Pass.
describe('parseGradeItems — scale items carry gradeText', () => {
  it('keeps gradeformatted as gradeText for scale items', () => {
    const [c] = parseGradeItems({
      usergrades: [
        {
          courseid: 1,
          gradeitems: [
            { itemname: 'CV upload', itemtype: 'mod', graderaw: 1, grademax: 2, scaleid: 4, gradeformatted: 'Passed' },
            { itemname: 'Quiz', itemtype: 'mod', graderaw: 5, grademax: 5 },
          ],
        },
      ],
    })
    expect(c.items[0].gradeText).toBe('Passed')
    expect(c.items[1].gradeText).toBeUndefined() // numerik tanpa skala
  })

  it('scale item with no grade has no gradeText', () => {
    const [c] = parseGradeItems({
      usergrades: [
        {
          courseid: 1,
          gradeitems: [{ itemname: 'X', itemtype: 'mod', graderaw: null, grademax: 2, scaleid: 4, gradeformatted: '-' }],
        },
      ],
    })
    expect(c.items[0].gradeText).toBeUndefined()
  })
})
