import type { CourseFact } from './sisuCourseFacts'
import type { PersonalPlanCourse } from './personalStudyPlan'
import type { Lesson } from '../types'
import { courseWeeklyHours } from './sisuWorkload'

/**
 * 必修优先：把「计划里排在后面、但 SISU 现在就开」的必修/专业课找出来。
 *
 * 与 `recommendOptionalCourses`（推荐计划外的选修课）互补：提前修一门计划内的
 * 必修课，净学分变化是 0 —— 学位总学分已经 209 / 目标 180，加选修只会让超载
 * 更严重，而提前修必修是把后面的压力挪到现在，不改变总量。
 */

export type RequirementKind = 'compulsory-major' | 'compulsory-general' | 'compulsory-language' | 'minor' | 'elective'

/** 通过要求的形态。不同课程差别很大，选课时是硬约束而不是备注。 */
export type PassStyle = 'exam-heavy' | 'course-work' | 'attendance' | 'pass-fail' | 'unknown'

export interface AdvanceableCourse {
  code: string
  title: string
  credits: number
  category: NonNullable<PersonalPlanCourse['category']>
  requirement: RequirementKind
  /** 中文标签，供 UI 直接显示「必修 / 选修」。 */
  requirementLabel: string
  /** 计划里的排期；用于说明「提前了多久」。 */
  plannedYear?: string
  plannedPeriods?: number[]
  offering: { name: string; startDate: string; endDate: string; periods: number[] }
  /** 按学分均摊到该学段的周工作量。 */
  weeklyHours: number
  gradeScale: CourseFact['gradeScale']
  passStyle: PassStyle
  /** SISU 公布的考核构成原文（Exam 50 %, project 50 % 之类）。 */
  passDetail?: string
  /** 单独的考试场次（考期），可能与授课窗口不同。 */
  examDates: string[]
  /** 提前修的净学分变化：始终 0，因为课本来就在计划里。 */
  netCredits: 0
}

const REQUIREMENT: Record<NonNullable<PersonalPlanCourse['category']>, { kind: RequirementKind; label: string }> = {
  intermediate: { kind: 'compulsory-major', label: '必修·专业课' },
  general: { kind: 'compulsory-general', label: '必修·通识' },
  language: { kind: 'compulsory-language', label: '必修·语言' },
  minor: { kind: 'minor', label: '辅修模块' },
  elective: { kind: 'elective', label: '选修' },
}

/** 排序权重：专业课最优先，其次通识/语言，最后是辅修。 */
const REQUIREMENT_RANK: Record<RequirementKind, number> = {
  'compulsory-major': 0,
  'compulsory-general': 1,
  'compulsory-language': 2,
  minor: 3,
  elective: 4,
}

/**
 * 从 SISU 的评估标准文字判断通过要求的形态。
 *
 * 文字是老师自由填写的，所以只做保守匹配：认不出就 `unknown`，绝不猜。
 */
export function classifyPassStyle(fact: CourseFact): PassStyle {
  if (fact.gradeScale === 'pass-fail') return 'pass-fail'
  const text = (fact.assessmentCriteria?.en ?? fact.assessmentCriteria?.fi ?? '').toLowerCase()
  if (!text) return 'unknown'
  const exam = /exam/.test(text)
  const attendance = /attendance|participation|classroom performance/.test(text)
  if (exam) return 'exam-heavy'
  if (attendance) return 'attendance'
  if (/project|report|assignment/.test(text)) return 'course-work'
  return 'unknown'
}

export interface AdvanceableOptions {
  /** 想塞课的时间窗（ISO YYYY-MM-DD）。 */
  windowStart: string
  windowEnd: string
  /** 窗口所属的学年，如 `2026-2027`。用于判断「是不是提前修」。 */
  academicYear?: string
  /** 已注册的课表；窗口内有课时的课视为「已经在上了」，不再推荐。 */
  lessons?: readonly Lesson[]
  limit?: number
  /** 是否包含辅修模块的课。默认只返回必修。 */
  includeMinor?: boolean
}

function overlaps(offering: { startDate: string; endDate: string }, start: string, end: string): boolean {
  return Boolean(offering.startDate) && Boolean(offering.endDate) && offering.startDate <= end && offering.endDate >= start
}

/**
 * 提前修候选：计划内、未完成、现在有开课、但计划排期在后面的必修课。
 */
export function recommendAdvanceableCourses(
  plan: readonly PersonalPlanCourse[],
  facts: Readonly<Record<string, CourseFact>>,
  options: AdvanceableOptions,
): AdvanceableCourse[] {
  const { windowStart, windowEnd, academicYear, lessons = [], limit, includeMinor = false } = options

  const onTimetable = new Set(
    lessons
      .filter((lesson) => lesson?.code && lesson.start >= windowStart && lesson.start <= `${windowEnd}T23:59:59`)
      .map((lesson) => lesson.code as string),
  )

  const rows: AdvanceableCourse[] = []
  for (const course of plan) {
    if (course.completed) continue
    if (!course.credits || course.credits <= 0) continue // 0 学分占位行（毕业论文研讨会、成熟度测试）
    if (onTimetable.has(course.code)) continue
    const requirement = REQUIREMENT[course.category]
    if (!requirement) continue
    if (requirement.kind === 'elective') continue // 选修走 recommendOptionalCourses
    if (requirement.kind === 'minor' && !includeMinor) continue

    // 「提前修」：计划排在当前学年之后，或计划里根本没排期。
    const plannedLater = academicYear ? !course.studyYear || course.studyYear > academicYear : true
    if (!plannedLater) continue

    const fact = facts[course.code]
    if (!fact) continue
    const offering = (fact.offerings ?? []).find((candidate) => overlaps(candidate, windowStart, windowEnd))
    if (!offering) continue

    rows.push({
      code: course.code,
      title: course.title || fact.name || course.code,
      credits: course.credits,
      category: course.category,
      requirement: requirement.kind,
      requirementLabel: requirement.label,
      plannedYear: course.studyYear,
      plannedPeriods: course.periods,
      offering: {
        name: offering.name,
        startDate: offering.startDate,
        endDate: offering.endDate,
        periods: offering.periods,
      },
      weeklyHours: courseWeeklyHours({
        totalHours: fact.totalHours,
        credits: course.credits,
        periods: course.periods ?? offering.periods ?? [],
        selfPaced: fact.selfPaced,
      }),
      gradeScale: fact.gradeScale,
      passStyle: classifyPassStyle(fact),
      passDetail: fact.assessmentCriteria?.en ?? fact.assessmentCriteria?.fi,
      // 考试场次单独存（`offerings` 里故意不含考试，否则会把授课窗口拉长）。
      // SISU 对同一天可能给出多个考场/语言的场次，按日期去重。
      examDates: [...new Set((fact.examSittings ?? []).map((sitting) => sitting.startDate))].sort(),
      netCredits: 0,
    })
  }

  rows.sort((a, b) =>
    REQUIREMENT_RANK[a.requirement] - REQUIREMENT_RANK[b.requirement] ||
    a.weeklyHours - b.weeklyHours ||
    a.code.localeCompare(b.code),
  )
  return limit && limit > 0 ? rows.slice(0, limit) : rows
}
