import { useI18n } from '../i18n'
import type { AppCommand } from '../lib/commands'
import { VIEWS, WEEK_NAV, type AppView, type WeekNavId } from '../lib/navigation'
import { useMoodleData } from '../hooks/useMoodleData'
import AppMenu from './AppMenu'
import Icon from './Icon'

/** Moodle 未读徽标（挂在导航 tab 上；0 时不渲染）。 */
function MoodleUnreadBadge() {
  const { unread } = useMoodleData()
  if (unread <= 0) return null
  return (
    /* .app-badge 携带自己的 bg/fg 对，选中/未选中两态都可读（同作业徽章）。
       不另引入 info 色：未读语义由「出现在 Moodle tab 上」本身传达。 */
    <span className="app-badge ml-1 font-semibold tabular-nums">{unread > 9 ? '9+' : unread}</span>
  )
}

/**
 * 顶部栏：应用名 + 视图切换 + 周导航 + 搜索/⋯。
 *
 * 视图与周导航的清单来自 `lib/navigation`（头部只是其中一种壳层），
 * 这里不再写死按钮——加视图只改声明表。状态全是受控的（App 独占
 * view / weekStart），组件只发事件；⋯ 菜单内容来自 lib/commands 的注册表。
 */
export default function AppHeader({
  view,
  onView,
  lessonCount,
  sourceCount,
  pendingTaskCount,
  weekNum,
  weekRangeText,
  isCurrentWeek,
  onWeekNav,
  onOpenPalette,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  menuCommands,
}: {
  view: AppView
  onView: (v: AppView) => void
  lessonCount: number
  sourceCount: number
  pendingTaskCount: number
  weekNum: number
  weekRangeText: string
  isCurrentWeek: boolean
  onWeekNav: (id: WeekNavId) => void
  onOpenPalette: () => void
  menuOpen: boolean
  onToggleMenu: () => void
  onCloseMenu: () => void
  menuCommands: AppCommand[]
}) {
  const { t } = useI18n()
  return (
    <header className="app-header safe-top sticky top-0 z-30 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--line)] bg-[var(--surface-0)]/85 px-4 py-2 backdrop-blur-xl transition-all sm:px-6">
      {/* 品牌与状态区 */}
      <div className="flex items-center gap-3">
        <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-500 via-sky-500 to-emerald-400 p-[1px] shadow-sm shadow-indigo-500/20">
          <span
            aria-hidden="true"
            className="flex h-full w-full items-center justify-center rounded-[7px] bg-[var(--surface-0)] text-[11px] font-black text-transparent bg-clip-text bg-gradient-to-tr from-indigo-400 to-sky-300"
          >
            L
          </span>
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold tracking-tight text-[var(--text-1)]">{t('appName')}</h1>
            <span className="hidden items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400 sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {t('lessonsSources', { n: lessonCount, m: sourceCount })}
            </span>
          </div>
        </div>
      </div>

      {/* 视图切换：桌面端精致浮动分段胶囊 */}
      <div className="app-actions flex flex-1 flex-wrap items-center justify-end gap-2 text-xs">
        <div className="app-seg hidden md:flex shadow-sm">
          {VIEWS.filter((decl) => decl.inHeader).map((decl) => {
            const active = view === decl.view
            return (
              <button
                key={decl.route}
                onClick={() => onView(decl.view)}
                aria-pressed={active}
                className={`relative flex items-center gap-1.5 px-3 py-1.5 text-xs transition-all duration-150 ${
                  active
                    ? 'font-semibold text-[var(--accent-text)] bg-[var(--accent)] shadow-sm'
                    : 'text-[var(--text-2)] hover:text-[var(--text-1)] hover:bg-[var(--surface-2)]'
                }`}
              >
                {decl.headerIcon && <Icon name={decl.icon} size={14} />}
                <span>{t(decl.labelKey)}</span>
                {decl.badges?.includes('tasks') && pendingTaskCount > 0 && (
                  <span className="app-badge ml-1 px-1.5 py-0 text-[10px] font-bold tabular-nums bg-rose-500 text-white border-0 shadow-sm">
                    {pendingTaskCount}
                  </span>
                )}
                {decl.badges?.includes('unread') && <MoodleUnreadBadge />}
              </button>
            )
          })}
        </div>

        {/* 周导航：仅在周视图下显示 */}
        {view === 'week' && (
          <div className="hidden md:flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] p-0.5 shadow-sm">
            <button
              onClick={() => onWeekNav(WEEK_NAV.prev.id)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)] transition-colors"
              aria-label={t(WEEK_NAV.prev.labelKey)}
              title={t(WEEK_NAV.prev.labelKey)}
            >
              <Icon name={WEEK_NAV.prev.icon} size={14} />
            </button>
            <span
              className="px-2 text-xs font-medium tabular-nums text-[var(--text-2)]"
              title={t('weekRange', { w: weekNum, range: weekRangeText })}
            >
              {t('weekRange', { w: weekNum, range: weekRangeText })}
            </span>
            <button
              onClick={() => onWeekNav(WEEK_NAV.next.id)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)] transition-colors"
              aria-label={t(WEEK_NAV.next.labelKey)}
              title={t(WEEK_NAV.next.labelKey)}
            >
              <Icon name={WEEK_NAV.next.icon} size={14} />
            </button>
            {!isCurrentWeek && (
              <button
                onClick={() => onWeekNav(WEEK_NAV.this.id)}
                className="ml-0.5 rounded-md bg-[var(--accent)] px-2 py-1 text-[11px] font-semibold text-[var(--accent-text)] shadow-sm hover:opacity-90 transition-opacity"
              >
                {t(WEEK_NAV.this.labelKey)}
              </button>
            )}
          </div>
        )}

        {/* 快捷搜索 (命令面板) */}
        <button
          onClick={onOpenPalette}
          className="app-btn inline-flex items-center gap-2 px-2.5 py-1.5 text-xs text-[var(--text-2)] hover:text-[var(--text-1)]"
          title={t('paletteShortcuts')}
        >
          <Icon name="search" size={13} />
          <span className="hidden lg:inline text-[11px] font-normal text-[var(--text-3)]">
            <kbd className="rounded border border-[var(--line)] bg-[var(--surface-1)] px-1 py-0.5 text-[10px] font-mono">Ctrl K</kbd>
          </span>
        </button>

        {/* 桌面端更多菜单 */}
        <div className="relative max-md:hidden">
          <button
            onClick={onToggleMenu}
            className="app-btn inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-[var(--text-2)] hover:text-[var(--text-1)]"
            title={t('moreActions')}
            aria-expanded={menuOpen}
          >
            <Icon name="more" size={15} />
            <span className="hidden xl:inline">{t('moreActions')}</span>
          </button>
          <AppMenu open={menuOpen} commands={menuCommands} onClose={onCloseMenu} />
        </div>
      </div>
    </header>
  )
}
