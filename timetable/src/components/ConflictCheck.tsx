import { useMemo, useState } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { formatTime } from '../lib/date'
import { courseColor } from '../lib/colors'
import { TYPE_META } from '../lib/lessonTypes'
import { displayTitle } from '../lib/display'
import { SOURCE_ICON } from '../lib/sources'
import {
  courseKeyOf,
  courseCodeOf,
  matchCourses,
  findCourseConflicts,
  type CourseCandidate,
} from '../lib/conflicts'

interface Props {
  lessons: Lesson[]
  /** Optional: clicking a clashing lesson jumps to it on the calendar and closes the modal */
  onOpenLesson?: (id: string) => void
  onClose: () => void
}


/**
 * Course clash checker: type a code/name, pick the course, and see every
 * slot where it overlaps ANOTHER course — which course, which time.
 * Parallel groups of the same course are not counted as clashes.
 */
export default function ConflictCheck({ lessons, onOpenLesson, onClose }: Props) {
  const { t, lang } = useI18n()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<CourseCandidate | null>(null)

  const candidates = useMemo(() => matchCourses(lessons, q), [lessons, q])

  // Changing the keyword drops the previously picked course
  const onQuery = (v: string) => {
    setQ(v)
    setSelected(null)
  }

  const report = useMemo(
    () => (selected ? findCourseConflicts(lessons, selected.key) : null),
    [lessons, selected],
  )

  const inputCls =
    'rounded-md bg-zinc-800 border border-zinc-700 px-2 py-1.5 text-xs focus:outline-none focus:border-sky-500'

  const jump = (l: Lesson) => {
    if (!onOpenLesson) return
    onOpenLesson(l.id)
    onClose()
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })

  const timeRange = (l: Lesson) => formatTime(l.start) + '–' + formatTime(l.end)

  const typeTag = (l: Lesson) =>
    l.type && TYPE_META[l.type] ? (
      <span
        className="shrink-0 rounded bg-zinc-700/60 px-1 py-px text-[10px] text-zinc-300"
        title={t(TYPE_META[l.type].key)}
      >
        {TYPE_META[l.type].icon} {TYPE_META[l.type].short}
      </span>
    ) : null

  const lessonTitle = (l: Lesson) => displayTitle(l)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">⚔ {t('conflictsTitle')}</h3>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            title={t('closeHint')}
          >
            ✕
          </button>
        </div>

        {/* Search box */}
        <div className="mb-2 flex gap-1.5">
          <input
            value={q}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
            placeholder={t('conflictsSearchPh')}
            autoFocus
            className={'flex-1 ' + inputCls}
          />
          {selected && (
            <button
              onClick={() => setSelected(null)}
              className="rounded-md bg-zinc-700 px-2.5 text-[11px] text-zinc-300 hover:bg-zinc-600"
            >
              ← {t('conflictsBack')}
            </button>
          )}
        </div>

        {!selected ? (
          /* --- Matching courses --- */
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {q.trim() === '' ? (
              <p className="py-10 text-center text-xs text-zinc-600">
                {t('conflictsSearchHint')}
              </p>
            ) : candidates.length === 0 ? (
              <p className="py-8 text-center text-xs text-zinc-600">
                {t('conflictsNoMatch')}
              </p>
            ) : (
              candidates.map((c) => {
                const sample = lessons.find((l) => courseKeyOf(l) === c.key)
                const col = sample ? courseColor(sample) : null
                return (
                  <button
                    key={c.key}
                    onClick={() => {
                      setSelected(c)
                      setQ((c.code || c.title).trim())
                    }}
                    className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs hover:border-sky-500"
                    style={
                      col
                        ? { background: col.bg, borderColor: col.border }
                        : undefined
                    }
                  >
                    <span
                      className="shrink-0 font-mono font-semibold"
                      style={col ? { color: col.text } : undefined}
                    >
                      {c.code || '—'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-zinc-300">
                      {lessonTitle({
                        id: c.key,
                        source: 'manual',
                        code: c.code,
                        title: c.title,
                        start: '',
                        end: '',
                      })}
                    </span>
                    <span className="shrink-0 text-[10px] text-zinc-500">
                      {t('lessonsN', { n: c.count })} →
                    </span>
                  </button>
                )
              })
            )}
          </div>
        ) : (
          /* --- Conflict report for the picked course --- */
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {report && (
              <>
                {/* Summary bar */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-800/40 px-3 py-2 text-xs">
                  <span className="font-mono font-semibold text-sky-300">
                    {selected.code || '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-zinc-300">
                    {lessonTitle({
                      id: selected.key,
                      source: 'manual',
                      code: selected.code,
                      title: selected.title,
                      start: '',
                      end: '',
                    })}
                  </span>
                  <span className="shrink-0 text-zinc-500">
                    {t('lessonsN', { n: report.occurrences })}
                  </span>
                  {report.slots > 0 ? (
                    <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 font-medium text-amber-300">
                      ⚠ {t('conflictsClashN', { n: report.slots })}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded bg-emerald-500/20 px-1.5 py-0.5 font-medium text-emerald-300">
                      ✓ {t('conflictsNone')}
                    </span>
                  )}
                  {report.otherCourses > 0 && (
                    <span className="shrink-0 text-[10px] text-zinc-500">
                      {t('conflictsOtherCourses', { n: report.otherCourses })}
                    </span>
                  )}
                </div>

                {report.slots === 0 ? (
                  <p className="py-8 text-center text-xs text-emerald-300/80">
                    ✓ {t('conflictsCleanAll')}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {report.details.map((d) => (
                      <div
                        key={d.mine.id}
                        className="rounded-lg border border-amber-400/50 bg-amber-400/5 px-3 py-2"
                      >
                        {/* The searched course's slot */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="font-medium text-amber-200">
                            ⚠ {fmtDate(d.mine.start)}
                          </span>
                          <span className="font-mono font-semibold text-zinc-200">
                            {courseCodeOf(d.mine) || '—'}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-zinc-300">
                            {lessonTitle(d.mine)}
                          </span>
                          <span className="shrink-0 tabular-nums text-zinc-400">
                            {timeRange(d.mine)}
                          </span>
                          {d.mine.location && (
                            <span className="shrink-0 text-[10px] text-zinc-500">
                              📍 {d.mine.location}
                            </span>
                          )}
                          {typeTag(d.mine)}
                        </div>

                        {/* Other courses clashing in this slot */}
                        <div className="mt-1.5 space-y-1 border-t border-amber-400/20 pt-1.5">
                          <div className="text-[10px] uppercase tracking-wide text-amber-200/60">
                            {t('conflictsWith')}
                          </div>
                          {d.others.map((o) => {
                            const col = courseColor(o)
                            return (
                              <button
                                key={o.id}
                                onClick={() => jump(o)}
                                disabled={!onOpenLesson}
                                className="flex w-full items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-left text-[11px] hover:border-sky-500 disabled:cursor-default"
                                title={
                                  onOpenLesson
                                    ? t('conflictsJumpHint')
                                    : undefined
                                }
                              >
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ background: col.text }}
                                />
                                <span
                                  className="shrink-0 font-mono font-semibold"
                                  style={{ color: col.text }}
                                >
                                  {courseCodeOf(o) || '—'}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-zinc-200">
                                  {lessonTitle(o)}
                                </span>
                                <span className="shrink-0 tabular-nums text-zinc-400">
                                  {timeRange(o)}
                                </span>
                                {o.location && (
                                  <span className="hidden shrink-0 text-[10px] text-zinc-500 sm:inline">
                                    📍 {o.location}
                                  </span>
                                )}
                                {typeTag(o)}
                                <span className="shrink-0 text-zinc-500">
                                  {SOURCE_ICON[o.source]}
                                </span>
                                {onOpenLesson && (
                                  <span className="shrink-0 text-zinc-600">
                                    →
                                  </span>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Legend */}
                <p className="pt-1 text-[10px] leading-relaxed text-zinc-600">
                  • {t('conflictsSameCourseHint')}
                  {onOpenLesson && (
                    <>
                      <br />• {t('conflictsJumpHint')}
                    </>
                  )}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
