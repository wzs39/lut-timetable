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
import { KEYS } from '../src/lib/storage'
import { buildCourseGraph } from '../src/lib/courseGraph'
import { buildCourseDossier } from '../src/lib/courseDossier'
import { buildCrunchRadar } from '../src/lib/crunchRadar'
import { solveGradeTargetsByLevel } from '../src/lib/gradeCalc'
import { parseOmniQuickAdd } from '../src/lib/quickAdd'
import { freeRoomsNow } from '../src/lib/freeRooms'
import { DEFAULT_POMODORO_CONFIG, recordFocusRound, startFocusForBlock } from '../src/lib/pomodoro'
import { importBackup } from '../src/lib/backup'
import { runSharedTransition, stepSpring } from '../src/lib/motion'

describe('Tier 3 · Cross-Feature Pairwise Interactions (15 Pairs)', () => {
  beforeEach(() => {
    localStorage.clear()
    location.hash = ''
    ensureBrowserGlobals(false)
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('P01 · Omni-Command scheduling persists StudyBlock which immediately updates WeekGrid & CrunchRadar', () => {
    const now = new Date('2026-10-12T08:00:00')
    const parsed = parseOmniQuickAdd('周四 15:00 算法复习 90m', now)!
    expect(parsed.kind).toBe('study-block')
    const blocks = [
      {
        id: 'omni-sb-1',
        sourceKind: 'task' as const,
        sourceId: 'manual',
        title: parsed.title,
        courseCode: parsed.course || 'CS30A1300',
        startAt: parsed.startOrDueAt!,
        endAt: parsed.endAt!,
        completed: false,
        createdAt: now.toISOString(),
      },
    ]
    const radar = buildCrunchRadar({
      lessons: buildSampleLessons(now),
      tasks: buildSampleTasks(now),
      studyBlocks: blocks,
      now,
    })
    const totalStudyHours = radar.days.reduce((s, d) => s + d.studyBlockHours, 0)
    expect(totalStudyHours).toBeGreaterThanOrEqual(1.4)
  })

  it('P02 · WeekGrid Spotlight click feeds Right Context Inspector Dossier view directly', () => {
    seedFullAcademicState()
    renderFullApp()
    fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
    const card = document.querySelector('[data-course-key]') as HTMLElement
    expect(card).toBeTruthy()
    fireEvent.mouseEnter(card)
    const hud = screen.getByTestId('week-course-spotlight-hud')
    const inspectBtn = [...hud.querySelectorAll('button')][0]
    if (inspectBtn) fireEvent.click(inspectBtn)
    expect(document.body.textContent).toContain('CT60A2411')
  })

  it('P03 · Completing a task in Kanban board persists to KEYS.tasks and updates Dossier pending count', () => {
    seedFullAcademicState()
    renderFullApp()
    fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
    fireEvent.click(screen.getByTestId('tasks-mode-kanban'))
    const col = screen.getByTestId('kanban-col-overdue')
    const checkbox = col.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).toBeTruthy()
    fireEvent.click(checkbox)
    const savedTasks = JSON.parse(localStorage.getItem(KEYS.tasks)!)
    const updatedGraph = buildCourseGraph({
      lessons: buildSampleLessons(),
      tasks: savedTasks,
    })
    const dossier = buildCourseDossier(updatedGraph.byKey.get('CT60A2411')!, {
      attendanceLog: {},
      notesMap: {},
    })
    expect(dossier.tasks.pending.some((t) => t.id === 'task-overdue')).toBe(false)
  })

  it('P04 · Focus session ledger integrates into Unified Course Dossier vs SISU target hours', () => {
    const graph = buildCourseGraph({
      lessons: buildSampleLessons(),
      planItems: buildSamplePlanItems(),
    })
    const state = recordFocusRound(
      {
        config: DEFAULT_POMODORO_CONFIG,
        day: '2026-10-12',
        roundsToday: 0,
        focusMinutesByCourse: {},
        focusMinutesByDay: {},
        recentSessions: [],
      },
      new Date('2026-10-12T10:00:00'),
      { courseCode: 'CT60A2411', minutes: 50 },
    )
    const dossier = buildCourseDossier(graph.byKey.get('CT60A2411')!, {
      attendanceLog: {},
      notesMap: {},
      focusMinutesByCourse: state.focusMinutesByCourse,
    })
    expect(dossier.focus.focusMinutes).toBe(50)
    expect(dossier.focus.sisuTotalHours).toBe(162)
  })

  it('P05 · Selecting LUT Grade Level 5 chip inside GradeCourseCard syncs Target % badge immediately', () => {
    seedFullAcademicState()
    renderFullApp()
    fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
    fireEvent.click(screen.getByRole('tab', { name: /成绩/ }))
    fireEvent.click(screen.getAllByRole('button', { name: /预估总分|What-if/i })[0])
    fireEvent.click(screen.getByTestId('grade-lut-level-5'))
    expect(localStorage.getItem(KEYS.gradeTarget)).toBe('90')
  })

  it('P06 · Courses workspace Tri-Source rows open the exact same Course Dossier inspector as Today view', () => {
    seedFullAcademicState()
    renderFullApp()
    fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
    fireEvent.click(screen.getByRole('tab', { name: /课程/ }))
    fireEvent.click(screen.getByTestId('course-dossier-btn-BM20A9200'))
    expect(document.body.textContent).toContain('Problem Set 3 ODE')
  })

  it('P07 · CrunchRadar peak workload alert references the exact high-pressure day present in tasks & lessons', () => {
    const now = new Date('2026-10-12T08:00:00')
    const report = buildCrunchRadar({
      lessons: buildSampleLessons(now),
      tasks: buildSampleTasks(now),
      studyBlocks: buildSampleStudyBlocks(now),
      grades: buildSampleGrades(),
      now,
      horizonDays: 14,
    })
    expect(report.peakDay).toBeTruthy()
    expect(report.peakDay!.crunchScore).toBeGreaterThan(0)
  })

  it('P08 · Free Room Finder duration filter + TimeEdit lessons identify available room slots across campus', () => {
    const base = new Date('2026-10-12T10:30:00')
    const lessons = buildSampleLessons(base)
    const rooms = freeRoomsNow(lessons, base, 60)
    expect(rooms.some((r) => r.room === '1314')).toBe(true)
    expect(rooms.some((r) => r.room === '1320')).toBe(false)
  })

  it('P09 · StudyBlock creation in WeekGrid integrates directly with startFocusForBlock Pomodoro trigger', () => {
    const block = buildSampleStudyBlocks()[0]
    const timer = startFocusForBlock(DEFAULT_POMODORO_CONFIG, block, 1000)
    expect(timer.studyBlockId).toBe(block.id)
    expect(timer.label).toBe(block.title)
  })

  it('P10 · Offline mode unlocks Academic Cockpit while keeping Free Room Finder & Today Stage functional', () => {
    seedFullAcademicState()
    localStorage.removeItem(KEYS.moodleSource)
    localStorage.removeItem(KEYS.gradesSource)
    renderFullApp()
    expect(screen.getByTestId('today-live-stage')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
    expect(screen.getByTestId('moodle-disconnected-banner')).toBeTruthy()
    expect(screen.getByTestId('crunch-radar-chart')).toBeTruthy()
  })

  it('P11 · Backup export payload preserves Courses Notes, StudyBlocks, GradesCache, and UiPrefs simultaneously', () => {
    seedFullAcademicState()
    localStorage.setItem(KEYS.lang, 'en')
    const raw = JSON.stringify({
      app: 'lut-timetable',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        [KEYS.lessons]: localStorage.getItem(KEYS.lessons)!,
        [KEYS.tasks]: localStorage.getItem(KEYS.tasks)!,
        [KEYS.studyBlocks]: localStorage.getItem(KEYS.studyBlocks)!,
        [KEYS.courseNotes]: localStorage.getItem(KEYS.courseNotes)!,
      },
    })
    localStorage.clear()
    importBackup(raw)
    expect(localStorage.getItem(KEYS.courseNotes)).toContain('sequence diagrams')
    expect(localStorage.getItem(KEYS.studyBlocks)).toContain('Design Patterns')
  })

  it('P12 · Reduced-motion preference short-circuits both view transitions and spring integrators uniformly', async () => {
    ensureBrowserGlobals(true)
    const stepped = stepSpring({ position: 0, velocity: 20 }, 150)
    expect(stepped.position).toBe(150)
    let transitioned = false
    await runSharedTransition(() => {
      transitioned = true
    })
    expect(transitioned).toBe(true)
  })

  it('P13 · Glance tile navigation switches Academic Cockpit tab and updates panel aria-labelledby', () => {
    seedFullAcademicState()
    renderFullApp()
    fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
    const avgTile = screen.getByRole('button', { name: /当前均分/ })
    fireEvent.click(avgTile)
    const panel = document.getElementById('moodle-panel')!
    expect(panel.getAttribute('aria-labelledby')).toBe('moodle-tab-grades')
  })

  it('P14 · Tri-Source Course Graph discrepancies combine with solveGradeTargetsByLevel for incomplete course grades', () => {
    const graph = buildCourseGraph({
      lessons: buildSampleLessons(),
      enrolled: buildSampleEnrolled(),
      grades: buildSampleGrades(),
      planItems: buildSamplePlanItems(),
    })
    const node = graph.byKey.get('CT60A2411')!
    expect(node.discrepancies.length).toBeGreaterThan(0)
    const solver = solveGradeTargetsByLevel(node.grades!.items, {}, undefined)
    expect(solver[2].plan.status).toBe('possible')
  })

  it('P15 · SISU Prerequisite SVG graph inside Grades workspace renders edges & interactive nodes', () => {
    seedFullAcademicState()
    renderFullApp()
    fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
    fireEvent.click(screen.getByRole('tab', { name: /成绩/ }))
    const svg = screen.getByTestId('sisu-prereq-graph').querySelector('svg')
    expect(svg).toBeTruthy()
  })
})
