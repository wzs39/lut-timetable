import {
  isSseRelevantCourse,
  rankPlannerCourses,
  type PlannerCourse,
  type SisuCourseFocus,
  type SisuCoursePreferences,
  type PublicPlannerCourse,
} from './sisuCourseCatalog'
import { normalizeCourseCode } from './ics'

function plannerCourseIdentity(course: Pick<PlannerCourse, 'key' | 'code'>): string {
  const code = courseCode(course.code)
  if (code) return `code:${code}`
  return course.key.startsWith('sisu:') ? `id:${course.key.slice(5)}` : `key:${course.key}`
}

function normalizedTitle(title: string): string {
  return title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function courseCode(code: string | undefined): string | undefined {
  return code ? normalizeCourseCode(code) || undefined : undefined
}

export function coursePlanIdentity(course: { code?: string; name: string }): string {
  const code = courseCode(course.code)
  return code ? `code:${code}` : `title:${normalizedTitle(course.name)}`
}

export function planItemIdentity(item: { courseCode?: string; title: string }): string {
  return coursePlanIdentity({ code: item.courseCode, name: item.title })
}

export function publicPlannerCourseIdentity(course: Pick<PublicPlannerCourse, 'id' | 'code'>): string {
  return course.code
    ? `code:${courseCode(course.code)}`
    : `id:${course.id}`
}

export function isPlannerCourseSelected(course: PlannerCourse, selectedKeys: readonly string[]): boolean {
  return selectedKeys.includes(plannerCourseIdentity(course)) || selectedKeys.includes(course.key) ||
    Boolean(course.code && selectedKeys.includes(courseCode(course.code) ?? course.code))
}

export function togglePlannerCourseSelection(
  preferences: SisuCoursePreferences,
  course: PlannerCourse,
): SisuCoursePreferences {
  const identity = plannerCourseIdentity(course)
  const selected = isPlannerCourseSelected(course, preferences.selectedCourseKeys)
  const legacyKeys = new Set([course.key, course.code, courseCode(course.code)].filter((key): key is string => Boolean(key)))
  const selectedCourseKeys = selected
    ? preferences.selectedCourseKeys.filter((key) => key !== identity && !legacyKeys.has(key))
    : [...preferences.selectedCourseKeys, identity]
  const selectedCourses = course.publicCourse && course.sources.includes('sisu')
    ? selected
      ? preferences.selectedCourses.filter((item) => publicPlannerCourseIdentity(item) !== identity)
      : [...preferences.selectedCourses.filter((item) => publicPlannerCourseIdentity(item) !== identity), course.publicCourse]
    : preferences.selectedCourses
  return { ...preferences, selectedCourseKeys, selectedCourses }
}

export function selectedPlannerCourses(courses: readonly PlannerCourse[], selectedKeys: readonly string[]): PlannerCourse[] {
  return [...new Map(courses.filter((item) => isPlannerCourseSelected(item, selectedKeys))
    .map((item) => [coursePlanIdentity(item), item])).values()]
}

export function selectedPlannerCourseCredits(courses: readonly PlannerCourse[]): { credits: number; unknown: number } {
  return {
    credits: courses.reduce((sum, item) => sum + (item.credits ?? 0), 0),
    unknown: courses.filter((item) => item.credits == null).length,
  }
}

export function visiblePlannerCourses(input: {
  courses: readonly PlannerCourse[]
  focus: SisuCourseFocus
  query: string
  currentResultQuery?: string
  currentResultIdentities?: readonly string[]
  selectedKeys: readonly string[]
  plannedIdentities: ReadonlySet<string>
  onlySseRelevant: boolean
}): PlannerCourse[] {
  const query = input.query.trim().toLocaleLowerCase()
  const currentResults = new Set(input.currentResultIdentities ?? [])
  return rankPlannerCourses(input.courses, input.focus).filter((item) => {
    const selected = isPlannerCourseSelected(item, input.selectedKeys)
    const planned = input.plannedIdentities.has(coursePlanIdentity(item))
    if (input.onlySseRelevant && item.sources.includes('sisu') && !selected && !isSseRelevantCourse(item)) return false
    if (item.sources.includes('sisu')) {
      const current = input.currentResultQuery?.toLocaleLowerCase() === query &&
        currentResults.has(plannerCourseIdentity(item))
      return current || selected || planned
    }
    return !query || `${item.code ?? ''} ${item.name} ${item.relevanceText ?? ''}`.toLocaleLowerCase().includes(query)
  })
}
