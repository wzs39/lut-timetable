import { useState } from 'react'
import type { Lesson, SyncSource } from '../types'
import { normalizeSisuUrl, normalizeTimeEditUrl } from '../lib/store'
import { QUICK_LINKS } from '../lib/quickLinks'
import { useI18n } from '../i18n'
import Icon from './Icon'
import CourseSearch from './CourseSearch'
import SyncProtection from './SyncProtection'

/** Label hari, index 0 = Senin */
const DAY_LABELS_ZH = ['一', '二', '三', '四', '五', '六', '日']
const DAY_LABELS_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

interface Props {
  sources: SyncSource[]
  syncing: boolean
  syncMessage: string | null
  autoSync: boolean
  onToggleAutoSync: (v: boolean) => void
  notifEnabled: boolean
  onToggleNotif: (v: boolean) => void
  onAddSource: (s: SyncSource) => void
  onRemoveSource: (id: string) => void
  onSync: (s: SyncSource) => void
  onAddManual: (l: Omit<Lesson, 'id' | 'source'>) => void
  onCloseDrawer?: () => void
}

export default function Sidebar({
  sources,
  syncing,
  syncMessage,
  autoSync,
  onToggleAutoSync,
  notifEnabled,
  onToggleNotif,
  onAddSource,
  onRemoveSource,
  onSync,
  onAddManual,
  onCloseDrawer,
}: Props) {
  const { t, lang } = useI18n()
  const DAY_LABELS = lang === 'zh' ? DAY_LABELS_ZH : DAY_LABELS_EN
  const [url, setUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)

  // Manual lesson form (batch: pilih hari + rentang tanggal)
  const [mTitle, setMTitle] = useState('')
  const [mCode, setMCode] = useState('')
  const [mLocation, setMLocation] = useState('')
  const [mStart, setMStart] = useState('08:00')
  const [mEnd, setMEnd] = useState('10:00')
  const [mDays, setMDays] = useState<number[]>([0, 1, 2, 3, 4])
  const [mDateFrom, setMDateFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // Senin minggu ini
    return d.toISOString().slice(0, 10)
  })
  const [mDateTo, setMDateTo] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 3)
    return d.toISOString().slice(0, 10)
  })
  const [mMessage, setMMessage] = useState<string | null>(null)
  const addSource = () => {
    const raw = url.trim()
    if (!raw) return
    const sisu = normalizeSisuUrl(raw)
    const timeedit = sisu ? null : normalizeTimeEditUrl(raw)
    const icsUrl = sisu || timeedit
    if (!icsUrl) {
      setUrlError(t('badUrl'))
      return
    }
    setUrlError(null)
    const type = sisu ? 'sisu' : 'timeedit'
    onAddSource({
      id: crypto.randomUUID(),
      type,
      url: raw,
      icsUrl,
      label: type === 'sisu' ? 'SISU calendar-share' : 'TimeEdit',
      count: 0,
    })
    setUrl('')
  }

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
      // getDay(): 0=Minggu..6=Sabtu -> konversi ke 0=Senin..6=Minggu
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
    <aside className="w-80 max-w-[85vw] shrink-0 border-r border-[var(--line)] bg-[var(--surface-1)] flex flex-col overflow-y-auto safe-bottom">
      {onCloseDrawer && (
        <div className="flex justify-end px-3 pt-3 md:hidden">
          <button
            onClick={onCloseDrawer}
            className="rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] px-2 py-1 text-xs"
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
      <div className="p-4 space-y-6">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2">
            {t('syncCalendar')}
          </h2>
          <textarea
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('pasteUrl')}
            rows={3}
            className="w-full rounded-md bg-[var(--surface-2)] border border-[var(--line)] px-2 py-1.5 text-xs focus:outline-none focus:border-[var(--info)] resize-none"
          />
          {urlError && <p className="text-[11px] text-[var(--danger)] mt-1">{urlError}</p>}
          <button
            onClick={addSource}
            className="mt-2 w-full rounded-md app-btn-primary px-2 py-1.5 text-xs font-medium"
          >
            {t('addSource')}
          </button>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-[var(--text-2)] cursor-pointer">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => onToggleAutoSync(e.target.checked)}
              className="accent-sky-500"
            />
            {t('autoSyncHint')}
          </label>
          <label className="flex items-center gap-2 text-[11px] text-[var(--text-2)] cursor-pointer">
            <input
              type="checkbox"
              checked={notifEnabled}
              onChange={(e) => onToggleNotif(e.target.checked)}
              className="accent-sky-500"
            />
            {t('notifHint')}
          </label>
          {syncMessage && (
            <p className="text-[11px] text-[var(--text-2)] mt-1">{syncMessage}</p>
          )}
        </div>

        <div className="space-y-2">
          {sources.map((s) => (
            <div
              key={s.id}
              className="rounded-md bg-[var(--surface-2)] border border-[var(--line)] p-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  <span className="inline-flex items-center gap-1"><span className={"inline-block h-2 w-2 rounded-full " + (s.type === 'sisu' ? 'bg-[var(--info)]' : 'bg-[var(--violet)]')} /> {s.type === 'sisu' ? 'SISU' : 'TimeEdit'}</span> · {s.label}
                </span>
                <button
                  onClick={() => onRemoveSource(s.id)}
                  className="text-[var(--text-3)] hover:text-[var(--danger)]"
                  title="Close"
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
              <div className="text-[10px] text-[var(--text-3)] mt-0.5 truncate" title={s.url}>
                {s.url}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-[var(--text-3)]">
                  {t('lessonsN', { n: s.count })}
                  {s.lastSync
                    ? ` · ${new Date(s.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : ''}
                </span>
                <button
                  onClick={() => onSync(s)}
                  disabled={syncing}
                  className="rounded bg-[var(--surface-2)] hover:bg-[var(--hover-1)] disabled:opacity-50 px-2 py-0.5 text-[10px]"
                >
                  {t('syncNow')}
                </button>
              </div>
            </div>
          ))}
        </div>

        <SyncProtection revision={syncMessage ?? ''} />

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2">
            {t('addManual')}
          </h2>
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
                className="w-1/2 rounded-md bg-[var(--surface-2)] border border-[var(--line)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--ok)]"
              />
              <input
                value={mLocation}
                onChange={(e) => setMLocation(e.target.value)}
                placeholder={t('locationPh')}
                className="w-1/2 rounded-md bg-[var(--surface-2)] border border-[var(--line)] px-2 py-1 text-xs focus:outline-none focus:border-[var(--ok)]"
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
                className="w-1/2 rounded-md bg-[var(--surface-2)] border border-[var(--line)] px-2 py-1 text-xs"
              />
              <span className="inline-flex text-[var(--text-3)]"><Icon name="arrow-right" size={12} /></span>
              <input
                type="date"
                value={mDateTo}
                onChange={(e) => setMDateTo(e.target.value)}
                className="w-1/2 rounded-md bg-[var(--surface-2)] border border-[var(--line)] px-2 py-1 text-xs"
              />
            </div>
            <div className="flex gap-1.5">
              <input
                type="time"
                value={mStart}
                onChange={(e) => setMStart(e.target.value)}
                className="w-1/2 rounded-md bg-[var(--surface-2)] border border-[var(--line)] px-2 py-1 text-xs"
              />
              <input
                type="time"
                value={mEnd}
                onChange={(e) => setMEnd(e.target.value)}
                className="w-1/2 rounded-md bg-[var(--surface-2)] border border-[var(--line)] px-2 py-1 text-xs"
              />
            </div>
            <button
              onClick={addManualBatch}
              className="w-full rounded-md app-btn-primary px-2 py-1.5 text-xs font-medium"
            >
              {t('addBatch')}
            </button>
            {mMessage && (
              <p className="text-[11px] text-[var(--ok)]">{mMessage}</p>
            )}
          </div>
        </div>

        <CourseSearch />

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2">
            {t('quickLinks')}
          </h2>
          <div className="grid grid-cols-2 gap-1.5">
            {QUICK_LINKS.map((l) => (
              <a
                key={l.key}
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] border border-[var(--line)] px-2 py-1.5 text-[11px] text-[var(--text-2)] truncate"
                title={l.url}
              >
                {<Icon name={l.icon} size={12} />} {l.name}
              </a>
            ))}
          </div>
        </div>
      </div>
    </aside>
  )
}
