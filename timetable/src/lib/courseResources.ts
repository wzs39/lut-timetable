import type { CourseSection } from './contents'
import { KEYS, readJson, writeJson } from './storage'

export interface CourseResource {
  courseId: number
  courseName: string
  sectionName: string
  id: number
  name: string
  modname: string
  url?: string
  description?: string
}

export interface RecentCourseResource extends CourseResource {
  visitedAt: string
}

const MAX_RECENT = 30
const HEBUT_ORIGIN = 'https://hebut.maisterilms.com'

export function heButLoginUrl(): string {
  return `${HEBUT_ORIGIN}/login/index.php`
}

export function isHddCourse(name: string | undefined): boolean {
  return /^HDD/i.test(name?.trim() ?? '')
}

export function heButCourseSearchUrl(code = 'HDD'): string {
  return `${HEBUT_ORIGIN}/course/search.php?search=${encodeURIComponent(code.trim() || 'HDD')}`
}

export function collectCourseResources(
  courses: Array<{ courseId: number; courseName: string; sections: CourseSection[] | null }>,
): CourseResource[] {
  const out: CourseResource[] = []
  for (const course of courses) {
    for (const section of course.sections ?? []) {
      for (const module of section.modules) {
        if (!module.url) continue
        out.push({
          courseId: course.courseId,
          courseName: course.courseName,
          sectionName: section.name,
          id: module.id,
          name: module.name,
          modname: module.modname,
          url: module.url,
          description: module.description,
        })
      }
    }
  }
  return out
}

export function searchCourseResources(resources: CourseResource[], query: string): CourseResource[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  return resources.filter((resource) => {
    const haystack = `${resource.courseName} ${resource.sectionName} ${resource.name} ${resource.modname} ${resource.description ?? ''}`.toLocaleLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}

function resourceKey(resource: Pick<CourseResource, 'courseId' | 'id'>): string {
  return `${resource.courseId}:${resource.id}`
}

export function loadCourseResourceFavorites(): CourseResource[] {
  const raw = readJson<CourseResource[]>(KEYS.courseResourceFavorites, [])
  if (!Array.isArray(raw)) return []
  return raw.filter(isCourseResource)
}

export function toggleCourseResourceFavorite(resource: CourseResource): CourseResource[] {
  const current = loadCourseResourceFavorites()
  const key = resourceKey(resource)
  const next = current.some((item) => resourceKey(item) === key)
    ? current.filter((item) => resourceKey(item) !== key)
    : [resource, ...current]
  writeJson(KEYS.courseResourceFavorites, next)
  return next
}

export function loadRecentCourseResources(): RecentCourseResource[] {
  const raw = readJson<RecentCourseResource[]>(KEYS.courseResourceRecent, [])
  if (!Array.isArray(raw)) return []
  return raw.filter((item) => isCourseResource(item) && typeof item.visitedAt === 'string')
}

export function recordCourseResourceVisit(resource: CourseResource, visitedAt = new Date().toISOString()): RecentCourseResource[] {
  const next: RecentCourseResource[] = [
    { ...resource, visitedAt },
    ...loadRecentCourseResources().filter((item) => resourceKey(item) !== resourceKey(resource)),
  ].slice(0, MAX_RECENT)
  writeJson(KEYS.courseResourceRecent, next)
  return next
}

export function isCourseResourceFavorite(
  resource: CourseResource,
  favorites: readonly CourseResource[],
): boolean {
  const key = resourceKey(resource)
  return favorites.some((item) => resourceKey(item) === key)
}

function isCourseResource(value: unknown): value is CourseResource {
  if (!value || typeof value !== 'object') return false
  const resource = value as Partial<CourseResource>
  return typeof resource.courseId === 'number' &&
    typeof resource.id === 'number' &&
    typeof resource.name === 'string' &&
    typeof resource.courseName === 'string' &&
    typeof resource.sectionName === 'string' &&
    typeof resource.modname === 'string'
}
