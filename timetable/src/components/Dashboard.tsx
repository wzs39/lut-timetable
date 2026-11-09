import type { ReactNode } from 'react'
import Icon, { type IconName } from './Icon'

/**
 * 仪表盘骨架的三块积木（SISU 计划页先行，成绩页/作业页复用同一条结构）：
 *
 *   DashboardHero   标题 + 右侧动作 + KPI 格子（`.app-hero` / `.stat-tile`）
 *   DashboardSplit  主区 2/3 + 侧栏 1/3；窄屏单列，侧栏可以排到主区之前
 *   CollapsiblePanel（另一个文件）  侧栏里的「工具」，折叠状态逐面板记忆
 *
 * 这里只负责布局与语义，不读数据、不做格式化——数字怎么算属于 lib。
 */

export type StatTone = 'ok' | 'due' | 'danger' | 'info' | 'violet'

interface StatTileProps {
  label: string
  value: ReactNode
  /** 悬停说明：数字的口径（别让用户猜）。 */
  hint?: string
  tone?: StatTone
  /** 有回调 → 渲染成 button，并带 data-interactive 的按压反馈。 */
  onClick?: () => void
  /** 与当前筛选/排序对应时高亮（aria-pressed 同时给屏幕阅读器）。 */
  pressed?: boolean
  className?: string
}

/** 一个 KPI 格子。数值大、标签小，语义色只染数字与左上角渐变。 */
export function StatTile({ label, value, hint, tone = 'info', onClick, pressed, className = '' }: StatTileProps) {
  const body = (
    <>
      <div className="stat-value text-xl font-bold leading-tight tabular-nums tracking-tight sm:text-2xl">{value}</div>
      <div className="mt-1 text-[11px] font-medium text-[var(--text-3)]">{label}</div>
    </>
  )
  const classes = `stat-tile group relative rounded-md p-3 text-left transition-all duration-150 ${
    pressed ? 'border-[var(--line-info)] bg-[var(--surface-2)]' : ''
  } ${className}`
  if (!onClick) {
    return <div data-tone={tone} title={hint} className={classes}>{body}</div>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-tone={tone}
      data-interactive="true"
      aria-pressed={pressed}
      title={hint}
      className={classes}
    >
      {body}
    </button>
  )
}

interface DashboardHeroProps {
  title: string
  subtitle?: ReactNode
  icon?: IconName
  /** 右侧动作（刷新 / 同步 / 新增），与标题同一行。 */
  actions?: ReactNode
  children: ReactNode
}

/** 页面顶部的「一眼概览」：标题行 + 一行 KPI 格子。 */
export function DashboardHero({ title, subtitle, icon, actions, children }: DashboardHeroProps) {
  return (
    <section className="app-hero p-4 sm:p-5" data-dashboard="hero">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight text-[var(--text-1)]">
            {icon && (
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-[var(--surface-2)] text-[var(--text-2)]">
                <Icon name={icon} size={13} />
              </span>
            )}
            <span>{title}</span>
          </h2>
          {subtitle && <p className="mt-1 text-xs text-[var(--text-3)]">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="mt-3.5 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">{children}</div>
    </section>
  )
}

interface DashboardSplitProps {
  main: ReactNode
  aside: ReactNode
  /**
   * 手机上把侧栏排到主区之前（筛选是阅读列表的前提时用）。
   * 桌面端始终是「主区 2/3 + 侧栏 1/3」。
   */
  asideFirstOnMobile?: boolean
}

/** 主区 + 侧栏。容器查询在 @2xl（42rem）分栏，窄容器保持单列。 */
export function DashboardSplit({ main, aside, asideFirstOnMobile = false }: DashboardSplitProps) {
  return (
    <div className="@container" data-dashboard="split">
      <div className="grid gap-4 @2xl:grid-cols-3 @2xl:items-start @2xl:gap-5">
        <div className="min-w-0 space-y-3.5 @2xl:col-span-2">{main}</div>
        <div
          className={`min-w-0 space-y-3.5 @2xl:col-span-1 ${asideFirstOnMobile ? 'order-first @2xl:order-none' : ''}`}
        >
          {aside}
        </div>
      </div>
    </div>
  )
}
