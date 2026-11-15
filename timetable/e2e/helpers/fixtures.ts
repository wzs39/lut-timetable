import { createElement } from 'react'
import { render } from '@testing-library/react'
import App from '../../src/App'
import { ThemeProvider } from '../../src/theme'
import { I18nProvider } from '../../src/i18n'
import type { Lesson } from '../../src/types'
import type { Task } from '../../src/lib/tasks'
import type { CourseGrades } from '../../src/lib/grades'
import type { EnrolledCourse } from '../../src/lib/courses'
import type { SisuPlanItem } from '../../src/lib/sisuStudyPlan'
import type { StudyBlock } from '../../src/lib/studyBlocks'
import { KEYS } from '../../src/lib/storage'

export function ensureBrowserGlobals(reducedMotion = false): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('min-width')
        ? true
        : query.includes('prefers-reduced-motion')
          ? reducedMotion
          : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}

export function renderFullApp() {
  ensureBrowserGlobals(false)
  return render(
    createElement(
      ThemeProvider,
      null,
      createElement(I18nProvider, null, createElement(App)),
    ),
  )
}

export function isoAt(dayOffset: number, hour: number, minute = 0, base = new Date()): string {
  const d = new Date(base)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

export function buildSampleLessons(base = new Date()): Lesson[] {
  return [
    {
      id: 'les-ct60a2411-1',
      title: 'CT60A2411 Ohjelmistotekniikka',
      code: 'CT60A2411',
      start: isoAt(0, 10, 0, base),
      end: isoAt(0, 12, 0, base),
      location: 'L1_1320',
      source: 'timeedit',
      teacher: 'Dr. Virtanen',
    },
    {
      id: 'les-bm20a9200-1',
      title: 'BM20A9200 Differential Equations',
      code: 'BM20A9200',
      start: isoAt(0, 14, 0, base),
      end: isoAt(0, 16, 0, base),
      location: 'L1_1314',
      source: 'sisu',
      teacher: 'Prof. Korhonen',
    },
    {
      id: 'les-cs30a1300-1',
      title: 'CS30A1300 Algorithms and Data Structures',
      code: 'CS30A1300',
      start: isoAt(-1, 9, 0, base),
      end: isoAt(-1, 11, 0, base),
      location: 'L2_2310',
      source: 'timeedit',
    },
    {
      id: 'les-manual-1',
      title: 'Team Standup',
      code: '',
      start: isoAt(-2, 13, 0, base),
      end: isoAt(-2, 14, 0, base),
      location: 'M19_AUD1B',
      source: 'manual',
    },
  ]
}

export function buildSampleTasks(base = new Date()): Task[] {
  const created = isoAt(-5, 9, 0, base)
  return [
    {
      id: 'task-overdue',
      title: 'Lab 1 UML Diagram',
      completed: false,
      course: 'CT60A2411',
      dueAt: isoAt(-1, 23, 59, base),
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'task-due3',
      title: 'Problem Set 3 ODE',
      completed: false,
      course: 'BM20A9200',
      dueAt: isoAt(0, 23, 59, base),
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'task-later',
      title: 'Final Project Architecture',
      completed: false,
      course: 'CT60A2411',
      dueAt: isoAt(10, 23, 59, base),
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'task-done',
      title: 'Setup Dev Environment',
      completed: true,
      course: 'CS30A1300',
      dueAt: isoAt(-2, 12, 0, base),
      createdAt: created,
      updatedAt: created,
    },
  ]
}

export function buildSampleGrades(): CourseGrades[] {
  return [
    {
      course: 'CT60A2411 Ohjelmistotekniikka',
      courseId: 101,
      matched: true,
      average: 78,
      officialTotal: 78,
      items: [
        { name: 'Midterm', grade: 78, max: 100, classAvg: null, weight: 40 },
        { name: 'Project', grade: null, max: 100, classAvg: null, weight: 60 },
      ],
    },
    {
      course: 'BM20A9200 Differential Equations',
      courseId: 102,
      matched: true,
      average: 86,
      officialTotal: 86,
      items: [
        { name: 'Exam 1', grade: 86, max: 100, classAvg: null, weight: 50 },
        { name: 'Exam 2', grade: null, max: 100, classAvg: null, weight: 50 },
      ],
    },
  ]
}

export function buildSampleEnrolled(): EnrolledCourse[] {
  return [
    {
      courseid: 101,
      shortname: 'CT60A2411-2026',
      fullname: 'CT60A2411 Ohjelmistotekniikka',
    },
    {
      courseid: 102,
      shortname: 'BM20A9200-2026',
      fullname: 'BM20A9200 Differential Equations',
    },
    {
      courseid: 103,
      shortname: 'CT60A9600-2026',
      fullname: 'CT60A9600 Cloud Systems',
    },
  ]
}

export function buildSamplePlanItems(): SisuPlanItem[] {
  return [
    {
      id: 'plan-1',
      title: 'Software Engineering',
      courseCode: 'CT60A2411',
      kind: 'course',
      category: 'intermediate',
      credits: 6,
      completed: false,
      studyYear: '2026-2027',
      periods: [1, 2],
      createdAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'plan-2',
      title: 'Algorithms and Data Structures',
      courseCode: 'CS30A1300',
      kind: 'course',
      category: 'intermediate',
      credits: 5,
      completed: false,
      studyYear: '2026-2027',
      periods: [2],
      createdAt: '2026-09-01T00:00:00.000Z',
    },
    {
      id: 'plan-3',
      title: 'Differential Equations',
      courseCode: 'BM20A9200',
      kind: 'course',
      category: 'general',
      credits: 5,
      completed: true,
      studyYear: '2025-2026',
      periods: [3],
      createdAt: '2025-09-01T00:00:00.000Z',
    },
  ]
}

export function buildSampleStudyBlocks(base = new Date()): StudyBlock[] {
  return [
    {
      id: 'sb-1',
      sourceKind: 'task',
      sourceId: 'task-due3',
      title: 'Review CT60A2411 Design Patterns',
      courseCode: 'CT60A2411',
      startAt: isoAt(0, 17, 0, base),
      endAt: isoAt(0, 18, 30, base),
      dueAt: isoAt(0, 23, 59, base),
      completed: false,
      createdAt: isoAt(-1, 10, 0, base),
    },
  ]
}

export function seedFullAcademicState(base = new Date()): {
  lessons: Lesson[]
  tasks: Task[]
  grades: CourseGrades[]
  enrolled: EnrolledCourse[]
  planItems: SisuPlanItem[]
  studyBlocks: StudyBlock[]
} {
  const lessons = buildSampleLessons(base)
  const tasks = buildSampleTasks(base)
  const grades = buildSampleGrades()
  const enrolled = buildSampleEnrolled()
  const planItems = buildSamplePlanItems()
  const studyBlocks = buildSampleStudyBlocks(base)

  localStorage.setItem(KEYS.onboardingDone, '1')
  localStorage.setItem(KEYS.lang, 'zh')
  localStorage.setItem(KEYS.lessons, JSON.stringify(lessons))
  localStorage.setItem(KEYS.tasks, JSON.stringify(tasks))
  localStorage.setItem(KEYS.gradesCache, JSON.stringify({ fetchedAt: base.toISOString(), courses: grades }))
  localStorage.setItem(KEYS.sisuStudyPlan, JSON.stringify({ goalCredits: 180, items: planItems }))
  localStorage.setItem(KEYS.studyBlocks, JSON.stringify(studyBlocks))
  localStorage.setItem(KEYS.courseNotes, JSON.stringify({
    'CT60A2411|other': {
      note: 'Review sequence diagrams before exam',
      updatedAt: base.toISOString(),
    },
  }))
  localStorage.setItem(
    KEYS.moodleSource,
    JSON.stringify({
      url: 'https://moodle.lut.fi/calendar/export_execute.php?userid=42&authtoken=demo',
      lastSync: base.toISOString(),
      count: tasks.length,
    }),
  )
  localStorage.setItem(KEYS.gradesSource, JSON.stringify({ token: 'demo-token', userid: 42 }))
  return { lessons, tasks, grades, enrolled, planItems, studyBlocks }
}
