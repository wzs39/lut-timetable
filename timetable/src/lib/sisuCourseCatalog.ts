import type { Lesson } from '../types'
import { extractCourseCode, type EnrolledCourse } from './courses'
import type { CourseIdentityIndex } from './courseIdentity'
import { normalizeCourseCode } from './ics'
import { moodleCourseUrl } from './moodleUrl'
import type { PlanCategory, SisuPlanItem } from './sisuStudyPlan'
import { KEYS, readJson, writeJson } from './storage'

export type SisuCourseCategory = PlanCategory | 'moodle' | 'timetable' | 'public'
export type PlannerCourseSource = 'plan' | 'moodle' | 'timetable' | 'sisu'

export interface PlannerCourse {
  key: string
  code?: string
  name: string
  credits?: number
  creditRange?: { min: number; max: number }
  category: SisuCourseCategory
  periods?: string
  studyYears?: readonly string[]
  publicCourse?: PublicPlannerCourse
  sources: readonly PlannerCourseSource[]
  url?: string
}

export interface PublicPlannerCourse {
  id: string
  code?: string
  name: string
  credits?: number
  creditRange?: { min: number; max: number }
  studyYears?: readonly string[]
  studyFields?: readonly string[]
  searchTags?: readonly string[]
}

/** Only selected SISU search candidates are persisted; there is no focus preference. */
export interface SisuCoursePreferences {
  selectedCourseKeys: string[]
  selectedCourses: PublicPlannerCourse[]
}

const PREFERENCES_KEY = KEYS.sisuCoursePreferences
const DEFAULT_PREFERENCES: SisuCoursePreferences = { selectedCourseKeys: [], selectedCourses: [] }

function normalizeCode(code: string | undefined): string | undefined {
  return code ? normalizeCourseCode(code) || undefined : undefined
}

export function normalizePlannerCode(code: string | undefined): string | undefined {
  return normalizeCode(code)
}

export function normalizePlannerTitle(title: string): string {
  return title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function isPublicPlannerCourse(value: unknown): value is PublicPlannerCourse {
  if (!value || typeof value !== 'object') return false
  const course = value as Partial<PublicPlannerCourse>
  return typeof course.id === 'string' && course.id.length > 0 &&
    typeof course.name === 'string' && course.name.trim().length > 0
}

function periodsLabel(periods: readonly number[] | undefined, note?: string): string | undefined {
  if (!periods?.length) return undefined
  const label = [...periods].sort((a, b) => a - b).map((period) => `P${period}`).join('–')
  return note ? `${label} · ${note}` : label
}

/** Plan items become the "plan" source so search results mark them as already planned. */
function planCourses(items: readonly SisuPlanItem[]): PlannerCourse[] {
  return items.filter((item) => item.kind === 'course' && item.courseCode).map((item) => ({
    key: normalizeCode(item.courseCode) ?? item.id,
    code: normalizeCode(item.courseCode),
    name: item.title,
    credits: item.credits,
    creditRange: item.creditRange,
    category: item.category ?? 'public',
    periods: periodsLabel(item.periods, item.timingNote),
    studyYears: item.studyYear ? [item.studyYear] : [],
    sources: ['plan'],
    url: item.sisuId ? `https://sisu.lut.fi/student/courseunit/${item.sisuId}` : undefined,
  }))
}

/** Merge by normalized course code; only code-less records use the exact-title fallback. */
export function buildPlannerCourses(
  lessons: Lesson[] = [],
  enrolled: EnrolledCourse[] = [],
  publicCourses: PublicPlannerCourse[] = [],
  identityIndex?: CourseIdentityIndex,
  planItems: readonly SisuPlanItem[] = [],
): PlannerCourse[] {
  const seeded = planCourses(planItems)
  const courses = new Map(seeded.map((item) => [item.key, item]))
  const courseCodes = new Map(seeded.flatMap((item) => item.code ? [[item.code, item.key] as const] : []))
  const titleKeys = new Map<string, string>()
  const rememberTitle = (title: string, key: string) => {
    const normalized = normalizePlannerTitle(title)
    if (!normalized) return
    const previous = titleKeys.get(normalized)
    if (previous !== '') titleKeys.set(normalized, previous === undefined || previous === key ? key : '')
  }

  const upsert = (incoming: PlannerCourse) => {
    const codeKey = incoming.code ? courseCodes.get(incoming.code) : undefined
    const titleKey = titleKeys.get(normalizePlannerTitle(incoming.name))
    const byTitle = titleKey ? courses.get(titleKey) : undefined
    const titleMatch = byTitle && !byTitle.code && !incoming.code ? byTitle : undefined
    const existing = (codeKey && courses.get(codeKey)) ?? titleMatch ?? courses.get(incoming.key)
    if (!existing) {
      courses.set(incoming.key, incoming)
      if (incoming.code) courseCodes.set(incoming.code, incoming.key)
      rememberTitle(incoming.name, incoming.key)
      return
    }
    const plan = existing.sources.includes('plan')
    const merged: PlannerCourse = {
      ...existing,
      code: existing.code ?? incoming.code,
      name: plan || existing.sources.includes('sisu') ? existing.name : incoming.name,
      credits: existing.credits ?? incoming.credits,
      creditRange: existing.creditRange ?? incoming.creditRange,
      periods: existing.periods ?? incoming.periods,
      studyYears: [...new Set([...(existing.studyYears ?? []), ...(incoming.studyYears ?? [])])],
      publicCourse: existing.publicCourse ?? incoming.publicCourse,
      sources: [...new Set([...existing.sources, ...incoming.sources])],
      url: existing.url ?? incoming.url,
    }
    courses.set(merged.key, merged)
    if (merged.code) courseCodes.set(merged.code, merged.key)
    rememberTitle(incoming.name, merged.key)
  }

  for (const item of publicCourses) {
    const code = normalizeCode(item.code)
    const key = code ?? `sisu:${item.id}`
    upsert({
      key, code, name: item.name, credits: item.credits, creditRange: item.creditRange,
      category: 'public', studyYears: item.studyYears, publicCourse: item,
      sources: ['sisu'], url: `https://sisu.lut.fi/student/courseunit/${item.id}`,
    })
  }

  for (const item of enrolled) {
    const official = identityIndex?.forName(item.shortname) ?? identityIndex?.forName(item.fullname)
    const code = normalizeCode(identityIndex?.codeFor(item.courseid) ?? official?.code ??
      extractCourseCode(item.shortname) ?? extractCourseCode(item.fullname))
    const name = item.fullname.replace(/^\s*[A-Z]{1,5}\d[A-Z0-9]{2,}(?:-\d{4})?\s*/i, '').split(/\s+-\s+/)[0].trim() || item.fullname
    upsert({
      key: code ?? `moodle:${item.courseid}`, code, name: name || item.fullname,
      category: 'moodle', sources: ['moodle'], url: moodleCourseUrl(item.courseid) ?? undefined,
    })
  }

  for (const lesson of lessons) {
    const code = normalizeCode(lesson.code) ?? normalizeCode(extractCourseCode(lesson.title))
    const name = code
      ? lesson.title.replace(new RegExp(`^\\s*${code}\\s*[-:–]?\\s*`, 'i'), '').trim() || lesson.title
      : lesson.title
    upsert({
      key: code ?? `timetable:${normalizePlannerTitle(name)}`, code, name,
      category: 'timetable', sources: ['timetable'],
    })
  }
  return [...courses.values()]
}

export function loadSisuCoursePreferences(): SisuCoursePreferences {
  const raw = readJson<Partial<SisuCoursePreferences> & { selectedCodes?: unknown } | null>(PREFERENCES_KEY, null)
  if (!raw) return { ...DEFAULT_PREFERENCES }
  const selected = Array.isArray(raw.selectedCourseKeys) ? raw.selectedCourseKeys : raw.selectedCodes
  return {
    selectedCourseKeys: Array.isArray(selected)
      ? [...new Set(selected.filter((key): key is string => typeof key === 'string' && key.trim().length > 0))]
      : [],
    selectedCourses: Array.isArray(raw.selectedCourses) ? raw.selectedCourses.filter(isPublicPlannerCourse) : [],
  }
}

export function saveSisuCoursePreferences(value: SisuCoursePreferences): SisuCoursePreferences {
  const safe: SisuCoursePreferences = {
    selectedCourseKeys: [...new Set(value.selectedCourseKeys.filter((key) => typeof key === 'string' && key.trim().length > 0))],
    selectedCourses: value.selectedCourses.filter(isPublicPlannerCourse),
  }
  writeJson(PREFERENCES_KEY, safe)
  return safe
}
