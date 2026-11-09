import { useI18n } from '../i18n'
import { VIEWS, type AppView } from '../lib/navigation'
import { useMoodleData } from '../hooks/useMoodleData'
import Icon from './Icon'

/**
 * 移动端底部标签栏（<md 才显示）：信息视图 + 「更多」抽屉。
 *
 * 与头部是「同一份声明的两种壳」——视图清单来自 `lib/navigation`，加视图
 * 只改声明表。角标数字在这里按声明（badges）汇总：待办来自 props，未读来自
 * Moodle Provider；组件只做「这个入口该显示几」的加法。
 */
export default function BottomNav({
  view,
  pendingTaskCount,
  onView,
  onOpenSheet,
}: {
  view: AppView
  pendingTaskCount: number
  onView: (v: AppView) => void
  onOpenSheet: () => void
}) {
  const { t } = useI18n()
  const { unread } = useMoodleData()
  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-[var(--line)] bg-[var(--surface-1)]/95 px-2 py-1"
      style={{ paddingBottom: 'calc(0.25rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {VIEWS.filter((decl) => decl.inBottomNav).map((decl) => {
        const active = view === decl.view
        const count =
          (decl.badges?.includes('tasks') ? pendingTaskCount : 0) +
          (decl.badges?.includes('unread') ? unread : 0)
        return (
          <button
            key={decl.route}
            onClick={() => onView(decl.view)}
            aria-pressed={active}
            className={`app-nav-item relative flex flex-1 flex-col items-center justify-center gap-1 rounded-md py-1.5 transition-colors ${
              active
                ? 'text-[var(--text-1)] font-semibold bg-[var(--surface-2)]/60'
                : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
            }`}
          >
            {active && (
              <span
                aria-hidden="true"
                className="absolute top-0.5 h-[2px] w-5 rounded-full bg-[var(--text-1)]"
              />
            )}
            <div className="relative mt-1">
              <Icon name={decl.icon} size={18} />
              {count > 0 && (
                <span className="absolute -right-2 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded border border-[var(--danger)]/30 bg-[var(--tint-danger)] px-1 text-[9px] font-mono font-bold text-[var(--danger)]">
                  {count > 9 ? '9+' : count}
                </span>
              )}
            </div>
            <span className="max-w-full truncate text-[10px] tracking-tight">{t(decl.labelKey)}</span>
          </button>
        )
      })}
      <button
        onClick={onOpenSheet}
        className="flex flex-1 flex-col items-center justify-center gap-1 rounded-md py-1.5 text-[10px] text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
        title={t('moreActions')}
      >
        <div className="mt-1">
          <Icon name="menu" size={18} />
        </div>
        <span className="max-w-full truncate tracking-tight">{t('moreActions')}</span>
      </button>
    </nav>
  )
}
