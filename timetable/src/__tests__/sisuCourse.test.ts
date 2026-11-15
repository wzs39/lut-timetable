// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchAndCacheSisuCourseFact,
  getSisuCourseFact,
  loadLiveSisuFacts,
  saveLiveSisuFact,
} from '../lib/sisuCourse'
import { KEYS } from '../lib/storage'

describe('SISU live facts cache and GraphQL enrichment', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('persists and retrieves live SISU course facts via KEYS.sisuLiveFacts', () => {
    expect(loadLiveSisuFacts()).toEqual({})

    saveLiveSisuFact({
      id: 'lut-cu-live-999',
      code: 'CT99A9999-3001',
      name: 'Advanced Quantum Systems',
      credits: 5,
      periods: ['P3', 'P4'],
      level: 'advanced',
      totalHours: 135,
      prerequisites: ['CT10A0001'],
    })

    const map = loadLiveSisuFacts()
    expect(map.CT99A9999).toBeDefined()
    expect(map.CT99A9999.code).toBe('CT99A9999')
    expect(map.CT99A9999.totalHours).toBe(135)

    const resolved = getSisuCourseFact('ct99a9999-3002')
    expect(resolved?.name).toBe('Advanced Quantum Systems')
    expect(resolved?.periods).toEqual(['P3', 'P4'])
  })

  it('fetches CourseUnitFacts from SISU GraphQL, extracts periods/workload/level, and caches into localStorage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          course_unit_search: [
            {
              id: 'lut-cu-test-123',
              code: 'CT70A7777',
              name: { en: 'Distributed Cloud Kernels', fi: 'Hajautetut ytimet' },
              credits: { min: 6, max: 6 },
              gradeScale: { abbreviation: { en: '0-5' } },
              compulsoryFormalPrerequisites: [
                {
                  prerequisites: [
                    {
                      courseUnits: [{ code: 'CT60A2411' }],
                    },
                  ],
                },
              ],
              completionMethods: [
                {
                  studyType: 'DEGREE_STUDIES',
                  description: { en: '<p>Total workload is 160 h of study.</p>' },
                  evaluationCriteria: { en: 'Exam 60%, Project 40%' },
                  assessmentItems: [{ name: { en: 'Written exam' } }],
                },
              ],
              courseUnitRealisations: [
                {
                  id: 'cur-1',
                  name: { en: 'Lectures and exercises' },
                  activityPeriod: { startDate: '2026-09-01', endDate: '2026-12-15' },
                },
              ],
            },
          ],
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const fact = await fetchAndCacheSisuCourseFact('CT70A7777-3001')
    expect(fact).not.toBeNull()
    expect(fact?.code).toBe('CT70A7777')
    expect(fact?.id).toBe('lut-cu-test-123')
    expect(fact?.credits).toBe(6)
    expect(fact?.level).toBe('advanced')
    expect(fact?.periods).toEqual(['P1', 'P2'])
    expect(fact?.totalHours).toBe(160)
    expect(fact?.prerequisites).toEqual(['CT60A2411'])

    // Verify cached in KEYS.sisuLiveFacts and KEYS.sisuCourseIds
    const liveCached = loadLiveSisuFacts()
    expect(liveCached.CT70A7777?.id).toBe('lut-cu-test-123')
    const idCache = JSON.parse(localStorage.getItem(KEYS.sisuCourseIds) ?? '{}')
    expect(idCache.CT70A7777).toBe('lut-cu-test-123')
  })
})
