// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { post: vi.fn() },
}))
vi.mock('../lib/fetchIcs', () => ({
  fetchViaElectron: vi.fn(),
  hasLutBridge: () => false,
}))

import { searchSisuPublicCatalog } from '../lib/sisuCourse'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('public SISU course search', () => {
  it('fetches every result page and keeps credit ranges while leaving study year unknown', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: `course-${index}`,
      code: `CT60A${String(index).padStart(4, '0')}`,
      name: { en: `Software course ${index}` },
      credits: index === 0 ? { min: 6, max: 6 } : index === 1 ? { min: 1, max: 12 } : null,
      studyFields: [{ name: { en: 'Software engineering', fi: 'Ohjelmistotekniikka' } }],
      searchTags: ['software'],
    }))
    const finalPage = [{
      id: 'course-100', code: 'CT60A0100', name: { en: 'Final software course' },
      credits: { min: 3, max: 3 }, studyFields: [], searchTags: [],
    }]
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const { query } = JSON.parse(String(init.body)) as { query: string }
      const start = Number(/resultStart:\s*(\d+)/.exec(query)?.[1] ?? 0)
      return { json: async () => ({ data: { course_unit_search: start === 0 ? firstPage : finalPage } }) }
    })

    const result = await searchSisuPublicCatalog('software')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstQuery = JSON.parse(String(fetchMock.mock.calls[0][1].body)).query as string
    const secondQuery = JSON.parse(String(fetchMock.mock.calls[1][1].body)).query as string
    expect(firstQuery).toContain('fullTextQuery: "software"')
    expect(firstQuery).toContain('validity: "ONGOING_AND_FUTURE"')
    expect(firstQuery).toContain('resultStart: 0')
    expect(secondQuery).toContain('resultStart: 100')
    expect(result).toMatchObject({ total: 101 })
    expect(result).not.toHaveProperty('complete')
    expect(result.courses[0]).toMatchObject({ credits: 6, studyYears: [] })
    expect(result.courses[1]).toMatchObject({ creditRange: { min: 1, max: 12 }, studyYears: [] })
    expect(result.courses[0].studyFields).toEqual(['Software engineering', 'Ohjelmistotekniikka'])
    expect(result.courses[0].searchTags).toEqual(['software'])
  })

  it('ignores unusable rows without counting them as valid courses', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ data: { course_unit_search: [
      { id: 'missing-name', code: 'CT60A4050', credits: { min: 6, max: 6 } },
      { code: 'CT60A4051', name: { en: 'Missing identity' } },
      { id: 'valid', code: 'CT60A4052', name: { fi: 'Kelvollinen nimi' }, credits: null },
    ] } }) })

    const result = await searchSisuPublicCatalog('software')

    expect(result).toMatchObject({ total: 1, courses: [{ id: 'valid', name: 'Kelvollinen nimi' }] })
  })

  it('honors abort signals before and between pages instead of falling back to stale UI results', async () => {
    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(searchSisuPublicCatalog('software', alreadyAborted.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()

    const controller = new AbortController()
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      controller.abort()
      expect(init.signal).toBe(controller.signal)
      return { json: async () => ({ data: { course_unit_search: Array.from({ length: 100 }, (_, index) => ({ id: `page-${index}`, code: `CT60A${index}`, name: { en: 'Course' } })) } }) }
    })
    await expect(searchSisuPublicCatalog('software', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses code search for course-code queries and rejects terms shorter than three characters', async () => {
    await expect(searchSisuPublicCatalog('ai')).rejects.toThrow('query-too-short')
    expect(fetchMock).not.toHaveBeenCalled()

    fetchMock.mockResolvedValue({ json: async () => ({ data: { course_unit_search: [] } }) })
    const result = await searchSisuPublicCatalog('991070')
    const query = JSON.parse(String(fetchMock.mock.calls[0][1].body)).query as string
    expect(query).toContain('codeQuery: "991070"')
    expect(result).toMatchObject({ courses: [], total: 0 })
    expect(result).not.toHaveProperty('complete')

    fetchMock.mockResolvedValue({ json: async () => ({ data: { course_unit_search: [{ id: 'id', code: 'K200CE69', name: { en: 'Finnish 1' }, credits: null, studyFields: [], searchTags: [] }] } }) })
    const letterPrefixQuery = await searchSisuPublicCatalog('K200CE69')
    expect(letterPrefixQuery.courses).toHaveLength(1)
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).query).toContain('codeQuery: "K200CE69"')

    fetchMock.mockResolvedValue({ json: async () => ({ data: { course_unit_search: [{ id: 'digits', code: '1137L', name: { en: 'Licenciate Thesis' }, credits: null, studyFields: [], searchTags: [] }] } }) })
    const digitPrefixQuery = await searchSisuPublicCatalog('1137L')
    expect(digitPrefixQuery.courses[0].code).toBe('1137L')
    expect(JSON.parse(String(fetchMock.mock.calls[2][1].body)).query).toContain('codeQuery: "1137L"')

    fetchMock.mockResolvedValue({ json: async () => ({ data: { course_unit_search: [{ id: 'numeric', code: '991070', name: { en: 'Doctoral course' }, credits: null, studyFields: [], searchTags: [] }] } }) })
    await searchSisuPublicCatalog('991070')
    expect(JSON.parse(String(fetchMock.mock.calls[3][1].body)).query).toContain('codeQuery: "991070"')

    fetchMock.mockResolvedValue({ json: async () => ({ data: { course_unit_search: [{ id: 'similar-word', code: 'CT60A5022', name: { en: 'Common software security' }, credits: null, studyFields: [], searchTags: [] }] } }) })
    await searchSisuPublicCatalog('systems')
    expect(JSON.parse(String(fetchMock.mock.calls[4][1].body)).query).toContain('fullTextQuery: "systems"')

    fetchMock.mockResolvedValue({ json: async () => ({ data: { course_unit_search: [{ id: 'dashed', code: 'CT60A4050', name: { en: 'Software engineering' }, credits: null, studyFields: [], searchTags: [] }] } }) })
    await searchSisuPublicCatalog('CT60A4050-3001')
    expect(JSON.parse(String(fetchMock.mock.calls[5][1].body)).query).toContain('codeQuery: "CT60A4050"')

    fetchMock.mockResolvedValue({ json: async () => ({ data: { course_unit_search: [{ id: 'code-token-word', code: 'ZZ200', name: { en: 'theories of systems' }, credits: null, studyFields: [], searchTags: [] }] } }) })
    await searchSisuPublicCatalog('systems engineering')
    expect(JSON.parse(String(fetchMock.mock.calls[6][1].body)).query).toContain('fullTextQuery: "systems engineering"')

    fetchMock.mockResolvedValue({ json: async () => ({ data: { course_unit_search: [{ id: 'code-short-word', code: 'ZZ201', name: { en: 'Software development' }, credits: null, studyFields: [], searchTags: [] }] } }) })
    await searchSisuPublicCatalog('software 3')
    expect(JSON.parse(String(fetchMock.mock.calls[7][1].body)).query).toContain('fullTextQuery: "software 3"')
  })
})
