import type { Lesson, LessonType } from '../types'
import {
  attendanceFor,
  courseAttendance,
  type AttendanceLog,
  type CourseAttendanceStats,
} from './attendance'
import { loadCachedContents, type CourseSection } from './contents'
import type { UnifiedCourseNode } from './courseGraph'
import { collectCourseResources, type CourseResource } from './courseResources'
import {
  courseProjection,
  DEFAULT_LUT_GRADE_THRESHOLDS,
  solveGradeTargetsByLevel,
  solveItemMinimumsForTarget,
  type CourseProjection,
  type GradeLevelPlan,
  type ItemMinimumRequirement,
  type LutGradeLevel,
} from './gradeCalc'
import { normalizeCourseCode } from './ics'
import { noteKeyOf, parseNoteKey, type NotesMap } from './notes'
import { sortTasks } from './tasks'

export type { AttendanceLog, CourseAttendanceStats }

export interface CourseNoteEntry {
  type: LessonType
  key: string
  note: string
  updatedAt: string
}

export interface CourseFocusSummary {
  focusMinutes: number
  focusHours: number
  attendedLectureHours: number
  scheduledStudyBlockHours: number
  completedStudyBlockHours: number
  sisuTotalHours: number | null
  completionRatio: number | null
}

export interface CourseDossier {
  node: UnifiedCourseNode
  attendance: CourseAttendanceStats
  recentAndUpcomingLessons: {
    past: Lesson[]
    upcoming: Lesson[]
  }
  tasks: {
    pending: UnifiedCourseNode['tasks']
    completed: UnifiedCourseNode['tasks']
  }
  resources: {
    sections: CourseSection[]
    flatFiles: CourseResource[]
  }
  gradeAnalysis: {
    projection: CourseProjection | null
    targetPlansByGrade: GradeLevelPlan[]
    itemMinimumsForTarget: ItemMinimumRequirement[]
  }
  notes: CourseNoteEntry[]
  focus: CourseFocusSummary
}

const ALL_LESSON_TYPES: readonly LessonType[] = [
  'lecture',
  'exercise',
  'tutorial',
  'seminar',
  'lab',
  'exam',
  'workshop',
  'other',
]

function intervalHours(startIso: string, endIso: string): number {
  const s = Date.parse(startIso)
  const e = Date.parse(endIso)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0
  return (e - s) / 3_600_000
}

export function buildCourseDossier(
  node: UnifiedCourseNode,
  ctx: {
    attendanceLog: AttendanceLog
    notesMap: NotesMap
    sections?: CourseSection[]
    gradeOverrides?: Record<number, number>
    targetGradeLevel?: LutGradeLevel
    focusMinutesByCourse?: Record<string, number>
    now?: Date
  },
): CourseDossier {
  const now = ctx.now ?? new Date()
  const nowMs = now.getTime()
  const attendanceLog = ctx.attendanceLog ?? {}
  const notesMap = ctx.notesMap ?? {}
  const overrides = ctx.gradeOverrides ?? {}
  const targetLevel: LutGradeLevel = ctx.targetGradeLevel ?? 4

  // Ensure lessons carry normalized course code when matching courseAttendance
  const targetCourseKey = node.code || node.title
  const lessonsForAttendance = node.lessons.map((l) =>
    node.code && l.code && normalizeCourseCode(l.code) === normalizeCourseCode(node.code)
      ? { ...l, code: node.code }
      : l,
  )
  const attendance = courseAttendance(
    lessonsForAttendance,
    attendanceLog,
    targetCourseKey,
    now,
  )

  const sortedLessons = [...node.lessons].sort(
    (a, b) => Date.parse(a.start) - Date.parse(b.start),
  )
  const past: Lesson[] = []
  const upcoming: Lesson[] = []
  for (const lesson of sortedLessons) {
    const endMs = Date.parse(lesson.end)
    if (Number.isFinite(endMs) && endMs <= nowMs) {
      past.push(lesson)
    } else {
      upcoming.push(lesson)
    }
  }

  const pending = sortTasks(node.tasks.filter((t) => !t.completed))
  const completed = sortTasks(node.tasks.filter((t) => t.completed))

  const sections: CourseSection[] =
    ctx.sections ??
    (node.moodleCourseId != null ? loadCachedContents(node.moodleCourseId) ?? [] : [])
  const flatFiles = collectCourseResources([
    {
      courseId: node.moodleCourseId ?? 0,
      courseName: node.code || node.title,
      sections,
    },
  ])

  const gradeAnalysis: CourseDossier['gradeAnalysis'] = node.grades
    ? {
        projection: courseProjection(node.grades, overrides),
        targetPlansByGrade: solveGradeTargetsByLevel(
          node.grades.items,
          overrides,
          node.grades.officialTotal,
        ),
        itemMinimumsForTarget: solveItemMinimumsForTarget(
          node.grades.items,
          DEFAULT_LUT_GRADE_THRESHOLDS[targetLevel] ?? 80,
          overrides,
          node.grades.officialTotal,
        ),
      }
    : {
        projection: null,
        targetPlansByGrade: [],
        itemMinimumsForTarget: [],
      }

  // Aggregate notes across all LessonTypes for this course
  const notes: CourseNoteEntry[] = []
  const seenNoteKeys = new Set<string>()
  for (const type of ALL_LESSON_TYPES) {
    const key = noteKeyOf({
      code: node.code || undefined,
      title: node.title,
      type,
    })
    const entry = notesMap[key]
    if (entry && entry.note?.trim()) {
      seenNoteKeys.add(key)
      notes.push({
        type,
        key,
        note: entry.note,
        updatedAt: entry.updatedAt,
      })
    }
  }
  if (node.code) {
    const normCode = normalizeCourseCode(node.code)
    for (const [key, entry] of Object.entries(notesMap)) {
      if (seenNoteKeys.has(key) || !entry?.note?.trim()) continue
      const parsed = parseNoteKey(key)
      if (normalizeCourseCode(parsed.code) === normCode) {
        seenNoteKeys.add(key)
        notes.push({
          type: parsed.type ?? 'other',
          key,
          note: entry.note,
          updatedAt: entry.updatedAt,
        })
      }
    }
  }

  // Compute Focus & Workload summary
  const focusMap = ctx.focusMinutesByCourse ?? {}
  const normCode = node.code ? normalizeCourseCode(node.code) : ''
  const focusMinutes =
    (normCode ? focusMap[normCode] : undefined) ??
    (node.code ? focusMap[node.code] : undefined) ??
    focusMap[node.key] ??
    focusMap[node.title] ??
    0
  const focusHours = Math.round((focusMinutes / 60) * 100) / 100

  let attendedLectureHoursRaw = 0
  for (const lesson of lessonsForAttendance) {
    if (attendanceFor(attendanceLog, lesson) === 'attended') {
      attendedLectureHoursRaw += intervalHours(lesson.start, lesson.end)
    }
  }
  const attendedLectureHours = Math.round(attendedLectureHoursRaw * 100) / 100

  let scheduledBlockHoursRaw = 0
  let completedBlockHoursRaw = 0
  for (const block of node.studyBlocks) {
    const hrs = intervalHours(block.startAt, block.endAt)
    scheduledBlockHoursRaw += hrs
    const isDone = block.completed === true || (block as { done?: boolean }).done === true
    if (isDone) completedBlockHoursRaw += hrs
  }
  const scheduledStudyBlockHours = Math.round(scheduledBlockHoursRaw * 100) / 100
  const completedStudyBlockHours = Math.round(completedBlockHoursRaw * 100) / 100

  const sisuTotalHours =
    node.totalStudyHours != null && node.totalStudyHours > 0
      ? node.totalStudyHours
      : node.credits != null && node.credits > 0
        ? Math.round(node.credits * 27)
        : null

  const completionRatio =
    sisuTotalHours != null && sisuTotalHours > 0
      ? Math.min(
          1,
          Math.round(((focusHours + attendedLectureHours) / sisuTotalHours) * 10000) / 10000,
        )
      : null

  return {
    node,
    attendance,
    recentAndUpcomingLessons: {
      past,
      upcoming,
    },
    tasks: {
      pending,
      completed,
    },
    resources: {
      sections,
      flatFiles,
    },
    gradeAnalysis,
    notes,
    focus: {
      focusMinutes,
      focusHours,
      attendedLectureHours,
      scheduledStudyBlockHours,
      completedStudyBlockHours,
      sisuTotalHours,
      completionRatio,
    },
  }
}
