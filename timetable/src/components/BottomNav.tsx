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
      className="md:hidden fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--line)] bg-[var(--surface-1)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {VIEWS.filter((decl) => decl.inBottomNav).map((decl) => {
        const count =
          (decl.badges?.includes('tasks') ? pendingTaskCount : 0) +
          (decl.badges?.includes('unread') ? unread : 0)
        return (
          <button
            key={decl.route}
            onClick={() => onView(decl.view)}
            aria-pressed={view === decl.view}
            className="app-nav-item relative flex flex-1 flex-col items-center gap-0.5 rounded-lg py-2 text-[10px]"
          >
            <span
              aria-hidden="true"
              className={
                'absolute top-0 h-0.5 w-8 rounded-full bg-[var(--accent)] transition-all duration-150 ' +
                (view === decl.view ? 'scale-x-100 opacity-100' : 'scale-x-50 opacity-0')
              }
            />
            <Icon name={decl.icon} size={17} />
            <span className="max-w-full truncate">{t(decl.labelKey)}</span>
            {count > 0 && (
              <span className="app-badge absolute right-[16%] top-2.5 px-1 text-[9px] font-semibold tabular-nums">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </button>
        )
      })}
      <button
        onClick={onOpenSheet}
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-[var(--text-3)]"
        title={t('moreActions')}
      >
        <Icon name="menu" size={17} />
        <span className="max-w-full truncate">{t('moreActions')}</span>
      </button>
    </nav>
  )
}
