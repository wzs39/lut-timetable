import { useMemo } from 'react'
import type { Lesson } from '../types'
import type { Task } from '../lib/tasks'
import { useI18n } from '../i18n'
import { semesterOverview } from '../lib/semester'
import { formatWeekRange } from '../lib/date'
import Icon from './Icon'

/**
 * 学期全景带：每周一根竖条，高度与浓度表示「这周有多忙」。
 * 点某一周 → 跳到周视图。所有阈值/分桶都在 lib/semester.ts，这里只渲染。
 */
export default function SemesterStrip({
  lessons,
  tasks = [],
  now,
  onOpenWeek,
}: {
  lessons: Lesson[]
  tasks?: Task[]
  /** 可注入时钟（测试 / 预览用） */
  now?: Date
  onOpenWeek?: (weekStart: Date) => void
}) {
  const { t, locale } = useI18n()
  const overview = useMemo(
    () => semesterOverview(lessons, tasks, now ?? new Date()),
    [lessons, tasks, now],
  )

  if (overview.weeks.length === 0) return null

  const total = overview.weeks.length
  const current = overview.currentIndex

  return (
    <section className="app-card p-3" aria-label={t('semesterTitle')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="app-card-label inline-flex items-center gap-1.5">
          <Icon name="clock" size={12} /> {t('semesterTitle')}
        </h3>
        <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-3)]">
          {current >= 0
            ? t('semesterProgress', { i: current + 1, n: total })
            : t('semesterDone')}
        </span>
      </div>

      <div className="flex items-end gap-1 overflow-x-auto pb-1" role="list">
        {overview.weeks.map((week, i) => {
          const start = new Date(`${week.start}T00:00:00`)
          const range = formatWeekRange(start, locale)
          const label = t('semesterWeekTip', {
            range,
            lessons: week.lessons,
            tasks: week.tasks,
          })
          const isCurrent = i === current
          return (
            <button
              key={week.start}
              type="button"
              role="listitem"
              onClick={() => onOpenWeek?.(start)}
              title={label}
              aria-label={label}
              aria-current={isCurrent ? 'date' : undefined}
              className={
                'group relative w-2.5 shrink-0 rounded-sm transition hover:opacity-100 ' +
                (isCurrent ? 'ring-1 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--surface-1)]' : '')
              }
              style={{
                height: `${8 + week.load * 5}px`,
                background:
                  week.load === 0 ? 'var(--surface-2)' : 'var(--accent)',
                opacity: week.load === 0 ? 1 : 0.25 + week.load * 0.13,
              }}
            />
          )
        })}
      </div>

      <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--surface-2)]" aria-hidden>
        <div
          className="h-full rounded-full bg-[var(--accent)] opacity-70 transition-[width]"
          style={{ width: `${Math.round(overview.progress * 100)}%` }}
        />
      </div>
    </section>
  )
}
