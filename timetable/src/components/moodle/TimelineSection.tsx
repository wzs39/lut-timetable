import { useMemo } from 'react'
import { useNow } from '../../lib/useNow'
import { timelineBuckets, type Task } from '../../lib/tasks'
import { useI18n } from '../../i18n'
import Icon from '../Icon'

/** Empat ember waktu gaya Timeline resmi; kartu dapat diklik → filter 作业页. */
export default function TimelineSection({
  tasks,
  onOpenAssignments,
}: {
  tasks: Task[]
  onOpenAssignments: (filter: 'overdue' | 'due7' | 'later') => void
}) {
  const { t } = useI18n()
  const nowMs = useNow()
  const buckets = useMemo(() => timelineBuckets(tasks, nowMs), [tasks, nowMs])

  // 'today' jatuh ke ember due7 di 作业页 (bucket sama, sub-dari-7-hari);
  // 'month' → 'later'. Pemetaan eksplisit agar kartu & filter konsisten.
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

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map((c) => (
          <button
            key={c.key}
            onClick={() => onOpenAssignments(c.filter)}
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
      <button onClick={() => onOpenAssignments('overdue')} className="app-btn w-full px-3 py-2 text-xs" type="button">
        <span className="inline-flex items-center justify-center gap-1.5">
          {t('moodleTimelineLink')} <Icon name="chevron-right" size={12} />
        </span>
      </button>
    </section>
  )
}
