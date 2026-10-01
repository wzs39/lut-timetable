// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  collectCourseResources,
  heButLoginUrl,
  heButCourseSearchUrl,
  isCourseResourceFavorite,
  isHddCourse,
  loadCourseResourceFavorites,
  loadRecentCourseResources,
  recordCourseResourceVisit,
  searchCourseResources,
  toggleCourseResourceFavorite,
  type CourseResource,
} from '../lib/courseResources'
import type { CourseSection } from '../lib/contents'

const resource: CourseResource = {
  courseId: 41,
  courseName: 'Data Structures',
  sectionName: 'Week 2',
  id: 702,
  name: 'Lecture slides: Trees',
  modname: 'resource',
  url: 'https://moodle.lut.fi/mod/resource/view.php?id=702',
  description: 'Binary search trees and balancing',
}

beforeEach(() => localStorage.clear())

describe('course resources', () => {
  it('collects visible linked course modules and supports multiword search', () => {
    const sections: CourseSection[] = [{
      id: 1,
      name: 'Week 2',
      visible: true,
      modules: [{ id: 702, name: 'Lecture slides: Trees', modname: 'resource', url: resource.url, description: resource.description, visible: true }],
    }]
    expect(collectCourseResources([{ courseId: 41, courseName: 'Data Structures', sections }])).toEqual([resource])
    expect(searchCourseResources([resource], 'binary trees')).toEqual([resource])
    expect(searchCourseResources([resource], 'binary missing')).toEqual([])
    expect(searchCourseResources([resource], '')).toEqual([])
  })

  it('persists favorites and deduplicated bounded recent history', () => {
    expect(toggleCourseResourceFavorite(resource)).toEqual([resource])
    expect(isCourseResourceFavorite(resource, loadCourseResourceFavorites())).toBe(true)
    expect(toggleCourseResourceFavorite(resource)).toEqual([])
    expect(isCourseResourceFavorite(resource, loadCourseResourceFavorites())).toBe(false)

    recordCourseResourceVisit(resource, '2026-09-01T10:00:00.000Z')
    const newer = recordCourseResourceVisit(resource, '2026-09-02T10:00:00.000Z')
    expect(newer).toHaveLength(1)
    expect(newer[0].visitedAt).toBe('2026-09-02T10:00:00.000Z')
    expect(loadRecentCourseResources()).toEqual(newer)
  })

  it('recognizes only HDD-prefixed codes and keeps HEBUT separate from LUT Moodle', () => {
    expect(isHddCourse('HDD1234')).toBe(true)
    expect(isHddCourse('hdd-220')).toBe(true)
    expect(isHddCourse('CT60A0250 HDD intro')).toBe(false)
    expect(heButLoginUrl()).toBe('https://hebut.maisterilms.com/login/index.php')
    expect(heButCourseSearchUrl()).toBe('https://hebut.maisterilms.com/course/search.php?search=HDD')
    expect(heButCourseSearchUrl('HDD A/B')).toContain('search=HDD%20A%2FB')
  })
})
