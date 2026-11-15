import type { IconName } from '../components/Icon'
import type { Lesson } from '../types'
import { formatDateTime } from './date'
import { roomTimelinesForDay } from './freeRooms'
import { VIEWS, WEEK_NAV, WEEK_NAV_ORDER, type ViewRoute } from './navigation'
import { parseOmniQuickAdd } from './quickAdd'
import { pendingTasks, type Task } from './tasks'

/**
 * 命令面板（Ctrl/Cmd+K）的数据层。
 *
 * 纯函数：把「视图 / 操作 / 课程 / 作业」四类候选拼成一张可搜索的清单，
 * 并提供打分排序。可执行动作以数据（PaletteAction）返回，真正跑动作的
 * 副作用留在 App：这样排序与筛选可以单测，App 只做 dispatch。
 */

// 视图名的唯一来源是 lib/navigation（'assign' 仍合法：派发时映射到 moodle）
export type ViewName = ViewRoute

export type PaletteAction =
  | { kind: 'view'; view: ViewName }
  | { kind: 'week'; delta: -1 | 0 | 1 }
  /** code 为空 = 无代码的手动课，App 回退到按 title 跳转 */
  | { kind: 'course'; code: string; title: string }
  /** 打开课程全景作战室抽屉 (Course Dossier) */
  | { kind: 'dossier'; courseKey: string; code: string; title: string }
  | { kind: 'task'; taskId: string }
  /** 应用动作：真正做什么由 lib/commands 的注册表决定，App 只查 id */
  | { kind: 'command'; id: string }
  /** 命令面板自然语言录入的作业（由 CommandPalette 解析后交给 App 落库） */
  | { kind: 'quickAddTask'; title: string; dueAt?: string; course?: string }
  /** 命令面板自然语言排入学习时间块 */
  | {
      kind: 'quickAddStudyBlock'
      title: string
      course: string
      start: string
      end: string
      durationMin: number
    }
  /** 教室今日空置时间轴查询 */
  | { kind: 'roomStatus'; room: string }
  /** 面板内联成绩目标速算结果 */
  | { kind: 'gradeCalcResult'; expression: string; resultText: string; courseCode?: string }

/** 分组顺序 = 面板展示顺序（无查询时按此浏览） */
export type PaletteGroup = 'views' | 'actions' | 'courses' | 'tasks'

export interface PaletteItem {
  id: string
  group: PaletteGroup
  /** 主文本（已本地化；课程用代码，作业用标题） */
  label: string
  /** 次要文本：课程名 / 课程码 + 截止时间 */
  sub?: string
  icon?: IconName
  /** 附加搜索关键词（课程全名、别名），不展示 */
  keywords?: string
  action: PaletteAction
}

export const PALETTE_GROUP_ORDER: PaletteGroup[] = ['views', 'actions', 'courses', 'tasks']

/** 无查询时课程/作业各只展示前 N 条，避免面板被数据淹成列表 */
export const PALETTE_BROWSE_LIMIT = 6
/** 有查询时的结果上限 */
export const PALETTE_RESULT_LIMIT = 24

/** 由 lib/commands 的注册表映射出的动作条目（label 已本地化） */
export interface PaletteCommand {
  id: string
  label: string
  icon?: IconName
  keywords?: string
}

export interface PaletteInput {
  t: (key: string, params?: Record<string, string | number>) => string
  locale: string
  lessons: Lesson[]
  tasks: Task[]
  /** 应用动作（顺序即面板里的动作顺序） */
  commands: PaletteCommand[]
  /** 已知课程代码列表（可选，供 Omni-Command Bar 识别课程码） */
  knownCourseCodes?: string[]
  /** 当前时间（可选，供测试注入） */
  now?: Date
}

export type PaletteContext = PaletteInput

/** 视图 / 操作 / 课程 / 作业 → 面板清单（顺序即默认展示顺序） */
export function buildPalette({ t, locale, lessons, tasks, commands }: PaletteInput): PaletteItem[] {
  // 视图与周导航都来自 lib/navigation：面板只是把同一份声明本地化，
  // 不再维护第二份按钮清单（那是「新视图在面板里搜不到」的来源）。
  const views: PaletteItem[] = [
    ...VIEWS.map((decl): PaletteItem => ({
      id: `view:${decl.route}`,
      group: 'views',
      label: t(decl.labelKey),
      icon: decl.icon,
      action: { kind: 'view', view: decl.route },
    })),
    ...WEEK_NAV_ORDER.map((id): PaletteItem => {
      const nav = WEEK_NAV[id]
      return {
        id: `week:${nav.id}`,
        group: 'views',
        label: t(nav.labelKey),
        icon: nav.icon,
        action: { kind: 'week', delta: nav.delta },
      }
    }),
  ]

  // 动作组来自 lib/commands 的注册表：这里只做「本地化 → 面板条目」的映射，
  // 不再自己维护一份动作清单（那正是以前「死类型」的来源）。
  const actions: PaletteItem[] = commands.map((c) => ({
    id: `cmd:${c.id}`,
    group: 'actions' as const,
    label: c.label,
    icon: c.icon,
    keywords: c.keywords,
    action: { kind: 'command' as const, id: c.id },
  }))

  // 课程：按代码去重（无代码用标题），label = 代码或标题，sub = 课程名
  const courseMap = new Map<
    string,
    { code: string; title: string; label: string; sub?: string; count: number }
  >()
  for (const l of lessons) {
    const code = l.code?.trim() ?? ''
    const title = (l.title ?? '').trim()
    const key = (code || title).toUpperCase()
    if (!key) continue
    const cur = courseMap.get(key)
    if (cur) {
      cur.count++
      if (!cur.sub && code && title) cur.sub = title
    } else {
      courseMap.set(key, {
        code,
        title,
        label: code || title,
        sub: code ? title || undefined : undefined,
        count: 1,
      })
    }
  }
  const courses: PaletteItem[] = [...courseMap.entries()]
    // 课次多的课程排前面：用户更可能想跳到它
    .sort((a, b) => b[1].count - a[1].count || a[1].label.localeCompare(b[1].label))
    .map(([key, v]) => ({
      id: `course:${key}`,
      group: 'courses' as const,
      label: v.label,
      sub: v.sub,
      icon: 'book' as const,
      keywords: v.sub,
      action: { kind: 'course' as const, code: v.code, title: v.title },
    }))

  // 作业：未完成的，按截止时间排序（无截止排后）
  const tasksOut: PaletteItem[] = pendingTasks(tasks).map((task) => {
    const bits: string[] = []
    if (task.course) bits.push(task.course)
    if (task.dueAt && !isNaN(new Date(task.dueAt).getTime())) {
      bits.push(formatDateTime(task.dueAt, locale))
    }
    return {
      id: `task:${task.id}`,
      group: 'tasks' as const,
      label: task.title,
      sub: bits.join(' · ') || undefined,
      icon: 'assignment' as const,
      keywords: [task.course, task.note].filter(Boolean).join(' '),
      action: { kind: 'task' as const, taskId: task.id },
    }
  })

  return [...views, ...actions, ...courses, ...tasksOut]
}

/** 归一化：小写 + 去音标，让 "Aalto" 也能被 "aalt" 之外的输入命中 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** 单个候选项对查询的得分；null = 不匹配。所有词都必须命中（AND）。 */
export function scoreItem(item: PaletteItem, query: string): number | null {
  const tokens = norm(query).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 0
  const label = norm(item.label)
  const hay = norm([item.sub, item.keywords].filter(Boolean).join(' '))
  let score = 0
  for (const token of tokens) {
    if (label.startsWith(token)) score += 100
    else if (label.includes(' ' + token)) score += 70
    else if (label.includes(token)) score += 50
    else if (hay.includes(token)) score += 25
    else return null
  }
  // 同等命中下更短的标签更可能是用户想要的那个
  return score - label.length * 0.5
}

/**
 * 分组筛选 + 排序：组间保持 views → actions → courses → tasks 的固定
 * 顺序（面板里分组标题不会来回跳），组内按得分降序。
 * 空查询 = 浏览模式：课程/作业各截断到 PALETTE_BROWSE_LIMIT，
 * 且不套总上限（否则末尾的作业会被前面较长的课程列表挤掉）。
 */
export function filterPalette(
  items: PaletteItem[],
  query: string,
  limit = PALETTE_RESULT_LIMIT,
): PaletteItem[] {
  const q = query.trim()
  const out: PaletteItem[] = []
  for (const group of PALETTE_GROUP_ORDER) {
    const inGroup = items.filter((i) => i.group === group)
    if (q === '') {
      const cap = group === 'courses' || group === 'tasks' ? PALETTE_BROWSE_LIMIT : inGroup.length
      out.push(...inGroup.slice(0, cap))
      continue
    }
    const scored = inGroup
      .map((item) => ({ item, score: scoreItem(item, q) }))
      .filter((x): x is { item: PaletteItem; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item)
    out.push(...scored)
  }
  return q === '' ? out : out.slice(0, limit)
}

export interface OmniExtrasContext {
  lessons?: Lesson[]
  knownCourseCodes?: string[]
  now?: Date
  locale?: string
}

/**
 * Omni-Command Bar 2.0 动态增强条目构建器：
 * - 自然语言创建学习块 (`quickAddStudyBlock`) 或作业 (`quickAddTask`)
 * - 教室空置查询 (`room 1314` / `教室 1314` -> `roomStatus`)
 * - 成绩目标内联速算 (`grade 80` / `= ...` -> `gradeCalcResult`)
 */
export function buildOmniExtras(
  query: string,
  ctx: OmniExtrasContext = {},
): PaletteItem[] {
  const q = query.trim()
  if (!q) return []

  const now = ctx.now ?? new Date()
  const locale = ctx.locale ?? 'zh-CN'
  const items: PaletteItem[] = []

  // 1. 教室空置时间轴查询 (`room 1314`, `教室 1314`, `free room`)
  const roomMatch = q.match(/^(?:room|rooms|教室|空教室)\s*(.*)$/i)
  if (roomMatch && ctx.lessons && ctx.lessons.length > 0) {
    const roomQuery = roomMatch[1].trim()
    const timelines = roomTimelinesForDay(ctx.lessons, now, roomQuery)
    for (const tl of timelines.slice(0, 6)) {
      const stateLabel = tl.currentStatus.state === 'free' ? '空闲' : '占用中'
      const untilStr = tl.currentStatus.until
        ? formatDateTime(tl.currentStatus.until, locale)
        : '今日结束'
      items.push({
        id: `omni:room:${tl.room}`,
        group: 'actions',
        label: `${tl.room} · ${stateLabel}`,
        sub: `至 ${untilStr} · 今日剩余空闲 ${tl.freeMinutesRemainingToday} 分钟`,
        icon: 'building',
        keywords: `room 教室 ${tl.room}`,
        action: { kind: 'roomStatus', room: tl.room },
      })
    }
  }

  // 2. 成绩目标内联速算 (`grade CT60A2411 4` / `目标 80`)
  const gradeMatch = q.match(/^(?:grade|目标|算分)\s+([A-Za-z0-9_-]+)?\s*(\d+(?:\.\d+)?)$/i)
  if (gradeMatch) {
    const courseCode = gradeMatch[1]?.toUpperCase()
    const targetVal = Number(gradeMatch[2])
    if (Number.isFinite(targetVal)) {
      const pct = targetVal <= 5 && targetVal >= 1 ? 40 + targetVal * 10 : targetVal
      const resultText = courseCode
        ? `${courseCode} 目标 ${targetVal} 需总评 ≥ ${pct}%`
        : `目标 ${targetVal} 需总评 ≥ ${pct}%`
      items.push({
        id: `omni:grade:${courseCode ?? 'any'}:${targetVal}`,
        group: 'actions',
        label: resultText,
        sub: '点击打开成绩反推模拟器查看各分项最低分',
        icon: 'graduation',
        keywords: q,
        action: {
          kind: 'gradeCalcResult',
          expression: q,
          resultText,
          courseCode,
        },
      })
    }
  }

  // 3. 自然语言排块 / 任务录入 (`parseOmniQuickAdd`)
  const omni = parseOmniQuickAdd(q, now, ctx.knownCourseCodes ?? [])
  if (omni) {
    if (omni.kind === 'study-block' && omni.startOrDueAt && omni.endAt && omni.durationMin) {
      const subParts = [
        omni.course || undefined,
        formatDateTime(omni.startOrDueAt, locale),
        `${omni.durationMin} 分钟`,
      ].filter(Boolean)
      items.push({
        id: `omni:study-block:${omni.title}`,
        group: 'actions',
        label: `排入学习块：${omni.title}`,
        sub: subParts.join(' · '),
        icon: 'clock',
        keywords: q,
        action: {
          kind: 'quickAddStudyBlock',
          title: omni.title,
          course: omni.course,
          start: omni.startOrDueAt,
          end: omni.endAt,
          durationMin: omni.durationMin,
        },
      })
    } else if (omni.kind === 'task') {
      const subParts = [
        omni.course || undefined,
        omni.startOrDueAt ? formatDateTime(omni.startOrDueAt, locale) : undefined,
      ].filter(Boolean)
      items.push({
        id: `omni:task:${omni.title}`,
        group: 'tasks',
        label: omni.title,
        sub: subParts.join(' · ') || undefined,
        icon: 'plus',
        keywords: q,
        action: {
          kind: 'quickAddTask',
          title: omni.title,
          dueAt: omni.startOrDueAt,
          course: omni.course || undefined,
        },
      })
    }
  }

  return items
}
