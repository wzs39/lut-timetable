import type { CourseFact } from './sisuCourseFacts'
import type { PlanCategory } from './sisuStudyPlan'
import type { PersonalPlanCourse } from './personalStudyPlan'
import { likelyPrerequisiteCodes } from './optionalCourses'

/**
 * 毕业路径规划：把「209 cr 计划 / 180 cr 学位」压缩成一份能执行的取舍清单。
 *
 * 三条硬约束来自学位结构，不是偏好：
 *   1. 每个模块有自己的最低学分，砍课只能砍在「模块余量」里；
 *   2. 专业必修（intermediate）余量为 0 —— 一门都不能砍；
 *   3. 申请研究生看的是 GPA 与先修课匹配，所以砍课的排序依据是
 *      「这门课对申研的加成」，不是「这门课难不难」。
 */

/** LUT 官方换算：1 ECTS = 27 小时学生工作量。 */
export const HOURS_PER_CREDIT = 27

/** 一个教学学段的周数（工程里换算周负荷的既有口径）。 */
export const WEEKS_PER_PERIOD = 8

/** 每学年常规学段数（P1–P4）；暑假 P5 是额外选项。 */
export const PERIODS_PER_YEAR = 4

/**
 * 课程对「申请研究生 / 保研」的加成。
 * 分类依据是 CS/SE 研究生项目的常见先修要求，不是课程难度。
 */
export type GradValue =
  /** 数学基础。欧洲（尤其德国）研究生项目逐项核对数学学分，是最硬的通货。 */
  | 'core-math'
  /** CS 核心：算法、操作系统、网络、数据库、编程语言。先修匹配的主要对象。 */
  | 'core-cs'
  /** 软件工程核心，以及论文 / Capstone —— 后者直接变成作品集与研究经历。 */
  | 'core-se'
  /** 方向与辅助课。有价值但可替代。 */
  | 'supporting'
  /** 对 CS 申研几乎无加成（管理类、通识 MOOC、辅修）。 */
  | 'low-value'
  /**
   * 学位程序本身要求的占位课（专业导论、成熟度测试等）。
   * 学分少但砍了在程序上不成立 —— 不参与砍课排序。
   */
  | 'administrative'

export const GRAD_VALUE_LABEL: Record<GradValue, string> = {
  'core-math': '核心·数学',
  'core-cs': '核心·计算机',
  'core-se': '核心·软工',
  supporting: '方向课',
  'low-value': '低加成',
  administrative: '程序必修',
}

/** 砍课时越靠前越该砍。 */
const CUT_RANK: Record<GradValue, number> = {
  'low-value': 0,
  supporting: 1,
  'core-se': 2,
  'core-cs': 3,
  'core-math': 4,
  administrative: Number.MAX_SAFE_INTEGER,
}

export interface CourseValue {
  code: string
  value: GradValue
  /** 中文说明：为什么归这一类，以及砍掉会损失什么。 */
  reason: string
}

export const COURSE_VALUE: Readonly<Record<string, CourseValue>> = {
  // --- 数学 ---
  BM20A9200: { code: 'BM20A9200', value: 'core-math', reason: '数学 A（微积分/线代）。所有研究生项目都看，德国项目逐学分核对。' },
  BM20A9301: { code: 'BM20A9301', value: 'core-math', reason: '概率统计。ML/数据方向的必备先修，也是科研方法的基础。' },
  BM20A8801: { code: 'BM20A8801', value: 'core-math', reason: '离散数学。算法与理论 CS 的直接前置。' },
  HDD4010: { code: 'HDD4010', value: 'core-math', reason: '工程数学 I。凑数学学分用，德国申请常卡数学总学分。' },
  HDD4020: { code: 'HDD4020', value: 'core-math', reason: '工程数学 II。同上，但注意它是 0-5 评分，会拉低或拉高 GPA。' },
  HDD4030: { code: 'HDD4030', value: 'core-math', reason: '工程数学 III。同上。' },
  HDD4040: { code: 'HDD4040', value: 'core-math', reason: '工程数学 IV。四门里最远的一门，边际价值最低。' },
  HDD5010: { code: 'HDD5010', value: 'core-math', reason: '计算机科学基础。理论 CS（逻辑/计算模型），研究生面试常问。' },

  // --- CS 核心 ---
  HDD5030: { code: 'HDD5030', value: 'core-cs', reason: '数据结构与算法。申研第一硬课，也是技术面试的全部内容。' },
  CT30A3350: { code: 'CT30A3350', value: 'core-cs', reason: '操作系统与系统编程。CS 研究生的标准先修，系统方向的门槛。' },
  CT60A5540: { code: 'CT60A5540', value: 'core-cs', reason: '计算机网络。标准先修课。' },
  CT60A4700: { code: 'CT60A4700', value: 'core-cs', reason: '高级网络。网络的进阶层，网络/分布式方向有用。' },
  CT60A4350: { code: 'CT60A4350', value: 'core-cs', reason: '数据库基础。标准先修课。' },
  CT60A7660: { code: 'CT60A7660', value: 'core-cs', reason: '数据库管理。进阶层，数据方向有用。' },
  CT30A3401: { code: 'CT30A3401', value: 'core-cs', reason: '分布式系统。系统/云方向的核心课，也是简历亮点。' },
  CT60A0250: { code: 'CT60A0250', value: 'core-cs', reason: '编程基础。**6 门专业课的先修闸门** —— 挂了或延后，后链全堵。' },
  CT60A2450: { code: 'CT60A2450', value: 'core-cs', reason: '面向对象编程。多数项目的隐含先修。' },
  CT60A2700: { code: 'CT60A2700', value: 'core-cs', reason: 'C 语言开发。系统编程/嵌入式的门槛，也是 OS 的实际准备。' },

  // --- 软工核心 ---
  CT60A4050: { code: 'CT60A4050', value: 'core-se', reason: '软件工程基础。SE 项目的直接先修。' },
  CT60A5511: { code: 'CT60A5511', value: 'core-se', reason: '软件质量管理。SE 方向的标准课。' },
  CT60A4500: { code: 'CT60A4500', value: 'core-se', reason: '软件测试基础。测试/质量方向。' },
  CT60A5550: { code: 'CT60A5550', value: 'core-se', reason: '软件项目管理。带团队/实习的铺垫。' },
  CT60A9800: { code: 'CT60A9800', value: 'core-se', reason: 'Capstone 9 cr。**作品集主体**，申研材料里最有说服力的一项。' },
  CT10A5000: { code: 'CT10A5000', value: 'core-se', reason: '本科论文 12 cr。**可转成研究经历与推荐信来源**，务必选到好导师与好题目。' },

  // --- 程序占位：不参与砍课 ---
  CT10A9900: { code: 'CT10A9900', value: 'administrative', reason: '专业导论 1 cr。学位程序要求，不能砍。' },
  LUTKYPSAT: { code: 'LUTKYPSAT', value: 'administrative', reason: '成熟度测试。学位程序要求，0 学分但必须完成。' },
  HDD5000: { code: 'HDD5000', value: 'administrative', reason: 'HEBUT 论文研讨。学位程序要求，0 学分但必须完成。' },

  // --- 方向 / 辅助 ---
  CT30A2850: { code: 'CT30A2850', value: 'supporting', reason: '人机交互与可用性。HCI 方向才用得上。' },
  CT30A2910: { code: 'CT30A2910', value: 'supporting', reason: 'Web 编程入门。技能有用，但研究生项目很少当作先修。' },
  CT60A4800: { code: 'CT60A4800', value: 'supporting', reason: '智能系统基础。IoT/嵌入方向。' },
  CT60A5522: { code: 'CT60A5522', value: 'supporting', reason: '软件系统网络安全。安全方向才对口。' },
  CT60A9602: { code: 'CT60A9602', value: 'supporting', reason: '函数式编程。编程语言/理论方向有用。' },

  // --- 低加成 ---
  HDD4100: { code: 'HDD4100', value: 'low-value', reason: '工程项目管理（HDD）。管理类，CS 研究生不看。' },
  HDD4110: { code: 'HDD4110', value: 'low-value', reason: '系统工程（HDD）。管理类，同上。' },
  HDD4130: { code: 'HDD4130', value: 'supporting', reason: '精益管理（HDD）。管理类不加申研竞争力，但**无考试、作业主导，是拉 GPA 的便宜分** —— 砍它是用 GPA 换时间。' },
  BH60A6200: { code: 'BH60A6200', value: 'low-value', reason: '可持续城市（辅修）。与 CS 无关。' },
  BH60A6802: { code: 'BH60A6802', value: 'low-value', reason: 'Sustainable.now（辅修）。与 CS 无关。' },
  BH60A7201: { code: 'BH60A7201', value: 'low-value', reason: 'Circular.now（辅修）。Pass-Fail，不进 GPA。' },
  BH60A7400: { code: 'BH60A7400', value: 'low-value', reason: 'Climate.Now（辅修）。Pass-Fail，不进 GPA。' },
  BH60A7410: { code: 'BH60A7410', value: 'low-value', reason: '生命周期思维（辅修）。与 CS 无关。' },
  BH60A7500: { code: 'BH60A7500', value: 'low-value', reason: '影响力创业（辅修）6 cr。20.3 h/周，全计划最重的一门辅修。' },
  MOOC0006A: { code: 'MOOC0006A', value: 'low-value', reason: '技术计算 MOOC。Pass-Fail，不进 GPA，对 CS 无加成。' },
  MOOC0006B: { code: 'MOOC0006B', value: 'low-value', reason: 'Matlab 基础 MOOC。同上。' },
  MOOC0006C: { code: 'MOOC0006C', value: 'low-value', reason: '应用 Matlab MOOC。同上。' },
  MOOC0006D: { code: 'MOOC0006D', value: 'low-value', reason: '有限元基础 MOOC。同上。' },
  MOOC0006E: { code: 'MOOC0006E', value: 'low-value', reason: '力学基础 MOOC。同上。' },
  MOOC0004A: { code: 'MOOC0004A', value: 'low-value', reason: '可持续 3D 建模 MOOC 1 cr。同上。' },
}

export function courseValue(code: string): CourseValue {
  return COURSE_VALUE[code] ?? {
    code,
    value: 'supporting',
    reason: '未分类课程：默认按方向课处理，砍之前请人工确认。',
  }
}

// ---------------------------------------------------------------------------
// 砍课建议
// ---------------------------------------------------------------------------

export interface CutSuggestion {
  code: string
  title: string
  credits: number
  category: PlanCategory
  value: GradValue
  reason: string
  /** Pass-Fail 不进 GPA —— 砍掉对成绩单没有正面或负面影响。 */
  affectsGpa: boolean
  /** 该课在其所属学段里的周工作量。 */
  weeklyHours: number
  /** 砍到这一门时，累计已砍掉的学分。 */
  cutSoFar: number
}

export interface CutPlan {
  goalCredits: number
  plannedCredits: number
  completedCredits: number
  /** 计划总学分 - 目标学分（正数 = 超载）。 */
  creditsToCut: number
  /** 按「最该砍」排序的建议清单（不一定刚好凑满 creditsToCut）。 */
  cuts: CutSuggestion[]
  /** 按建议砍完之后的总学分。 */
  projectedCredits: number
  /** 已经砍到模块最低、无法再砍的提示。 */
  warnings: string[]
  /** 模块余量：还能砍多少学分。 */
  moduleSlack: Record<PlanCategory, number>
}

export interface CutOptions {
  /** 学位最低总学分。缺省 180。 */
  goalCredits?: number
  /** 每周可投入小时上限；超过这个数的课优先砍。缺省 60。 */
  maxWeeklyHours?: number
}

/**
 * 按模块余量给出砍课清单。
 *
 * 排序规则（升序，越靠前越该砍）：
 *   ① 对申研加成越低越该砍；
 *   ② 同样加成时，Pass-Fail（不进 GPA）优先砍；
 *   ③ 再同样时，周负荷越重越该砍。
 *
 * 硬约束：某模块的余量被砍光之后，该模块剩下的课一律不动 —— 即使它价值更低。
 */
export function suggestCuts(
  plan: readonly PersonalPlanCourse[],
  facts: Readonly<Record<string, CourseFact>>,
  categoryMinimums: Readonly<Record<PlanCategory, number>>,
  options: CutOptions = {},
): CutPlan {
  const goal = options.goalCredits ?? 180
  const maxHours = options.maxWeeklyHours ?? 60

  const totalOf = (rows: readonly PersonalPlanCourse[]) => rows.reduce((sum, row) => sum + (row.credits ?? 0), 0)
  const planned = totalOf(plan)
  const completed = totalOf(plan.filter((row) => row.completed))
  const creditsToCut = Math.max(0, planned - goal)

  const moduleTotal: Record<PlanCategory, number> = {
    general: 0, language: 0, intermediate: 0, minor: 0, elective: 0,
  }
  for (const row of plan) {
    const cat = row.category ?? 'elective'
    moduleTotal[cat] += row.credits ?? 0
  }
  const moduleSlack: Record<PlanCategory, number> = {
    general: 0, language: 0, intermediate: 0, minor: 0, elective: 0,
  }
  for (const cat of Object.keys(moduleSlack) as PlanCategory[]) {
    moduleSlack[cat] = Math.max(0, moduleTotal[cat] - (categoryMinimums[cat] ?? 0))
  }

  const warnings: string[] = []
  for (const cat of Object.keys(moduleSlack) as PlanCategory[]) {
    if (moduleSlack[cat] === 0) warnings.push(`${cat} 模块已无余量（${moduleTotal[cat]} / 最低 ${categoryMinimums[cat] ?? 0}），一门都不能砍`)
  }

  const candidates = plan
    .filter((row) => !row.completed)
    .filter((row) => (row.credits ?? 0) > 0)
    // 学位程序要求的占位课不参与砍课 —— 学分少但砍了程序上不成立。
    .filter((row) => courseValue(row.code ?? '').value !== 'administrative')
    .map((row) => {
      const code = row.code ?? ''
      const fact = facts[code]
      const value = courseValue(code)
      const periods = row.periods ?? []
      const affectsGpa = fact?.gradeScale === '0-5'
      const weeklyHours = fact && !fact.selfPaced && fact.totalHours > 0 && periods.length > 0
        ? Math.round((fact.totalHours / (periods.length * WEEKS_PER_PERIOD)) * 10) / 10
        : 0
      return {
        code,
        title: row.title,
        credits: row.credits ?? 0,
        category: row.category ?? ('elective' as PlanCategory),
        value: value.value,
        reason: value.reason,
        affectsGpa,
        weeklyHours,
        score: CUT_RANK[value.value] * 10 +
          (affectsGpa ? 2 : 0) +
          (weeklyHours > maxHours ? -3 : 0) -
          weeklyHours / 20,
      }
    })
    .sort((a, b) => a.score - b.score || b.credits - a.credits || a.code.localeCompare(b.code))

  const cuts: CutSuggestion[] = []
  let cutSoFar = 0
  const slack = { ...moduleSlack }
  for (const candidate of candidates) {
    if (cutSoFar >= creditsToCut) break
    if (slack[candidate.category] <= 0) continue
    // 不能把一门课砍一半：只有当剩余额度吃得住整门课时才砍。
    if (candidate.credits > slack[candidate.category]) continue
    // 也不能砍过头掉到学位最低要求以下 —— 宁可多修几学分，别毕不了业。
    // 用 continue 而不是 break：后面可能有更小的课刚好凑到门槛上。
    if (planned - cutSoFar - candidate.credits < goal) continue
    slack[candidate.category] -= candidate.credits
    cutSoFar += candidate.credits
    cuts.push({ ...candidate, cutSoFar })
  }

  return {
    goalCredits: goal,
    plannedCredits: planned,
    completedCredits: completed,
    creditsToCut,
    cuts,
    projectedCredits: planned - cutSoFar,
    warnings,
    moduleSlack,
  }
}

// ---------------------------------------------------------------------------
// 可行性
// ---------------------------------------------------------------------------

export interface FeasibilityInput {
  /** 毕业前还需要拿到的学分。 */
  creditsRemaining: number
  /** 计划用几年修完（含当前学年）。 */
  years: number
  /** 是否把暑假学段 P5 计入可用周数。 */
  useSummer?: boolean
  /** 每周可投入小时上限。缺省 60（告警线 80 之下的可持续值）。 */
  maxWeeklyHours?: number
  /**
   * 从「现在」到毕业实际还剩多少教学周。
   *
   * 给了就按它算 —— 这是真实口径。学年一旦过半，前面那段已经锁死，
   * 剩下的学分只能压进后面的学段，按「N 年均分」会严重低估强度。
   * 不给则按 years × 学年周数均分（理想口径）。
   */
  weeksRemaining?: number
}

export interface Feasibility {
  years: number
  creditsRemaining: number
  creditsPerYear: number
  /** 每年可用的教学周数。 */
  weeksPerYear: number
  /** 每年需要的总工作量。 */
  hoursPerYear: number
  weeklyHours: number
  maxWeeklyHours: number
  /** 周负荷没超上限。 */
  feasible: boolean
  /** 离上限还有多少余量（负数 = 超了）。 */
  headroom: number
  /** 用的是真实剩余周数还是按学年均分。 */
  basis: 'remaining-weeks' | 'even-years'
  note: string
}

/**
 * 「N 年修完」在算术上是否成立。
 *
 * 只用学分 × 27 h 的总量算，不做学段落位 —— 未来学段的真实开课窗口还没发布，
 * 假装能排出精确课表只是编数据。
 */
export function graduationFeasibility(input: FeasibilityInput): Feasibility {
  const years = Math.max(1, Math.round(input.years))
  const maxWeeklyHours = input.maxWeeklyHours ?? 60
  const weeksPerYear = PERIODS_PER_YEAR * WEEKS_PER_PERIOD + (input.useSummer ? WEEKS_PER_PERIOD : 0)
  const creditsPerYear = input.creditsRemaining / years
  const hoursPerYear = creditsPerYear * HOURS_PER_CREDIT

  const basis: Feasibility['basis'] = input.weeksRemaining !== undefined ? 'remaining-weeks' : 'even-years'
  const totalWeeks = basis === 'remaining-weeks'
    ? Math.max(1, input.weeksRemaining ?? 1)
    : weeksPerYear * years
  const weeklyHours = Math.round((creditsPerYear * years * HOURS_PER_CREDIT / totalWeeks) * 10) / 10
  const headroom = Math.round((maxWeeklyHours - weeklyHours) * 10) / 10

  let note: string
  if (headroom < 0) {
    note = `需要 ${weeklyHours} h/周，超出可持续上限 ${maxWeeklyHours} h/周 ${Math.abs(headroom)} 小时 —— 这个年数在算术上就不成立`
  } else if (headroom < 10) {
    note = `需要 ${weeklyHours} h/周，距上限只剩 ${headroom} 小时 —— 没有容错，任何一门课出意外都会拖累全局`
  } else if (weeklyHours > 45) {
    note = `需要 ${weeklyHours} h/周，明显高于 45 h/周的正常全日制强度 —— 可行但要牺牲课外活动`
  } else {
    note = `需要 ${weeklyHours} h/周，属于正常全日制强度`
  }

  return {
    years,
    creditsRemaining: input.creditsRemaining,
    creditsPerYear: Math.round(creditsPerYear * 10) / 10,
    weeksPerYear,
    hoursPerYear: Math.round(hoursPerYear),
    weeklyHours,
    maxWeeklyHours,
    feasible: headroom >= 0,
    headroom,
    basis,
    note,
  }
}

// ---------------------------------------------------------------------------
// 先修闸门
// ---------------------------------------------------------------------------

export interface PrerequisiteGate {
  code: string
  /** 有多少门计划内课程把它（或其等价课）列为先修。 */
  dependents: number
  dependentCodes: string[]
}

/**
 * 找出「一旦挂科或延后，后面整条链都会堵住」的课。
 *
 * 先修里出现的芬兰校区代码（CT60A0203 等）通过既有的等价表映射回计划里的课。
 */
export function prerequisiteGates(
  PlanCodes: readonly string[],
  facts: Readonly<Record<string, CourseFact>>,
): PrerequisiteGate[] {
  const inPlan = new Set(PlanCodes.map((code) => code.replace(/-\d{4}$/, '').trim().toUpperCase()))
  const dependents = new Map<string, Set<string>>()

  for (const code of inPlan) {
    for (const raw of facts[code]?.formalPrerequisites ?? []) {
      const cleaned = raw.replace(/-\d{4}$/, '').trim().toUpperCase()
      const targets = [cleaned, ...likelyPrerequisiteCodes(cleaned)]
      for (const target of targets) {
        if (!inPlan.has(target)) continue
        if (!dependents.has(target)) dependents.set(target, new Set())
        dependents.get(target)!.add(code)
      }
    }
  }

  return [...dependents.entries()]
    .map(([code, set]) => ({ code, dependents: set.size, dependentCodes: [...set].sort() }))
    .sort((a, b) => b.dependents - a.dependents || a.code.localeCompare(b.code))
}
