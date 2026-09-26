import { useState } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import Icon from './Icon'

/**
 * 手动添加课程（按星期 + 日期范围批量生成）。
 *
 * 从 Sidebar 抽出：桌面侧栏与移动端「更多」抽屉共用同一份表单，
 * 只有 `onAddManual` 一个出口，重复实现不会再各写一套。
 */

const DAY_LABELS_ZH = ['一', '二', '三', '四', '五', '六', '日']
const DAY_LABELS_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

export default function ManualLessonForm({
  onAddManual,
}: {
  onAddManual: (l: Omit<Lesson, 'id' | 'source'>) => void
}) {
  const { t, lang } = useI18n()
  const DAY_LABELS = lang === 'zh' ? DAY_LABELS_ZH : DAY_LABELS_EN

  const [mTitle, setMTitle] = useState('')
  const [mCode, setMCode] = useState('')
  const [mLocation, setMLocation] = useState('')
  const [mStart, setMStart] = useState('08:00')
  const [mEnd, setMEnd] = useState('10:00')
  const [mDays, setMDays] = useState<number[]>([0, 1, 2, 3, 4])
  const [mDateFrom, setMDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // 本周一
    return d.toISOString().slice(0, 10)
  })
  const [mDateTo, setMDateTo] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 3)
    return d.toISOString().slice(0, 10)
  })
  const [mMessage, setMMessage] = useState<string | null>(null)

  const toggleDay = (d: number) => {
    setMDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    )
  }

  const addManualBatch = () => {
    if (!mTitle.trim() || mDays.length === 0) return
    const from = new Date(`${mDateFrom}T00:00:00`)
    const to = new Date(`${mDateTo}T00:00:00`)
    if (isNaN(from.getTime()) || isNaN(to.getTime()) || to < from) return

    const created: Omit<Lesson, 'id' | 'source'>[] = []
    const cursor = new Date(from)
    while (cursor <= to) {
      // getDay(): 0=周日..6=周六 → 转成 0=周一..6=周日
      const weekday = (cursor.getDay() + 6) % 7
      if (mDays.includes(weekday)) {
        const y = cursor.getFullYear()
        const mo = String(cursor.getMonth() + 1).padStart(2, '0')
        const da = String(cursor.getDate()).padStart(2, '0')
        const start = new Date(`${y}-${mo}-${da}T${mStart}:00`)
        const end = new Date(`${y}-${mo}-${da}T${mEnd}:00`)
        if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start) {
          created.push({
            title: mTitle.trim(),
            code: mCode.trim() || undefined,
            location: mLocation.trim() || undefined,
            start: start.toISOString(),
            end: end.toISOString(),
          })
        }
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    if (created.length === 0) return
    created.forEach(onAddManual)
    setMMessage(t('addedN', { n: created.length }))
    setMTitle('')
    setTimeout(() => setMMessage(null), 4000)
  }

  const inputCls =
    'w-full rounded-md bg-[var(--surface-2)] border border-[var(--line)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--ok)]'

  return (
    <div className="space-y-1.5">
      <input
        value={mTitle}
        onChange={(e) => setMTitle(e.target.value)}
        placeholder={t('namePh')}
        className={inputCls}
      />
      <div className="flex gap-1.5">
        <input
          value={mCode}
          onChange={(e) => setMCode(e.target.value)}
          placeholder={t('codePh')}
          className={inputCls}
        />
        <input
          value={mLocation}
          onChange={(e) => setMLocation(e.target.value)}
          placeholder={t('locationPh')}
          className={inputCls}
        />
      </div>
      <div className="flex gap-1">
        {DAY_LABELS.map((label, d) => (
          <button
            key={d}
            onClick={() => toggleDay(d)}
            className={
              'flex-1 rounded-md py-1 text-[11px] border ' +
              (mDays.includes(d)
                ? 'bg-[var(--accent)] border-transparent text-[var(--accent-text)] font-medium'
                : 'bg-[var(--surface-2)] border-[var(--line)] text-[var(--text-3)] hover:border-[var(--hover-line)]')
            }
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)]">
        <input
          type="date"
          value={mDateFrom}
          onChange={(e) => setMDateFrom(e.target.value)}
          aria-label={t('manualDateFrom')}
          className={inputCls}
        />
        <span className="inline-flex text-[var(--text-3)]">
          <Icon name="arrow-right" size={12} />
        </span>
        <input
          type="date"
          value={mDateTo}
          onChange={(e) => setMDateTo(e.target.value)}
          aria-label={t('manualDateTo')}
          className={inputCls}
        />
      </div>
      <div className="flex gap-1.5">
        <input
          type="time"
          value={mStart}
          onChange={(e) => setMStart(e.target.value)}
          aria-label={t('manualStart')}
          className={inputCls}
        />
        <input
          type="time"
          value={mEnd}
          onChange={(e) => setMEnd(e.target.value)}
          aria-label={t('manualEnd')}
          className={inputCls}
        />
      </div>
      <button
        onClick={addManualBatch}
        className="w-full rounded-md app-btn-primary px-2 py-1.5 text-xs font-medium"
      >
        {t('addBatch')}
      </button>
      {mMessage && <p className="text-[11px] text-[var(--ok)]">{mMessage}</p>}
    </div>
  )
}
