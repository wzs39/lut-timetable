import { useEffect, useState } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { resolveSisuCourseUrl } from '../lib/sisuCourse'
import { TYPE_META } from '../lib/lessonTypes'
import { displayTitle, buildingOf, roomOf } from '../lib/display'
import { formatDay, formatTime } from '../lib/date'

interface Props {
  lesson: Lesson
  onSave: (id: string, patch: Partial<Lesson>) => void
  onDelete: (id: string) => void
  /** URL halaman TimeEdit sumber lesson ini (bila ada) */
  timeEditUrl?: string
  /** Sembunyikan tanpa menghapus (tanpa tombstone) */
  onHide: (id: string) => void
  onClose: () => void
}

function toTimeInput(iso: string): string {
  const d = new Date(iso)
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`
}

export default function LessonDetail({
  lesson,
  onSave,
  onDelete,
  timeEditUrl,
  onHide,
  onClose,
}: Props) {
  const { t, lang } = useI18n()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(lesson.title)
  const [code, setCode] = useState(lesson.code || '')
  const [location, setLocation] = useState(lesson.location || '')
  const [date, setDate] = useState(lesson.start.slice(0, 10))
  const [start, setStart] = useState(toTimeInput(lesson.start))
  const [end, setEnd] = useState(toTimeInput(lesson.end))
  const [error, setError] = useState<string | null>(null)
  const [sisuState, setSisuState] = useState<'idle' | 'loading' | 'notfound'>('idle')

  const isMerged = (lesson.mergedSources?.length ?? 0) > 1
  const sourceNote = isMerged
    ? t('mergedNote')
    : lesson.source === 'sisu'
      ? t('sisuNote')
      : lesson.source === 'timeedit'
        ? t('timeeditNote')
        : t('manualNote')

  // Buka lesson lain: kembali ke mode lihat + reset form
  useEffect(() => {
    setEditing(false)
    setTitle(lesson.title)
    setCode(lesson.code || '')
    setLocation(lesson.location || '')
    setDate(lesson.start.slice(0, 10))
    setStart(toTimeInput(lesson.start))
    setEnd(toTimeInput(lesson.end))
    setError(null)
    setSisuState('idle')
  }, [lesson])

  const startEdit = () => {
    // Init from the RAW stored title, not the display-cleaned one, so
    // entering edit mode can never rewrite stored data on save.
    setTitle(lesson.title)
    setEditing(true)
    setError(null)
  }

  const handleSave = () => {
    const startDt = new Date(`${date}T${start}:00`)
    const endDt = new Date(`${date}T${end}:00`)
    if (!title.trim()) return setError(t('errNameRequired'))
    if (isNaN(startDt.getTime()) || isNaN(endDt.getTime()))
      return setError(t('errInvalidDate'))
    if (endDt <= startDt) return setError(t('errEndBeforeStart'))
    onSave(lesson.id, {
      title: title.trim(),
      code: code.trim() || undefined,
      location: location.trim() || undefined,
      start: startDt.toISOString(),
      end: endDt.toISOString(),
    })
    onClose()
  }

  const handleDelete = () => {
    if (confirm(t('deleteConfirm', { t: lesson.title }))) {
      onDelete(lesson.id)
      onClose()
    }
  }

  const openSisu = async () => {
    if (!lesson.code) return
    setSisuState('loading')
    try {
      const url = await resolveSisuCourseUrl(lesson.code)
      window.open(url, '_blank', 'noopener')
      setSisuState('idle')
    } catch {
      setSisuState('notfound')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (editing) setEditing(false)
      else onClose()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && editing) handleSave()
  }

  const inputCls =
    'mt-0.5 w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 focus:outline-none focus:border-sky-500'

  const startD = new Date(lesson.start)
  const endD = new Date(lesson.end)
  const durMin = Math.max(0, Math.round((endD.getTime() - startD.getTime()) / 60000))
  const durText =
    durMin < 60
      ? t('durationM', { m: durMin })
      : t('durationHM', { h: Math.floor(durMin / 60), m: durMin % 60 })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {editing ? t('editTitle') : t('detailTitle')}
          </h3>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            title={t('closeHint')}
          >
            ✕
          </button>
        </div>

        {editing ? (
          <>
            <div className="space-y-2 text-xs">
              <div className="text-[11px] text-zinc-500">{sourceNote}</div>

              <label className="block">
                <span className="text-zinc-500">{t('name')}</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                  className={inputCls}
                />
              </label>

              <div className="flex gap-2">
                <label className="block w-1/2">
                  <span className="text-zinc-500">{t('code')}</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block w-1/2">
                  <span className="text-zinc-500">{t('location')}</span>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className={inputCls}
                  />
                </label>
              </div>

              <div className="flex gap-2">
                <label className="block w-2/4">
                  <span className="text-zinc-500">{t('date')}</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block w-1/4">
                  <span className="text-zinc-500">{t('start')}</span>
                  <input
                    type="time"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block w-1/4">
                  <span className="text-zinc-500">{t('end')}</span>
                  <input
                    type="time"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className={inputCls}
                  />
                </label>
              </div>

              {error && <p className="text-[11px] text-rose-400">{error}</p>}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleSave}
                className="flex-[2] rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium hover:bg-sky-500"
              >
                {t('save')}
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-zinc-600">
              {t('shortcuts')}
            </p>
          </>
        ) : (
          <>
            {/* --- Mode lihat: info lengkap, hanya-baca --- */}
            <div className="space-y-2.5 text-xs">
              <div className="text-[11px] text-zinc-500">
                {sourceNote}
                {lesson.type && TYPE_META[lesson.type] && (
                  <span className="ml-1">
                    · {TYPE_META[lesson.type].icon} {t(TYPE_META[lesson.type].key)}
                  </span>
                )}
              </div>

              <div
                className="rounded-md border border-zinc-800 bg-zinc-800/40 px-2.5 py-2 text-sm font-medium leading-snug"
                style={{ color: lesson.code ? undefined : undefined }}
              >
                {displayTitle(lesson)}
              </div>

              <dl className="space-y-1.5">
                {lesson.code && (
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-zinc-500">{t('code')}</dt>
                    <dd className="font-mono">{lesson.code}</dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-zinc-500">{t('date')}</dt>
                  <dd>{formatDay(startD, locale)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-zinc-500">{t('time')}</dt>
                  <dd>
                    {formatTime(lesson.start, locale)} –{' '}
                    {formatTime(lesson.end, locale)}
                    <span className="ml-1 text-zinc-500">({durText})</span>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-zinc-500">
                    {t('location')}
                  </dt>
                  <dd className={lesson.location ? '' : 'text-zinc-500'}>
                    {lesson.location || '—'}
                  </dd>
                </div>
                {buildingOf(lesson.location) && (
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-zinc-500">🧭</dt>
                    <dd>
                      <span className="font-medium">🏢 {buildingOf(lesson.location)}</span>
                      <span className="ml-2 text-zinc-400">
                        {t('room')}: {roomOf(lesson.location as string)}
                      </span>
                    </dd>
                  </div>
                )}
              </dl>

              {lesson.code && (
                <button
                  onClick={openSisu}
                  className="text-[11px] text-sky-400 hover:text-sky-300 hover:underline"
                >
                  {sisuState === 'loading'
                    ? t('sisuLookingUp')
                    : sisuState === 'notfound'
                      ? t('sisuNotFound')
                      : t('viewSisu')}
                </button>
              )}
              {timeEditUrl && (
                <a
                  href={timeEditUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-[11px] text-violet-400 hover:text-violet-300 hover:underline"
                >
                  {t('viewTimeEdit')}
                </a>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={startEdit}
                className="flex-[2] rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium hover:bg-sky-500"
              >
                ✏️ {t('edit')}
              </button>
              <button
                onClick={() => {
                  onHide(lesson.id)
                  onClose()
                }}
                title={t('batchHideHint')}
                className="rounded-md border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200"
              >
                🙈
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 rounded-md border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-400/90 hover:bg-rose-500/10 hover:text-rose-300"
              >
                {t('delete')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
