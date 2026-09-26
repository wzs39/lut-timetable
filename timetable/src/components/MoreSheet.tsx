import type { Lesson, SyncSource } from '../types'
import { useI18n } from '../i18n'
import Icon from './Icon'
import Sidebar from './Sidebar'
import { needsAttention, orderSheetActions, type SheetAction } from '../lib/sheetActions'

export type { SheetAction }

/**
 * 移动端「更多」底部抽屉（<md）。
 *
 * 手机上只把信息留在主界面：导航在底部标签栏、周导航在周视图内，
 * 设置 / 批量筛选 / 冲突检查 / 语言 / 更新 等低频入口全部收进这里。
 * 抽屉下半部分是 Sidebar（来源同步 / 手动添加 / 课程查询 / 常用平台），
 * 与桌面侧栏共用同一份实现，不复制表单。
 *
 * 动作格子按状态自适应：有待处理事项（重复 / 隐藏 / 可更新）的排到最前
 * 并带数量角标，其余保持声明顺序（即「无事的收到底部」）。排序规则在
 * `lib/sheetActions.ts`，此处只渲染。
 */

interface Props {
  /** 打开中（true = 升起，false = 播放落下动画后卸载） */
  open: boolean
  actions: SheetAction[]
  sources: SyncSource[]
  syncing: boolean
  syncMessage: string | null
  onSync: (s: SyncSource) => void
  onAddManual: (l: Omit<Lesson, 'id' | 'source'>) => void
  onOpenSettings: () => void
  onClose: () => void
}

export default function MoreSheet({
  open,
  actions,
  sources,
  syncing,
  syncMessage,
  onSync,
  onAddManual,
  onOpenSettings,
  onClose,
}: Props) {
  const { t } = useI18n()
  const ordered = orderSheetActions(actions)

  return (
    <>
      <div
        className={
          (open ? 'animate-fade-in ' : 'animate-fade-out ') +
          'fixed inset-0 z-40 bg-black/60 md:hidden'
        }
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('moreActions')}
        className={
          (open ? 'animate-sheet-rise ' : 'animate-sheet-fall ') +
          'fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-[var(--line)] bg-[var(--surface-1)] shadow-2xl shadow-black/50 md:hidden'
        }
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[var(--line)]" aria-hidden />
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-1 pt-2">
          <h2 className="text-sm font-semibold">{t('moreActions')}</h2>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="app-btn-ghost px-2 py-1"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        {/* 高频动作网格：始终可见，不随下方数据区滚动；待处理项排最前 */}
        <div className="grid shrink-0 grid-cols-2 gap-1.5 px-4 pb-2 pt-1">
          {ordered.map((a) => {
            const hot = needsAttention(a)
            return (
              <button
                key={a.key}
                onClick={() => {
                  a.onRun()
                  onClose()
                }}
                className={
                  'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-xs ' +
                  (hot
                    ? 'border-[var(--line-due)] bg-[var(--tint-due)] text-[var(--due)]'
                    : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-1)] hover:bg-[var(--hover-1)]')
                }
              >
                <Icon name={a.icon} size={14} />
                <span className="min-w-0 truncate">{a.label}</span>
                {(a.pending ?? 0) > 0 ? (
                  <span className="app-badge app-badge-due ml-auto shrink-0 px-1.5 text-[9px] font-semibold tabular-nums">
                    {a.pending}
                  </span>
                ) : hot ? (
                  <span
                    className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--due)]"
                    aria-hidden
                  />
                ) : null}
              </button>
            )
          })}
        </div>
        {/* 数据与工具区：来源同步 / 手动添加 / 课程查询 / 常用平台（侧栏同一实现） */}
        <Sidebar
          embedded
          sources={sources}
          syncing={syncing}
          syncMessage={syncMessage}
          onSync={onSync}
          onAddManual={onAddManual}
          onOpenSettings={onOpenSettings}
        />
      </div>
    </>
  )
}
