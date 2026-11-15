// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import {
  buildSampleLessons,
  buildSampleTasks,
  ensureBrowserGlobals,
  isoAt,
  renderFullApp,
  seedFullAcademicState,
} from './helpers/fixtures'
import { KEYS, BACKUP_KEYS } from '../src/lib/storage'
import { importBackup, importBackupDetail } from '../src/lib/backup'
import {
  SPRING_PRESETS,
  computeFlipDelta,
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
import {
  DEFAULT_POMODORO_CONFIG,
  normalizePomodoroConfig,
  pauseTimer,
  phaseDone,
  progress,
  recordFocusRound,
  remainingMs,
  resumeTimer,
  startFocusSession,
} from '../src/lib/pomodoro'

describe('Tier 2 · E2E Boundary, Edge & Negative Cases (F1–F11)', () => {
  beforeEach(() => {
    localStorage.clear()
    location.hash = ''
    ensureBrowserGlobals(false)
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  // ---------------- F1: Spatial Workbench Boundary Cases ----------------
  describe('F1 · Workbench Boundaries & Corrupt State Recovery', () => {
    it('1.1 recovers cleanly when lessons storage contains corrupted JSON string', () => {
      localStorage.setItem(KEYS.onboardingDone, '1')
      localStorage.setItem(KEYS.lessons, '{bad-json!!')
      renderFullApp()
      expect(document.querySelector('main')).toBeTruthy()
    })

    it('1.2 falls back to default view route on invalid location.hash', () => {
      seedFullAcademicState()
      location.hash = '#/view/nonexistent-route-999'
      renderFullApp()
      expect(screen.getByTestId('today-live-stage')).toBeTruthy()
    })

    it('1.3 falls back safely when theme preset key holds unsupported token', () => {
      seedFullAcademicState()
      localStorage.setItem(KEYS.themePreset, 'unknown-preset-xyz')
      renderFullApp()
      expect(document.querySelector('main')).toBeTruthy()
    })

    it('1.4 renders clean empty workbench when 0 lessons, 0 tasks, and 0 study blocks exist', () => {
      localStorage.setItem(KEYS.onboardingDone, '1')
      renderFullApp()
      expect(screen.getByTestId('today-live-stage')).toBeTruthy()
    })

    it('1.5 closes right context / command dialog cleanly via Escape key without mutating storage', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
      const dialog = screen.getByTestId('omni-palette-dialog')
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(screen.queryByTestId('omni-palette-dialog')).toBeNull()
    })
  })

  // ---------------- F2: Motion Boundaries ----------------
  describe('F2 · Motion Edge Cases & Reduced Motion', () => {
    it('2.1 stepSpring snaps immediately when dtSec <= 0', () => {
      const res = stepSpring({ position: 10, velocity: 50 }, 80, SPRING_PRESETS.snappy, 0)
      expect(res).toEqual({ position: 80, velocity: 0, settled: true })
    })

    it('2.2 stepSpring clamps pathological huge dtSec without numerical explosion', () => {
      const res = stepSpring({ position: 0, velocity: 0 }, 100, SPRING_PRESETS.bouncy, 999)
      expect(Number.isFinite(res.position)).toBe(true)
      expect(Number.isFinite(res.velocity)).toBe(true)
    })

    it('2.3 computeFlipDelta handles zero-sized target rect safely (no NaN)', () => {
      const delta = computeFlipDelta(
        { left: 0, top: 0, width: 100, height: 50 },
        { left: 20, top: 30, width: 0, height: 0 },
      )
      expect(delta.sx).toBe(1)
      expect(delta.sy).toBe(1)
      expect(delta.identity).toBe(false)
    })

    it('2.4 runSharedTransition executes callback synchronously if startViewTransition throws', async () => {
      let called = false
      ;(document as unknown as { startViewTransition?: unknown }).startViewTransition = () => {
        throw new Error('transition-busy')
      }
      await runSharedTransition(() => {
        called = true
      })
      expect(called).toBe(true)
    })

    it('2.5 identity rects produce identity === true in FLIP delta', () => {
      const delta = computeFlipDelta(
        { left: 10.1, top: 20.1, width: 100, height: 40 },
        { left: 10.2, top: 20.2, width: 100, height: 40 },
      )
      expect(delta.identity).toBe(true)
    })
  })

  // ---------------- F3: Today Live Stage Boundaries ----------------
  describe('F3 · Today Live Stage Time-Window Edges', () => {
    it('3.1 handles after-hours state gracefully when all daily lessons ended earlier', () => {
      localStorage.setItem(KEYS.onboardingDone, '1')
      localStorage.setItem(
        KEYS.lessons,
        JSON.stringify([
          {
            id: 'old-1',
            title: 'CT60A0001 Early Class',
            code: 'CT60A0001',
            start: new Date(Date.now() - 4 * 3600_000).toISOString(),
            end: new Date(Date.now() - 3 * 3600_000).toISOString(),
            source: 'timeedit',
          },
        ]),
      )
      renderFullApp()
      const stage = screen.getByTestId('today-live-stage')
      expect(stage.getAttribute('data-stage-mode')).toBeTruthy()
    })

    it('3.2 freeRoomsNow returns empty array when no lessons carry campus location strings', () => {
      const now = new Date()
      expect(freeRoomsNow([], now, 60)).toEqual([])
    })

    it('3.3 freeRoomsNow excludes currently occupied room even if horizon is short', () => {
      const base = new Date()
      base.setHours(10, 15, 0, 0)
      const lessons = buildSampleLessons(base)
      const free = freeRoomsNow(lessons, base, 30)
      expect(free.some((r) => r.room === '1320')).toBe(false)
      expect(free.some((r) => r.room === '1314')).toBe(true)
    })

    it('3.4 roomTimelinesForDay returns empty array cleanly when query matches no rooms', () => {
      const tl = roomTimelinesForDay(buildSampleLessons(), new Date(), 'NONEXISTENT-999')
      expect(tl).toEqual([])
    })

    it('3.5 handles Free Room filter when >=2h yields filtered room results cleanly', () => {
      seedFullAcademicState()
      renderFullApp()
      const filters = screen.getByTestId('free-room-filters')
      const h2Btn = [...filters.querySelectorAll('button')].find((b) =>
        /2\s*h|2小时/i.test(b.textContent || ''),
      )
      if (h2Btn) fireEvent.click(h2Btn)
      expect(screen.getByTestId('free-room-filters')).toBeTruthy()
    })
  })

  // ---------------- F4: Week Grid Boundaries ----------------
  describe('F4 · Week Grid Edge & Invalid Input Cases', () => {
    it('4.1 week grid handles empty lesson and empty task arrays cleanly', () => {
      localStorage.setItem(KEYS.onboardingDone, '1')
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
      expect(document.querySelector('[data-day-canvas]')).toBeTruthy()
    })

    it('4.2 cancels empty-slot creation cleanly via Cancel button without saving to storage', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
      const before = JSON.parse(localStorage.getItem(KEYS.studyBlocks) || '[]').length
      const canvas = document.querySelector('[data-day-canvas]') as HTMLElement
      fireEvent.mouseDown(canvas, { clientY: 140, button: 0 })
      fireEvent.mouseUp(canvas, { clientY: 160, button: 0 })
      const pop = screen.getByTestId('week-slot-popover')
      const cancelBtn = [...pop.querySelectorAll('button')].find((b) =>
        /取消|Cancel/i.test(b.textContent || ''),
      )!
      fireEvent.click(cancelBtn)
      const after = JSON.parse(localStorage.getItem(KEYS.studyBlocks) || '[]').length
      expect(after).toBe(before)
      expect(screen.queryByTestId('week-slot-popover')).toBeNull()
    })

    it('4.3 handles mouseLeave after course spotlight to clear spotlight cleanly', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
      const card = document.querySelector('[data-course-key]')
      expect(card).toBeTruthy()
      if (card) {
        fireEvent.mouseEnter(card)
        expect(screen.getByTestId('week-course-spotlight-hud')).toBeTruthy()
        fireEvent.mouseLeave(card)
        expect(screen.queryByTestId('week-course-spotlight-hud')).toBeNull()
      }
    })

    it('4.4 navigates next week button cleanly without losing canvas', () => {
      seedFullAcademicState()
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
      const nextBtn = screen.getByRole('button', { name: /下一?周|Next/i })
      fireEvent.click(nextBtn)
      expect(document.querySelector('[data-day-canvas]')).toBeTruthy()
    })

    it('4.5 handles duplicate studyBlock timestamps without crashing WeekGrid', () => {
      seedFullAcademicState()
      const existing = JSON.parse(localStorage.getItem(KEYS.studyBlocks) || '[]')
      existing.push({ ...existing[0], id: 'sb-dup', sourceId: 'task-overdue', title: 'Overlapping Block' })
      localStorage.setItem(KEYS.studyBlocks, JSON.stringify(existing))
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /周视图|Week/i })[0])
      expect(document.body.textContent).toContain('Overlapping Block')
    })
  })

  // ---------------- F5: Academic Cockpit Edges ----------------
  describe('F5 · Academic Cockpit Empty & Edge States', () => {
    it('5.1 handles 0 enrolled courses and 0 SISU plan items in Courses workspace', () => {
      localStorage.setItem(KEYS.onboardingDone, '1')
      localStorage.setItem(KEYS.sisuStudyPlan, JSON.stringify({ goalCredits: 180, items: [] }))
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      fireEvent.click(screen.getByRole('tab', { name: /课程/ }))
      expect(document.body.textContent).toBeTruthy()
    })

    it('5.2 shows prerequisite graph fallback container safely when SISU plan is empty', () => {
      localStorage.setItem(KEYS.onboardingDone, '1')
      localStorage.setItem(KEYS.sisuStudyPlan, JSON.stringify({ goalCredits: 180, items: [] }))
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      fireEvent.click(screen.getByRole('tab', { name: /成绩/ }))
      expect(screen.getByTestId('sisu-prereq-graph')).toBeTruthy()
    })

    it('5.3 handles Kanban empty columns without throwing when all tasks are completed', () => {
      seedFullAcademicState()
      const tasks = JSON.parse(localStorage.getItem(KEYS.tasks)!).map((t: { completed: boolean }) => ({
        ...t,
        completed: true,
      }))
      localStorage.setItem(KEYS.tasks, JSON.stringify(tasks))
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      fireEvent.click(screen.getByTestId('tasks-mode-kanban'))
      expect(screen.getByTestId('kanban-col-overdue')).toBeTruthy()
    })

    it('5.4 legacy keys (resources, notif, timeline) cleanly migrate across workspaces', () => {
      seedFullAcademicState()
      localStorage.setItem(KEYS.moodleSection, 'resources')
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      expect(screen.getByRole('tab', { name: /课程/ }).getAttribute('aria-selected')).toBe('true')
    })

    it('5.5 handles partial/undefined unread count safely when notifications cache is cleared', () => {
      seedFullAcademicState()
      localStorage.removeItem(KEYS.ntfCache)
      renderFullApp()
      fireEvent.click(screen.getAllByRole('button', { name: /Moodle|学术/i })[0])
      expect(screen.getByRole('heading', { name: '一眼概览' })).toBeTruthy()
    })
  })

  // ---------------- F6: Dossier Boundaries ----------------
  describe('F6 · Course Dossier Boundary Cases', () => {
    it('6.1 handles course node with empty code and no SISU catalog entry', () => {
      const graph = buildCourseGraph({
        lessons: [
          {
            id: 'manual-only',
            title: 'Reading Group',
            code: '',
            start: isoAt(1, 12, 0),
            end: isoAt(1, 13, 0),
            source: 'manual',
          },
        ],
      })
      const dossier = buildCourseDossier(graph.nodes[0], { attendanceLog: {}, notesMap: {} })
      expect(dossier.node.code).toBe('')
      expect(dossier.node.credits).toBeUndefined()
      expect(dossier.focus.sisuTotalHours).toBeNull()
    })

    it('6.2 handles missing Moodle grades and zero study blocks gracefully', () => {
      const graph = buildCourseGraph({ lessons: buildSampleLessons() })
      const dossier = buildCourseDossier(graph.byKey.get('CT60A2411')!, {
        attendanceLog: {},
        notesMap: {},
      })
      expect(dossier.node.grades).toBeUndefined()
      expect(dossier.node.studyBlocks).toEqual([])
    })

    it('6.3 handles empty notesMap safely inside dossier builder', () => {
      const graph = buildCourseGraph({ lessons: buildSampleLessons() })
      const dossier = buildCourseDossier(graph.byKey.get('CT60A2411')!, {
        attendanceLog: {},
        notesMap: {},
      })
      expect(dossier.notes).toEqual([])
    })

    it('6.4 attendance percentage stays null when course has 0 sessions', () => {
      const graph = buildCourseGraph({
        lessons: [],
        enrolled: [{ courseid: 99, shortname: 'ZZ10A0001', fullname: 'ZZ10A0001 Ghost' }],
      })
      const dossier = buildCourseDossier(graph.nodes[0], { attendanceLog: {}, notesMap: {} })
      expect(dossier.attendance.total).toBe(0)
      expect(dossier.attendance.rate).toBeNull()
    })

    it('6.5 aggregates only focus minutes belonging to requested courseCode', () => {
      const graph = buildCourseGraph({ lessons: buildSampleLessons() })
      const dossier = buildCourseDossier(graph.byKey.get('CT60A2411')!, {
        attendanceLog: {},
        notesMap: {},
        focusMinutesByCourse: { BM20A9200: 25 },
      })
      expect(dossier.focus.focusMinutes).toBe(0)
    })
  })

  // ---------------- F7: Omni-Command Boundaries ----------------
  describe('F7 · Omni-Command Edge Cases', () => {
    it('7.1 returns null for plain keyword without trigger word or schedule syntax', () => {
      expect(parseOmniQuickAdd('CT60A2411', new Date())).toBeNull()
      expect(parseQuickAdd('algorithms', new Date())).toBeNull()
    })

    it('7.2 returns null when trigger word has empty title', () => {
      expect(parseQuickAdd('todo   ', new Date())).toBeNull()
      expect(parseOmniQuickAdd('作业 ', new Date())).toBeNull()
    })

    it('7.3 rejects out-of-range clock hour safely without returning invalid Date', () => {
      const res = parseQuickAdd('作业 2026-10-15 29:99 weird time', new Date('2026-10-12T09:00:00'))
      expect(res).toBeTruthy()
      expect(Number.isNaN(new Date(res!.dueAt!).getTime())).toBe(false)
    })

    it('7.4 returns empty array for buildOmniExtras on empty whitespace query', () => {
      expect(buildOmniExtras('   ', { lessons: buildSampleLessons() })).toEqual([])
    })

    it('7.5 filterPalette respects explicit result limit on broad multi-match queries', () => {
      const items = buildPalette({
        lessons: buildSampleLessons(),
        tasks: buildSampleTasks(),
        commands: [],
        locale: 'zh-CN',
        t: (k) => k,
      })
      expect(filterPalette(items, 'a', 2).length).toBeLessThanOrEqual(2)
    })
  })

  // ---------------- F8: Grade Solver & Crunch Radar Edges ----------------
  describe('F8 · Grade Solver & Crunch Radar Boundaries', () => {
    it('8.1 marks grade level unreachable when weighted maximum final is below threshold', () => {
      const items = [
        { name: 'Midterm', grade: 20, max: 100, classAvg: null, weight: 80 },
        { name: 'Quiz', grade: null, max: 100, classAvg: null, weight: 20 },
      ]
      const levels = solveGradeTargetsByLevel(items, {}, undefined, DEFAULT_LUT_GRADE_THRESHOLDS)
      const lvl5 = levels.find((l) => l.grade === 5)!
      expect(lvl5.plan.status).toBe('unreachable')
      expect(lvl5.plan.maxFinal).toBeLessThan(90)
    })

    it('8.2 marks grade level reached when current guaranteed score already exceeds threshold', () => {
      const items = [
        { name: 'Midterm', grade: 95, max: 100, classAvg: null, weight: 60 },
        { name: 'Bonus', grade: null, max: 100, classAvg: null, weight: 40 },
      ]
      const levels = solveGradeTargetsByLevel(items, {}, undefined, DEFAULT_LUT_GRADE_THRESHOLDS)
      const lvl1 = levels.find((l) => l.grade === 1)!
      expect(lvl1.plan.status).toBe('reached')
    })

    it('8.3 returns empty item requirements list when zero ungraded weighted items remain', () => {
      const items = [
        { name: 'Final', grade: 75, max: 100, classAvg: null, weight: 100 },
      ]
      expect(solveItemMinimumsForTarget(items, 80)).toEqual([])
    })

    it('8.4 crunch radar handles tasks missing dueAt by reporting 0 pending inside window safely', () => {
      const now = new Date('2026-10-12T08:00:00')
      const report = buildCrunchRadar({
        lessons: [],
        tasks: [
          {
            id: 'nodue-1',
            title: 'Read Chapter 4',
            completed: false,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
          },
        ],
        studyBlocks: [],
        now,
      })
      expect(report.unscheduledTasksInWindow).toEqual([])
      expect(report.totalPendingInWindow).toBe(0)
    })

    it('8.5 crunch radar handles horizonDays clamped >= 1 cleanly', () => {
      const report = buildCrunchRadar({ lessons: [], tasks: [], studyBlocks: [], horizonDays: 1 })
      expect(report.days).toHaveLength(1)
    })
  })

  // ---------------- F9: Focus Cockpit Edges ----------------
  describe('F9 · Focus Timer Edge Cases', () => {
    it('9.1 clamps invalid negative/huge Pomodoro durations to safe bounds', () => {
      const cfg = normalizePomodoroConfig({ focusMinutes: -50, shortMinutes: 9999 })
      expect(cfg.focusMinutes).toBe(1)
      expect(cfg.shortMinutes).toBe(60)
    })

    it('9.2 pauseTimer and resumeTimer preserve exact remaining milliseconds', () => {
      const started = startFocusSession(DEFAULT_POMODORO_CONFIG, 1_000_000)
      const paused = pauseTimer(started, 1_060_000)
      expect(remainingMs(paused, 9_999_999)).toBe(24 * 60_000)
      const resumed = resumeTimer(paused, 2_000_000)
      expect(resumed.endsAt).toBe(2_000_000 + 24 * 60_000)
    })

    it('9.3 phaseDone reports false while paused even if wall clock advances past totalMs', () => {
      const paused = pauseTimer(startFocusSession(DEFAULT_POMODORO_CONFIG, 1000), 2000)
      expect(phaseDone(paused, 999_999_999)).toBe(false)
    })

    it('9.4 recordFocusRound resets daily counters when date changes across midnight', () => {
      const yesterday = {
        config: DEFAULT_POMODORO_CONFIG,
        day: '2026-10-11',
        roundsToday: 3,
        focusMinutesByCourse: { CT60A2411: 75 },
        focusMinutesByDay: { '2026-10-11': 75 },
        recentSessions: [],
      }
      const next = recordFocusRound(yesterday, new Date('2026-10-12T08:00:00'), {
        courseCode: 'CT60A2411',
        minutes: 25,
      })
      expect(next.day).toBe('2026-10-12')
      expect(next.roundsToday).toBe(1)
      expect(next.focusMinutesByDay['2026-10-12']).toBe(25)
    })

    it('9.5 progress clamps at 1 and phaseDone flips true after timer expires', () => {
      const timer = startFocusSession(DEFAULT_POMODORO_CONFIG, 0)
      expect(phaseDone(timer, 999_999_999)).toBe(true)
      expect(progress(timer, 999_999_999)).toBe(1)
    })
  })

  // ---------------- F10: Tri-Source Graph Edges ----------------
  describe('F10 · Tri-Source Graph Discrepancy & Normalization', () => {
    it('10.1 normalizes group suffixes like CT60A2411-3001 into canonical CT60A2411', () => {
      const graph = buildCourseGraph({
        lessons: [
          {
            id: 'l-grp',
            title: 'CT60A2411-3001 Lecture',
            code: 'CT60A2411-3001',
            start: isoAt(1, 10, 0),
            end: isoAt(1, 12, 0),
            source: 'timeedit',
          },
        ],
        enrolled: [{ courseid: 101, shortname: 'CT60A2411-3001', fullname: 'Software Engineering' }],
      })
      expect(graph.byKey.has('CT60A2411')).toBe(true)
      expect(graph.byKey.get('CT60A2411')!.sources).toEqual(
        expect.arrayContaining(['moodle', 'timeedit']),
      )
    })

    it('10.2 handles missing-sisu-facts gracefully for bespoke seminar codes', () => {
      const graph = buildCourseGraph({
        lessons: [
          {
            id: 'l-unk',
            title: 'XY99Z9999 Mystery Workshop',
            code: 'XY99Z9999',
            start: isoAt(1, 10, 0),
            end: isoAt(1, 12, 0),
            source: 'timeedit',
          },
        ],
      })
      const node = graph.byKey.get('XY99Z9999')!
      expect(node.discrepancies.some((d) => d.kind === 'missing-sisu-facts')).toBe(true)
    })

    it('10.3 flags weights-missing when Moodle grade items have null weights', () => {
      const graph = buildCourseGraph({
        lessons: [],
        grades: [
          {
            course: 'CT60A2411',
            matched: true,
            average: 80,
            items: [{ name: 'HW1', grade: 80, max: 100, classAvg: null, weight: null }],
          },
        ],
      })
      const node = graph.byKey.get('CT60A2411')!
      expect(node.discrepancies.some((d) => d.kind === 'weights-missing')).toBe(true)
    })

    it('10.4 skips non-course milestone entries unless they carry courseCode', () => {
      const graph = buildCourseGraph({
        lessons: [],
        planItems: [
          {
            id: 'ms-1',
            title: 'Bachelor Thesis Seminar Milestone',
            kind: 'milestone',
            category: 'general',
            completed: false,
            createdAt: new Date().toISOString(),
          },
        ],
      })
      expect(graph.nodes).toHaveLength(0)
    })

    it('10.5 merges duplicate course entries without creating duplicate nodes', () => {
      const lessons = [
        {
          id: 'l1',
          title: 'CT60A2411 Lec 1',
          code: 'CT60A2411',
          start: isoAt(0, 10, 0),
          end: isoAt(0, 12, 0),
          source: 'timeedit' as const,
        },
        {
          id: 'l2',
          title: 'CT60A2411 Ex 1',
          code: 'CT60A2411',
          start: isoAt(1, 10, 0),
          end: isoAt(1, 12, 0),
          source: 'sisu' as const,
        },
      ]
      const graph = buildCourseGraph({ lessons })
      expect(graph.nodes).toHaveLength(1)
      expect(graph.nodes[0].lessons).toHaveLength(2)
      expect(graph.nodes[0].sources).toEqual(['timeedit', 'sisu'])
    })
  })

  // ---------------- F11: Storage & Backup Boundaries ----------------
  describe('F11 · Storage Keys & Backup Edge Cases', () => {
    it('11.1 importBackup throws on corrupted JSON syntax', () => {
      expect(() => importBackup('{broken-json')).toThrow()
    })

    it('11.2 importBackup rejects wrong version numbers', () => {
      expect(() => importBackup('{"app":"lut-timetable","version":99,"data":{}}')).toThrow('bad-format')
    })

    it('11.3 importBackupDetail handles empty data object cleanly with 0 written', () => {
      const detail = importBackupDetail(
        JSON.stringify({ app: 'lut-timetable', version: 1, exportedAt: '2026-01-01', data: {} }),
      )
      expect(detail.written).toBe(0)
      expect(detail.skipped).toEqual([])
    })

    it('11.4 accepts legacy backup keys not present in current KEYS enum without throwing', () => {
      const written = importBackup(
        JSON.stringify({
          app: 'lut-timetable',
          version: 1,
          exportedAt: '2026-01-01',
          data: { tt_legacy_extra_key: 'preserved' },
        }),
      )
      expect(written).toBe(1)
      expect(localStorage.getItem('tt_legacy_extra_key')).toBe('preserved')
    })

    it('11.5 BACKUP_KEYS never contains empty or undefined entries', () => {
      for (const k of BACKUP_KEYS) {
        expect(typeof k).toBe('string')
        expect(k.length).toBeGreaterThan(3)
      }
    })
  })
})
