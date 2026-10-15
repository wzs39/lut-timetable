// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  activeSchemeWeights,
  applySchemeWeights,
  clearGradeSchemeMemoryCacheForTest,
  confirmGradeScheme,
  loadGradeSchemes,
  parseGradeScheme,
  saveGradeSchemePreview,
  updateGradeSchemeOverride,
} from './gradeScheme'
import type { GradeItem } from './grades'
import { KEYS } from './storage'

afterEach(() => {
  localStorage.removeItem(KEYS.gradeSchemes)
  clearGradeSchemeMemoryCacheForTest()
})

const item = (name: string, weight: number | null): GradeItem => ({ name, grade: 80, max: 100, classAvg: null, weight })

describe('grade scheme confirmation and mapping', () => {
  it('keeps parser proposals inert until explicitly confirmed and persists per courseid', () => {
    const parsed = parseGradeScheme(['Assignment 1 (25 % of the grade)'], 'KE00DA03')
    saveGradeSchemePreview(420, 'KE00DA03', parsed)
    expect(KEYS.gradeSchemes).toBe('tt_grade_schemes_v1')
    expect(loadGradeSchemes()[420].confirmedWeights).toBeUndefined()
    expect(activeSchemeWeights(420)).toBeNull()

    expect(confirmGradeScheme(420)?.confirmedWeights).toEqual(parsed.weights)
    clearGradeSchemeMemoryCacheForTest()
    expect(activeSchemeWeights(420)).toEqual(parsed.weights)
  })

  it('overrides only exact same-course item matches and leaves unmatched Moodle weights untouched', () => {
    const items = [item('Home Assignment 1', null), item('Home Assignment 2', null), item('Other quiz', 12)]
    const changed = applySchemeWeights(items, [
      { label: 'Home Assignments', weight: 40 },
      { label: 'Exam project', weight: 25 },
    ])
    expect(changed.map((i) => i.weight)).toEqual([20, 20, 12])
    expect(items.map((i) => i.weight)).toEqual([null, null, 12])
  })

  it('keeps manual edits proposed until confirmation and retains previous active values while editing', () => {
    saveGradeSchemePreview(430, 'CT60A4050', parseGradeScheme(['Final exam – 25%'], 'CT60A4050'))
    const original = [{ label: 'Quiz', weight: 10 }]
    updateGradeSchemeOverride(430, 'CT60A4050', original, true)
    const proposed = [{ label: 'Quiz', weight: 15 }]
    updateGradeSchemeOverride(430, 'CT60A4050', proposed, false)
    expect(activeSchemeWeights(430)).toEqual(original)
    updateGradeSchemeOverride(430, 'CT60A4050', proposed, true)
    expect(activeSchemeWeights(430)).toEqual(proposed)
  })
})
