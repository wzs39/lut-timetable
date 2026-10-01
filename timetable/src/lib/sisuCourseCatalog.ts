import type { Lesson } from '../types'
import { extractCourseCode, type EnrolledCourse } from './courses'
import type { CourseIdentityIndex } from './courseIdentity'
import { normalizeCourseCode } from './ics'
import { moodleCourseUrl } from './moodleUrl'
import { KEYS, readJson, writeJson } from './storage'

export type SisuCourseFocus = 'software' | 'ai' | 'systems' | 'international'
export type SisuCourseCategory = 'general' | 'specialisation' | 'language' | 'minor' | 'moodle' | 'timetable' | 'public'
export type PlannerCourseSource = 'programme' | 'moodle' | 'timetable' | 'sisu'

export interface PlannerCourse {
  key: string
  code?: string
  name: string
  credits?: number
  creditRange?: { min: number; max: number }
  category: SisuCourseCategory
  periods?: string
  studyYears?: readonly string[]
  relevanceText?: string
  publicTags?: readonly string[]
  publicCourse?: PublicPlannerCourse
  tags: readonly SisuCourseFocus[]
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

export interface SisuCoursePreferences {
  focus: SisuCourseFocus
  selectedCourseKeys: string[]
  selectedCourses: PublicPlannerCourse[]
}

export const HDD_COURSE_SOURCE_URL = 'https://elut.lut.fi/sites/default/files/category-page/2026-06/Software%20and%20Systems%20Engineering_Courses%20lectured%20by%20HEBUT%20in%202026-2027_0.pdf'
const PREFERENCES_KEY = KEYS.sisuCoursePreferences
const DEFAULT_PREFERENCES: SisuCoursePreferences = { focus: 'software', selectedCourseKeys: [], selectedCourses: [] }
const VALID_FOCI = new Set<SisuCourseFocus>(['software', 'ai', 'systems', 'international'])

const course = (
  code: string,
  name: string,
  credits: number,
  category: SisuCourseCategory,
  periods: string,
  tags: readonly SisuCourseFocus[],
  otmId: string,
): PlannerCourse => ({
  key: code,
  code,
  name,
  credits,
  category,
  periods,
  studyYears: ['2026-2027'],
  relevanceText: name,
  tags,
  sources: ['programme'],
  url: `https://sisu.lut.fi/student/courseunit/${otmId}`,
})

/** The official 2026–2027 SSE HDD programme table, not an individual PSP. */
export const HDD_COURSES: readonly PlannerCourse[] = [
  course('HDD4100', 'Engineering Project Management', 3, 'general', 'P1', ['systems', 'software'], 'otm-1bacc350-6ed2-49d6-9ca3-54d18a42e8d8'),
  course('HDD4130', 'Lean Management', 3, 'general', 'P2', ['systems', 'software'], 'otm-60b12341-9b0d-40e0-8b20-4c756654a5d9'),
  course('HDD4110', 'Systems Engineering', 3, 'general', 'P1–P2', ['systems', 'software'], 'otm-20109b79-2071-4b00-9035-3d798d49036c'),
  course('HDD5000', 'HEBUT Bachelor’s Thesis Seminar, SSE', 0, 'specialisation', 'P3–P4', ['software', 'systems'], 'otm-3a261197-8a8b-4f06-910b-2228cd71493f'),
  course('HDD5030', 'Data Structures and Algorithms', 6, 'specialisation', 'P1–P4', ['software', 'ai'], 'otm-a9ee0621-f573-43b4-8eaa-88401c4d40a5'),
  course('HDD5040', 'Foundations of Artificial Intelligence and Machine Learning', 6, 'specialisation', 'P1–P4', ['ai', 'software'], 'otm-ea6a947b-986f-4daf-8276-584392eae81e'),
  course('HDD5010', 'Foundations of Computer Science', 6, 'specialisation', 'P3–P4', ['software', 'systems', 'ai'], 'otm-23f71ebe-e11c-4c4a-a00d-4ea56c2b3445'),
  course('HDD5020', 'Foundations of Information Processing', 6, 'specialisation', 'P1–P4', ['software', 'systems'], 'otm-b54cd883-8e4a-471a-927f-436da10dae2f'),
  course('HDD7010', 'Basic Chinese 1', 5, 'language', 'P1–P2', ['international'], 'otm-03360014-e679-4bfc-84d4-1397e393cfba'),
  course('HDD7020', 'Basic Chinese 2', 5, 'language', 'P3–P4', ['international'], 'otm-8936bb41-1499-402f-af78-d5b6c328ac73'),
  course('HDD4120', 'Overview of China', 3, 'language', 'P1–P2', ['international'], 'otm-c4f6fc62-12e7-42f6-9e6d-6af138063b87'),
  course('HDD4090', 'Academic and Cultural Exchange in China', 5, 'minor', 'P2 (2026–27)–P1 (2027–28)', ['international'], 'otm-cd451ffe-d247-4e23-bab7-6553d7b63d43'),
  course('HDD4080', 'China’s 40 Years of Economic Reform and Development', 2, 'minor', 'P1', ['international'], 'otm-e8bd7078-fe9c-45d7-8abc-43bbcf6d0b86'),
  course('HDD7030', 'Intermediate Chinese 1', 3, 'minor', 'P1–P2', ['international'], 'otm-ae886100-fc49-4967-b770-b87dc569a98d'),
  course('HDD7040', 'Intermediate Chinese 2', 3, 'minor', 'P3–P4', ['international'], 'otm-ac56644a-2c3d-44a0-936e-d923db9d0322'),
  course('HDD4070', 'Traditional Chinese Culture', 6, 'minor', 'P3–P4', ['international'], 'otm-7faef782-75bf-4112-a2b2-5820903ef17e'),
]

function normalizeCode(code: string | undefined): string | undefined {
  return code ? normalizeCourseCode(code) || undefined : undefined
}

function normalizedTitle(title: string): string {
  return title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function normalizedSearchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
}

const SSE_TERMS = /software engineering|software development|software project|software architecture|software systems|software testing|software quality|computer science|algorithms?|data structures?|programming|coding|information processing|information and communication technolog|\bict\b|cyber ?security|computing|artificial intelligence|machine learning|data science|informatics|systems? engineering|computer network|\biot\b|electrical circuit|digital systems|human-computer interaction|tietojenkasittely/i
const SSE_TAGS = new Set(['software', 'software engineering', 'programming', 'computer science', 'algorithms', 'data structures', 'information processing', 'cyber security', 'computing', 'artificial intelligence', 'machine learning', 'data science', 'informatics', 'systems engineering', 'ict'])
const FOCUS_TERMS: Record<SisuCourseFocus, RegExp> = {
  software: /software|programming|computer science|computer|algorithm|data structure|coding|information processing|web|cyber ?security|computing|ict|informatics/i,
  ai: /artificial intelligence|machine learning|\bai\b|data science|data analytics/i,
  systems: /system engineering|systems engineering|network|iot|circuit|physics|digital system/i,
  international: /chinese|china|language|english|communication/i,
}

function inferTags(value: string): SisuCourseFocus[] {
  const text = normalizedSearchText(value)
  return (Object.keys(FOCUS_TERMS) as SisuCourseFocus[]).filter((focus) => FOCUS_TERMS[focus].test(text))
}

function isPublicPlannerCourse(value: unknown): value is PublicPlannerCourse {
  if (!value || typeof value !== 'object') return false
  const course = value as Partial<PublicPlannerCourse>
  return typeof course.id === 'string' && course.id.length > 0 &&
    typeof course.name === 'string' && course.name.trim().length > 0
}

/** Merge by normalized course code; only code-less records use the exact-title fallback. */
export function buildPlannerCourses(
  lessons: Lesson[] = [],
  enrolled: EnrolledCourse[] = [],
  publicCourses: PublicPlannerCourse[] = [],
  identityIndex?: CourseIdentityIndex,
): PlannerCourse[] {
  const courses = new Map(HDD_COURSES.map((item) => [item.key, item]))
  const courseCodes = new Map(HDD_COURSES.flatMap((item) => item.code ? [[item.code, item.key] as const] : []))
  const titleKeys = new Map<string, string>()
  const rememberTitle = (title: string, key: string) => {
    const normalized = normalizedTitle(title)
    if (!normalized) return
    const previous = titleKeys.get(normalized)
    if (previous !== '') titleKeys.set(normalized, previous === undefined || previous === key ? key : '')
  }

  const upsert = (incoming: PlannerCourse) => {
    const codeKey = incoming.code ? courseCodes.get(incoming.code) : undefined
    const titleKey = titleKeys.get(normalizedTitle(incoming.name))
    const byTitle = titleKey ? courses.get(titleKey) : undefined
    const titleMatch = byTitle && !byTitle.code && !incoming.code ? byTitle : undefined
    const existing = (codeKey && courses.get(codeKey)) ?? titleMatch ?? courses.get(incoming.key)
    if (!existing) {
      courses.set(incoming.key, incoming)
      if (incoming.code) courseCodes.set(incoming.code, incoming.key)
      rememberTitle(incoming.name, incoming.key)
      return
    }
    const programme = existing.sources.includes('programme')
    const merged: PlannerCourse = {
      ...existing,
      code: existing.code ?? incoming.code,
      name: programme || existing.sources.includes('sisu') ? existing.name : incoming.name,
      credits: programme ? existing.credits : (incoming.credits ?? existing.credits),
      creditRange: programme ? existing.creditRange : (incoming.creditRange ?? existing.creditRange),
      periods: existing.periods ?? incoming.periods,
      studyYears: [...new Set([...(existing.studyYears ?? []), ...(incoming.studyYears ?? [])])],
      relevanceText: [existing.relevanceText, incoming.relevanceText].filter(Boolean).join(' '),
      publicTags: [...new Set([...(existing.publicTags ?? []), ...(incoming.publicTags ?? [])])],
      publicCourse: existing.publicCourse ?? incoming.publicCourse,
      tags: [...new Set([...existing.tags, ...incoming.tags])],
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
    const relevanceText = `${item.code ?? ''} ${item.name} ${item.studyFields?.join(' ') ?? ''} ${item.searchTags?.join(' ') ?? ''}`
    upsert({
      key, code, name: item.name, credits: item.credits, creditRange: item.creditRange,
      category: 'public', studyYears: item.studyYears, relevanceText,
      publicTags: item.searchTags, publicCourse: item, tags: inferTags(relevanceText),
      sources: ['sisu'], url: `https://sisu.lut.fi/student/courseunit/${item.id}`,
    })
  }

  for (const item of enrolled) {
    const official = identityIndex?.forName(item.shortname) ?? identityIndex?.forName(item.fullname)
    const code = normalizeCode(identityIndex?.codeFor(item.courseid) ?? official?.code ??
      extractCourseCode(item.shortname) ?? extractCourseCode(item.fullname))
    const name = item.fullname.replace(/^\s*[A-Z]{1,5}\d[A-Z0-9]{2,}(?:-\d{4})?\s*/i, '').split(/\s+-\s+/)[0].trim() || item.fullname
    upsert({
      key: code ?? `moodle:${item.courseid}`, code,
      name: code && HDD_COURSES.some((known) => known.code === code) ? name : (name || item.fullname),
      category: 'moodle', tags: inferTags(`${item.shortname} ${item.fullname}`),
      sources: ['moodle'], url: moodleCourseUrl(item.courseid) ?? undefined,
    })
  }

  for (const lesson of lessons) {
    const code = normalizeCode(lesson.code) ?? normalizeCode(extractCourseCode(lesson.title))
    const name = code
      ? lesson.title.replace(new RegExp(`^\\s*${code}\\s*[-:–]?\\s*`, 'i'), '').trim() || lesson.title
      : lesson.title
    upsert({
      key: code ?? `timetable:${normalizedTitle(name)}`, code, name,
      category: 'timetable', tags: inferTags(`${code ?? ''} ${name}`), sources: ['timetable'],
    })
  }
  return [...courses.values()]
}

export function isSseRelevantCourse(course: Pick<PlannerCourse, 'code' | 'name' | 'tags' | 'sources' | 'relevanceText' | 'publicTags'>): boolean {
  return course.sources.some((source) => source !== 'sisu') ||
    (course.publicTags ?? []).some((tag) => SSE_TAGS.has(normalizedSearchText(tag).trim())) ||
    SSE_TERMS.test(normalizedSearchText(`${course.code ?? ''} ${course.name} ${course.relevanceText ?? ''} ${course.tags.join(' ')}`))
}

export function rankPlannerCourses(courses: readonly PlannerCourse[], focus: SisuCourseFocus): PlannerCourse[] {
  return [...courses].sort((a, b) => {
    const scoreA = FOCUS_TERMS[focus].test(normalizedSearchText(`${a.code ?? ''} ${a.name} ${a.relevanceText ?? ''} ${a.tags.join(' ')}`)) ? 1 : 0
    const scoreB = FOCUS_TERMS[focus].test(normalizedSearchText(`${b.code ?? ''} ${b.name} ${b.relevanceText ?? ''} ${b.tags.join(' ')}`)) ? 1 : 0
    return scoreB - scoreA || (a.code ?? a.name).localeCompare(b.code ?? b.name)
  })
}

export function loadSisuCoursePreferences(): SisuCoursePreferences {
  const raw = readJson<Partial<SisuCoursePreferences> & { selectedCodes?: unknown } | null>(PREFERENCES_KEY, null)
  if (!raw) return { ...DEFAULT_PREFERENCES }
  const selected = Array.isArray(raw.selectedCourseKeys) ? raw.selectedCourseKeys : raw.selectedCodes
  return {
    focus: VALID_FOCI.has(raw.focus as SisuCourseFocus) ? raw.focus as SisuCourseFocus : DEFAULT_PREFERENCES.focus,
    selectedCourseKeys: Array.isArray(selected)
      ? [...new Set(selected.filter((key): key is string => typeof key === 'string' && key.trim().length > 0))]
      : [],
    selectedCourses: Array.isArray(raw.selectedCourses) ? raw.selectedCourses.filter(isPublicPlannerCourse) : [],
  }
}

export function saveSisuCoursePreferences(value: SisuCoursePreferences): SisuCoursePreferences {
  const safe: SisuCoursePreferences = {
    focus: VALID_FOCI.has(value.focus) ? value.focus : DEFAULT_PREFERENCES.focus,
    selectedCourseKeys: [...new Set(value.selectedCourseKeys.filter((key) => typeof key === 'string' && key.trim().length > 0))],
    selectedCourses: value.selectedCourses.filter(isPublicPlannerCourse),
  }
  writeJson(PREFERENCES_KEY, safe)
  return safe
}
