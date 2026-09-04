import { useRef, useState } from 'react'
import type { Lesson, SyncSource } from '../types'
import { loadLessons, normalizeSisuUrl, normalizeTimeEditUrl } from '../lib/store'
import { buildIcs } from '../lib/ics'
import { downloadBlob } from '../lib/download'
import { useI18n } from '../i18n'
import CourseSearch from './CourseSearch'
import SyncProtection from './SyncProtection'
import { exportBackup, importBackup } from '../lib/backup'

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
  translatorUrl?: string
  onTranslatorUrl?: (u: string) => void
  onLinkTranslator?: () => void
  translatorMsg?: string | null
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
  translatorUrl = 'http://localhost:8000',
  onTranslatorUrl,
  onLinkTranslator,
  translatorMsg = null,
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [icsDone, setIcsDone] = useState<string | null>(null)

  const exportIcs = async () => {
    const blob = new Blob([buildIcs(loadLessons())], {
      type: 'text/calendar;charset=utf-8',
    })
    await downloadBlob('lut-timetable.ics', blob)
    setIcsDone(t('exportIcsDone'))
  }

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
    'w-full rounded-md bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs focus:outline-none focus:border-emerald-500'

  return (
    <aside className="w-80 max-w-[85vw] shrink-0 border-r border-zinc-800 bg-zinc-900/60 flex flex-col overflow-y-auto safe-bottom">
      {onCloseDrawer && (
        <div className="flex justify-end px-3 pt-3 md:hidden">
          <button
            onClick={onCloseDrawer}
            className="rounded-md bg-zinc-800 hover:bg-zinc-700 px-2 py-1 text-xs"
          >
            ✕
          </button>
        </div>
      )}
      <div className="p-4 space-y-6">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            {t('syncCalendar')}
          </h2>
          <textarea
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('pasteUrl')}
            rows={3}
            className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs focus:outline-none focus:border-sky-500 resize-none"
          />
          {urlError && <p className="text-[11px] text-rose-400 mt-1">{urlError}</p>}
          <button
            onClick={addSource}
            className="mt-2 w-full rounded-md bg-sky-600 hover:bg-sky-500 px-2 py-1.5 text-xs font-medium"
          >
            {t('addSource')}
          </button>
          <label className="mt-2 flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => onToggleAutoSync(e.target.checked)}
              className="accent-sky-500"
            />
            {t('autoSyncHint')}
          </label>
          <label className="flex items-center gap-2 text-[11px] text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={notifEnabled}
              onChange={(e) => onToggleNotif(e.target.checked)}
              className="accent-sky-500"
            />
            {t('notifHint')}
          </label>
          <div className="mt-2 rounded-md bg-zinc-800/60 border border-zinc-700 p-2">
            <p className="text-[11px] text-zinc-400 mb-1.5">{t('translatorTitle')}</p>
            <input
              defaultValue={translatorUrl}
              placeholder="http://localhost:8000"
              onBlur={(e) => {
                const u = e.target.value.trim().replace(/\/+$/, '')
                if (u && u !== translatorUrl) onTranslatorUrl?.(u)
              }}
              className="w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-[11px]"
            />
            <button
              onClick={onLinkTranslator}
              className="mt-1.5 w-full rounded bg-emerald-700 hover:bg-emerald-600 px-2 py-1 text-[11px] font-medium"
            >
              {t('translatorLinkNow')}
            </button>
            {translatorMsg && (
              <p className="text-[11px] text-zinc-400 mt-1">{translatorMsg}</p>
            )}
          </div>
          {syncMessage && (
            <p className="text-[11px] text-zinc-400 mt-1">{syncMessage}</p>
          )}
        </div>

        <div className="space-y-2">
          {sources.map((s) => (
            <div
              key={s.id}
              className="rounded-md bg-zinc-800/70 border border-zinc-700 p-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {s.type === 'sisu' ? '🔵 SISU' : '🟣 TimeEdit'} · {s.label}
                </span>
                <button
                  onClick={() => onRemoveSource(s.id)}
                  className="text-zinc-500 hover:text-rose-400"
                  title="✕"
                >
                  ✕
                </button>
              </div>
              <div className="text-[10px] text-zinc-500 mt-0.5 truncate" title={s.url}>
                {s.url}
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[10px] text-zinc-500">
                  {t('lessonsN', { n: s.count })}
                  {s.lastSync
                    ? ` · ${new Date(s.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : ''}
                </span>
                <button
                  onClick={() => onSync(s)}
                  disabled={syncing}
                  className="rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 px-2 py-0.5 text-[10px]"
                >
                  {t('syncNow')}
                </button>
              </div>
            </div>
          ))}
        </div>

        <SyncProtection revision={syncMessage ?? ''} />

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
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
                className="w-1/2 rounded-md bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs focus:outline-none focus:border-emerald-500"
              />
              <input
                value={mLocation}
                onChange={(e) => setMLocation(e.target.value)}
                placeholder={t('locationPh')}
                className="w-1/2 rounded-md bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs focus:outline-none focus:border-emerald-500"
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
                      ? 'bg-emerald-600/80 border-emerald-500 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600')
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <input
                type="date"
                value={mDateFrom}
                onChange={(e) => setMDateFrom(e.target.value)}
                className="w-1/2 rounded-md bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs"
              />
              <span>→</span>
              <input
                type="date"
                value={mDateTo}
                onChange={(e) => setMDateTo(e.target.value)}
                className="w-1/2 rounded-md bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs"
              />
            </div>
            <div className="flex gap-1.5">
              <input
                type="time"
                value={mStart}
                onChange={(e) => setMStart(e.target.value)}
                className="w-1/2 rounded-md bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs"
              />
              <input
                type="time"
                value={mEnd}
                onChange={(e) => setMEnd(e.target.value)}
                className="w-1/2 rounded-md bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs"
              />
            </div>
            <button
              onClick={addManualBatch}
              className="w-full rounded-md bg-emerald-600 hover:bg-emerald-500 px-2 py-1.5 text-xs font-medium"
            >
              {t('addBatch')}
            </button>
            {mMessage && (
              <p className="text-[11px] text-emerald-400">{mMessage}</p>
            )}
          </div>
        </div>

        <CourseSearch />

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            {t('dataTitle')}
          </h2>
          <div className="flex gap-1.5">
            <button
              onClick={() => void exportBackup()}
              className="flex-1 rounded-md bg-zinc-700 hover:bg-zinc-600 px-2 py-1.5 text-xs"
            >
              {t('exportData')}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 rounded-md bg-zinc-700 hover:bg-zinc-600 px-2 py-1.5 text-xs"
            >
              {t('importData')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (!file) return
                try {
                  importBackup(await file.text())
                  location.reload()
                } catch {
                  setImportError(t('importFail'))
                }
                e.target.value = ''
              }}
            />
          </div>
          {importError && (
            <p className="text-[11px] text-rose-400 mt-1">{importError}</p>
          )}
          <button
            onClick={exportIcs}
            className="w-full rounded-md bg-zinc-700 hover:bg-zinc-600 px-2 py-1.5 text-xs mt-2"
          >
            {t('exportIcs')}
          </button>
          {icsDone && (
            <p className="text-[11px] text-emerald-400 mt-1">{icsDone}</p>
          )}
          <p className="text-[10px] text-zinc-600 mt-1">{t('dataHint')}</p>
        </div>

        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-2">
            TimeEdit
          </h2>
          <a
            href="https://cloud.timeedit.net/lut-saimia/web/lutpublic/ri1Y8X1QQ7wZ16QfQ5079675yYY95Z7.html"
            target="_blank"
            rel="noreferrer"
            className="block rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-2 py-1.5 text-[11px] text-zinc-300"
          >
            {t('openTimeEdit')}
          </a>
        </div>
      </div>
    </aside>
  )
}
