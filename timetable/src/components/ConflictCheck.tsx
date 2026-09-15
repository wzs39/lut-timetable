import { useMemo, useState } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import Icon from './Icon'
import { formatTime } from '../lib/date'
import type { CSSProperties } from 'react'
import { courseColor, courseStyle, courseTextStyle } from '../lib/colors'
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
  const { t, locale } = useI18n()
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
    'rounded-md bg-[var(--surface-2)] border border-[var(--line)] px-2 py-1.5 text-xs focus:outline-none focus:border-[var(--info)]'

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
        className="shrink-0 rounded bg-[var(--surface-2)] px-1 py-px text-[10px] text-[var(--text-2)]"
        title={t(TYPE_META[l.type].key)}
      >
        {<Icon name={TYPE_META[l.type].icon} size={11} />} {TYPE_META[l.type].short}
      </span>
    ) : null

  const lessonTitle = (l: Lesson) => displayTitle(l)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 shadow-2xl">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold"><Icon name="warn" size={15} /> {t('conflictsTitle')}</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-3)] hover:text-[var(--text-1)]"
            title={t('closeHint')}
          >
            <Icon name="close" size={13} />
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
              className="rounded-md bg-[var(--surface-2)] px-2.5 text-[11px] text-[var(--text-2)] hover:bg-[var(--hover-1)]"
            >
              <span className="inline-flex items-center gap-1.5"><Icon name="arrow-left" size={13} /> {t('conflictsBack')}</span>
            </button>
          )}
        </div>

        {!selected ? (
          /* --- Matching courses --- */
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {q.trim() === '' ? (
              <p className="py-10 text-center text-xs text-[var(--text-3)]">
                {t('conflictsSearchHint')}
              </p>
            ) : candidates.length === 0 ? (
              <p className="py-8 text-center text-xs text-[var(--text-3)]">
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
                    className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs hover:border-[var(--info)]"
                    style={
                      col
                        ? courseStyle(col)
                        : undefined
                    }
                  >
                    <span
                      className="shrink-0 font-mono font-semibold"
                      style={col ? courseTextStyle(col) : undefined}
                    >
                      {c.code || '—'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--text-2)]">
                      {lessonTitle({
                        id: c.key,
                        source: 'manual',
                        code: c.code,
                        title: c.title,
                        start: '',
                        end: '',
                      })}
                    </span>
                    <span className="shrink-0 text-[10px] text-[var(--text-3)]">
                      <span className="inline-flex items-center gap-1">{t('lessonsN', { n: c.count })} <Icon name="chevron-right" size={11} /></span>
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
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-xs">
                  <span className="font-mono font-semibold text-[var(--info)]">
                    {selected.code || '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--text-2)]">
                    {lessonTitle({
                      id: selected.key,
                      source: 'manual',
                      code: selected.code,
                      title: selected.title,
                      start: '',
                      end: '',
                    })}
                  </span>
                  <span className="shrink-0 text-[var(--text-3)]">
                    {t('lessonsN', { n: report.occurrences })}
                  </span>
                  {report.slots > 0 ? (
                    <span className="shrink-0 rounded bg-[var(--tint-due)] px-1.5 py-0.5 font-medium text-[var(--due)]">
                      <span className="inline-flex items-center gap-1.5"><Icon name="warn" size={13} /> {t('conflictsClashN', { n: report.slots })}</span>
                    </span>
                  ) : (
                    <span className="shrink-0 rounded bg-[var(--tint-ok)] px-1.5 py-0.5 font-medium text-[var(--ok)]">
                      <span className="inline-flex items-center gap-1.5"><Icon name="check" size={13} /> {t('conflictsNone')}</span>
                    </span>
                  )}
                  {report.otherCourses > 0 && (
                    <span className="shrink-0 text-[10px] text-[var(--text-3)]">
                      {t('conflictsOtherCourses', { n: report.otherCourses })}
                    </span>
                  )}
                </div>

                {report.slots === 0 ? (
                  <p className="py-8 text-center text-xs text-[var(--ok)]">
                    <span className="inline-flex items-center gap-1.5"><Icon name="check" size={13} /> {t('conflictsCleanAll')}</span>
                  </p>
                ) : (
                  <div className="space-y-2">
                    {report.details.map((d) => (
                      <div
                        key={d.mine.id}
                        className="rounded-lg border border-[var(--line-due)] bg-[var(--tint-due)] px-3 py-2"
                      >
                        {/* The searched course's slot */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="font-medium text-[var(--due)]">
                            <span className="inline-flex items-center gap-1.5"><Icon name="warn" size={12} /> {fmtDate(d.mine.start)}</span>
                          </span>
                          <span className="font-mono font-semibold text-[var(--text-1)]">
                            {courseCodeOf(d.mine) || '—'}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[var(--text-2)]">
                            {lessonTitle(d.mine)}
                          </span>
                          <span className="shrink-0 tabular-nums text-[var(--text-2)]">
                            {timeRange(d.mine)}
                          </span>
                          {d.mine.location && (
                            <span className="shrink-0 text-[10px] text-[var(--text-3)]">
                              <span className="inline-flex items-center gap-1"><Icon name="pin" size={11} /> {d.mine.location}</span>
                            </span>
                          )}
                          {typeTag(d.mine)}
                        </div>

                        {/* Other courses clashing in this slot */}
                        <div className="mt-1.5 space-y-1 border-t border-[var(--line-due)] pt-1.5">
                          <div className="text-[10px] uppercase tracking-wide text-[var(--due)]">
                            {t('conflictsWith')}
                          </div>
                          {d.others.map((o) => {
                            const col = courseColor(o)
                            return (
                              <button
                                key={o.id}
                                onClick={() => jump(o)}
                                disabled={!onOpenLesson}
                                className="flex w-full items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 text-left text-[11px] hover:border-[var(--info)] disabled:cursor-default"
                                title={
                                  onOpenLesson
                                    ? t('conflictsJumpHint')
                                    : undefined
                                }
                              >
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ background: col.text, '--ch': col.ch } as CSSProperties}
                                />
                                <span
                                  className="shrink-0 font-mono font-semibold"
                                  style={courseTextStyle(col)}
                                >
                                  {courseCodeOf(o) || '—'}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[var(--text-1)]">
                                  {lessonTitle(o)}
                                </span>
                                <span className="shrink-0 tabular-nums text-[var(--text-2)]">
                                  {timeRange(o)}
                                </span>
                                {o.location && (
                                  <span className="hidden shrink-0 text-[10px] text-[var(--text-3)] sm:inline">
                                    <span className="inline-flex items-center gap-1"><Icon name="pin" size={11} /> {o.location}</span>
                                  </span>
                                )}
                                {typeTag(o)}
                                <span className="shrink-0 text-[var(--text-3)]">
                                  {SOURCE_ICON[o.source]}
                                </span>
                                {onOpenLesson && (
                                  <span className="shrink-0 text-[var(--text-3)]">
                                    <span className="inline-flex text-[var(--text-3)]"><Icon name="arrow-right" size={12} /></span>
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
                <p className="pt-1 text-[10px] leading-relaxed text-[var(--text-3)]">
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
