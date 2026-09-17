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
            weight: 0.2,
            feedback: 'Good start',
          },
          {
            itemname: 'Exam',
            itemtype: 'mod',
            graderaw: 42,
            grademax: 50,
            gradeaverage: 35,
            weight: 0.8,
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
