import { useEffect, useMemo, useState } from 'react'
import { useExitAnimation } from '../lib/useExitAnimation'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import Icon from './Icon'
import { resolveSisuCourseUrl } from '../lib/sisuCourse'
import { loadIdentityIndex } from '../lib/courseIdentity'
import { TYPE_META } from '../lib/lessonTypes'
import { displayTitle, buildingOf, roomOf } from '../lib/display'
import { formatDay, formatTime } from '../lib/date'
import { normalizeCourseCode } from '../lib/ics'
import { scopeText } from '../lib/notes'
import { isOverdue, pendingTasks, type Task } from '../lib/tasks'
import { openExternal } from '../lib/openExternal'
import ExternalLink from './ExternalLink'

interface Props {
  lesson: Lesson
  onSave: (id: string, patch: Partial<Lesson>) => void
  onDelete: (id: string) => void
  /** URL halaman TimeEdit sumber lesson ini (bila ada) */
  timeEditUrl?: string
  /** Sembunyikan tanpa menghapus (tanpa tombstone) */
  onHide: (id: string) => void
  onClose: () => void
  /** Catatan kursus (berlaku untuk semua pelajaran dengan kode+jenis yang sama) */
  note?: string
  onSaveNote?: (text: string) => void
  onRemoveNote?: () => void
  /** Semua tugas/assignment — untuk menampilkan yang terkait kode kursus ini */
  assignments?: Task[]
  /** Buka panel Tugas (from lesson detail) */
  onOpenAssignments?: () => void
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
  note,
  onSaveNote,
  onRemoveNote,
  assignments,
  onOpenAssignments,
}: Props) {
  const { t, locale } = useI18n()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(lesson.title)
  const [code, setCode] = useState(lesson.code || '')
  const [location, setLocation] = useState(lesson.location || '')
  const [date, setDate] = useState(lesson.start.slice(0, 10))
  const [start, setStart] = useState(toTimeInput(lesson.start))
  const [end, setEnd] = useState(toTimeInput(lesson.end))
  const [error, setError] = useState<string | null>(null)
  const [sisuState, setSisuState] = useState<'idle' | 'loading' | 'notfound'>('idle')
  const [noteEdit, setNoteEdit] = useState(false)
  const [noteText, setNoteText] = useState('')

  // Tabel identitas: kode jadwal → courseid Moodle (tulis saat enrol sync).
  // Ada barisnya → tautan langsung ke halaman kursus, tanpa pencarian SISU.
  const moodleCourseId = useMemo(
    () => (lesson.code ? loadIdentityIndex().idForCode(lesson.code) : null),
    [lesson.code],
  )

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
    setNoteEdit(false)
    setNoteText(note || '')
  }, [lesson, note])

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
    requestClose()
  }

  const handleDelete = () => {
    if (confirm(t('deleteConfirm', { t: lesson.title }))) {
      onDelete(lesson.id)
      requestClose()
    }
  }

  const openSisu = async () => {
    if (!lesson.code) return
    setSisuState('loading')
    try {
      const url = await resolveSisuCourseUrl(lesson.code)
      openExternal(url)
      setSisuState('idle')
    } catch {
      setSisuState('notfound')
    }
  }

  // Semua jalur tutup (✕ / ESC / klik luar) lewat satu frame keluar.
  const [closing, requestClose] = useExitAnimation(onClose)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (editing) setEditing(false)
      else requestClose()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && editing) handleSave()
  }

  const inputCls =
    'mt-0.5 app-input'

  const startD = new Date(lesson.start)
  const endD = new Date(lesson.end)
  const durMin = Math.max(0, Math.round((endD.getTime() - startD.getTime()) / 60000))
  const durText =
    durMin < 60
      ? t('durationM', { m: durMin })
      : t('durationHM', { h: Math.floor(durMin / 60), m: durMin % 60 })

  // Ruang lingkup catatan: kode kursus (ternormalisasi) + jenis sesi
  const noteScope = scopeText(
    lesson.code ? normalizeCourseCode(lesson.code) : displayTitle(lesson),
    lesson.type && TYPE_META[lesson.type]
      ? t(TYPE_META[lesson.type].key)
      : t('noteScopeAny'),
  )

  return (
    <div
      className={
        (closing ? 'animate-fade-out ' : 'animate-fade-in ') +
        'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4'
      }
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div
        className={
          (closing ? 'animate-exit-down ' : 'animate-modal-in ') +
          'w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 shadow-2xl'
        }
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {editing ? t('editTitle') : t('detailTitle')}
          </h3>
          <button
            onClick={requestClose}
            className="text-[var(--text-3)] hover:text-[var(--text-1)]"
            title={t('closeHint')}
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        {editing ? (
          <>
            <div className="space-y-2 text-xs">
              <div className="text-[11px] text-[var(--text-3)]">{sourceNote}</div>

              <label className="block">
                <span className="text-[var(--text-3)]">{t('name')}</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                  className={inputCls}
                />
              </label>

              <div className="flex gap-2">
                <label className="block w-1/2">
                  <span className="text-[var(--text-3)]">{t('code')}</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block w-1/2">
                  <span className="text-[var(--text-3)]">{t('location')}</span>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className={inputCls}
                  />
                </label>
              </div>

              <div className="flex gap-2">
                <label className="block w-2/4">
                  <span className="text-[var(--text-3)]">{t('date')}</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block w-1/4">
                  <span className="text-[var(--text-3)]">{t('start')}</span>
                  <input
                    type="time"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block w-1/4">
                  <span className="text-[var(--text-3)]">{t('end')}</span>
                  <input
                    type="time"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className={inputCls}
                  />
                </label>
              </div>

              {error && <p className="text-[11px] text-[var(--danger)]">{error}</p>}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--hover-1)]"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleSave}
                className="app-fill-info flex-[2] rounded-md px-3 py-1.5 text-xs"
              >
                {t('save')}
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-[var(--text-3)]">
              {t('shortcuts')}
            </p>
          </>
        ) : (
          <>
            {/* --- Mode lihat: info lengkap, hanya-baca --- */}
            <div className="space-y-2.5 text-xs">
              <div className="text-[11px] text-[var(--text-3)]">
                {sourceNote}
                {lesson.type && TYPE_META[lesson.type] && (
                  <span className="ml-1">
                    · {<Icon name={TYPE_META[lesson.type].icon} size={11} />} {t(TYPE_META[lesson.type].key)}
                  </span>
                )}
              </div>

              <div
                className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2 text-sm font-medium leading-snug"
                style={{ color: lesson.code ? undefined : undefined }}
              >
                {displayTitle(lesson)}
              </div>

              <dl className="space-y-1.5">
                {lesson.code && (
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-[var(--text-3)]">{t('code')}</dt>
                    <dd className="font-mono">{lesson.code}</dd>
                  </div>
                )}
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-[var(--text-3)]">{t('date')}</dt>
                  <dd>{formatDay(startD, locale)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-[var(--text-3)]">{t('time')}</dt>
                  <dd>
                    {formatTime(lesson.start, locale)} –{' '}
                    {formatTime(lesson.end, locale)}
                    <span className="ml-1 text-[var(--text-3)]">({durText})</span>
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0 text-[var(--text-3)]">
                    {t('location')}
                  </dt>
                  <dd className={lesson.location ? '' : 'text-[var(--text-3)]'}>
                    {lesson.location || '—'}
                  </dd>
                </div>
                {buildingOf(lesson.location) && (
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-[var(--text-3)] inline-flex"><Icon name="compass" size={12} className="mt-0.5" /></dt>
                    <dd>
                      <span className="font-medium inline-flex items-center gap-1"><Icon name="building" size={12} /> {buildingOf(lesson.location)}</span>
                      <span className="ml-2 text-[var(--text-2)]">
                        {t('room')}: {roomOf(lesson.location as string)}
                      </span>
                    </dd>
                  </div>
                )}
              </dl>

              {moodleCourseId && (
                <ExternalLink
                  href={`https://moodle.lut.fi/course/view.php?id=${moodleCourseId}`}
                  className="block text-[11px] text-[var(--info)] hover:text-[var(--info)] hover:underline"
                >
                  {t('viewMoodleCourse')}
                </ExternalLink>
              )}
              {lesson.code && (
                <button
                  onClick={openSisu}
                  className="text-[11px] text-[var(--info)] hover:text-[var(--info)] hover:underline"
                >
                  {sisuState === 'loading'
                    ? t('sisuLookingUp')
                    : sisuState === 'notfound'
                      ? t('sisuNotFound')
                      : t('viewSisu')}
                </button>
              )}
              {timeEditUrl && (
                <ExternalLink
                  href={timeEditUrl}
                  className="block text-[11px] text-[var(--violet)] hover:text-[var(--violet)] hover:underline"
                >
                  {t('viewTimeEdit')}
                </ExternalLink>
              )}

              {/* Tugas/assignment milik kode kursus ini */}
              {assignments && onOpenAssignments && (() => {
                const code = lesson.code ? normalizeCourseCode(lesson.code) : null
                const related = code
                  ? pendingTasks(assignments).filter(
                      (task) =>
                        task.course &&
                        (task.course.toUpperCase().includes(code) ||
                          normalizeCourseCode(task.course) === code),
                    )
                  : []
                return (
                  <button
                    onClick={onOpenAssignments}
                    className="block w-full rounded-md border border-[var(--line-ok)] bg-[var(--tint-ok)] px-2.5 py-2 text-left hover:bg-[var(--tint-ok)]"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ok)]">
                      <span className="inline-flex items-center gap-1.5"><Icon name="graduation" size={12} /> {related.length > 0
                        ? t('lessonAssignments', { n: related.length })
                        : t('lessonAssignmentsEmpty')}</span>
                    </div>
                    {related.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {related.slice(0, 3).map((task) => (
                          <li key={task.id} className="truncate text-[11px] text-[var(--ok)]">
                            · {task.title}
                            {isOverdue(task) && <span className="ml-1 text-[var(--danger)]">· {t('taskOverdue')}</span>}
                          </li>
                        ))}
                        {related.length > 3 && (
                          <li className="text-[10px] text-[var(--ok)]">…</li>
                        )}
                      </ul>
                    )}
                  </button>
                )
              })()}

              {/* Catatan kursus: berlaku untuk semua pelajaran dengan kode+jenis sama */}
              {onSaveNote && (
                <div className="rounded-md border border-[var(--line-due)] bg-[var(--tint-due)] px-2.5 py-2">
                  {noteEdit ? (
                    <>
                      <div className="text-[10px] font-medium text-[var(--due)]">
                        <span className="inline-flex items-center gap-1.5"><Icon name="note" size={12} /> {t('noteTitle')} · {noteScope}</span>
                      </div>
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder={t('notePlaceholder')}
                        rows={2}
                        autoFocus
                        className="mt-1 w-full resize-none app-input"
                      />
                      <div className="mt-1.5 flex gap-2">
                        <button
                          onClick={() => setNoteEdit(false)}
                          className="flex-1 rounded-md bg-[var(--surface-2)] px-2 py-1 text-[11px] font-medium hover:bg-[var(--hover-1)]"
                        >
                          {t('cancel')}
                        </button>
                        <button
                          onClick={() => {
                            onSaveNote(noteText)
                            setNoteEdit(false)
                          }}
                          className="app-fill-due flex-[2] rounded-md px-2 py-1 text-[11px]"
                        >
                          {t('noteSave')}
                        </button>
                      </div>
                    </>
                  ) : note ? (
                    <>
                      <div className="text-[10px] font-medium text-[var(--due)]">
                        <span className="inline-flex items-center gap-1.5"><Icon name="note" size={12} /> {t('noteTitle')} · {noteScope}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-[var(--due)]">
                        {note}
                      </p>
                      <div className="mt-1.5 flex gap-2">
                        <button
                          onClick={() => {
                            setNoteText(note)
                            setNoteEdit(true)
                          }}
                          className="rounded bg-[var(--tint-due)] px-2 py-0.5 text-[10px] text-[var(--due)] hover:bg-[var(--tint-due)]"
                        >
                          {t('noteEdit')}
                        </button>
                        <button
                          onClick={onRemoveNote}
                          className="rounded bg-[var(--surface-2)] px-2 py-0.5 text-[10px] text-[var(--text-2)] hover:bg-[var(--hover-1)]"
                        >
                          {t('noteRemove')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-[10px] text-[var(--due)]">
                        {t('noteApplies', { scope: noteScope })}
                      </div>
                      <button
                        onClick={() => setNoteEdit(true)}
                        className="mt-1 rounded bg-[var(--tint-due)] px-2 py-1 text-[11px] font-medium text-[var(--due)] hover:bg-[var(--tint-due)]"
                      >
                        {t('noteAdd')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={startEdit}
                className="app-fill-info flex-[2] rounded-md px-3 py-1.5 text-xs"
              >
                <span className="inline-flex items-center gap-1.5"><Icon name="pencil" size={12} /> {t('edit')}</span>
              </button>
              <button
                onClick={() => {
                  onHide(lesson.id)
                  requestClose()
                }}
                title={t('batchHideHint')}
                className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
              >
                <Icon name="eye-off" size={13} />
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 rounded-md border border-[var(--danger)] px-3 py-1.5 text-xs font-medium text-[var(--danger)] hover:bg-[var(--tint-danger)] hover:text-[var(--danger)]"
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
