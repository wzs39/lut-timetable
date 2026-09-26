import { useMemo } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { formatLongDay, formatTime } from '../lib/date'
import Icon from './Icon'

/**
 * 别人分享的课表链接打开后的确认框：先给人看"要导入什么"（几节、哪个时间段），
 * 再决定。导入是**加法**（不覆盖现有课表），所以这里的语气是确认而不是警告。
 */
export default function ShareImportDialog({
  decoded,
  failed,
  imported,
  onConfirm,
  onClose,
}: {
  /** 解码结果；failed 为 true 时表示链接坏了（decoded 为 null） */
  decoded: { lessons: Omit<Lesson, 'id' | 'source'>[]; dropped: number } | null
  failed: boolean
  /** 已导入结果（确认后展示） */
  imported?: { added: number; skipped: number } | null
  onConfirm: () => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()

  const range = useMemo(() => {
    if (!decoded || decoded.lessons.length === 0) return ''
    const starts = decoded.lessons.map((l) => new Date(l.start).getTime())
    const first = new Date(Math.min(...starts))
    const last = new Date(Math.max(...starts))
    const firstLabel = formatLongDay(first, locale)
    const lastLabel = formatLongDay(last, locale)
    return firstLabel === lastLabel
      ? `${firstLabel} · ${formatTime(decoded.lessons[0].start, locale)}`
      : `${firstLabel} – ${lastLabel}`
  }, [decoded, locale])

  const courses = useMemo(() => {
    if (!decoded) return []
    return [...new Set(decoded.lessons.map((l) => l.code || l.title).filter(Boolean))].slice(0, 6)
  }, [decoded])

  return (
    <div
      // z-[70]：链接随时可能被点开（设置/详情页开着也算了），确认框必须压在最上层
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t('shareImportTitle')}
      onClick={onClose}
    >
      <div
        className="animate-modal-in w-full max-w-md rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--text-1)]">
            <Icon name="link" size={14} /> {t('shareImportTitle')}
          </h3>
          <button onClick={onClose} className="app-btn px-2 py-1 text-xs" title={t('closeHint')}>
            <Icon name="close" size={12} />
          </button>
        </div>

        {failed && (
          <p className="mt-3 text-xs text-[var(--danger)]">{t('shareImportFailed')}</p>
        )}

        {imported && (
          <div className="mt-3 space-y-1 text-xs text-[var(--text-1)]">
            {/* 一节没加时不说「已导入 0 节」——那句话只让人紧张 */}
            <p>
              {imported.added > 0
                ? t('shareImportDone', { n: imported.added })
                : t('shareImportAllPresent')}
            </p>
            {imported.skipped > 0 && imported.added > 0 && (
              <p className="text-[var(--text-3)]">{t('shareImportSkipped', { n: imported.skipped })}</p>
            )}
            <button onClick={onClose} className="app-btn-primary mt-2 w-full px-3 py-1.5 text-xs">
              {t('close')}
            </button>
          </div>
        )}

        {!failed && !imported && decoded && (
          <>
            <p className="mt-3 text-xs text-[var(--text-2)]">
              {t('shareImportCount', { n: decoded.lessons.length })}
              {range && <span className="text-[var(--text-3)]"> · {range}</span>}
            </p>
            {courses.length > 0 && (
              <p className="mt-1 text-[11px] text-[var(--text-3)]">{courses.join(' · ')}</p>
            )}
            {decoded.dropped > 0 && (
              <p className="mt-1 text-[11px] text-[var(--text-3)]">
                {t('shareImportDropped', { n: decoded.dropped })}
              </p>
            )}
            <p className="mt-2 text-[11px] text-[var(--text-3)]">{t('shareImportNote')}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={onConfirm} className="app-btn-primary flex-1 px-3 py-2 text-xs">
                {t('shareImportConfirm')}
              </button>
              <button onClick={onClose} className="app-btn flex-1 px-3 py-2 text-xs">
                {t('cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
