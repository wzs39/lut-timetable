import type { IconName } from '../components/Icon'
import { addDays, startOfWeek } from './date'

/**
 * 视图与周导航的唯一声明处。
 *
 * 加一个视图 = 在 `VIEWS` 里加一行（路由名、落到哪个页面、标签键、图标、
 * 快捷键、出现在哪些壳层）。头部的视图切换器、底部标签栏、命令面板与键盘
 * 快门都从这张表派生——以前这四处各写一份，新视图漏一处就静默少一个入口。
 *
 * 这里只管「有哪些入口」；角标的数字由 App 提供（视图只声明挂哪些角标）。
 */

/** App 的 view state 只可能是这些（真正的页面）。 */
export type AppView = 'today' | 'week' | 'moodle'

/**
 * 路由 / 命令里可以出现的名字。`assign` 是并入 Moodle 时间线之前的历史入口：
 * 它仍是一条合法命令（用户会搜「作业」），但落到 `moodle` 页面。
 */
export type ViewRoute = AppView | 'assign'

export type ViewBadge = 'tasks' | 'unread'

export interface ViewDecl {
  route: ViewRoute
  /** 真正切换到的页面（历史别名可以指向别的 view） */
  view: AppView
  labelKey: string
  icon: IconName
  /** 键盘快捷键（单字符或 KeyboardEvent.key；大小写不敏感） */
  shortcut?: string
  inHeader?: boolean
  /** 头部是否显示图标（今日/周视图历史上只有文字，Moodle 有图标） */
  headerIcon?: boolean
  inBottomNav?: boolean
  /** 入口按钮上挂哪些角标（数字由 App 提供，0 时入口自己隐藏） */
  badges?: readonly ViewBadge[]
  /** 进入时清掉作业预置筛选（`assign` 语义：用户明确要看作业） */
  clearsAssignPreset?: boolean
}

/** 顺序 = 头部/底部/面板里的展示顺序。 */
export const VIEWS: readonly ViewDecl[] = [
  { route: 'today', view: 'today', labelKey: 'viewToday', icon: 'live', shortcut: '1', inHeader: true, inBottomNav: true },
  { route: 'week', view: 'week', labelKey: 'viewWeek', icon: 'clock', shortcut: '2', inHeader: true, inBottomNav: true },
  // 作业模块已并入 Moodle 时间线：没有独立页面，但保留「作业」入口（快捷键 3）
  { route: 'assign', view: 'moodle', labelKey: 'assignNav', icon: 'graduation', shortcut: '3', clearsAssignPreset: true },
  { route: 'moodle', view: 'moodle', labelKey: 'moodleNav', icon: 'book', shortcut: '4', inHeader: true, headerIcon: true, inBottomNav: true, badges: ['tasks', 'unread'] },
]

/** 路由名 → 声明；不认识的返回 undefined（调用方别猜一个默认视图）。 */
export function viewDeclForRoute(route: string | null | undefined): ViewDecl | undefined {
  if (!route) return undefined
  return VIEWS.find((decl) => decl.route === route)
}

/** `#/view/<route>` → 声明；带别的路径段或未知名字一律 undefined。 */
export function viewDeclFromHash(hash: string): ViewDecl | undefined {
  const match = /^#\/view\/([a-z]+)$/.exec(hash)
  return viewDeclForRoute(match?.[1])
}

/** 键盘数字键 → 视图声明（大小写不敏感）。 */
export function viewDeclForKey(key: string): ViewDecl | undefined {
  const normalized = key.toLowerCase()
  return VIEWS.find(
    (decl) => decl.shortcut != null && decl.shortcut.toLowerCase() === normalized,
  )
}

export type WeekNavId = 'this' | 'prev' | 'next'

export interface WeekNavDecl {
  id: WeekNavId
  labelKey: string
  icon: IconName
  /** 相对当前周的位移（0 = 回到本周） */
  delta: -1 | 0 | 1
  shortcut?: string
}

/**
 * 周导航按 id 存放（`WEEK_NAV.prev` 静态可用，不会出现「找不到」分支）；
 * 面板浏览顺序另用 `WEEK_NAV_ORDER`，头部与周视图直接取 prev/next/this。
 */
export const WEEK_NAV: Record<WeekNavId, WeekNavDecl> = {
  this: { id: 'this', labelKey: 'thisWeek', icon: 'restore', delta: 0, shortcut: 't' },
  prev: { id: 'prev', labelKey: 'prevWeek', icon: 'chevron-left', delta: -1, shortcut: 'ArrowLeft' },
  next: { id: 'next', labelKey: 'nextWeek', icon: 'chevron-right', delta: 1, shortcut: 'ArrowRight' },
}

export const WEEK_NAV_ORDER: readonly WeekNavId[] = ['this', 'prev', 'next']

/** 滑动手势只有前后两周；映射到同一份声明，避免组件自带方向语义。 */
export function weekNavForDelta(delta: -1 | 1): WeekNavDecl {
  return delta < 0 ? WEEK_NAV.prev : WEEK_NAV.next
}

/** 键盘 → 周导航（←/→ 翻周、T 回本周）。 */
export function weekNavForKey(key: string): WeekNavDecl | undefined {
  const normalized = key.toLowerCase()
  return WEEK_NAV_ORDER.map((id) => WEEK_NAV[id]).find(
    (nav) => nav.shortcut != null && nav.shortcut.toLowerCase() === normalized,
  )
}

/**
 * 应用一个周导航动作。`delta: 0` 取 `now` 所在的周（不是「当前 weekStart
 * 那一周」），所以「回到本周」永远真的回到今天所在的周。
 */
export function weekStartAfter(weekStart: Date, nav: WeekNavDecl, now = new Date()): Date {
  return nav.delta === 0 ? startOfWeek(now) : addDays(weekStart, nav.delta * 7)
}
