import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { useMoodleData } from '../../hooks/useMoodleData'
import GradeCourseCard from '../GradeCourseCard'
import GradeSchemeReview from '../GradeSchemeReview'
import { loadGradeSchemes, parseGradeScheme, saveGradeSchemePreview } from '../../lib/gradeScheme'
import { fetchCourseContents } from '../../lib/contents'
import Icon from '../Icon'
import CollapsiblePanel from '../CollapsiblePanel'
import { DashboardHero, DashboardSplit, StatTile } from '../Dashboard'
import {
  sortGrades,
  filterGrades,
  ungradedTotal,
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
  onOpenAssignments: (filter: 'overdue' | 'due7' | 'later' | null, query?: string) => void
}) {
  const { t } = useI18n()
  const md = useMoodleData()
  const [sort, setSort] = useState<GradeSort>(loadSort)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'matched' | 'unmatched' | null>(null)
  const [, setSchemeRevision] = useState(0)
  const attemptedCourses = useRef(new Set<number>())
  const schemes = loadGradeSchemes()

  useEffect(() => {
    if (!md.token || !md.grades) return
    let active = true
    void Promise.all(md.grades.filter((course) => course.courseId != null).map(async (course) => {
      const courseId = course.courseId!
      if (loadGradeSchemes()[courseId] || attemptedCourses.current.has(courseId)) return
      attemptedCourses.current.add(courseId)
      const sections = await fetchCourseContents(md.token, courseId)
      if (!sections) return
      const texts = sections.flatMap((section) => [section.name, ...section.modules.flatMap((module) => [module.name, module.description ?? ''])])
      const parsed = parseGradeScheme(texts, course.course)
      if (parsed.weights.length > 0) saveGradeSchemePreview(courseId, course.course, parsed)
    })).then(() => { if (active) setSchemeRevision((revision) => revision + 1) })
    return () => { active = false }
  }, [md.token, md.grades])

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

  const totalCourses = md.grades?.length ?? 0
  const matchedCount = md.grades?.filter((c) => c.matched).length ?? 0
  const dirty = q.trim() !== '' || only != null

  // KPI 口径与 Moodle 页「当前均分」一致：有总分的课程等权平均；未评项含未计权重的条目。
  const gradedCourses = md.grades?.filter((c) => c.average != null) ?? []
  const average = gradedCourses.length > 0
    ? Math.round(gradedCourses.reduce((sum, c) => sum + (c.average ?? 0), 0) / gradedCourses.length)
    : null
  const ungradedItems = md.grades?.reduce((sum, c) => sum + ungradedTotal(c), 0) ?? 0

  const resetFilters = () => {
    setQ('')
    setOnly(null)
    setSort('code')
  }

  return (
    <section className="space-y-3">
      {/* 页面动作：刷新/同步留在顶部（空态文案说的「上方按钮」就是它们）。 */}
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
          <DashboardHero
            title={t('gradesKpiTitle')}
            icon="graduation"
            subtitle={t('gradesKpiHint', { n: totalCourses })}
          >
            <StatTile
              label={t('gradesKpiAverage')}
              value={average != null ? `${average}%` : '—'}
              tone="ok"
              hint={t('gradesKpiAverageHint')}
              onClick={() => setSort('grade-desc')}
              pressed={sort === 'grade-desc'}
            />
            <StatTile
              label={t('gradesKpiUngraded')}
              value={ungradedItems}
              tone={ungradedItems > 0 ? 'due' : 'ok'}
              hint={t('gradesKpiUngradedHint')}
              onClick={() => { setOnly(null); setSort('ungraded') }}
              pressed={sort === 'ungraded' && only == null}
            />
            <StatTile
              label={t('gradesKpiMatched')}
              value={`${matchedCount}/${totalCourses}`}
              tone="info"
              hint={t('gradesKpiMatchedHint')}
              onClick={() => setOnly(only === 'matched' ? null : 'matched')}
              pressed={only === 'matched'}
            />
            <StatTile
              label={t('gradesKpiCourses')}
              value={totalCourses}
              tone="info"
              hint={t('gradesKpiCoursesHint')}
              onClick={resetFilters}
              pressed={!dirty && sort === 'code'}
            />
          </DashboardHero>

          <DashboardSplit
            asideFirstOnMobile
            main={
              shown && shown.length === 0 ? (
                <p className="app-card py-8 text-center text-xs text-[var(--text-3)]">{t('gradeNoMatch')}</p>
              ) : (
                <ul className="animate-stagger space-y-2">
                  {(shown ?? []).map((c) => (
                    <GradeCourseCard
                      key={c.courseId ?? c.course}
                      c={c}
                      activityDates={md.activityDatesByCmid}
                      moduleKindByCmid={md.moduleKindByCmid}
                      onJumpToCourse={onJumpToCourse}
                      schemeReview={c.courseId != null && schemes[c.courseId] ? (
                        <GradeSchemeReview
                          key={`${c.courseId}`}
                          courseId={c.courseId}
                          courseCode={c.course}
                          weights={schemes[c.courseId].weights}
                          onConfirmed={() => {
                            setSchemeRevision((revision) => revision + 1)
                            void md.refreshGrades()
                          }}
                        />
                      ) : undefined}
                      onOpenUngradedTasks={
                        ungradedTotal(c) > 0 && c.course
                          ? () => onOpenAssignments(null, c.course)
                          : undefined
                      }
                    />
                  ))}
                </ul>
              )
            }
            aside={
              <CollapsiblePanel
                storageKey={KEYS.gradesToolsOpen}
                label={<span className="inline-flex items-center gap-1.5"><Icon name="search" size={12} /> {t('gradesToolsTitle')}</span>}
                right={dirty ? <span className="app-badge px-1.5 py-0 text-[9px] tabular-nums">{shown?.length ?? 0}</span> : undefined}
              >
                <div className="space-y-2">
                  <div className="relative min-w-0">
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder={t('gradeSearchPh', { n: totalCourses })}
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
                  <div>
                    <p className="mb-1 text-[10px] text-[var(--text-3)]">{t('gradesSortLabel')}</p>
                    <div className="app-seg flex-wrap" role="tablist" aria-label={t('gradesSortLabel')}>
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
                  <div className="app-seg flex-wrap" role="tablist" aria-label={t('gradesMatchFilter')}>
                    {(['matched', 'unmatched'] as const).map((m) => {                          const n = m === 'matched' ? matchedCount : totalCourses - matchedCount
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
                  {dirty && shown && shown.length > 0 && (
                    <p className="text-right text-[10px] text-[var(--text-3)]">
                      {t('gradeShownN', { shown: shown.length, total: totalCourses })}
                    </p>
                  )}
                </div>
              </CollapsiblePanel>
            }
          />
        </>
      ) : md.token ? (
        <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('gradesEmptyHint')}</p>
      ) : (
        <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('moodleIcsOnlyHint')}</p>
      )}
    </section>
  )
}
