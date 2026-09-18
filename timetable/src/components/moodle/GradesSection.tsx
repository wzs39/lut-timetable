import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../i18n'
import { useMoodleData } from '../../hooks/useMoodleData'
import GradeCourseCard from '../GradeCourseCard'
import Icon from '../Icon'
import {
  sortGrades,
  filterGrades,
  type GradeSort,
} from '../../lib/gradeCalc'
import { readString, writeString, KEYS } from '../../lib/storage'

const SORTS: readonly GradeSort[] = ['code', 'grade-desc', 'grade-asc', 'ungraded', 'matched']
const SORT_KEY = KEYS.gradesSort

function loadSort(): GradeSort {
  const raw = readString(SORT_KEY) as GradeSort | null
  return SORTS.includes(raw as GradeSort) ? (raw as GradeSort) : 'code'
}

export default function GradesSection({
  onJumpToCourse,
  onOpenAssignments,
}: {
  onJumpToCourse?: (code: string) => void
  onOpenAssignments: (filter: 'overdue' | 'due7' | 'later') => void
}) {
  const { t } = useI18n()
  const md = useMoodleData()
  const [sort, setSort] = useState<GradeSort>(loadSort)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'matched' | 'unmatched' | null>(null)

  useEffect(() => {
    writeString(SORT_KEY, sort)
  }, [sort])

  const shown = useMemo(
    () =>
      md.grades
        ? filterGrades(sortGrades(md.grades, sort), { q, only })
        : null,
    [md.grades, sort, q, only],
  )

  const matchedCount = md.grades?.filter((c) => c.matched).length ?? 0
  const dirty = q.trim() !== '' || only != null

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void md.refreshGrades()}
          disabled={md.busy !== 'idle' || !md.token}
          className="app-btn px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {md.busy === 'grades' ? t('gradesFetching') : t('gradesRefresh')}
        </button>
        <button
          onClick={() => void md.syncSubmissions()}
          disabled={md.busy !== 'idle' || !md.token}
          className="app-btn px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {md.busy === 'subs' ? t('subSyncing') : t('subSyncNow')}
        </button>
        <button
          onClick={() => onOpenAssignments('overdue')}
          className="app-btn-ghost ml-auto inline-flex items-center gap-1 px-2 py-1.5 text-xs"
        >
          {t('moodleTimelineLink')} <Icon name="chevron-right" size={12} />
        </button>
      </div>
      {md.message && <p className="text-[11px] text-[var(--text-2)]">{md.message}</p>}
      {md.token && md.grades && md.grades.length > 0 ? (
        <>
          {/* Urutkan + saring — state lokal segmen, sort dipersistenkan */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="app-seg flex-wrap" role="tablist">
              {SORTS.map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={sort === s}
                  onClick={() => setSort(s)}
                  className="px-2 py-1 text-[11px]"
                >
                  {t(`gradeSort_${s.replace(/-/g, '_')}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('gradeSearchPh', { n: md.grades.length })}
                className="w-full rounded-md border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1 pr-7 text-[11px] focus:border-[var(--focus-line)] focus:outline-none"
              />
              {q && (
                <button
                  onClick={() => setQ('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-3)] hover:text-[var(--text-1)]"
                  title={t('gradeReset')}
                >
                  <Icon name="close" size={11} />
                </button>
              )}
            </div>
            <div className="app-seg shrink-0" role="tablist">
              {(['matched', 'unmatched'] as const).map((m) => {
                const n = m === 'matched' ? matchedCount : (md.grades?.length ?? 0) - matchedCount
                return (
                  <button
                    key={m}
                    role="tab"
                    aria-selected={only === m}
                    onClick={() => setOnly(only === m ? null : m)}
                    className="px-2 py-1 text-[11px]"
                    title={m === 'matched' ? t('gradeMatchedTitle', { n: matchedCount }) : t('gradeUnmatchedTitle', { n })}
                  >
                    {t(m === 'matched' ? 'gradeMatched' : 'gradeUnmatched')} {n}
                  </button>
                )
              })}
            </div>
          </div>
          {shown && shown.length === 0 ? (
            <p className="py-6 text-center text-xs text-[var(--text-3)]">{t('gradeNoMatch')}</p>
          ) : (
            <ul className="space-y-2">
              {(shown ?? []).map((c) => (
                <GradeCourseCard key={c.courseId ?? c.course} c={c} onJumpToCourse={onJumpToCourse} />
              ))}
            </ul>
          )}
          {dirty && shown && shown.length > 0 && (
            <p className="text-right text-[10px] text-[var(--text-3)]">
              {t('gradeShownN', { shown: shown.length, total: md.grades.length })}
            </p>
          )}
        </>
      ) : md.token ? (
        <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('gradesEmptyHint')}</p>
      ) : (
        <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('moodleIcsOnlyHint')}</p>
      )}
    </section>
  )
}
