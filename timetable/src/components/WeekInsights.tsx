import { useMemo } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'

import { weekInsights, type WeekInsight } from '../lib/weekInsights'
import Icon from './Icon'

/**
 * 本周提示：未来 7 天最多三条只读提醒。点击一行打开对应课程。
 * 生成逻辑（阈值、排序、截断）全在 lib/weekInsights.ts。
 */
export default function WeekInsights({
  lessons,
  now,
  onSelect,
}: {
  lessons: Lesson[]
  now?: Date
  onSelect: (lessonId: string) => void
}) {
  const { t, locale } = useI18n()
  const insights = useMemo(() => weekInsights(lessons, now ?? new Date()), [lessons, now])
  const byId = useMemo(() => new Map(lessons.map((l) => [l.id, l])), [lessons])

  if (insights.length === 0) return null

  const text = (insight: WeekInsight): string => {
    const anchor = byId.get(insight.lessonId)
    if (insight.kind === 'tight-hop') {
      return t('insightTightHop', {
        from: anchor?.location ?? '—',
        to: insight.to ?? '—',
        n: insight.minutes,
      })
    }
    if (insight.kind === 'long-day') {
      return t('insightLongDay', { h: Math.round((insight.minutes / 60) * 10) / 10 })
    }
    return t('insightLongGap', { n: insight.minutes })
  }

  const icon = (kind: WeekInsight['kind']) =>
    kind === 'tight-hop' ? 'jump' : kind === 'long-day' ? 'clock' : 'chair'

  return (
    <section className="animate-modal-in app-card p-3" aria-label={t('insightsTitle')}>
      <h3 className="app-card-label inline-flex items-center gap-1.5">
        <Icon name="compass" size={12} /> {t('insightsTitle')}
      </h3>
      <ul className="mt-2 space-y-0.5">
        {insights.map((insight) => (
          <li key={insight.id}>
            <button
              type="button"
              onClick={() => onSelect(insight.lessonId)}
              className="flex w-full items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-[11px] transition hover:border-[var(--line)] hover:bg-[var(--surface-2)]"
            >
              <span className="shrink-0 text-[var(--text-3)]">
                <Icon name={icon(insight.kind)} size={12} />
              </span>
              <span className="w-9 shrink-0 text-[10px] tabular-nums text-[var(--text-3)]">
                {new Date(`${insight.day}T00:00:00`).toLocaleDateString(locale, {
                  month: 'numeric',
                  day: 'numeric',
                })}
              </span>
              <span
                className={
                  'min-w-0 flex-1 truncate ' +
                  (insight.kind === 'tight-hop' ? 'text-[var(--due)]' : 'text-[var(--text-2)]')
                }
                title={text(insight)}
              >
                {text(insight)}
              </span>
              <span className="shrink-0 text-[var(--text-3)]">
                <Icon name="chevron-right" size={12} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
