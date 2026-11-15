// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import {
  buildSampleEnrolled,
  buildSampleGrades,
  buildSampleLessons,
  buildSamplePlanItems,
  buildSampleStudyBlocks,
  buildSampleTasks,
  ensureBrowserGlobals,
  renderFullApp,
  seedFullAcademicState,
} from './helpers/fixtures'
import { KEYS, BACKUP_KEYS } from '../src/lib/storage'
import { buildCourseGraph } from '../src/lib/courseGraph'
import { buildCourseDossier } from '../src/lib/courseDossier'
import { solveGradeTargetsByLevel } from '../src/lib/gradeCalc'
import { parseOmniQuickAdd } from '../src/lib/quickAdd'
import { DEFAULT_POMODORO_CONFIG, recordFocusRound, startFocusForBlock } from '../src/lib/pomodoro'
import { importBackup } from '../src/lib/backup'
import { prefersReducedMotion } from '../src/lib/motion'

describe('Tier 4 · Real-World Academic Scenarios', () => {
  beforeEach(() => {
    localStorage.clear()
    location.hash = ''
    ensureBrowserGlobals(false)
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('Scenario 1 · Morning Pre-Class Triage -> Live Stage -> Course Dossier Inspection -> Focus Start', () => {
    seedFullAcademicState()
    renderFullApp()

    const stage = screen.getByTestId('today-live-stage')
    expect(stage).toBeTruthy()
    expect(screen.getByTestId('free-room-filters')).toBeTruthy()

    // Navigate to Courses workspace & open Course Dossier for CT60A2411
    fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
    fireEvent.click(screen.getByRole('tab', { name: /课程/ }))
    fireEvent.click(screen.getByTestId('course-dossier-btn-CT60A2411'))

    expect(document.body.textContent).toContain('Review sequence diagrams before exam')
    expect(document.body.textContent).toContain('Lab 1 UML Diagram')
  })

  it('Scenario 2 · Omni-Command NL Study Block -> Week Grid Verification -> Pomodoro Focus -> Dossier Hours', () => {
    const now = new Date('2026-10-12T08:00:00')
    seedFullAcademicState(now)

    const nl = parseOmniQuickAdd('周四 15:00 CS30A1300 算法复习 90m', now)!
    expect(nl.kind).toBe('study-block')
    expect(nl.course).toBe('CS30A1300')

    const existingBlocks = JSON.parse(localStorage.getItem(KEYS.studyBlocks) || '[]')
    const addedBlock = {
      id: 'scenario2-block',
      sourceKind: 'task' as const,
      sourceId: 'omni',
      title: nl.title,
      courseCode: nl.course,
      startAt: nl.startOrDueAt!,
      endAt: nl.endAt!,
      completed: false,
      createdAt: now.toISOString(),
    }
    localStorage.setItem(KEYS.studyBlocks, JSON.stringify([...existingBlocks, addedBlock]))

    const timer = startFocusForBlock(DEFAULT_POMODORO_CONFIG, addedBlock, now.getTime())
    expect(timer.courseCode).toBe('CS30A1300')
    const ledged = recordFocusRound(
      {
        config: DEFAULT_POMODORO_CONFIG,
        day: '2026-10-12',
        roundsToday: 0,
        focusMinutesByCourse: {},
        focusMinutesByDay: {},
        recentSessions: [],
      },
      now,
      { courseCode: 'CS30A1300', minutes: 45 },
    )

    const graph = buildCourseGraph({
      lessons: buildSampleLessons(now),
      planItems: buildSamplePlanItems(),
      studyBlocks: [...existingBlocks, addedBlock],
    })
    const dossier = buildCourseDossier(graph.byKey.get('CS30A1300')!, {
      attendanceLog: {},
      notesMap: {},
      focusMinutesByCourse: ledged.focusMinutesByCourse,
      now,
    })
    expect(dossier.focus.focusMinutes).toBe(45)
    expect(dossier.node.studyBlocks.length).toBe(1)

    renderFullApp()
    fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
    expect(screen.getByTestId('week-semester-strip')).toBeTruthy()
  })

  it('Scenario 3 · Midterm Crunch Week Triage: 14-Day Crunch Radar -> Kanban -> Task Completion Sync', () => {
    seedFullAcademicState()
    renderFullApp()

    fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
    const chart = screen.getByTestId('crunch-radar-chart')
    expect(chart.querySelector('svg')).toBeTruthy()

    fireEvent.click(screen.getByTestId('tasks-mode-kanban'))
    const overdueCol = screen.getByTestId('kanban-col-overdue')
    expect(overdueCol.textContent).toContain('Lab 1 UML Diagram')

    const checkbox = overdueCol.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox)
    const tasksAfter = JSON.parse(localStorage.getItem(KEYS.tasks)!)
    expect(tasksAfter.find((t: { id: string }) => t.id === 'task-overdue').completed).toBe(true)
  })

  it('Scenario 4 · Target Grade 5 Planning: Grades & SISU Workspace -> Reverse Solver -> Prereq DAG', () => {
    seedFullAcademicState()
    renderFullApp()

    fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
    fireEvent.click(screen.getByRole('tab', { name: /成绩/ }))
    expect(screen.getByTestId('sisu-prereq-graph')).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: /预估总分|What-if/i })[0])
    expect(screen.getByTestId('grade-lut-solver')).toBeTruthy()
    fireEvent.click(screen.getByTestId('grade-lut-level-4'))
    expect(localStorage.getItem(KEYS.gradeTarget)).toBe('80')

    const solver = solveGradeTargetsByLevel(buildSampleGrades()[0].items, {}, undefined)
    expect(solver[4].grade).toBe(5)
    expect(solver[4].plan.status).toBe('possible')
  })

  it('Scenario 5 · Tri-Source Onboarding & Discrepancy Reconciliation Across TimeEdit, Moodle & SISU', () => {
    const graph = buildCourseGraph({
      lessons: buildSampleLessons(),
      enrolled: buildSampleEnrolled(),
      grades: buildSampleGrades(),
      planItems: buildSamplePlanItems(),
      tasks: buildSampleTasks(),
      studyBlocks: buildSampleStudyBlocks(),
    })

    expect(graph.discrepancies.some((d) => d.kind === 'moodle-only')).toBe(true)
    expect(graph.discrepancies.some((d) => d.kind === 'timetable-only')).toBe(true)
    expect(graph.discrepancies.some((d) => d.kind === 'plan-status-mismatch')).toBe(true)

    seedFullAcademicState()
    renderFullApp()
    fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
    fireEvent.click(screen.getByRole('tab', { name: /课程/ }))
    expect(screen.getByTestId('courses-discrepancies-banner')).toBeTruthy()
    expect(screen.getByTestId('courses-tri-source-list')).toBeTruthy()
  })

  it('Scenario 6 · Full Semester Backup/Restore Round-Trip Across Keys with Reduced-Motion Active', () => {
    seedFullAcademicState()
    const snapshot: Record<string, string> = {}
    for (const k of BACKUP_KEYS) {
      const val = localStorage.getItem(k)
      if (val !== null) snapshot[k] = val
    }

    localStorage.clear()
    const written = importBackup(
      JSON.stringify({
        app: 'lut-timetable',
        version: 1,
        exportedAt: new Date().toISOString(),
        data: snapshot,
      }),
    )
    expect(written).toBe(Object.keys(snapshot).length)

    ensureBrowserGlobals(true)
    expect(prefersReducedMotion()).toBe(true)
    renderFullApp()
    expect(screen.getByTestId('today-live-stage')).toBeTruthy()
    expect(document.body.textContent).toContain('CT60A2411')
  })
})
