import type { Lesson } from '../types'
import type { CourseGrades } from './grades'
import { normalizeCourseCode } from './ics'
import type { StudyBlock } from './studyBlocks'
import { courseRemainingWeight, NEUTRAL_WEIGHT } from './taskPriority'
import { sortTasks, type Task } from './tasks'

export type CrunchLevel = 'calm' | 'moderate' | 'high' | 'critical'

export interface CrunchDayPoint {
  dateKey: string // YYYY-MM-DD
  dateIso: string
  dayOffset: number // 0..13
  lessonHours: number
  studyBlockHours: number
  examCount: number
  dueTasks: Task[]
  /** Weighted deadline pressure taking into account tasks due in [day .. day+2] */
  ddlPressureScore: number
  /** Composite 0..100 workload intensity score */
  crunchScore: number
  level: CrunchLevel
}

export interface CrunchAlert {
  kind: 'collision' | 'exam-crunch' | 'unplanned-ddl' | 'overload-day'
  dateKey: string
  severity: 'warn' | 'critical'
  title: string
  taskIds: string[]
  courseCodes: string[]
}

export interface CrunchRadarReport {
  days: CrunchDayPoint[]
  peakDay: CrunchDayPoint | null
  totalPendingInWindow: number
  unscheduledTasksInWindow: Task[]
  alerts: CrunchAlert[]
}

function toLocalDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function localDayStart(base: Date, offsetDays: number): Date {
  const d = new Date(base)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + offsetDays)
  return d
}

function isSameLocalDay(iso: string | undefined, targetDay: Date): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return false
  return (
    d.getFullYear() === targetDay.getFullYear() &&
    d.getMonth() === targetDay.getMonth() &&
    d.getDate() === targetDay.getDate()
  )
}

function durationHours(startIso: string, endIso: string): number {
  const s = Date.parse(startIso)
  const e = Date.parse(endIso)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0
  return (e - s) / 3_600_000
}

function isExamLesson(lesson: Lesson): boolean {
  if (lesson.type === 'exam') return true
  return /\b(exam|tentti|koe|midterm|finals?)\b/i.test(lesson.title)
}

function classifyCrunchLevel(score: number): CrunchLevel {
  if (score >= 75) return 'critical'
  if (score >= 50) return 'high'
  if (score >= 25) return 'moderate'
  return 'calm'
}

export function buildCrunchRadar(input: {
  lessons: Lesson[]
  tasks: Task[]
  studyBlocks: StudyBlock[]
  grades?: CourseGrades[]
  now?: Date
  horizonDays?: number
}): CrunchRadarReport {
  const now = input.now ?? new Date()
  const horizonDays = Math.max(1, Math.trunc(input.horizonDays ?? 14))
  const grades = input.grades ?? []

  // Map normalized course code -> remaining grade weight
  const weightByCourse = new Map<string, number>()
  for (const g of grades) {
    const w = courseRemainingWeight(g)
    const norm = normalizeCourseCode(g.course)
    if (norm) weightByCourse.set(norm, w)
    if (g.courseTitle) weightByCourse.set(g.courseTitle.trim().toUpperCase(), w)
  }

  const getTaskWeight = (task: Task): number => {
    if (!task.course) return NEUTRAL_WEIGHT
    const norm = normalizeCourseCode(task.course)
    const found = weightByCourse.get(norm) ?? weightByCourse.get(task.course.trim().toUpperCase())
    return found != null && found > 0 ? found : NEUTRAL_WEIGHT
  }

  // Pre-bucket unfinished tasks and lessons by day offset (up to horizonDays + 2 for 3-day pressure lookahead)
  const pending = sortTasks(input.tasks.filter((t) => !t.completed && Boolean(t.dueAt)))
  const tasksByOffset = new Map<number, Task[]>()
  const examsByOffset = new Map<number, Lesson[]>()

  for (let offset = 0; offset < horizonDays + 2; offset++) {
    const dayDate = localDayStart(now, offset)
    tasksByOffset.set(
      offset,
      pending.filter((t) => isSameLocalDay(t.dueAt, dayDate)),
    )
    examsByOffset.set(
      offset,
      input.lessons.filter((l) => isSameLocalDay(l.start, dayDate) && isExamLesson(l)),
    )
  }

  const days: CrunchDayPoint[] = []
  const DECAY = [1.0, 0.6, 0.3] as const

  for (let offset = 0; offset < horizonDays; offset++) {
    const dayDate = localDayStart(now, offset)
    const dateKey = toLocalDateKey(dayDate)
    const dayLessons = input.lessons.filter((l) => isSameLocalDay(l.start, dayDate))
    const lessonHours =
      Math.round(
        dayLessons.reduce((sum, l) => sum + durationHours(l.start, l.end), 0) * 100,
      ) / 100

    const dayBlocks = input.studyBlocks.filter(
      (b) => b.completed !== true && isSameLocalDay(b.startAt, dayDate),
    )
    const studyBlockHours =
      Math.round(
        dayBlocks.reduce((sum, b) => sum + durationHours(b.startAt, b.endAt), 0) * 100,
      ) / 100

    const examCount = (examsByOffset.get(offset) ?? []).length
    const dueTasks = tasksByOffset.get(offset) ?? []

    // Compute 3-day lookahead DDL + Exam pressure score
    let rawPressure = 0
    for (let lookahead = 0; lookahead <= 2; lookahead++) {
      const factor = DECAY[lookahead]
      const lookTasks = tasksByOffset.get(offset + lookahead) ?? []
      for (const t of lookTasks) {
        const w = getTaskWeight(t)
        rawPressure += (14 + Math.min(36, w * 0.5)) * factor
      }
      if (lookahead > 0) {
        const lookExams = examsByOffset.get(offset + lookahead) ?? []
        rawPressure += lookExams.length * 18 * factor
      }
    }

    const ddlPressureScore = Math.min(100, Math.round(rawPressure * 10) / 10)
    const rawComposite =
      lessonHours * 6 +
      studyBlockHours * 5 +
      examCount * 28 +
      ddlPressureScore
    const crunchScore = Math.min(100, Math.max(0, Math.round(rawComposite)))
    const level = classifyCrunchLevel(crunchScore)

    days.push({
      dateKey,
      dateIso: dayDate.toISOString(),
      dayOffset: offset,
      lessonHours,
      studyBlockHours,
      examCount,
      dueTasks,
      ddlPressureScore,
      crunchScore,
      level,
    })
  }

  const allWindowTasks = days.flatMap((d) => d.dueTasks)
  const totalPendingInWindow = allWindowTasks.length

  const scheduledTaskIds = new Set<string>()
  for (const b of input.studyBlocks) {
    if (b.sourceKind === 'task' && b.sourceId) scheduledTaskIds.add(b.sourceId)
    const legacyTaskId = (b as { taskId?: string }).taskId
    if (legacyTaskId) scheduledTaskIds.add(legacyTaskId)
  }

  const unscheduledTasksInWindow = allWindowTasks.filter(
    (t) => !scheduledTaskIds.has(t.id),
  )

  const alerts: CrunchAlert[] = []

  for (const day of days) {
    const courseCodes = [
      ...new Set(
        day.dueTasks
          .map((t) => (t.course ? normalizeCourseCode(t.course) : ''))
          .filter(Boolean),
      ),
    ]

    if (day.dueTasks.length >= 2) {
      alerts.push({
        kind: 'collision',
        dateKey: day.dateKey,
        severity: day.dueTasks.length >= 3 ? 'critical' : 'warn',
        title: `${day.dueTasks.length} deadlines colliding on ${day.dateKey}`,
        taskIds: day.dueTasks.map((t) => t.id),
        courseCodes,
      })
    }

    if (day.examCount > 0 && (day.dueTasks.length > 0 || day.examCount >= 2 || day.ddlPressureScore >= 20)) {
      const examCodes = input.lessons
        .filter((l) => isSameLocalDay(l.start, new Date(day.dateIso)) && isExamLesson(l))
        .map((l) => (l.code ? normalizeCourseCode(l.code) : ''))
        .filter(Boolean)
      alerts.push({
        kind: 'exam-crunch',
        dateKey: day.dateKey,
        severity: day.examCount >= 2 || day.dueTasks.length >= 2 ? 'critical' : 'warn',
        title: `Exam & deadline crunch on ${day.dateKey}`,
        taskIds: day.dueTasks.map((t) => t.id),
        courseCodes: [...new Set([...examCodes, ...courseCodes])],
      })
    }

    const dayUnscheduled = day.dueTasks.filter((t) => !scheduledTaskIds.has(t.id))
    if (dayUnscheduled.length > 0) {
      const hasHighWeight = dayUnscheduled.some((t) => getTaskWeight(t) >= 25)
      alerts.push({
        kind: 'unplanned-ddl',
        dateKey: day.dateKey,
        severity: hasHighWeight || day.dayOffset <= 3 ? 'critical' : 'warn',
        title: `${dayUnscheduled.length} unscheduled deadline(s) on ${day.dateKey}`,
        taskIds: dayUnscheduled.map((t) => t.id),
        courseCodes: [
          ...new Set(
            dayUnscheduled
              .map((t) => (t.course ? normalizeCourseCode(t.course) : ''))
              .filter(Boolean),
          ),
        ],
      })
    }

    if (day.lessonHours + day.studyBlockHours >= 8 || day.crunchScore >= 75) {
      alerts.push({
        kind: 'overload-day',
        dateKey: day.dateKey,
        severity: day.crunchScore >= 85 || day.lessonHours + day.studyBlockHours >= 10 ? 'critical' : 'warn',
        title: `High workload (${Math.round((day.lessonHours + day.studyBlockHours) * 10) / 10}h) on ${day.dateKey}`,
        taskIds: day.dueTasks.map((t) => t.id),
        courseCodes,
      })
    }
  }

  let peakDay: CrunchDayPoint | null = null
  for (const day of days) {
    if (day.crunchScore <= 0) continue
    if (!peakDay || day.crunchScore > peakDay.crunchScore) {
      peakDay = day
    }
  }

  return {
    days,
    peakDay,
    totalPendingInWindow,
    unscheduledTasksInWindow,
    alerts,
  }
}
