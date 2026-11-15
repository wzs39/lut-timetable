import { useMemo, useState } from 'react'
import { useNow } from '../../lib/useNow'
import { isOverdue, sortTasks, timelineBuckets, updateTask, type Task } from '../../lib/tasks'
import { useI18n } from '../../i18n'
import type { Lesson } from '../../types'
import type { CourseGrades } from '../../lib/grades'
import type { StudyBlock } from '../../lib/studyBlocks'
import { matchCourseCode } from '../../lib/courses'
import AssignmentsView from '../AssignmentsView'
import type { AssignPreset } from '../MoodleView'
import CrunchRadarChart from './CrunchRadarChart'

/**
 * 时间线分区 = 14 天负荷雷达 + 四桶概览卡片 + 完整作业模块（列表 / 看板双视图）。
 */
export default function TimelineSection({
  tasks,
  lessons,
  studyBlocks = [],
  grades,
  onTasks,
  onJumpToCourse,
  onInspectCourse,
  assignPreset,
  onClearAssignPreset,
}: {
  tasks: Task[]
  lessons: Lesson[]
  studyBlocks?: StudyBlock[]
  grades?: CourseGrades[]
  /** 作业模块的写操作（带删除撤销），由 App 的 applyTasks 提供 */
  onTasks: (tasks: Task[]) => void
  onJumpToCourse?: (code: string) => void
  onInspectCourse?: (code: string) => void
  /** 跳转点预置的筛选/搜索词；非空时优先于本地卡片点击。 */
  assignPreset?: AssignPreset
  /** 卡片点击时清掉 App 级预置（否则预置恒胜，卡片筛选不生效）。 */
  onClearAssignPreset?: () => void
}) {
  const { t, locale } = useI18n()
  const nowMs = useNow()
  const buckets = useMemo(() => timelineBuckets(tasks, nowMs), [tasks, nowMs])
  // 生效中的筛选：外部预置 > 本地卡片点击（派生值，两处状态不会失步）。
  const [cardFilter, setCardFilter] = useState<'overdue' | 'due7' | 'later' | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list')
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

  const kanbanColumns = useMemo(() => {
    const weekEnd = nowMs + 7 * 24 * 3600 * 1000
    const sorted = sortTasks(tasks)
    const overdue: Task[] = []
    const due7: Task[] = []
    const later: Task[] = []
    const done: Task[] = []
    for (const task of sorted) {
      if (task.completed) {
        done.push(task)
      } else if (isOverdue(task)) {
        overdue.push(task)
      } else if (task.dueAt && new Date(task.dueAt).getTime() <= weekEnd) {
        due7.push(task)
      } else {
        later.push(task)
      }
    }
    return [
      { key: 'overdue', title: t('assignOverdue'), tone: 'danger' as const, items: overdue },
      { key: 'due7', title: t('assignDue7'), tone: 'due' as const, items: due7 },
      { key: 'later', title: t('kanbanLater'), tone: 'info' as const, items: later },
      { key: 'done', title: t('assignDone'), tone: 'ok' as const, items: done.slice(0, 12) },
    ]
  }, [tasks, nowMs, t])

  // 预置变化 = key 变化 = AssignmentsView 以 initialFilter/initialQuery 重建
  // （与原 App 层导航重建同模式，初值始终生效）。
  const presetKey = `${preset.filter ?? 'all'}|${preset.query ?? ''}`

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-timeline-buckets>
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

      {/* 14 天 DDL & 学时 Crunch Radar */}
      <CrunchRadarChart
        lessons={lessons}
        tasks={tasks}
        studyBlocks={studyBlocks}
        grades={grades}
        onInspectCourse={onInspectCourse}
      />

      {/* 列表 / 看板视图切换 */}
      <div className="flex items-center justify-end">
        <div
          data-testid="tasks-mode-toggle"
          className="app-seg"
          role="group"
          aria-label={t('tasksModeList')}
        >
          <button
            type="button"
            data-testid="tasks-mode-list"
            data-active={viewMode === 'list'}
            aria-pressed={viewMode === 'list'}
            onClick={() => setViewMode('list')}
            className="app-seg-item"
          >
            {t('tasksModeList')}
          </button>
          <button
            type="button"
            data-testid="tasks-mode-kanban"
            data-active={viewMode === 'kanban'}
            aria-pressed={viewMode === 'kanban'}
            onClick={() => setViewMode('kanban')}
            className="app-seg-item"
          >
            {t('tasksModeKanban')}
          </button>
        </div>
      </div>

      {viewMode === 'list' ? (
        /* 完整作业模块（原独立「作业」视图整体内嵌） */
        <AssignmentsView
          key={presetKey}
          tasks={tasks}
          lessons={lessons}
          onChange={onTasks}
          onJumpToCourse={onJumpToCourse}
          initialFilter={preset.filter}
          initialQuery={preset.query}
        />
      ) : (
        <div
          data-testid="tasks-kanban-board"
          className="animate-view-in grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4"
        >
          {kanbanColumns.map((col) => (
            <div
              key={col.key}
              data-testid={`kanban-col-${col.key}`}
              className="app-card flex flex-col gap-2 p-2.5"
            >
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-1.5">
                <span
                  className={
                    'text-[11px] font-semibold uppercase tracking-wider ' +
                    (col.tone === 'danger' && col.items.length > 0
                      ? 'text-[var(--danger)]'
                      : col.tone === 'ok'
                        ? 'text-[var(--ok)]'
                        : col.tone === 'due'
                          ? 'text-[var(--due)]'
                          : 'text-[var(--text-2)]')
                  }
                >
                  {col.title}
                </span>
                <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-3)] tabular-nums">
                  {col.items.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {col.items.length === 0 ? (
                  <p className="py-4 text-center text-[10px] text-[var(--text-3)]">—</p>
                ) : (
                  col.items.map((task) => {
                    const code = task.course ? matchCourseCode(task.course, lessons) : null
                    return (
                      <div
                        key={task.id}
                        className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2 transition hover:border-[var(--info)]/50"
                      >
                        <div className="flex items-start gap-1.5">
                          <input
                            type="checkbox"
                            checked={task.completed}
                            onChange={() =>
                              onTasks(updateTask(tasks, task.id, { completed: !task.completed }))
                            }
                            aria-label={task.title}
                            className="mt-0.5 shrink-0 accent-sky-500"
                          />
                          <div className="min-w-0 flex-1">
                            <div
                              className={
                                'text-[11px] font-medium leading-snug ' +
                                (task.completed ? 'line-through text-[var(--text-3)]' : 'text-[var(--text-1)]')
                              }
                            >
                              {task.title}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--text-3)]">
                              {(code || task.course) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const target = code ?? task.course!
                                    if (onInspectCourse) onInspectCourse(target)
                                    else onJumpToCourse?.(target)
                                  }}
                                  className="rounded border border-[var(--line)] bg-[var(--surface-1)] px-1 py-px font-mono text-[9px] text-[var(--info)] hover:underline"
                                >
                                  {code ?? task.course}
                                </button>
                              )}
                              {task.dueAt && (
                                <span className="tabular-nums">
                                  {new Date(task.dueAt).toLocaleDateString(locale, {
                                    month: 'short',
                                    day: 'numeric',
                                  })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
