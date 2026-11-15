// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import LessonDetail from '../../components/LessonDetail'
import { I18nProvider } from '../../i18n'
import { PomodoroProvider } from '../../hooks/usePomodoro'
import type { Lesson } from '../../types'
import type { CourseGrades } from '../../lib/grades'
import type { Task } from '../../lib/tasks'
import { KEYS, TRANSIENT_KEYS, writeJson } from '../../lib/storage'

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

const sampleLesson: Lesson = {
  id: 'les-1',
  source: 'sisu',
  code: 'CT60A2411',
  title: 'Data Structures and Algorithms',
  type: 'lecture',
  location: '1325',
  start: '2026-09-21T08:00:00.000Z',
  end: '2026-09-21T10:00:00.000Z',
  mergedSources: ['sisu', 'timeedit'],
}

const sampleGrades: CourseGrades[] = [
  {
    courseId: 404,
    course: 'CT60A2411',
    courseTitle: 'CT60A2411 Data Structures and Algorithms',
    matched: true,
    average: 90,
    items: [
      {
        name: 'Project Milestone 1',
        grade: 90,
        max: 50,
        classAvg: null,
        weight: 40,
        gradeText: '45',
      },
      {
        name: 'Final Exam',
        grade: null,
        max: 100,
        classAvg: null,
        weight: 60,
      },
    ],
  },
]

const sampleTasks: Task[] = [
  {
    id: 'task-dsa-1',
    title: 'Implement AVL Tree',
    course: 'CT60A2411',
    dueAt: '2026-10-01T21:00:00.000Z',
    completed: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  },
]

describe('LessonDetail — Right Context Inspector & Unified Course Dossier', () => {
  it('renders full Unified Course Dossier when opened with a Lesson object', () => {
    writeJson(KEYS.sisuLiveFacts, {
      CT60A2411: {
        code: 'CT60A2411',
        nameEn: 'Data Structures and Algorithms',
        credits: 6,
        totalStudyHours: 162,
        periods: ['P1', 'P2'],
      },
    })
    localStorage.setItem(
      `${TRANSIENT_KEYS.icsCachePrefix}contents_404`,
      JSON.stringify({
        fetchedAt: Date.now(),
        items: [
          {
            id: 1,
            name: 'Week 1 Lecture Slides',
            visible: true,
            modules: [
              {
                id: 11,
                name: 'AVL Trees Slides',
                modname: 'resource',
                url: 'https://moodle.lut.fi/mod/resource/view.php?id=11',
                visible: true,
              },
            ],
          },
        ],
      }),
    )

    const onToggleTask = vi.fn()
    render(
      <I18nProvider>
        <PomodoroProvider>
          <LessonDetail
            lesson={sampleLesson}
            grades={sampleGrades}
            assignments={sampleTasks}
            allLessons={[sampleLesson]}
            onSave={() => {}}
            onDelete={() => {}}
            onClose={() => {}}
            onToggleTask={onToggleTask}
          />
        </PomodoroProvider>
      </I18nProvider>,
    )

    // Drawer & Tri-Source badges
    expect(screen.getByTestId('course-dossier-drawer')).toBeTruthy()
    const badges = screen.getByTestId('dossier-source-badges')
    expect(badges.textContent).toContain('SISU')
    expect(badges.textContent).toContain('TimeEdit')
    expect(badges.textContent).toContain('Moodle')

    // Pending assignments with inline checkbox sync
    const checkbox = screen.getByTestId('dossier-task-checkbox-task-dsa-1')
    fireEvent.click(checkbox)
    expect(onToggleTask).toHaveBeenCalledWith(sampleTasks[0], true)

    // Courseware resource link rendered via ExternalLink
    expect(screen.getByText('AVL Trees Slides')).toBeTruthy()

    // Grade projection & LUT 1-5 target reverse solver
    const gradeSolver = screen.getByTestId('dossier-grade-solver')
    expect(gradeSolver.textContent).toContain('G1')
    expect(gradeSolver.textContent).toContain('G5')

    // Focus Cockpit start button
    const focusSection = screen.getByTestId('dossier-focus-cockpit')
    expect(focusSection.textContent).toContain('162h')
    fireEvent.click(screen.getByTestId('dossier-start-focus-btn'))
  })

  it('opens by courseCode without a timetable Lesson object and displays cross-source dossier', () => {
    render(
      <I18nProvider>
        <PomodoroProvider>
          <LessonDetail
            lesson={null}
            courseCode="CT60A2411"
            grades={sampleGrades}
            assignments={sampleTasks}
            allLessons={[]}
            onClose={() => {}}
          />
        </PomodoroProvider>
      </I18nProvider>,
    )

    expect(screen.getByTestId('course-dossier-drawer')).toBeTruthy()
    expect(screen.getByText('CT60A2411')).toBeTruthy()
    // Discrepancy alert when course has SISU/Moodle data but zero timetable sessions
    expect(screen.getByTestId('dossier-discrepancies')).toBeTruthy()
    expect(screen.getByTestId('dossier-grade-solver')).toBeTruthy()
    expect(screen.getByTestId('dossier-focus-cockpit')).toBeTruthy()
  })
})
