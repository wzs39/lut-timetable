import { useMemo, useState } from 'react'
import { useNow } from '../../lib/useNow'
import { timelineBuckets, type Task } from '../../lib/tasks'
import { useI18n } from '../../i18n'
import type { Lesson } from '../../types'
import AssignmentsView from '../AssignmentsView'
import type { AssignPreset } from '../MoodleView'

/**
 * 时间线分区 = 官方 App 的四桶概览卡片 + 完整作业模块。
 *
 * 【2026-09-26】独立的 assign 视图已并入这里：卡片数字与下方任务列表同源
 * （同一个 timelineBuckets 口径），点卡片切换下方列表的分组筛选，不再跳
 * 别的视图。跳转点（成绩卡未评项、命令面板任务项）的预置筛选经
 * `assignPreset`（App 级、按值 memo）进入并优先于卡片；卡片点击时回调
 * `onClearAssignPreset` 清掉预置，本地 cardFilter 才能接管。
 */
export default function TimelineSection({
  tasks,
  lessons,
  onTasks,
  onJumpToCourse,
  assignPreset,
  onClearAssignPreset,
}: {
  tasks: Task[]
  lessons: Lesson[]
  /** 作业模块的写操作（带删除撤销），由 App 的 applyTasks 提供 */
  onTasks: (tasks: Task[]) => void
  onJumpToCourse?: (code: string) => void
  /** 跳转点预置的筛选/搜索词；非空时优先于本地卡片点击。 */
  assignPreset?: AssignPreset
  /** 卡片点击时清掉 App 级预置（否则预置恒胜，卡片筛选不生效）。 */
  onClearAssignPreset?: () => void
}) {
  const { t } = useI18n()
  const nowMs = useNow()
  const buckets = useMemo(() => timelineBuckets(tasks, nowMs), [tasks, nowMs])
  // 生效中的筛选：外部预置 > 本地卡片点击（派生值，两处状态不会失步）。
  const [cardFilter, setCardFilter] = useState<'overdue' | 'due7' | 'later' | null>(null)
  const activeFilter = assignPreset != null ? assignPreset.filter : cardFilter
  const preset = assignPreset ?? { filter: cardFilter, query: undefined }

  // 卡片口径与作业页分组一致：today ⊂ due7（7 天内），month → later。
  const cards: Array<{
    key: string
    n: number
    label: string
    danger?: boolean
    filter: 'overdue' | 'due7' | 'later'
  }> = [
    { key: 'overdue', n: buckets.overdue, label: t('assignOverdue'), danger: true, filter: 'overdue' },
    { key: 'today', n: buckets.today, label: t('timelineToday'), filter: 'due7' },
    { key: 'week', n: buckets.week, label: t('assignDue7'), filter: 'due7' },
    { key: 'month', n: buckets.month, label: t('timelineNext30'), filter: 'later' },
  ]

  // 预置变化 = key 变化 = AssignmentsView 以 initialFilter/initialQuery 重建
  // （与原 App 层导航重建同模式，初值始终生效）。
  const presetKey = `${preset.filter ?? 'all'}|${preset.query ?? ''}`

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.key}
            onClick={() => {
              setCardFilter(cardFilter === c.filter ? null : c.filter)
              onClearAssignPreset?.() // 卡片筛选接管列表：先清掉外部预置
            }}
            aria-pressed={activeFilter === c.filter}
            title={t('moodleTimelineLink')}
            className={
              'rounded-lg border p-3 text-center transition hover:brightness-110 ' +
              (c.danger && c.n > 0
                ? 'border-[var(--danger)] bg-[var(--tint-danger)]'
                : 'border-[var(--line)] bg-[var(--surface-2)]')
            }
          >
            <div
              className={
                'text-xl font-semibold tabular-nums ' +
                (c.danger && c.n > 0 ? 'text-[var(--danger)]' : 'text-[var(--text-1)]')
              }
            >
              {c.n}
            </div>
            <div className="mt-0.5 text-[10px] text-[var(--text-3)]">{c.label}</div>
          </button>
        ))}
      </div>

      {/* 完整作业模块（原独立「作业」视图整体内嵌） */}
      <AssignmentsView
        key={presetKey}
        tasks={tasks}
        lessons={lessons}
        onChange={onTasks}
        onJumpToCourse={onJumpToCourse}
        initialFilter={preset.filter}
        initialQuery={preset.query}
      />
    </section>
  )
}
