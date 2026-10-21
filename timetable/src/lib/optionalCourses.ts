import type { CourseFact } from './sisuCourseFacts'
import type { SisuPlanItem, SisuStudyPlan } from './sisuStudyPlan'
import { planItemIdentity } from './sisuCourseSelection'
import { ABSOLUTE_MAX_WEEKLY_HOURS, courseWeeklyHours } from './sisuWorkload'

export type OptionalTag = 'software' | 'systems' | 'ai' | 'math' | 'career' | 'society'

export interface OptionalCourse {
  code: string
  title: string
  tags: readonly OptionalTag[]
  why: { zh: string; en: string }
  priority: number
  categoryImpact: 'elective' | 'language'
  /** Plan codes that make this recommendation redundant. */
  overlaps?: readonly string[]
}

/**
 * Curated from SISU public catalogue + LUT's official programme page.
 * These are recommendations, never auto-added to the plan.
 *
 * Computer-science / software-engineering only: the HDD (HEBUT) Chinese
 * language and culture courses are NOT part of this programme's optional
 * studies, so they must not be recommended here (the earlier "double-degree
 * Chinese requirement" entries were wrong).
 */
export const OPTIONAL_COURSES: readonly OptionalCourse[] = [
  {
    code: 'CT30A1500', title: 'Software Engineering Tools and Practices', tags: ['software', 'career'], priority: 10, categoryImpact: 'elective',
    why: {
      zh: '把 CT60A4050 的理论落成 CI/CD、自动化与 DevOps 实践，直接服务 Capstone 和实习。',
      en: 'Turns CT60A4050 theory into CI/CD, automation and DevOps practice; feeds the capstone and internships.',
    },
  },
  {
    code: 'CT30A8912', title: 'Software Architecture', tags: ['software', 'systems'], priority: 9, categoryImpact: 'elective',
    why: {
      zh: '补当前计划缺的架构视角，适合论文/硕士阶段的系统设计。',
      en: 'Adds the architecture perspective missing from the current plan; useful for the thesis and MSc systems design.',
    },
  },
  {
    code: 'CT60A5103', title: 'Software Engineering Models and Methods', tags: ['software'], priority: 8, categoryImpact: 'elective',
    why: {
      zh: '补需求、建模与设计方法，和 CT60A4050 的工程基础互补。',
      en: 'Adds requirements, modelling and design methods on top of the CT60A4050 engineering basics.',
    },
  },
  {
    code: 'CT30A3204', title: 'Advanced Web Applications', tags: ['software', 'career'], priority: 7, categoryImpact: 'elective',
    why: {
      zh: '在 CT30A2910 之后做进阶 Web/全栈，作品集和就业导向最强。',
      en: 'Advanced web/full-stack work after CT30A2910; the strongest portfolio and employability option.',
    },
  },
  {
    code: 'CT80A0301', title: 'Software Engineering Ethics', tags: ['software', 'society'], priority: 5, categoryImpact: 'elective',
    why: {
      zh: '软件伦理、社会影响与沟通，补纯技术课之外的软技能。',
      en: 'Software ethics, societal impact and communication; soft skills beyond pure technical courses.',
    },
  },
  {
    code: 'CT70A9300', title: "Bachelor's Thesis Seminar", tags: ['software', 'career'], priority: 6, categoryImpact: 'elective',
    why: {
      zh: '研讨、写作与文献训练，直接为 Bachelor thesis 做准备。',
      en: 'Seminar, writing and literature training that directly prepares the bachelor thesis.',
    },
  },
  {
    code: 'CT10A7052', title: 'Software Engineering Work Practice', tags: ['software', 'career'], priority: 7, categoryImpact: 'elective',
    why: {
      zh: '软件工程工作实践，3 学分、P3–P4，适合放实习/作品集。',
      en: 'Software engineering work practice, 3 cr in P3–P4; good for an internship and portfolio.',
    },
  },
  {
    code: 'CT30A1400', title: 'Rust Programming', tags: ['systems', 'software'], priority: 6, categoryImpact: 'elective',
    why: {
      zh: 'Rust 与内存安全，补 C/C++ 之外的现代系统编程能力。',
      en: 'Rust and memory safety, adding modern systems programming beyond C/C++.',
    },
  },
  {
    code: 'BM20A6100', title: 'Data Analysis and Machine Learning', tags: ['ai', 'math'], priority: 9, categoryImpact: 'elective',
    why: {
      zh: 'HDD5040 之后继续数据分析与机器学习，AI 方向最直接的进阶。',
      en: 'Continues data analysis and machine learning after HDD5040; the most direct AI follow-up.',
    },
  },
  {
    code: 'BM40A0702', title: 'Pattern Recognition and Machine Learning', tags: ['ai', 'math'], priority: 7, categoryImpact: 'elective',
    why: {
      zh: '模式识别与机器学习；与 BM20A6100 二选一即可，避免重复。',
      en: 'Pattern recognition and machine learning; pick either this or BM20A6100 to avoid overlap.',
    },
  },
  {
    code: 'BM40A1900', title: 'Mathematics for Machine Learning', tags: ['ai', 'math'], priority: 8, categoryImpact: 'elective',
    why: {
      zh: '机器学习数学基础，适合想深入理论或读硕士。',
      en: 'Mathematical foundations of ML for deeper theory or MSc study.',
    },
  },
  {
    code: 'BM20A7102', title: 'Statistical Inference', tags: ['math', 'ai'], priority: 6, categoryImpact: 'elective',
    why: {
      zh: '统计推断与实验设计，直接支撑 ML/数据分析；先修 BM20A9301 已在计划里。',
      en: 'Statistical inference and experiment design for ML/data analysis; BM20A9301 is already in the plan.',
    },
  },
  {
    code: 'CT10A0013', title: 'Introduction to Python Programming', tags: ['software', 'ai'], priority: 5, categoryImpact: 'elective',
    why: {
      zh: '快速补 Python，服务 AI/数据课程与脚本化。',
      en: 'A quick Python foundation for AI/data courses and scripting.',
    },
  },
] as const

export interface OptionalSwapOption {
  ids: string[]
  codes: string[]
  credits: number
}

export interface OptionalRecommendation {
  course: OptionalCourse
  fact: CourseFact
  prereqStatus: 'ok' | 'likely-equivalent' | 'missing'
  missingPrerequisites: string[]
  netCredits: number
  weeklyDelta: number
  swapOptions: OptionalSwapOption[]
}

const LIKELY_EQUIVALENT: Record<string, readonly string[]> = {
  CT60A0203: ['CT60A0250'],
  CT60A2412: ['CT60A2450'],
  CT60A4002: ['CT60A4050'],
  CT60A4304: ['CT60A4350'],
  BM20A6600: ['BM20A8801'],
}

export const LIKELY_PREREQUISITE_EQUIVALENTS = LIKELY_EQUIVALENT

export function likelyPrerequisiteCodes(code: string): readonly string[] {
  return LIKELY_EQUIVALENT[code] ?? []
}

function cleanCode(code: string): string {
  return code.replace(/-\d{4}$/, '').trim().toUpperCase()
}

function planCodes(plan: SisuStudyPlan): Set<string> {
  return new Set(plan.items.flatMap((item) => item.courseCode ? [item.courseCode.replace(/-\d{4}$/, '').toUpperCase()] : []))
}

export function prerequisiteStatus(
  prerequisites: readonly string[],
  plan: SisuStudyPlan,
  overrides: Readonly<Record<string, readonly string[]>> = {},
): { status: 'ok' | 'likely-equivalent' | 'missing'; missing: string[] } {
  const codes = planCodes(plan)
  const missing: string[] = []
  let likely = false
  for (const prerequisite of prerequisites) {
    const clean = prerequisite.replace(/-\d{4}$/, '').toUpperCase()
    if (codes.has(clean)) continue
    const override = overrides[clean] ?? []
    if (override.some((code) => codes.has(code))) continue
    if ((LIKELY_EQUIVALENT[clean] ?? []).some((code) => codes.has(code))) {
      likely = true
      continue
    }
    missing.push(clean)
  }
  return { status: missing.length > 0 ? 'missing' : likely ? 'likely-equivalent' : 'ok', missing }
}

/** Prefer one same-credit elective, then a 3+3 or 2+1 combination. */
export function findSwapOptions(
  plan: SisuStudyPlan,
  credits: number,
  facts: Readonly<Record<string, CourseFact>> = {},
): OptionalSwapOption[] {
  const candidates = plan.items.filter((item) =>
    !item.completed && item.category === 'elective' && (item.credits ?? 0) > 0,
  )
  const options: OptionalSwapOption[] = []
  const push = (items: SisuPlanItem[]) => {
    const sum = items.reduce((total, item) => total + (item.credits ?? 0), 0)
    if (Math.abs(sum - credits) > 0.01) return
    const removed = new Set(items.map((item) => cleanCode(item.courseCode ?? '')))
    const remaining = plan.items.filter((item) => !removed.has(cleanCode(item.courseCode ?? '')))
    // Never remove a course that another remaining plan course still needs as a prerequisite.
    const broken = remaining.some((item) => {
      const fact = item.courseCode ? facts[cleanCode(item.courseCode)] : undefined
      return (fact?.formalPrerequisites ?? []).some((prerequisite) => {
        const code = cleanCode(prerequisite)
        return removed.has(code) || likelyPrerequisiteCodes(code).some((equivalent) => removed.has(equivalent))
      })
    })
    if (broken) return
    options.push({ ids: items.map((item) => item.id), codes: items.map((item) => item.courseCode ?? item.title), credits: sum })
  }
  for (const item of candidates) push([item])
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) push([candidates[i], candidates[j]])
  }
  return options
    .sort((a, b) => a.ids.length - b.ids.length || a.codes.join(',').localeCompare(b.codes.join(',')))
    .slice(0, 4)
}

export function recommendOptionalCourses(
  plan: SisuStudyPlan,
  facts: Readonly<Record<string, CourseFact>>,
  options: {
    overrides?: Readonly<Record<string, readonly string[]>>
    limit?: number
    targetYears?: number
    maxWeeklyHours?: number
  } = {},
): OptionalRecommendation[] {
  const codes = planCodes(plan)
  const overrides = options.overrides ?? {}
  const targetYears = options.targetYears ?? 3
  // 单门推荐课的上限用绝对上限（80h/周）：正常课程（6cr/单学段 ≈ 20h）远低于它，
  // 这里只拦数据异常；「学段总负荷」的 60h 阈值在 sisuWorkload，概念不同。
  const maxWeeklyHours = options.maxWeeklyHours ?? ABSOLUTE_MAX_WEEKLY_HOURS
  return OPTIONAL_COURSES
    .filter((course) => !codes.has(course.code))
    .flatMap((course) => {
      const fact = facts[course.code]
      if (!fact) return []
      if ((course.overlaps ?? []).some((code) => codes.has(code))) return []
      const prereq = prerequisiteStatus(fact.formalPrerequisites, plan, overrides)
      // 与毕业情景同一个换算（含自定进度 / 0 学分排除、跨学段均摊）。
      const weeklyDelta = courseWeeklyHours({
        totalHours: fact.totalHours,
        credits: fact.credits,
        periods: fact.offeringPattern.length > 0 ? fact.offeringPattern : [1],
        selfPaced: fact.selfPaced,
      })
      const swapOptions = findSwapOptions(plan, fact.credits, facts).filter((option) => {
        const remaining = plan.items.filter((item) => !option.ids.includes(item.id))
        return prerequisiteStatus(fact.formalPrerequisites, { ...plan, items: remaining }, overrides).status !== 'missing'
      })
      // In a 2-year plan extras are only sensible when a swap keeps the total flat.
      if (targetYears <= 2 && swapOptions.length === 0) return []
      if (weeklyDelta > maxWeeklyHours) return []
      return [{
        course,
        fact,
        prereqStatus: prereq.status,
        missingPrerequisites: prereq.missing,
        netCredits: fact.credits,
        weeklyDelta,
        swapOptions,
      }]
    })
    .sort((a, b) => {
      const score = (item: OptionalRecommendation) => item.course.priority * 10 +
        (item.prereqStatus === 'ok' ? 4 : item.prereqStatus === 'likely-equivalent' ? 2 : 0) +
        (item.swapOptions.length > 0 ? 3 : 0) - item.weeklyDelta / 10
      return score(b) - score(a) || a.course.code.localeCompare(b.course.code)
    })
    .slice(0, options.limit ?? 8)
}

export function optionalIdentity(item: SisuPlanItem): string {
  return planItemIdentity(item)
}
