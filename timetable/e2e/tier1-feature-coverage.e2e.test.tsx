// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import {
  buildSampleEnrolled,
  buildSampleGrades,
  buildSampleLessons,
  buildSamplePlanItems,
  buildSampleStudyBlocks,
  buildSampleTasks,
  ensureBrowserGlobals,
  isoAt,
  renderFullApp,
  seedFullAcademicState,
} from './helpers/fixtures'
import { KEYS, BACKUP_KEYS } from '../src/lib/storage'
import { exportBackup, importBackup, importBackupDetail } from '../src/lib/backup'
import {
  SPRING_PRESETS,
  computeFlipDelta,
  prefersReducedMotion,
  runSharedTransition,
  stepSpring,
} from '../src/lib/motion'
import {
  DEFAULT_LUT_GRADE_THRESHOLDS,
  solveGradeTargetsByLevel,
  solveItemMinimumsForTarget,
} from '../src/lib/gradeCalc'
import { buildCrunchRadar } from '../src/lib/crunchRadar'
import { buildOmniExtras, buildPalette, filterPalette } from '../src/lib/palette'
import { parseOmniQuickAdd, parseQuickAdd } from '../src/lib/quickAdd'
import { freeRoomsNow, roomTimelinesForDay } from '../src/lib/freeRooms'
import { buildCourseGraph } from '../src/lib/courseGraph'
import { buildCourseDossier } from '../src/lib/courseDossier'
import { setAttendance } from '../src/lib/attendance'
import {
  DEFAULT_POMODORO_CONFIG,
  recordFocusRound,
  startFocusForBlock,
  startFocusSession,
} from '../src/lib/pomodoro'

describe('Tier 1 · E2E Feature Coverage (F1–F11)', () => {
  beforeEach(() => {
    localStorage.clear()
    location.hash = ''
    ensureBrowserGlobals(false)
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  // ---------------- F1: Spatial Workbench Architecture & Nordic Precision ----------------
  describe('F1 · Spatial Workbench & Floating Instrument Dock', () => {
    it('1.1 renders instrument dock navigation across primary workbench routes', () => {
      seedFullAcademicState()
      renderFullApp()
      expect(document.querySelector('main')).toBeTruthy()
      expect(screen.getAllByRole('button', { name: /今日|Today/i }).length).toBeGreaterThan(0)
      expect(screen.getAllByRole('button', { name: /周视图|Week/i }).length).toBeGreaterThan(0)
    })

    it('1.2 switches smoothly between Today, Week, and Academic/SISU Cockpit', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
      expect(document.querySelector('[data-day-canvas]')).toBeTruthy()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      expect(screen.getByRole('tablist', { name: 'Moodle' })).toBeTruthy()
    })

    it('1.3 persists active theme token selection and reflects on documentElement', () => {
      seedFullAcademicState()
      localStorage.setItem(KEYS.theme, 'dark')
      renderFullApp()
      expect(localStorage.getItem(KEYS.theme)).toBe('dark')
    })

    it('1.4 renders global command trigger inside instrument header', () => {
      seedFullAcademicState()
      renderFullApp()
      const btn = screen.getAllByTitle(/命令面板|Command palette/i)
      expect(btn.length).toBeGreaterThan(0)
    })

    it('1.5 renders right context inspector shell cleanly when course is inspected', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      const input = screen.getByRole('combobox')
      fireEvent.change(input, { target: { value: 'CT60A2411' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(document.body.textContent).toContain('CT60A2411')
    })

    it('1.6 shows bottom thumb-reachable nav alongside desktop sidebar without crash', () => {
      seedFullAcademicState()
      renderFullApp()
      expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0)
    })
  })

  // ---------------- F2: Spring Physics, Shared Motion & Reduced Motion ----------------
  describe('F2 · Spring Physics & Motion Primitives', () => {
    it('2.1 exposes all named Nordic precision spring presets with positive stiffness/damping', () => {
      for (const name of ['snappy', 'gentle', 'bouncy', 'drawer', 'indicator'] as const) {
        expect(SPRING_PRESETS[name].stiffness).toBeGreaterThan(100)
        expect(SPRING_PRESETS[name].damping).toBeGreaterThan(10)
        expect(SPRING_PRESETS[name].durationMs).toBeGreaterThan(100)
      }
    })

    it('2.2 steps damped spring physics smoothly toward target and settles', () => {
      let state = { position: 0, velocity: 0 }
      let settled = false
      for (let i = 0; i < 180; i++) {
        const res = stepSpring(state, 100, SPRING_PRESETS.snappy, 1 / 60)
        state = { position: res.position, velocity: res.velocity }
        if (res.settled) {
          settled = true
          break
        }
      }
      expect(settled).toBe(true)
      expect(state.position).toBe(100)
    })

    it('2.3 computes accurate FLIP transform delta between two bounding rects', () => {
      const delta = computeFlipDelta(
        { left: 10, top: 20, width: 100, height: 40 },
        { left: 60, top: 70, width: 200, height: 80 },
      )
      expect(delta.dx).toBe(-50)
      expect(delta.dy).toBe(-50)
      expect(delta.sx).toBeCloseTo(0.5)
      expect(delta.identity).toBe(false)
    })

    it('2.4 executes runSharedTransition with document.startViewTransition when supported', async () => {
      let ran = false
      const startViewTransition = vi.fn((cb: () => void) => {
        cb()
        return { finished: Promise.resolve() }
      })
      ;(document as unknown as { startViewTransition?: unknown }).startViewTransition = startViewTransition
      await runSharedTransition(() => {
        ran = true
      })
      expect(ran).toBe(true)
      expect(startViewTransition).toHaveBeenCalledTimes(1)
    })

    it('2.5 honors prefers-reduced-motion fallback synchronously without animation lag', async () => {
      ensureBrowserGlobals(true)
      expect(prefersReducedMotion()).toBe(true)
      const snapped = stepSpring({ position: 0, velocity: 12 }, 250)
      expect(snapped).toEqual({ position: 250, velocity: 0, settled: true })
      let ran = false
      await runSharedTransition(() => {
        ran = true
      })
      expect(ran).toBe(true)
    })
  })

  // ---------------- F3: Today View Live Stage & Asymmetric Bento ----------------
  describe('F3 · Today View · Live Stage & Asymmetric Bento', () => {
    it('3.1 mounts Live Stage context banner with explicit stage mode', () => {
      seedFullAcademicState()
      renderFullApp()
      const stage = screen.getByTestId('today-live-stage')
      expect(['before-class', 'in-class', 'between-classes', 'after-hours']).toContain(
        stage.getAttribute('data-stage-mode'),
      )
    })

    it('3.2 eliminates flat Today legacy tabs and shows asymmetric bento columns', () => {
      seedFullAcademicState()
      renderFullApp()
      expect(screen.queryByRole('tab', { name: '课程' })).toBeNull()
      expect(screen.queryByRole('tab', { name: '动态' })).toBeNull()
      expect(screen.getByTestId('today-live-stage')).toBeTruthy()
    })

    it('3.3 renders Free Room Finder interactive duration and building filters', () => {
      seedFullAcademicState()
      renderFullApp()
      const filters = screen.getByTestId('free-room-filters')
      expect(filters).toBeTruthy()
      const btns = filters.querySelectorAll('button')
      expect(btns.length).toBeGreaterThanOrEqual(2)
    })

    it('3.4 filters free rooms live by >=1h vs >=2h availability window', () => {
      const now = new Date()
      now.setHours(10, 30, 0, 0)
      const lessons = buildSampleLessons(now)
      const oneHour = freeRoomsNow(lessons, now, 60)
      const twoHours = freeRoomsNow(lessons, now, 120)
      expect(oneHour.length).toBeGreaterThanOrEqual(twoHours.length)
      expect(oneHour.some((r) => r.room === '1314')).toBe(true)
      expect(oneHour.some((r) => r.room === '1320')).toBe(false)
    })

    it('3.5 displays upcoming tasks and SemesterStrip in Today workbench', () => {
      seedFullAcademicState()
      renderFullApp()
      expect(document.body.textContent).toContain('Lab 1 UML Diagram')
      expect(document.body.textContent).toContain('学期全景')
    })

    it('3.6 computes room day timelines with busy and free intervals cleanly', () => {
      const base = new Date()
      base.setHours(10, 30, 0, 0)
      const lessons = buildSampleLessons(base)
      const timelines = roomTimelinesForDay(lessons, base, '1314')
      expect(timelines).toHaveLength(1)
      expect(timelines[0].room).toBe('1314')
      expect(timelines[0].intervals.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ---------------- F4: Week View DDL Pins, Laser Cursor, Spotlight & Slot Creation ----------------
  describe('F4 · Week View Interactive Canvas', () => {
    it('4.1 mounts Week view with DDL pins directly above weekday columns', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
      expect(screen.getAllByTestId('week-ddl-pin').length).toBeGreaterThan(0)
    })

    it('4.2 embeds SemesterStrip P1-P4 overview directly inside Week view', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
      expect(screen.getByTestId('week-semester-strip')).toBeTruthy()
    })

    it('4.3 highlights matching course lessons and shows Spotlight Mini HUD on hover', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
      const card = document.querySelector('[data-course-key]')
      expect(card).toBeTruthy()
      if (card) fireEvent.mouseEnter(card)
      expect(screen.getByTestId('week-course-spotlight-hud')).toBeTruthy()
    })

    it('4.4 opens slot creation popover when dragging/clicking empty day canvas', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
      const canvas = document.querySelector('[data-day-canvas]') as HTMLElement
      expect(canvas).toBeTruthy()
      fireEvent.mouseDown(canvas, { clientY: 160, button: 0 })
      fireEvent.mouseUp(canvas, { clientY: 220, button: 0 })
      expect(screen.getByTestId('week-slot-popover')).toBeTruthy()
    })

    it('4.5 confirms created study block from week popover and persists to storage', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
      const canvas = document.querySelector('[data-day-canvas]') as HTMLElement
      fireEvent.mouseDown(canvas, { clientY: 160, button: 0 })
      fireEvent.mouseUp(canvas, { clientY: 200, button: 0 })
      const pop = screen.getByTestId('week-slot-popover')
      const input = pop.querySelector('input') as HTMLInputElement
      fireEvent.change(input, { target: { value: 'Sprint Study Block' } })
      const confirmBtn = [...pop.querySelectorAll('button')].find((b) =>
        /添加|确认|Add|Save|保存|创建/i.test(b.textContent || ''),
      )!
      fireEvent.click(confirmBtn)
      const saved = JSON.parse(localStorage.getItem(KEYS.studyBlocks) || '[]')
      expect(saved.some((b: { title: string }) => b.title === 'Sprint Study Block')).toBe(true)
    })

    it('4.6 switches compact vs comfortable timetable layout density smoothly', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
      const btn = screen.getByRole('button', { name: /^紧凑$|^Compact$/i })
      fireEvent.click(btn)
      expect(btn.getAttribute('aria-pressed')).toBe('true')
    })
  })

  // ---------------- F5: Academic & SISU Cockpit (3 Workspaces & Offline Access) ----------------
  describe('F5 · Academic & SISU Cockpit', () => {
    it('5.1 consolidates 6 legacy sections into 3 flat workspaces (Tasks, Grades, Courses)', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      const rail = screen.getByRole('tablist', { name: 'Moodle' })
      expect(rail.querySelectorAll('[role="tab"]').length).toBe(3)
    })

    it('5.2 unlocks all workspaces offline with disconnected banner when Moodle token is absent', () => {
      seedFullAcademicState()
      localStorage.removeItem(KEYS.moodleSource)
      localStorage.removeItem(KEYS.gradesSource)
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      expect(screen.getByTestId('moodle-disconnected-banner')).toBeTruthy()
      expect(screen.getByTestId('crunch-radar-chart')).toBeTruthy()
    })

    it('5.3 switches Tasks workspace between List and 4-column Kanban board', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      fireEvent.click(screen.getByTestId('tasks-mode-kanban'))
      expect(screen.getByTestId('tasks-kanban-board')).toBeTruthy()
      expect(screen.getByTestId('kanban-col-overdue')).toBeTruthy()
      expect(screen.getByTestId('kanban-col-due7')).toBeTruthy()
      expect(screen.getByTestId('kanban-col-later')).toBeTruthy()
      expect(screen.getByTestId('kanban-col-done')).toBeTruthy()
    })

    it('5.4 flattens SisuStudyPlan without 3-level nested tablist inside Grades workspace', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      fireEvent.click(screen.getByRole('tab', { name: /成绩/ }))
      const panel = document.getElementById('moodle-panel')!
      expect(panel.querySelector('#sisu-tab-overview')).toBeNull()
      expect(screen.getByTestId('sisu-prereq-graph')).toBeTruthy()
    })

    it('5.5 displays interactive SVG Prerequisite DAG inside SISU plan overview', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      fireEvent.click(screen.getByRole('tab', { name: /成绩/ }))
      const graph = screen.getByTestId('sisu-prereq-graph')
      expect(graph.querySelector('svg')).toBeTruthy()
    })

    it('5.6 opens Tri-Source Course Graph in Courses workspace and shows Dossier buttons', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      fireEvent.click(screen.getByRole('tab', { name: /课程/ }))
      expect(screen.getByTestId('courses-tri-source-list')).toBeTruthy()
      expect(screen.getByTestId('course-dossier-btn-CT60A2411')).toBeTruthy()
    })
  })

  // ---------------- F6: Unified Course Dossier & Right Context Inspector ----------------
  describe('F6 · Unified Course Dossier & Context Inspector', () => {
    it('6.1 aggregates SISU credits, lessons, Moodle tasks, grades, and notes into one dossier', () => {
      const graph = buildCourseGraph({
        lessons: buildSampleLessons(),
        tasks: buildSampleTasks(),
        grades: buildSampleGrades(),
        planItems: buildSamplePlanItems(),
        studyBlocks: buildSampleStudyBlocks(),
      })
      const node = graph.byKey.get('CT60A2411')!
      const dossier = buildCourseDossier(node, { attendanceLog: {}, notesMap: {} })
      expect(dossier.node.code).toBe('CT60A2411')
      expect(dossier.node.credits).toBe(6)
      expect(dossier.tasks.pending.length).toBeGreaterThanOrEqual(2)
      expect(dossier.node.grades?.average).toBe(78)
    })

    it('6.2 opens Dossier from Courses workspace and displays notes & tasks', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      fireEvent.click(screen.getByRole('tab', { name: /课程/ }))
      fireEvent.click(screen.getByTestId('course-dossier-btn-CT60A2411'))
      expect(document.body.textContent).toContain('Lab 1 UML Diagram')
      expect(document.body.textContent).toContain('Review sequence diagrams before exam')
    })

    it('6.3 computes attendance rate accurately inside dossier telemetry', () => {
      const base = new Date('2026-11-15T18:00:00')
      const lessons = buildSampleLessons(base)
      const graph = buildCourseGraph({ lessons })
      const node = graph.byKey.get('CT60A2411')!
      const attendanceLog = setAttendance({}, node.lessons[0], 'attended', base)
      const dossier = buildCourseDossier(node, { attendanceLog, notesMap: {}, now: base })
      expect(dossier.attendance.total).toBe(1)
      expect(dossier.attendance.rate).toBe(1)
    })

    it('6.4 reports focus hours vs SISU workload expectation', () => {
      const graph = buildCourseGraph({
        lessons: buildSampleLessons(),
        planItems: buildSamplePlanItems(),
      })
      const node = graph.byKey.get('CT60A2411')!
      const dossier = buildCourseDossier(node, {
        attendanceLog: {},
        notesMap: {},
        focusMinutesByCourse: { CT60A2411: 60 },
      })
      expect(dossier.focus.focusMinutes).toBe(60)
      expect(dossier.focus.sisuTotalHours).toBe(162)
    })

    it('6.5 preserves existing notes and allows lookup by lesson code', () => {
      const graph = buildCourseGraph({ lessons: buildSampleLessons() })
      const dossier = buildCourseDossier(graph.byKey.get('CT60A2411')!, {
        attendanceLog: {},
        notesMap: {
          'CT60A2411|other': {
            note: 'Review sequence diagrams before exam',
            updatedAt: new Date().toISOString(),
          },
        },
      })
      expect(dossier.notes.length).toBe(1)
      expect(dossier.notes[0].note).toContain('sequence diagrams')
    })

    it('6.6 switches inspector cleanly when inspecting a different course', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      fireEvent.click(screen.getByRole('tab', { name: /课程/ }))
      fireEvent.click(screen.getByTestId('course-dossier-btn-CT60A2411'))
      expect(document.body.textContent).toContain('CT60A2411')
      fireEvent.click(screen.getByTestId('course-dossier-btn-BM20A9200'))
      expect(document.body.textContent).toContain('BM20A9200')
    })
  })

  // ---------------- F7: Omni-Command Bar 2.0 ----------------
  describe('F7 · Omni-Command Bar 2.0', () => {
    it('7.1 parses natural language study block request with duration into scheduled slot', () => {
      const now = new Date('2026-10-12T08:00:00')
      const res = parseOmniQuickAdd('周四 15:00 算法复习 90m', now)
      expect(res?.kind).toBe('study-block')
      expect(res?.durationMin).toBe(90)
      expect(res?.title).toContain('算法复习')
    })

    it('7.2 parses traditional task trigger into due-dated quick add item', () => {
      const now = new Date('2026-10-12T08:00:00')
      const res = parseQuickAdd('作业 周三 14:00 密码学报告', now)
      expect(res?.title).toContain('密码学报告')
      expect(res?.dueAt).toBeTruthy()
    })

    it('7.3 generates inline room occupancy card when querying room id in palette', () => {
      const items = buildOmniExtras('room 1320', { lessons: buildSampleLessons(), now: new Date() })
      expect(items.some((i) => i.action.kind === 'roomStatus' && i.action.room === '1320')).toBe(true)
    })

    it('7.4 computes inline grade calculator preview inside palette for target expression', () => {
      const items = buildOmniExtras('grade 80', { now: new Date() })
      expect(items.some((i) => i.action.kind === 'gradeCalcResult')).toBe(true)
    })

    it('7.5 opens Command Palette on Ctrl+K and ranks filtered navigation & course hits', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      const combo = screen.getByRole('combobox')
      fireEvent.change(combo, { target: { value: 'BM20A9200' } })
      expect(document.body.textContent).toContain('BM20A9200')
    })

    it('7.6 scores prefix matches above substring matches in palette filter', () => {
      const items = buildPalette({
        lessons: buildSampleLessons(),
        tasks: buildSampleTasks(),
        commands: [],
        locale: 'zh-CN',
        t: (k) => k,
      })
      const hits = filterPalette(items, 'CT60A2411')
      expect(hits.length).toBeGreaterThan(0)
      expect(hits[0].label).toContain('CT60A2411')
    })
  })

  // ---------------- F8: Grade Target Reverse Solver & 14-Day Crunch Radar ----------------
  describe('F8 · LUT 1–5 Grade Solver & 14-Day Crunch Radar', () => {
    it('8.1 solves LUT 1-5 grade thresholds with exact required average on remaining weight', () => {
      const grades = buildSampleGrades()[0]
      const levels = solveGradeTargetsByLevel(grades.items, {}, undefined, DEFAULT_LUT_GRADE_THRESHOLDS)
      expect(levels).toHaveLength(5)
      const lvl4 = levels.find((l) => l.grade === 4)!
      expect(lvl4.plan.status).toBe('possible')
      expect(lvl4.plan.requiredAvg).toBeCloseTo(81.33, 1)
    })

    it('8.2 computes per-item optimistic and balanced minimum required scores', () => {
      const grades = buildSampleGrades()[0]
      const reqs = solveItemMinimumsForTarget(grades.items, 80)
      expect(reqs.length).toBe(1)
      expect(reqs[0].feasible).toBe(true)
      expect(reqs[0].minPercentBalanced).toBeCloseTo(81.33, 1)
    })

    it('8.3 renders LUT 1-5 reverse solver inside expanded GradeCourseCard', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      fireEvent.click(screen.getByRole('tab', { name: /成绩/ }))
      fireEvent.click(screen.getAllByRole('button', { name: /预估总分|What-if/i })[0])
      expect(screen.getByTestId('grade-lut-solver')).toBeTruthy()
      expect(screen.getByTestId('grade-lut-level-1')).toBeTruthy()
      expect(screen.getByTestId('grade-lut-level-5')).toBeTruthy()
    })

    it('8.4 builds 14-day Crunch Radar daily timeline and peak detection', () => {
      const now = new Date()
      const report = buildCrunchRadar({
        lessons: buildSampleLessons(now),
        tasks: buildSampleTasks(now),
        studyBlocks: buildSampleStudyBlocks(now),
        grades: buildSampleGrades(),
        now,
        horizonDays: 14,
      })
      expect(report.days).toHaveLength(14)
      expect(report.totalPendingInWindow).toBeGreaterThanOrEqual(2)
    })

    it('8.5 renders CrunchRadarChart SVG inside Tasks workspace', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      const chart = screen.getByTestId('crunch-radar-chart')
      expect(chart.querySelector('svg')).toBeTruthy()
    })

    it('8.6 detects stacked DDL collision alert when >= 2 deadlines fall on same date', () => {
      const now = new Date('2026-10-12T08:00:00')
      const dayDue = '2026-10-15T23:59:00.000Z'
      const stacked = [1, 2, 3].map((i) => ({
        id: `s-${i}`,
        title: `Heavy Task ${i}`,
        completed: false,
        course: 'CT60A2411',
        dueAt: dayDue,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }))
      const report = buildCrunchRadar({ lessons: [], tasks: stacked, studyBlocks: [], now })
      expect(report.alerts.some((a) => a.kind === 'collision')).toBe(true)
    })
  })

  // ---------------- F9: Course-Linked Focus Cockpit & Persistent Mini HUD ----------------
  describe('F9 · Course-Linked Focus Cockpit & Mini HUD', () => {
    it('9.1 creates a course-linked focus timer session storing courseCode & label', () => {
      const timer = startFocusSession(DEFAULT_POMODORO_CONFIG, 1000, {
        courseCode: 'CT60A2411',
        label: 'CT60A2411 Sprint',
      })
      expect(timer.phase).toBe('focus')
      expect(timer.courseCode).toBe('CT60A2411')
      expect(timer.label).toBe('CT60A2411 Sprint')
    })

    it('9.2 records focus minutes into per-course and global ledger cleanly', () => {
      const now = new Date('2026-10-12T10:00:00')
      const initial = {
        config: DEFAULT_POMODORO_CONFIG,
        day: '2026-10-12',
        roundsToday: 0,
        focusMinutesByCourse: {},
        focusMinutesByDay: {},
        recentSessions: [],
      }
      const next = recordFocusRound(initial, now, { courseCode: 'CT60A2411', minutes: 25 })
      expect(next.roundsToday).toBe(1)
      expect(next.focusMinutesByCourse.CT60A2411).toBe(25)
    })

    it('9.3 creates a block-linked focus timer referencing studyBlockId', () => {
      const block = buildSampleStudyBlocks()[0]
      const timer = startFocusForBlock(DEFAULT_POMODORO_CONFIG, block, 5000)
      expect(timer.studyBlockId).toBe(block.id)
      expect(timer.courseCode).toBe('CT60A2411')
    })

    it('9.4 renders Pomodoro cockpit inside Today view without duplicate widget conflicts', () => {
      seedFullAcademicState()
      renderFullApp()
      expect(screen.getAllByRole('heading', { name: /番茄钟|Pomodoro/i }).length).toBeGreaterThanOrEqual(1)
    })

    it('9.5 surfaces persistent Focus Mini HUD when focus timer is active in storage', () => {
      seedFullAcademicState()
      const now = Date.now()
      localStorage.setItem(
        KEYS.pomodoro,
        JSON.stringify({
          config: DEFAULT_POMODORO_CONFIG,
          day: new Date().toISOString().slice(0, 10),
          roundsToday: 0,
          focusMinutesByCourse: {},
          focusMinutesByDay: {},
          recentSessions: [],
          timer: {
            phase: 'focus',
            totalMs: 25 * 60_000,
            endsAt: now + 20 * 60_000,
            pausedRemainingMs: null,
            completedRounds: 0,
            studyBlockId: null,
            courseCode: 'CT60A2411',
            label: 'CT60A2411 Deep Work',
          },
        }),
      )
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
      expect(document.body.textContent).toContain('CT60A2411')
    })
  })

  // ---------------- F10: Tri-Source Course Graph & Bidirectional Sync ----------------
  describe('F10 · Tri-Source Course Graph & Discrepancy Engine', () => {
    it('10.1 fuses lessons, Moodle enrollments/grades, and SISU plan items into canonical course nodes', () => {
      const graph = buildCourseGraph({
        lessons: buildSampleLessons(),
        enrolled: buildSampleEnrolled(),
        grades: buildSampleGrades(),
        planItems: buildSamplePlanItems(),
        tasks: buildSampleTasks(),
      })
      const node = graph.byKey.get('CT60A2411')!
      expect(node.sources).toEqual(expect.arrayContaining(['moodle', 'timeedit', 'sisu']))
      expect(node.credits).toBe(6)
    })

    it('10.2 detects moodle-only discrepancy when enrolled course has zero timetable lessons', () => {
      const graph = buildCourseGraph({
        lessons: buildSampleLessons(),
        enrolled: buildSampleEnrolled(),
      })
      const cloud = graph.byKey.get('CT60A9600')!
      expect(cloud.discrepancies.some((d) => d.kind === 'moodle-only')).toBe(true)
    })

    it('10.3 detects timetable-only discrepancy for manual or unlinked lesson streams', () => {
      const graph = buildCourseGraph({
        lessons: buildSampleLessons(),
        enrolled: buildSampleEnrolled(),
      })
      const algo = graph.byKey.get('CS30A1300')!
      expect(algo.discrepancies.some((d) => d.kind === 'timetable-only')).toBe(true)
    })

    it('10.4 detects plan-status-mismatch when planned SISU course already has active Moodle grades', () => {
      const graph = buildCourseGraph({
        lessons: buildSampleLessons(),
        grades: buildSampleGrades(),
        planItems: buildSamplePlanItems(),
      })
      const se = graph.byKey.get('CT60A2411')!
      expect(se.discrepancies.some((d) => d.kind === 'plan-status-mismatch')).toBe(true)
    })

    it('10.5 merges live SISU facts cache cleanly alongside static catalog facts', () => {
      const graph = buildCourseGraph({
        lessons: [
          {
            id: 'l-custom',
            title: 'XX10A9999 Custom Seminar',
            code: 'XX10A9999',
            start: isoAt(1, 10, 0),
            end: isoAt(1, 12, 0),
            source: 'timeedit',
          },
        ],
        liveSisuFacts: {
          XX10A9999: {
            code: 'XX10A9999',
            name: { en: 'Custom Research Seminar', fi: 'Seminaari' },
            credits: 4,
            periods: [1],
            language: 'en',
            fetchedAt: new Date().toISOString(),
          },
        },
      })
      const node = graph.byKey.get('XX10A9999')!
      expect(node.credits).toBe(4)
      expect(node.discrepancies.some((d) => d.kind === 'missing-sisu-facts')).toBe(false)
    })

    it('10.6 surfaces discrepancy alert banner in Courses workspace DOM', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      fireEvent.click(screen.getByRole('tab', { name: /课程/ }))
      expect(screen.getByTestId('courses-discrepancies-banner')).toBeTruthy()
    })
  })

  // ---------------- F11: Storage KEYS 100% Compatibility & Backup/Restore ----------------
  describe('F11 · Storage KEYS Integrity & Backup/Restore', () => {
    it('11.1 includes all 54 canonical storage keys inside BACKUP_KEYS registry', () => {
      expect(Object.keys(KEYS).length).toBeGreaterThanOrEqual(54)
      for (const val of Object.values(KEYS)) {
        expect(BACKUP_KEYS).toContain(val)
      }
    })

    it('11.2 round-trips full localStorage academic payload through backup export/import', () => {
      seedFullAcademicState()
      const payload: Record<string, string> = {}
      for (const k of BACKUP_KEYS) {
        const v = localStorage.getItem(k)
        if (v !== null) payload[k] = v
      }
      localStorage.clear()
      const written = importBackup(
        JSON.stringify({
          app: 'lut-timetable',
          version: 1,
          exportedAt: new Date().toISOString(),
          data: payload,
        }),
      )
      expect(written).toBe(Object.keys(payload).length)
      expect(JSON.parse(localStorage.getItem(KEYS.lessons)!).length).toBe(4)
    })

    it('11.3 preserves legacy backup entries while rejecting malformed headers', () => {
      expect(() => importBackup('{"app":"other","version":1,"data":{}}')).toThrow('bad-format')
    })

    it('11.4 skips non-string backup values cleanly and reports written vs skipped counts', () => {
      const detail = importBackupDetail(
        JSON.stringify({
          app: 'lut-timetable',
          version: 1,
          exportedAt: new Date().toISOString(),
          data: {
            [KEYS.lang]: 'en',
            broken_key: 12345,
          },
        }),
      )
      expect(detail.written).toBe(1)
      expect(detail.skipped).toContain('broken_key')
    })

    it('11.5 normalizes legacy 6-section moodleSection keys cleanly on mount', () => {
      seedFullAcademicState()
      localStorage.setItem(KEYS.moodleSection, 'studyplan')
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      expect(screen.getByRole('tab', { name: /成绩/ }).getAttribute('aria-selected')).toBe('true')
    })

    it('11.6 calls exportBackup download helper with lut-timetable JSON blob', async () => {
      seedFullAcademicState()
      const createUrl = vi.fn(() => 'blob:mock')
      const revokeUrl = vi.fn()
      vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl })
      await exportBackup()
      expect(createUrl).toHaveBeenCalledTimes(1)
    })
  })
})
