import { describe, expect, it } from 'vitest'
import { parseGradeScheme } from '../lib/gradeScheme'

describe('parseGradeScheme explicit course contracts', () => {
  it('uses the approved CT60A4050 six-component scheme exactly', () => {
    const parsed = parseGradeScheme([
      'Course grading structure: Weekly Individual Home Assignments – 20% Weekly In-class Quizzes – 10% Weekly On-campus Exercises – 10% Course Project (reports + presentations) – 25% (Learning Diary(5) Attendance(5)) – 10% Final exam – 25% Grading scale: 5 = Excellent – 85-100%',
    ], 'CT60A4050')

    expect(parsed.weights).toEqual([
      { label: 'Weekly Individual Home Assignments', weight: 20 },
      { label: 'Weekly In-class Quizzes', weight: 10 },
      { label: 'Weekly On-campus Exercises', weight: 10 },
      { label: 'Course Project (reports + presentations)', weight: 25 },
      { label: 'Learning Diary', weight: 5 },
      { label: 'Attendance', weight: 5 },
    ])
    expect(parsed.total).toBe(75)
    expect(parsed.thresholds).toEqual([])
    // Generic parsing retains the separately listed exam; only the explicit
    // CT60A4050 policy excludes it from the requested six-component scheme.
    expect(parseGradeScheme(['Final exam – 25%']).weights).toEqual([
      { label: 'Final exam', weight: 25 },
    ])
  })

  it('does not apply the CT-specific omission to other courses', () => {
    expect(parseGradeScheme(['Final exam – 25%'], 'KE00DA03').weights).toEqual([
      { label: 'Final exam', weight: 25 },
    ])
  })

  it('extracts four separate 25% assignments without absorbing the preceding sentence', () => {
    const parsed = parseGradeScheme([
      'The following assignments impact the course evaluation: Assignment 1 (25 % of the grade) Assignment 2 (25 % of the grade) Assignment 3 (25 % of the grade) Assignment 4 (25 % of the grade). Attendance Minimum attendance is 75%.',
    ])

    expect(parsed.weights).toEqual([
      { label: 'Assignment 1', weight: 25 },
      { label: 'Assignment 2', weight: 25 },
      { label: 'Assignment 3', weight: 25 },
      { label: 'Assignment 4', weight: 25 },
    ])
    expect(parsed.total).toBe(100)
    expect(parsed.thresholds).toEqual([{ kind: 'attendance', percent: 75 }])
  })

  it('keeps K200DJ99 attendance minima as thresholds, never grade weights', () => {
    const parsed = parseGradeScheme([
      'K200DJ99 Attendance: The Language Center requires 80% of attendance. In exceptional cases, try to be here at least 50% of the lectures. Written exam grading scale: 5 = excellent 85-100%; pass grade is 50%.',
    ])

    expect(parsed.weights).toEqual([])
    expect(parsed.total).toBe(0)
    expect(parsed.thresholds).toEqual([
      { kind: 'attendance', percent: 80 },
      { kind: 'pass', percent: 50 },
    ])
  })

  it('deduplicates repeated source text without merging different assignment labels', () => {
    const source = 'Assignment 1 (25 % of the grade) Assignment 2 (25 % of the grade)'
    expect(parseGradeScheme([source, source]).weights).toEqual([
      { label: 'Assignment 1', weight: 25 },
      { label: 'Assignment 2', weight: 25 },
    ])
  })
})
