import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { fetchViaElectron, hasLutBridge } from './fetchIcs'
import {
  COURSE_FACTS,
  type CourseFact,
  type CourseOffering,
  type ExamSitting,
  type GradeScale,
  type OfferingConfidence,
  type SisuCourseFact,
  type TeachingPeriod,
} from './sisuCourseFacts'
import { KEYS, readJson, writeJson } from './storage'

export type { SisuCourseFact, TeachingPeriod }

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

export const postGraphql = sisuGraphql

export function sisuCourseUrl(id: string): string {
  return `https://sisu.lut.fi/student/courseunit/${id}/brochure`
}

export function sisuSearchUrl(code: string): string {
  return `https://sisu.lut.fi/student/search?q=${encodeURIComponent(normalizeSisuCode(code))}`
}

export async function resolveSisuCourseId(code: string): Promise<string | null> {
  const clean = normalizeSisuCode(code)
  if (!clean) return null
  const cache = readJson<Record<string, string>>(KEYS.sisuCourseIds, {})
  if (cache[clean]) return cache[clean]
  if (COURSE_FACTS[clean]?.sisuId) {
    cache[clean] = COURSE_FACTS[clean].sisuId!
    writeJson(KEYS.sisuCourseIds, cache)
    return cache[clean]
  }
  const match = await lookupSisuCourseByCode(clean)
  return match?.id ?? null
}

export async function preloadSisuCourseIds(codes: readonly string[]): Promise<Record<string, string>> {
  const cache = readJson<Record<string, string>>(KEYS.sisuCourseIds, {})
  for (const raw of codes) {
    const clean = normalizeSisuCode(raw)
    if (!clean || cache[clean]) continue
    if (COURSE_FACTS[clean]?.sisuId) {
      cache[clean] = COURSE_FACTS[clean].sisuId!
      continue
    }
    try {
      const match = await lookupSisuCourseByCode(clean)
      if (match?.id) cache[clean] = match.id
    } catch {
      /* ignore individual lookup failure */
    }
  }
  writeJson(KEYS.sisuCourseIds, cache)
  return cache
}

/* --------------------- Live SISU GraphQL Fact Enrichment --------------------- */

export function numberToTeachingPeriod(period: number): TeachingPeriod | null {
  if (period === 1) return 'P1'
  if (period === 2) return 'P2'
  if (period === 3) return 'P3'
  if (period === 4) return 'P4'
  if (period === 5) return 'Summer'
  return null
}

export function teachingPeriodToNumber(period: TeachingPeriod): number | null {
  if (period === 'P1') return 1
  if (period === 'P2') return 2
  if (period === 'P3') return 3
  if (period === 'P4') return 4
  if (period === 'Summer') return 5
  return null
}

export function deriveSisuLevel(code: string): 'basic' | 'intermediate' | 'advanced' | 'other' {
  const clean = normalizeSisuCode(code)
  const match = clean.match(/^[A-Za-z]+(\d{2})/)
  if (!match) return 'other'
  const levelNum = Number(match[1])
  if (levelNum >= 10 && levelNum < 20) return 'basic'
  if (levelNum >= 20 && levelNum < 30) return 'intermediate'
  if (levelNum >= 30 && levelNum < 90) return 'advanced'
  return 'other'
}

function periodsFromDates(start?: string, end?: string): number[] {
  if (!start || !end) return []
  const startYear = Number(start.slice(0, 4))
  const endYear = Number(end.slice(0, 4))
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) return []
  const out = new Set<number>()
  for (let year = startYear - 1; year <= endYear; year++) {
    const windows: Array<[number, string, string]> = [
      [1, `${year}-08-20`, `${year}-10-25`],
      [2, `${year}-10-26`, `${year}-12-20`],
      [3, `${year + 1}-01-05`, `${year + 1}-03-07`],
      [4, `${year + 1}-03-08`, `${year + 1}-05-31`],
      [5, `${year + 1}-06-01`, `${year + 1}-08-19`],
    ]
    for (const [period, periodStart, periodEnd] of windows) {
      if (start <= periodEnd && end >= periodStart) out.add(period)
    }
  }
  return [...out].sort((a, b) => a - b)
}

function parseHoursFromDescription(
  description: string,
  credits: number,
): { totalHours: number; hoursSource: 'sisu' | 'ects-estimate'; workloadAnomaly: boolean } {
  const match = description.match(
    /Total(?:\s+amount(?:\s+of\s+work)?|\s+workload)?(?:\s+is|:)?\s*(\d+)\s*h/i,
  )
  const sisuHours = match ? Number(match[1]) : null
  if (sisuHours !== null && Number.isFinite(sisuHours)) {
    const anomaly = credits > 0 && (sisuHours / credits < 20 || sisuHours / credits > 40)
    return {
      totalHours: anomaly ? Math.round(credits * 27) : sisuHours,
      hoursSource: anomaly ? 'ects-estimate' : 'sisu',
      workloadAnomaly: anomaly,
    }
  }
  return {
    totalHours: credits > 0 ? Math.round(credits * 27) : 0,
    hoursSource: 'ects-estimate',
    workloadAnomaly: false,
  }
}

function extractAssessmentMethods(
  methods: Array<{ assessmentItems?: Array<{ name?: { en?: string } }> }>,
  description: string,
): string[] {
  const names = [
    ...new Set(
      methods
        .flatMap((m) => (m.assessmentItems ?? []).map((item) => item?.name?.en))
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0),
    ),
  ]
  if (names.length > 0) return names
  const found: string[] = []
  if (/exam/i.test(description)) found.push('Exam')
  if (/project/i.test(description)) found.push('Project')
  if (/assignment/i.test(description)) found.push('Assignments')
  return found.length > 0 ? found : ['Course completion']
}

export function normalizeSisuFact(raw: SisuCourseFact | CourseFact): SisuCourseFact {
  const code = normalizeSisuCode(raw.code || '')
  const rawAsFact = raw as SisuCourseFact
  const sisuId = rawAsFact.sisuId || rawAsFact.id || undefined
  const credits = typeof raw.credits === 'number' && Number.isFinite(raw.credits) ? raw.credits : 0
  const offeringPattern: number[] = Array.isArray(rawAsFact.offeringPattern) && rawAsFact.offeringPattern.length > 0
    ? [...new Set(rawAsFact.offeringPattern.filter((n) => typeof n === 'number'))].sort((a, b) => a - b)
    : Array.isArray(rawAsFact.periods)
      ? rawAsFact.periods
          .map(teachingPeriodToNumber)
          .filter((n): n is number => n !== null)
      : []
  const periods: TeachingPeriod[] = Array.isArray(rawAsFact.periods) && rawAsFact.periods.length > 0
    ? [...new Set(rawAsFact.periods)]
    : offeringPattern
        .map(numberToTeachingPeriod)
        .filter((p): p is TeachingPeriod => p !== null)
  const formalPrerequisites = Array.isArray(rawAsFact.formalPrerequisites)
    ? rawAsFact.formalPrerequisites
    : Array.isArray(rawAsFact.prerequisites)
      ? rawAsFact.prerequisites
      : []
  const assessmentMethods = Array.isArray(rawAsFact.assessmentMethods)
    ? rawAsFact.assessmentMethods
    : Array.isArray(rawAsFact.assessmentItems)
      ? rawAsFact.assessmentItems
      : []
  const totalHours = typeof rawAsFact.totalHours === 'number' && Number.isFinite(rawAsFact.totalHours)
    ? rawAsFact.totalHours
    : credits > 0
      ? Math.round(credits * 27)
      : 0
  const nameFi = rawAsFact.nameFi ??
    (typeof rawAsFact.name === 'object' && rawAsFact.name !== null ? rawAsFact.name.fi : undefined)

  return {
    ...rawAsFact,
    code,
    id: rawAsFact.id ?? sisuId,
    sisuId: sisuId ?? rawAsFact.id,
    name: rawAsFact.name,
    ...(nameFi ? { nameFi } : {}),
    credits,
    gradeScale: rawAsFact.gradeScale ?? 'unknown',
    periods,
    offeringPattern,
    totalHours,
    hoursSource: rawAsFact.hoursSource ?? 'ects-estimate',
    assessmentMethods,
    assessmentItems: rawAsFact.assessmentItems ?? assessmentMethods,
    completionSummary: rawAsFact.completionSummary ?? rawAsFact.workloadNote,
    formalPrerequisites,
    prerequisites: rawAsFact.prerequisites ?? formalPrerequisites,
    offerings: Array.isArray(rawAsFact.offerings) ? rawAsFact.offerings : [],
    offeringConfidence: rawAsFact.offeringConfidence ?? 'unknown',
    examSittings: Array.isArray(rawAsFact.examSittings) ? rawAsFact.examSittings : [],
    level: rawAsFact.level ?? deriveSisuLevel(code),
  }
}

export function loadLiveSisuFacts(): Record<string, SisuCourseFact> {
  const raw = readJson<Record<string, unknown>>(KEYS.sisuLiveFacts, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, SisuCourseFact> = {}
  for (const [key, val] of Object.entries(raw)) {
    if (!val || typeof val !== 'object') continue
    const candidate = val as Partial<SisuCourseFact>
    const code = normalizeSisuCode(candidate.code || key)
    if (!code) continue
    out[code] = normalizeSisuFact({ ...candidate, code } as SisuCourseFact)
  }
  return out
}

export function saveLiveSisuFact(fact: SisuCourseFact): void {
  const clean = normalizeSisuCode(fact.code)
  if (!clean) return
  const current = loadLiveSisuFacts()
  const normalized = normalizeSisuFact({ ...fact, code: clean })
  current[clean] = normalized
  writeJson(KEYS.sisuLiveFacts, current)
  const resolvedId = normalized.sisuId || normalized.id
  if (resolvedId) {
    const idCache = readJson<Record<string, string>>(KEYS.sisuCourseIds, {})
    if (idCache[clean] !== resolvedId) {
      idCache[clean] = resolvedId
      writeJson(KEYS.sisuCourseIds, idCache)
    }
  }
}

/** Resolves SisuCourseFact from static COURSE_FACTS first, then localStorage live cache. */
export function getSisuCourseFact(code: string): SisuCourseFact | null {
  const clean = normalizeSisuCode(code)
  if (!clean) return null
  const staticFact = COURSE_FACTS[clean]
  if (staticFact) return normalizeSisuFact(staticFact)
  const live = loadLiveSisuFacts()
  return live[clean] ?? null
}

/** Queries https://sisu.lut.fi/api/ using CourseUnitFacts query and caches result. */
export async function fetchAndCacheSisuCourseFact(
  code: string,
  signal?: AbortSignal,
): Promise<SisuCourseFact | null> {
  const clean = normalizeSisuCode(code)
  if (!clean) return null

  const idCache = readJson<Record<string, string>>(KEYS.sisuCourseIds, {})
  let resolvedId: string | undefined = idCache[clean] || COURSE_FACTS[clean]?.sisuId
  let unitData: Record<string, any> | null = null

  if (!resolvedId) {
    const searchQuery = `{
      course_unit_search(
        codeQuery: ${JSON.stringify(clean)},
        universityOrgIds: ["lut-university-root-id"],
        validity: "ONGOING_AND_FUTURE",
        resultLimit: 10
      ) {
        id code name { en fi } credits { min max }
        gradeScale { abbreviation { en } }
        compulsoryFormalPrerequisites { prerequisites { courseUnits(universityOrgId: "lut-university-root-id") { code } } }
        completionMethods { studyType description { en } evaluationCriteria { en fi } assessmentItems { name { en } } }
        courseUnitRealisations { id name { en } activityPeriod { startDate endDate } }
      }
    }`
    const searchRes = await sisuGraphql(JSON.stringify({ query: searchQuery }), signal)
    if (searchRes?.data?.course_unit && typeof searchRes.data.course_unit === 'object') {
      unitData = searchRes.data.course_unit
      resolvedId = typeof unitData?.id === 'string' ? unitData.id : undefined
    } else if (Array.isArray(searchRes?.data?.course_unit_search)) {
      const rows = searchRes.data.course_unit_search as Array<Record<string, any>>
      const exact = rows.find((r) => typeof r?.code === 'string' && normalizeSisuCode(r.code) === clean)
      if (!exact || typeof exact.id !== 'string' || !exact.id) return null
      resolvedId = exact.id
      if (
        exact.completionMethods !== undefined ||
        exact.courseUnitRealisations !== undefined ||
        exact.compulsoryFormalPrerequisites !== undefined ||
        exact.gradeScale !== undefined
      ) {
        unitData = exact
      }
    } else {
      return null
    }
  }

  if (resolvedId && idCache[clean] !== resolvedId) {
    idCache[clean] = resolvedId
    writeJson(KEYS.sisuCourseIds, idCache)
  }

  if (!unitData && resolvedId) {
    const unitQuery = `query CourseUnitFacts {
      course_unit(id: ${JSON.stringify(resolvedId)}) {
        id code name { en fi } credits { min max }
        gradeScale { abbreviation { en } }
        compulsoryFormalPrerequisites { prerequisites { courseUnits(universityOrgId: "lut-university-root-id") { code } } }
        completionMethods { studyType description { en } evaluationCriteria { en fi } assessmentItems { name { en } } }
        courseUnitRealisations { id name { en } activityPeriod { startDate endDate } }
      }
    }`
    const unitRes = await sisuGraphql(JSON.stringify({ query: unitQuery }), signal)
    unitData = unitRes?.data?.course_unit ?? null
  }

  if (!unitData) return null

  const finalId = (typeof unitData.id === 'string' && unitData.id) || resolvedId
  if (finalId && idCache[clean] !== finalId) {
    idCache[clean] = finalId
    writeJson(KEYS.sisuCourseIds, idCache)
  }

  const minCredits = typeof unitData.credits?.min === 'number'
    ? unitData.credits.min
    : typeof unitData.credits === 'number'
      ? unitData.credits
      : 0
  const maxCredits = typeof unitData.credits?.max === 'number'
    ? unitData.credits.max
    : minCredits
  const methods = Array.isArray(unitData.completionMethods) ? unitData.completionMethods : []
  const degree = methods.find((m: any) => m?.studyType === 'DEGREE_STUDIES') ?? methods[0] ?? {}
  const description = typeof degree?.description?.en === 'string' ? degree.description.en : ''
  const criteria = degree?.evaluationCriteria ?? unitData.assessmentCriteria ?? {}
  const hours = parseHoursFromDescription(description, minCredits)
  const prerequisites = [
    ...new Set(
      (Array.isArray(unitData.compulsoryFormalPrerequisites) ? unitData.compulsoryFormalPrerequisites : [])
        .flatMap((group: any) => (Array.isArray(group?.prerequisites) ? group.prerequisites : []))
        .flatMap((p: any) =>
          (Array.isArray(p?.courseUnits) ? p.courseUnits : [])
            .map((cu: any) => (typeof cu?.code === 'string' ? normalizeSisuCode(cu.code) : ''))
            .filter(Boolean),
        ),
    ),
  ]

  const realisations = Array.isArray(unitData.courseUnitRealisations) ? unitData.courseUnitRealisations : []
  const examSittings: ExamSitting[] = realisations
    .filter((r: any) => /exam|tentti|kuulustelu/i.test(r?.name?.en ?? ''))
    .map((r: any) => ({
      name: String(r?.name?.en ?? ''),
      startDate: String(r?.activityPeriod?.startDate ?? ''),
      endDate: String(r?.activityPeriod?.endDate ?? ''),
    }))
    .filter((s: ExamSitting) => Boolean(s.startDate && s.endDate))
    .sort((a: ExamSitting, b: ExamSitting) => a.startDate.localeCompare(b.startDate))

  const offerings: CourseOffering[] = realisations
    .filter((r: any) => !/exam|tentti|kuulustelu/i.test(r?.name?.en ?? ''))
    .map((r: any) => ({
      id: String(r?.id ?? ''),
      name: String(r?.name?.en ?? ''),
      startDate: String(r?.activityPeriod?.startDate ?? ''),
      endDate: String(r?.activityPeriod?.endDate ?? ''),
      periods: periodsFromDates(r?.activityPeriod?.startDate, r?.activityPeriod?.endDate),
    }))
    .filter((o: CourseOffering) => Boolean(o.startDate && o.endDate))

  const offeringPattern = [...new Set(offerings.flatMap((o) => o.periods))].sort((a, b) => a - b)
  const years = offerings.map((o) => Number(o.startDate.slice(0, 4))).filter((y) => Number.isFinite(y) && y > 0)
  const offeringConfidence: OfferingConfidence = years.some((y) => y >= 2026)
    ? 'sisu-2026-27'
    : years.length > 0
      ? 'stale'
      : 'unknown'

  const rawScale = String(unitData.gradeScale?.abbreviation?.en ?? unitData.gradeScale ?? '')
  const gradeScale: GradeScale = /pass/i.test(rawScale)
    ? 'pass-fail'
    : rawScale === '0-5'
      ? '0-5'
      : 'unknown'

  const nameEn = typeof unitData.name === 'string'
    ? unitData.name
    : typeof unitData.name?.en === 'string'
      ? unitData.name.en
      : typeof unitData.name?.fi === 'string'
        ? unitData.name.fi
        : undefined
  const nameFi = typeof unitData.name === 'object' && typeof unitData.name?.fi === 'string'
    ? unitData.name.fi
    : undefined

  const extractedMethods = extractAssessmentMethods(methods, description)

  const fact = normalizeSisuFact({
    code: clean,
    id: finalId,
    sisuId: finalId,
    name: nameEn,
    nameFi,
    credits: minCredits,
    creditsMax: maxCredits !== minCredits ? maxCredits : undefined,
    creditRange: { min: minCredits, max: maxCredits },
    gradeScale,
    totalHours: hours.totalHours,
    hoursSource: hours.hoursSource,
    workloadAnomaly: hours.workloadAnomaly,
    workloadNote: description || undefined,
    completionSummary: description || undefined,
    assessmentCriteria:
      criteria?.en || criteria?.fi
        ? { en: criteria.en || undefined, fi: criteria.fi || undefined }
        : undefined,
    assessmentMethods: extractedMethods,
    assessmentItems: extractedMethods,
    formalPrerequisites: prerequisites,
    prerequisites,
    offerings,
    offeringPattern,
    periods: offeringPattern
      .map(numberToTeachingPeriod)
      .filter((p): p is TeachingPeriod => p !== null),
    offeringConfidence,
    examSittings,
    selfPaced: clean.startsWith('MOOC'),
    level: deriveSisuLevel(clean),
  })

  saveLiveSisuFact(fact)
  return fact
}

