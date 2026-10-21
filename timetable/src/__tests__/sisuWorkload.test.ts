import { describe, expect, it } from 'vitest'
import {
  ABSOLUTE_MAX_WEEKLY_HOURS,
  DEFAULT_MAX_WEEKLY_HOURS,
  WEEKS_PER_PERIOD,
  courseWeeklyHours,
  termCreditShare,
  termTotals,
} from '../lib/sisuWorkload'
import { buildScenario } from '../lib/sisuScenario'
import { COURSE_FACTS } from '../lib/sisuCourseFacts'
import { personalPlanItems } from '../lib/personalStudyPlan'
import type { CourseFact } from '../lib/sisuCourseFacts'
import type { SisuPlanItem } from '../lib/sisuStudyPlan'

// 【模型契约】SISU 总学时 → 周工作量：
// - 学分是「总工作量」不是「周工时」：1 cr ≈ 27 h，按学段（8 周）摊。
// - 跨学段课程在小时与学分上都按学段数均摊（否则 42 cr 会同时虚报两次）。
// - 自定进度（MOOC）与 0 学分占位行不产生周负荷。
// - 阈值 60 h/周 ≈ 全日制基准（50.6 h）+ 18% 余量，不是「每门课都报警」。

function fact(code: string, patch: Partial<CourseFact> = {}): CourseFact {
  return {
    code,
    credits: 5,
    gradeScale: '0-5',
    totalHours: 135,
    hoursSource: 'sisu',
    assessmentMethods: [],
    formalPrerequisites: [],
    offerings: [],
    offeringPattern: [1],
    offeringConfidence: 'sisu-2026-27',
    ...patch,
  }
}

function item(code: string, periods: number[], credits = 5): SisuPlanItem {
  return {
    id: `sisu:${code}`,
    kind: 'course',
    title: code,
    courseCode: code,
    credits,
    category: 'intermediate',
    studyYear: '2026-2027',
    periods,
    completed: false,
    createdAt: '2026-08-20T00:00:00.000Z',
    timingSource: 'pdf-plan',
  }
}

describe('courseWeeklyHours', () => {
  it('spreads total hours across the periods a course occupies', () => {
    // 6 cr / 162 h：整段 = 20.3 h/周；跨 P1–P2 = 10.1 h/周
    expect(courseWeeklyHours({ credits: 6, totalHours: 162, periods: [1] })).toBe(20.3)
    expect(courseWeeklyHours({ credits: 6, totalHours: 162, periods: [1, 2] })).toBe(10.1)
    expect(courseWeeklyHours({ credits: 12, totalHours: 324, periods: [1, 2, 3, 4] })).toBe(10.1)
  })

  it('never charges weekly time to self-paced or zero-credit rows', () => {
    // 5 门 MOOC 曾凭空制造 34 h/周，把 59.8 h 的实际负荷抬到 93.8。
    expect(courseWeeklyHours({ credits: 2, totalHours: 54, periods: [1], selfPaced: true })).toBe(0)
    // 0 学分占位行（如 HDD5000）带 162 h，但不是工作量。
    expect(courseWeeklyHours({ credits: 0, totalHours: 162, periods: [1, 2] })).toBe(0)
    // 缺总学时 / 没有排期：不猜一个数字。
    expect(courseWeeklyHours({ credits: 6, totalHours: 0, periods: [1] })).toBe(0)
    expect(courseWeeklyHours({ credits: 6, totalHours: 162, periods: [] })).toBe(0)
  })

  it('never divides by duplicated or bogus periods', () => {
    // 存储里的 [1, 1] 曾把一周的课按 16 周摊，负荷直接砍半、告警消失。
    expect(courseWeeklyHours({ credits: 6, totalHours: 162, periods: [1, 1] })).toBe(20.3)
    expect(courseWeeklyHours({ credits: 6, totalHours: 162, periods: [0, 5, 1, 1] })).toBe(20.3)
    expect(termTotals([{ credits: 6, totalHours: 162, periods: [1, 1] }])).toEqual({ credits: 6, weeklyHours: 20.3 })
  })
})

describe('termCreditShare', () => {
  it('splits credits the same way hours are split', () => {
    expect(termCreditShare(6, 2)).toBe(3)
    expect(termCreditShare(1, 4)).toBe(0.25)
    expect(termCreditShare(6, 0)).toBe(0)
    expect(termCreditShare(0, 1)).toBe(0)
  })

  it('keeps the sum of term credits equal to the course total', () => {
    const totals = termTotals([
      { credits: 6, totalHours: 162, periods: [1, 2] },
      { credits: 3, totalHours: 81, periods: [1] },
    ])
    // 6 cr 跨两个学段 → 3 + 3；3 cr 整段 → 3。两个学段合计仍是 6 cr。
    expect(totals.credits).toBe(6)
    // 每门课先按自己的学段数四舍五入再相加：10.1 + 10.1
    expect(totals.weeklyHours).toBe(20.2)
  })
})

describe('load alert threshold', () => {
  const scenarioOf = (creditsPerCourse: number, count: number) => {
    const facts: Record<string, CourseFact> = {}
    const items: SisuPlanItem[] = []
    for (let index = 0; index < count; index++) {
      const code = `C${index}`
      facts[code] = fact(code, { credits: creditsPerCourse, totalHours: creditsPerCourse * 27 })
      items.push(item(code, [1], creditsPerCourse))
    }
    return buildScenario({
      plan: { goalCredits: 180, items },
      facts,
      targetYears: 1,
    })
  }

  it('does not flag a normal full-time period (15 cr)', () => {
    expect(DEFAULT_MAX_WEEKLY_HOURS).toBe(60)
    const term = scenarioOf(5, 3).terms.find((entry) => entry.period === 1)!
    // 3 × 5 cr × 27 h ÷ 8 周 = 50.6 h/周（逐门 16.9 后相加 = 50.7）
    expect(term.credits).toBe(15)
    expect(term.weeklyHours).toBe(50.7)
    expect(term.overloaded).toBe(false)
  })

  it('flags a period that is genuinely above full time (20 cr)', () => {
    const term = scenarioOf(5, 4).terms.find((entry) => entry.period === 1)!
    expect(term.credits).toBe(20)
    expect(term.weeklyHours).toBeGreaterThan(DEFAULT_MAX_WEEKLY_HOURS)
    expect(term.overloaded).toBe(true)
  })

  it('keeps the absolute ceiling above the alert threshold', () => {
    expect(ABSOLUTE_MAX_WEEKLY_HOURS).toBeGreaterThan(DEFAULT_MAX_WEEKLY_HOURS)
    expect(WEEKS_PER_PERIOD).toBe(8)
  })
})

describe('real personal plan regression', () => {
  it('does not report 42 credits / 93.8 h for the first period (2026-10 calibration)', () => {
    const result = buildScenario({
      plan: { goalCredits: 180, items: personalPlanItems() },
      facts: COURSE_FACTS,
      targetYears: 3,
    })
    const p1 = result.terms.find((term) => term.yearIndex === 0 && term.period === 1)!

    // 42 cr 是「跨学段课程在两个学段各算一遍」的虚报；真实份额是 27.8 cr。
    expect(p1.credits).toBeLessThan(30)
    expect(p1.credits).toBeGreaterThan(26)
    // 93.8 h 里包含 5 门自定进度 MOOC（34 h/周）；校准后是 59.8 h/周。
    expect(p1.weeklyHours).toBeLessThan(62)
    expect(p1.weeklyHours).toBeGreaterThan(57)
    expect(p1.overloaded).toBe(false)

    // 自定进度课程可以占学分，但永远不占周负荷。
    for (const course of result.courses) {
      const source = course.code ? COURSE_FACTS[course.code] : undefined
      if (source?.selfPaced) expect(course.weeklyHours).toBe(0)
      if (course.credits === 0) expect(course.weeklyHours).toBe(0)
    }

    // 真正超过 1.2 倍全日制的学段仍然会告警（警告不是被关掉了）。
    expect(result.overloadTerms).toBeGreaterThan(0)
    expect(result.terms.some((term) => term.overloaded && term.credits > 18)).toBe(true)

    // SISU 描述里少算的学时不再被直接信任：CT10A5000（12 cr）只写了 162 h，
    // 按 27 h/cr 估算为 324 h，并带 workload-anomaly 提醒。
    expect(COURSE_FACTS.CT10A5000.totalHours).toBe(324)
    expect(COURSE_FACTS.CT10A5000.workloadAnomaly).toBe(true)
    expect(result.warnings.some((warning) => warning.kind === 'workload-anomaly' && warning.courseCode === 'CT10A5000')).toBe(true)
    // 每个快照的学时都不低于 20 h/学分（异常值已被估算替代），否则告警会系统性偏低。
    for (const source of Object.values(COURSE_FACTS)) {
      if (source.credits > 0) expect(source.totalHours / source.credits).toBeGreaterThanOrEqual(20)
    }
  })
})
