import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { fetchViaElectron, hasLutBridge } from './fetchIcs'
import { KEYS, readJson, writeJson } from './storage'

const QUERY = (code: string) =>
  JSON.stringify({
    query: `{ course_unit_search(codeQuery: "${code}", resultLimit: 1) { id code name { en } } }`,
  })

/** POST GraphQL ke SISU (native/Electron: langsung; browser: proxy/corsproxy) */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('SISU search aborted')
    error.name = 'AbortError'
    throw error
  }
}

export async function sisuGraphql(query: string, signal?: AbortSignal): Promise<any> {
  throwIfAborted(signal)
  if (Capacitor.isNativePlatform()) {
    const res = await CapacitorHttp.post({
      url: 'https://sisu.lut.fi/api/',
      headers: { 'Content-Type': 'application/json' },
      data: query,
    })
    return JSON.parse(typeof res.data === 'string' ? res.data : JSON.stringify(res.data))
  }

  if (hasLutBridge()) {
    const res = await fetchViaElectron('https://sisu.lut.fi/api/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: query,
    })
    return JSON.parse(res)
  }

  try {
    const res = await fetch('https://sisu.lut.fi/api/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: query,
      signal,
    })
    return await res.json()
  } catch (error) {
    if (signal?.aborted) throw error
    const res = await fetch(
      'https://corsproxy.io/?url=' + encodeURIComponent('https://sisu.lut.fi/api/'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: query,
        signal,
      },
    )
    return await res.json()
  }
}

/** Kode SISU → bentuk kanonik: buang nomor grup -dddd, uppercase. */
export function normalizeSisuCode(code: string): string {
  return code.trim().toUpperCase().replace(/-\d{4}$/, '')
}

/** Resolve course code -> SISU course page URL. */
export async function resolveSisuCourseUrl(code: string): Promise<string> {
  const clean = normalizeSisuCode(code)
  const cache = readJson<Record<string, string>>(KEYS.sisuCourseIds, {})
  if (cache[clean]) return `https://sisu.lut.fi/student/courseunit/${cache[clean]}`

  const json = await sisuGraphql(QUERY(clean))
  const id: string | undefined = json?.data?.course_unit_search?.[0]?.id
  if (!id) throw new Error('not-found')

  cache[clean] = id
  writeJson(KEYS.sisuCourseIds, cache)
  return `https://sisu.lut.fi/student/courseunit/${id}`
}

export interface SisuCourse {
  id: string
  code: string
  name: string
}

export interface SisuPublicCourse {
  id: string
  code?: string
  name: string
  credits?: number
  creditRange?: { min: number; max: number }
  studyYears: string[]
  studyFields: string[]
  searchTags: string[]
}

const PUBLIC_COURSE_PAGE_SIZE = 100

/** Satu baris course_unit_search → SisuPublicCourse; bentuk tak dikenal → null. */
function parseCatalogRow(row: Record<string, unknown>): SisuPublicCourse | null {
  if (typeof row.id !== 'string' || !row.id) return null
  const credits = row.credits && typeof row.credits === 'object'
    ? row.credits as { min?: unknown; max?: unknown }
    : undefined
  const minCredit = typeof credits?.min === 'number' ? credits.min : undefined
  const maxCredit = typeof credits?.max === 'number' ? credits.max : undefined
  const studyFields = Array.isArray(row.studyFields)
    ? row.studyFields.flatMap((fieldValue) => {
      if (!fieldValue || typeof fieldValue !== 'object') return []
      const localizedName = (fieldValue as { name?: Record<string, unknown> }).name
      return [localizedName?.en, localizedName?.fi].filter((value): value is string => typeof value === 'string' && value.length > 0)
    })
    : []
  const searchTags = Array.isArray(row.searchTags)
    ? row.searchTags.filter((tag): tag is string => typeof tag === 'string')
    : []
  const name = row.name && typeof row.name === 'object'
    ? [
      (row.name as Record<string, unknown>).en,
      (row.name as Record<string, unknown>).fi,
    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim()
    : undefined
  if (!name) return null

  return {
    id: row.id,
    code: typeof row.code === 'string' && row.code.trim() ? row.code.trim() : undefined,
    name,
    credits: minCredit !== undefined && minCredit === maxCredit ? minCredit : undefined,
    creditRange: minCredit !== undefined && maxCredit !== undefined && minCredit !== maxCredit
      ? { min: minCredit, max: maxCredit }
      : undefined,
    // SISU course-unit version curricula do not prove current teaching year.
    studyYears: [],
    studyFields,
    searchTags,
  }
}

/** Bidang katalog yang dipakai verifikasi rencana + deep link. */
export type SisuCatalogMatch = Pick<SisuPublicCourse, 'id' | 'code' | 'name' | 'credits' | 'creditRange'>

/** Satu kode → satu record katalog publik (verifikasi + deep link). */
export async function lookupSisuCourseByCode(code: string, signal?: AbortSignal): Promise<SisuCatalogMatch | null> {
  const clean = normalizeSisuCode(code)
  if (!clean) return null
  const query = `{
    course_unit_search(
      codeQuery: ${JSON.stringify(clean)},
      universityOrgIds: ["lut-university-root-id"],
      validity: "ONGOING_AND_FUTURE",
      resultLimit: 10
    ) { id code name { en fi } credits { min max } }
  }`
  const response = await sisuGraphql(JSON.stringify({ query }), signal)
  const rows = response?.data?.course_unit_search
  if (!Array.isArray(rows)) return null
  const parsed = (rows as Array<Record<string, unknown>>)
    .map(parseCatalogRow)
    .filter((row): row is SisuPublicCourse => row !== null)
  // Exact code only: fuzzy search can return a different course, and a wrong
  // SISU id would produce a wrong deep link and a false credit match.
  const match = parsed.find((row) => row.code && normalizeSisuCode(row.code) === clean)
  if (!match) return null

  const cache = readJson<Record<string, string>>(KEYS.sisuCourseIds, {})
  if (cache[clean] !== match.id) {
    cache[clean] = match.id
    writeJson(KEYS.sisuCourseIds, cache)
  }
  return { id: match.id, code: match.code, name: match.name, credits: match.credits, creditRange: match.creditRange }
}

/** Search all pages of LUT's public, current/future SISU course catalogue. */
export async function searchSisuPublicCatalog(term: string, signal?: AbortSignal): Promise<{
  courses: SisuPublicCourse[]
  total: number
}> {
  const searchTerm = term.trim()
  if (searchTerm.length < 3) throw new Error('query-too-short')

  const courses: SisuPublicCourse[] = []
  const codeTerm = searchTerm.replace(/-\d{4}$/, '')
  const isCodeQuery = /^(?:[A-Za-z]{1,5}\d[A-Za-z\d]*|\d{3,}[A-Za-z\d]*)$/i.test(codeTerm)
  const field = isCodeQuery ? 'codeQuery' : 'fullTextQuery'
  for (let start = 0; ; start += PUBLIC_COURSE_PAGE_SIZE) {
    throwIfAborted(signal)
    const query = `{
      course_unit_search(
        ${field}: ${JSON.stringify(codeTerm)},
        universityOrgIds: ["lut-university-root-id"],
        validity: "ONGOING_AND_FUTURE",
        resultLimit: ${PUBLIC_COURSE_PAGE_SIZE},
        resultStart: ${start}
      ) {
        id code name { en fi } credits { min max } studyFields { name { en fi } } searchTags
      }
    }`
    const response = await sisuGraphql(JSON.stringify({ query }), signal)
    throwIfAborted(signal)
    if (Array.isArray(response?.errors) && response.errors.length > 0) throw new Error('public-search-failed')
    const rows = response?.data?.course_unit_search
    if (!Array.isArray(rows)) throw new Error('invalid-public-search-response')

    for (const row of rows as Array<Record<string, unknown>>) {
      const parsed = parseCatalogRow(row)
      if (parsed) courses.push(parsed)
    }

    if (rows.length < PUBLIC_COURSE_PAGE_SIZE) return { courses, total: courses.length }
  }
}

/** Cari kursus di katalog SISU (kode atau nama) */
export async function searchSisuCourses(term: string): Promise<SisuCourse[]> {
  const t = term.trim()
  if (!t) return []
  const field = /^[A-Za-z]{2,4}\d/.test(t) ? 'codeQuery' : 'fullTextQuery'
  const q = JSON.stringify({
    query: `{ course_unit_search(${field}: "${t.replace(/"/g, '\\"')}", resultLimit: 8) { id code name { en fi } } }`,
  })
  const json = await sisuGraphql(q)
  const list = json?.data?.course_unit_search
  if (!Array.isArray(list)) return []
  return list.map((c: any) => ({
    id: c.id,
    code: c.code,
    name: c.name?.en || c.name?.fi || '',
  }))
}
