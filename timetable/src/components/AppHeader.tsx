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
    <header className="app-header safe-top flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--line)] bg-[var(--surface-0)]/90 px-3 py-2.5 backdrop-blur sm:px-4">
      <div className="flex items-center gap-3">
        {/* 移动端不再放汉堡按钮：主导航已下到底部标签栏（拇指可达） */}
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--line)] bg-gradient-to-br from-[var(--tint-info)] to-[var(--tint-violet)] text-[10px] font-bold text-[var(--text-1)]"
        >
          L
        </span>
        <h1 className="text-sm font-semibold tracking-tight">{t('appName')}</h1>
        <span className="hidden sm:inline text-[11px] text-[var(--text-3)]">
          {t('lessonsSources', { n: lessonCount, m: sourceCount })}
        </span>
      </div>
      <div className="app-actions flex flex-wrap items-center justify-end gap-1.5 text-xs ml-auto">
        {/* 视图切换：桌面/平板保留在头部（移动端交给底部标签栏） */}
        <div className="app-seg hidden md:flex">
          {VIEWS.filter((decl) => decl.inHeader).map((decl) => (
            <button
              key={decl.route}
              onClick={() => onView(decl.view)}
              aria-pressed={view === decl.view}
            >
              <span className="inline-flex items-center gap-2">
                {decl.headerIcon && <Icon name={decl.icon} size={15} />}
                <span>{t(decl.labelKey)}</span>
              </span>
              {decl.badges?.includes('tasks') && pendingTaskCount > 0 && (
                <span className="app-badge ml-1 font-semibold tabular-nums">{pendingTaskCount}</span>
              )}
              {decl.badges?.includes('unread') && <MoodleUnreadBadge />}
            </button>
          ))}
        </div>
        {view === 'week' && (
          <div className="hidden md:flex items-center gap-1.5">
            <button onClick={() => onWeekNav(WEEK_NAV.prev.id)} className="app-btn px-2.5 min-h-9" aria-label={t(WEEK_NAV.prev.labelKey)} title={t(WEEK_NAV.prev.labelKey)}>
              <Icon name={WEEK_NAV.prev.icon} size={15} />
            </button>
            <span
              className="inline-block max-w-[24vw] truncate align-middle rounded-md border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1.5 text-[11px] sm:max-w-none sm:text-xs tabular-nums text-[var(--text-2)]"
              title={t('weekRange', { w: weekNum, range: weekRangeText })}
            >
              {t('weekRange', { w: weekNum, range: weekRangeText })}
            </span>
            <button onClick={() => onWeekNav(WEEK_NAV.next.id)} className="app-btn px-2.5 min-h-9" aria-label={t(WEEK_NAV.next.labelKey)} title={t(WEEK_NAV.next.labelKey)}>
              <Icon name={WEEK_NAV.next.icon} size={15} />
            </button>
            {!isCurrentWeek && (
              <button onClick={() => onWeekNav(WEEK_NAV.this.id)} className="app-btn-primary px-2.5 min-h-9">
                {t(WEEK_NAV.this.labelKey)}
              </button>
            )}
          </div>
        )}
        <button
          onClick={onOpenPalette}
          className="app-btn inline-flex items-center gap-1.5 px-2 sm:px-2.5 min-h-9"
          title={t('paletteShortcuts')}
        >
          <Icon name="search" size={14} />
          <span className="hidden sm:inline text-[10px] text-[var(--text-3)]">Ctrl K</span>
        </button>
        <div className="relative max-md:hidden">
          <button
            onClick={onToggleMenu}
            className="app-btn px-2 sm:px-2.5 min-h-9"
            title={t('moreActions')}
            aria-expanded={menuOpen}
          >
            <span aria-hidden="true" className="inline-flex items-center">
              <Icon name="more" size={16} />
            </span>
            <span className="hidden sm:inline"> {t('moreActions')}</span>
          </button>
          <AppMenu open={menuOpen} commands={menuCommands} onClose={onCloseMenu} />
        </div>
      </div>
    </header>
  )
}
