import { useMemo, useState } from 'react'
import { useSisuStudyPlan } from '../hooks/useSisuStudyPlan'
import { localeOf, useI18n } from '../i18n'
import type { Lesson } from '../types'
import type { EnrolledCourse } from '../lib/courses'
import type { PlanCategory, SisuPlanKind } from '../lib/sisuStudyPlan'
import { PERSONAL_PLAN_DATE, PERSONAL_PLAN_META } from '../lib/personalStudyPlan'
import { coursePlanIdentity, isPlannerCourseSelected } from '../lib/sisuCourseSelection'
import type { OptionalRecommendation } from '../lib/optionalCourses'
import { periodWindowLabel } from '../lib/sisuRebalance'
import { DEFAULT_MAX_WEEKLY_HOURS } from '../lib/sisuWorkload'
import ExternalLink from './ExternalLink'
import Icon from './Icon'

const KINDS: SisuPlanKind[] = ['course', 'registration', 'exam', 'milestone']
const CATEGORIES: PlanCategory[] = ['general', 'language', 'intermediate', 'minor', 'elective']
type PlanFilter = 'all' | 'unfinished' | PlanCategory

/** Important warnings first; otherwise stale-offering noise hides real blockers. */
const WARNING_ORDER: Record<string, number> = {
  cancelled: 0, prerequisite: 1, delayed: 2, unscheduled: 3, overload: 4,
  'no-offering': 5, 'workload-anomaly': 6, 'stale-offering': 7, 'report-mismatch': 8,
}

function yearRange(startYear: number, index: number): string {
  return `${startYear + index}–${startYear + index + 1}`
}

function OptionalCard({ recommendation, onAdd, onSwap }: {
  recommendation: OptionalRecommendation
  onAdd: () => void
  onSwap: (ids: string[]) => void
}) {
  const { t, lang } = useI18n()
  const { course, fact } = recommendation
  const statusKey = recommendation.prereqStatus === 'ok'
    ? 'optionalPrereqOk'
    : recommendation.prereqStatus === 'likely-equivalent'
      ? 'optionalPrereqLikely'
      : 'optionalPrereqMissing'
  return (
    <article className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="font-mono text-[11px] font-semibold text-[var(--text-2)]">{course.code}</span>
        <span className="text-[11px] font-medium text-[var(--text-1)]">{fact.name ?? course.title}</span>
        <span className="text-[10px] text-[var(--text-3)]">{t('sisuPlanCreditsShort', { n: fact.credits })}</span>
        <span className="text-[10px] text-[var(--text-3)]">{t('optionalWeekly', { h: recommendation.weeklyDelta })}</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-2)]">{course.why[lang]}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
        <span className={recommendation.prereqStatus === 'ok' ? 'text-[var(--ok)]' : 'text-[var(--due)]'}>
          {t(statusKey, { codes: recommendation.missingPrerequisites.join(', ') })}
        </span>
        <span className="text-[var(--text-3)]">{t('optionalOffering', { periods: fact.offeringPattern.length > 0 ? fact.offeringPattern.map((p) => `P${p}`).join('/') : t('sisuCourseYearUnknown') })}</span>
        <span className="text-[var(--text-3)]">{t('optionalGradeScale', { scale: fact.gradeScale === 'pass-fail' ? t('optionalPassFail') : fact.gradeScale === '0-5' ? '0–5' : '—' })}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button onClick={onAdd} className="app-btn px-2 py-1 text-[10px]">{t('optionalAdd')}</button>
        {recommendation.swapOptions.slice(0, 2).map((option) => (
          <button
            key={option.ids.join('|')}
            onClick={() => onSwap(option.ids)}
            className="app-btn-ghost px-2 py-1 text-[10px]"
            title={option.codes.join(', ')}
          >
            {t('optionalSwap', { codes: option.codes.join(' + ') })}
          </button>
        ))}
      </div>
    </article>
  )
}

export default function SisuStudyPlan({ lessons = [], enrolled = [], onOpenSettings }: {
  lessons?: Lesson[]
  enrolled?: EnrolledCourse[]
  onOpenSettings?: () => void
} = {}) {
  const { t, lang } = useI18n()
  const {
    plan, scenario, rebalance, scenarioPrefs, changeScenario, scenarioComparison, feasibleYears,
    newCancelledCode, setNewCancelledCode, addCancelledCode, removeCancelledCode, restorePlan,
    startYear, graduation, categoryProgress, optionalRecommendations, addOptionalCourse, applyOptionalSwap,
    studyBlocks, studyBlockRecommendations, unscheduledStudyItems,
    generateStudyBlockRecommendations, confirmStudyBlockRecommendation,
    confirmAllStudyBlockRecommendations, skipStudyBlockRecommendation, deleteStudyBlock,
    setStudyBlockCompleted, studyLoad,
    title, setTitle, courseCode, setCourseCode, kind, setKind,
    credits, setCredits, dueAt, setDueAt, error,
    coursePreferences, visibleCandidates, alreadyPlanned, selectedNotPlannedCount,
    creditEstimateText, earnedCredits, catalogViewFor, courseQuery,
    searchResult, publicSearchLoading, publicSearchError,
    plannerMessage, searchPublicCourses, changeCourseQuery,
    toggleCourseSelection, addSelectedCourses, addPlanItem,
    setPlanItemCompleted, deletePlanItem,
  } = useSisuStudyPlan(lessons, enrolled)
  const [planFilter, setPlanFilter] = useState<PlanFilter>('unfinished')
  /**
   * 计划页的三个子页：概览（信息）/ 计划（主体清单）/ 选课与学习（工具与设置）。
   * 分离的目的很具体——原先把搜索框、复选框、情景开关和结果列表堆在同一
   * 条长滚里，用户每做一次选择都要重新找位置。子页不持久化：每次进入计划页
   * 都从概览开始。
   */
  const [tab, setTab] = useState<'overview' | 'plan' | 'tools'>('overview')
  const tabCls = (value: 'overview' | 'plan' | 'tools') =>
    value === tab ? 'animate-view-in space-y-3' : 'hidden'
  const planDate = PERSONAL_PLAN_DATE.split('-').reverse().join('.')
  const visibleWarnings = useMemo(() => [...scenario.warnings]
    .sort((a, b) => (WARNING_ORDER[a.kind] ?? 9) - (WARNING_ORDER[b.kind] ?? 9))
    .slice(0, 12), [scenario.warnings])

  const planTotal = plan.items.reduce((sum, item) => sum + (item.credits ?? 0), 0)
  const earnedPct = Math.min(100, Math.round(earnedCredits / Math.max(1, plan.goalCredits) * 100))
  const annualPeak = Math.max(1, ...scenario.annualCredits)
  // 当前年限的行一定存在：hook 把 scenarioPrefs.targetYears 也传给了 compareScenarios。
  const currentRow = scenarioComparison.find((row) => row.targetYears === scenarioPrefs.targetYears)
  const filteredItems = useMemo(() => plan.items
    .filter((item) => planFilter === 'all'
      ? true
      : planFilter === 'unfinished'
        ? !item.completed
        : item.category === planFilter)
    .sort((a, b) => (a.studyYear ?? '').localeCompare(b.studyYear ?? '') ||
      (a.periods?.[0] ?? 0) - (b.periods?.[0] ?? 0) ||
      (a.courseCode ?? a.title).localeCompare(b.courseCode ?? b.title)),
  [plan.items, planFilter])
  const groupsByYear = useMemo(() => {
    const groups = new Map<string, typeof filteredItems>()
    for (const item of filteredItems) {
      const key = item.studyYear ?? '—'
      groups.set(key, [...(groups.get(key) ?? []), item])
    }
    return [...groups.entries()]
  }, [filteredItems])
  return (
    // 容器查询而非视口断点：计划页在「已连接」下宽 896，在未连接卡片里只有 576，
    // 同一个 xl 断点会两种宽度走同一个分支（576 时两栏只剩 184px）。
    <section className="@container space-y-3">
      <div className="app-rail" role="tablist" aria-label={t('sisuPlanTitle')}>
        {([
          ['overview', 'sisuTabOverview', 'graduation'],
          ['plan', 'sisuTabPlan', 'note'],
          ['tools', 'sisuTabTools', 'book'],
        ] as const).map(([key, labelKey, icon]) => (
          <button
            key={key}
            id={`sisu-tab-${key}`}
            role="tab"
            aria-selected={tab === key}
            aria-controls={`sisu-panel-${key}`}
            onClick={() => setTab(key)}
            className="app-rail-item"
          >
            <Icon name={icon} size={13} />
            <span className="min-w-0 flex-1 truncate">{t(labelKey)}</span>
          </button>
        ))}
      </div>

      <div
        id="sisu-panel-overview"
        role="tabpanel"
        aria-labelledby="sisu-tab-overview"
        className={tabCls('overview')}
      >
      {/* 概览：学分、分类最低要求、目标年限与预计毕业 */}
      <div className="app-card space-y-3 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="app-card-label inline-flex items-center gap-1.5"><Icon name="graduation" size={13} /> {t('planOverviewTitle')}</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-3)]">{PERSONAL_PLAN_META.programme}</p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {[2, 3, 4].map((years) => (
              <button
                key={years}
                onClick={() => changeScenario({ targetYears: years })}
                aria-pressed={scenarioPrefs.targetYears === years}
                className={`app-btn px-2 py-1 text-[10px] ${scenarioPrefs.targetYears === years ? 'app-btn-primary' : ''}`}
              >
                {t('planTargetYears', { n: years })}
              </button>
            ))}
          </div>
        </div>
        {/* 仪表盘：学分为主块，毕业与负荷是内嵌小卡，分类进度缩成条带 */}
        <div className="grid gap-2 md:grid-cols-2 @2xl:grid-cols-[1.4fr_1fr_1fr]">
          <div className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5 md:col-span-2 @2xl:col-span-1">
            <div className="relative h-14 w-14 shrink-0" role="img" aria-label={t('planDashCreditsRing', { pct: earnedPct })}>
              <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--line)" strokeWidth="3.5" />
                <circle
                  cx="18" cy="18" r="15.5" fill="none" stroke="var(--info)" strokeWidth="3.5"
                  strokeLinecap="round" pathLength={100} strokeDasharray={`${earnedPct} ${100 - earnedPct}`}
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-[var(--text-1)]">{earnedPct}%</span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-[11px] text-[var(--text-1)]" title={t('sisuPlanCredits', { earned: earnedCredits, goal: plan.goalCredits })}>{t('sisuPlanCredits', { earned: earnedCredits, goal: plan.goalCredits })}</p>
              <p className="mt-1 text-[10px] text-[var(--text-3)]">{t('planOverviewPlanned', { planned: planTotal - earnedCredits, total: planTotal })}</p>
              <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-[var(--text-3)]" title={t('planOverviewSource', { date: planDate, total: planTotal, goal: plan.goalCredits })}>{t('planOverviewSource', { date: planDate, total: planTotal, goal: plan.goalCredits })}</p>
            </div>
          </div>
          <div className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5">
            <p className="text-[10px] text-[var(--text-3)]">{t('planDashGraduation')}</p>
            <p className="mt-0.5 text-lg font-semibold leading-tight text-[var(--text-1)]">{graduation ?? '—'}</p>
            <p className="mt-0.5 text-[10px] leading-snug text-[var(--text-3)]">{t('planScenarioHint', { years: scenarioPrefs.targetYears })}</p>
            <div
              className="mt-1.5 flex items-end gap-1"
              title={t('planAnnualCredits', { list: scenario.annualCredits.map((credits, index) => `${yearRange(startYear, index)}: ${credits}`).join(' · ') })}
            >
              {scenario.annualCredits.map((credits, index) => (
                <div key={index} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                  <span className="text-[9px] tabular-nums text-[var(--text-3)]">{credits}</span>
                  <div className="flex h-7 w-full items-end overflow-hidden rounded-sm bg-[var(--line)]">
                    <span className="w-full rounded-sm bg-[var(--info)]" style={{ height: `${Math.max(6, credits / annualPeak * 100)}%` }} />
                  </div>
                  <span className="text-[9px] tabular-nums text-[var(--text-3)]">{startYear + index}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2.5">
            <p className="text-[10px] text-[var(--text-3)]">{t('planDashRisk')}</p>
            <p className={`mt-0.5 text-lg font-semibold leading-tight ${currentRow?.fitsTarget ? 'text-[var(--ok)]' : 'text-[var(--due)]'}`}>
              {currentRow?.fitsTarget ? t('scenarioCompareFits') : t('planDashRiskTight')}
            </p>
            <ul className="mt-1 space-y-0.5 text-[10px]">
              <li className={currentRow?.overloadTerms ? 'text-[var(--due)]' : 'text-[var(--text-2)]'}                title={t('planOverloadCount', { n: scenario.overloadTerms, max: DEFAULT_MAX_WEEKLY_HOURS })}>
                {t('planDashOverload', { n: currentRow?.overloadTerms ?? 0, total: currentRow?.termCount ?? scenario.terms.length })}
              </li>
              <li
                className="text-[var(--text-3)]"
                title={t('workloadBasisHint', { max: DEFAULT_MAX_WEEKLY_HOURS })}
              >
                {t('planDashPeak', { h: currentRow?.peakWeeklyHours ?? 0 })}
              </li>
              {scenario.delayed.length > 0 && <li className="text-[var(--due)]">{t('planDashDelayed', { n: scenario.delayed.length })}</li>}
              {(currentRow?.missingPrerequisiteCourses ?? 0) > 0 && (
                <li className="text-[var(--due)]">{t('planDashMissingPrereq', { n: currentRow?.missingPrerequisiteCourses ?? 0 })}</li>
              )}
            </ul>
          </div>
        </div>
        <div>
          <h4 className="mb-1 text-[11px] font-semibold text-[var(--text-2)]">{t('planCategoryTitle')}</h4>
          <div className="grid gap-1.5 sm:grid-cols-2 @2xl:grid-cols-3">
            {categoryProgress.map((row) => (
              <div key={row.category} className="rounded border border-[var(--line)] px-2 py-1">
                <div className="flex items-center justify-between gap-2 text-[10px]">
                  <span className="text-[var(--text-2)]">{t(`sisuCourseCategory_${row.category}`)}</span>
                  <span className={row.total >= row.minimum ? 'text-[var(--ok)]' : 'text-[var(--due)]'}>
                    {row.minimum > 0 ? `${row.completed}/${row.minimum}` : t('planCategoryCompleted', { n: row.completed })} · {t('planCategoryPlanned', { n: row.planned })}
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--line)]">
                  <span className="block h-full rounded-full bg-[var(--ok)]" style={{ width: `${Math.min(100, row.completed / Math.max(1, row.minimum) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 主区：左侧学期时间地图，右侧情景 / 年限对比 / 情景提醒（两栏嵌套） */}
      <div className="grid gap-3 @2xl:grid-cols-3">
        <div className="min-w-0 @2xl:col-span-2">
          {/* 学期网格：每学年 P1–P4 的课程与负荷 */}
          <div className="app-card space-y-2 p-3">
            <div>
              <h3 className="app-card-label">{t('termGridTitle')}</h3>
              <p className="mt-1 text-[10px] text-[var(--text-3)]">{t('termGridHint')}</p>
            </div>
            <div className="space-y-2">
              {Array.from({ length: scenarioPrefs.targetYears }, (_, yearIndex) => (
                <div key={yearIndex}>
                  <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--text-2)]">
                    <span>{t('planYear', { year: yearRange(startYear, yearIndex) })}</span>
                    <span>{t('planYearCredits', { n: scenario.annualCredits[yearIndex] ?? 0 })}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
                    {[1, 2, 3, 4].map((period) => {
                      const term = scenario.terms.find((item) => item.yearIndex === yearIndex && item.period === period)
                      const courses = term?.courses ?? []
                      return (
                        <div key={period} className={`min-w-0 rounded border p-1.5 ${term?.overloaded ? 'border-[var(--due)]/50 bg-[var(--due)]/5' : 'border-[var(--line)] bg-[var(--surface-2)]'}`}>
                          <div className="flex items-center justify-between text-[10px] text-[var(--text-3)]">
                            <span>P{period}</span>
                            <span title={t('termCreditsHint')}>
                              {term ? t('termCellLoad', { cr: term.credits, h: term.weeklyHours }) : '—'}
                            </span>
                          </div>
                          <ul className="mt-1 space-y-0.5">
                            {courses.map((course) => (
                              <li key={`${course.itemId}:${period}`} title={`${course.code ?? ''} ${course.title}`} className="truncate text-[10px] text-[var(--text-2)]">
                                {course.code ?? course.title}
                              </li>
                            ))}
                            {courses.length === 0 && <li className="text-[10px] text-[var(--text-3)]">—</li>}
                          </ul>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            {scenario.terms.some((term) => term.overloaded) && (
              <p className="text-[10px] text-[var(--due)]">{t('termGridOverloadHint', { max: DEFAULT_MAX_WEEKLY_HOURS })}</p>
            )}
          </div>
        </div>
        <div className="min-w-0 space-y-3">
      {/* 情景：目标年限、只保留最低要求、取消课程 */}
      <div className="app-card space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="app-card-label">{t('scenarioTitle')}</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-3)]">{t('scenarioHint')}</p>
          </div>
          <button onClick={restorePlan} className="app-btn-ghost shrink-0 px-2 py-1 text-[10px]">{t('planRestore')}</button>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-[var(--text-2)]">
          <input type="checkbox" checked={scenarioPrefs.reduceToMinimum} onChange={(event) => changeScenario({ reduceToMinimum: event.target.checked })} className="accent-sky-500" />
          {t('scenarioReduce')}
        </label>
        <label className="flex items-center gap-2 text-[11px] text-[var(--text-2)]">
          <input type="checkbox" checked={scenarioPrefs.autoBalance} onChange={(event) => changeScenario({ autoBalance: event.target.checked })} className="accent-sky-500" />
          {t('scenarioBalance')}
        </label>
        {scenarioPrefs.autoBalance && (
          <div className="space-y-1.5 rounded border border-[var(--line)] bg-[var(--surface-2)] p-2">
            <label className="flex items-center gap-2 text-[10px] text-[var(--text-3)]">
              <input type="checkbox" checked={scenarioPrefs.strictOffering} onChange={(event) => changeScenario({ strictOffering: event.target.checked })} className="accent-sky-500" />
              {t('scenarioBalanceStrict')}
            </label>
            {rebalance && rebalance.moves.length > 0 ? (
              <>
                <p className="text-[10px] font-medium tabular-nums text-[var(--text-2)]">
                  {t('scenarioBalanceSummary', {
                    n: rebalance.moves.length, before: rebalance.peakBefore, after: rebalance.peakAfter,
                    overBefore: rebalance.overloadedBefore, overAfter: rebalance.overloadedAfter,
                  })}
                </p>
                <ul className="space-y-0.5 text-[10px]">
                  {rebalance.moves.map((move) => (
                    <li key={move.itemId} className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="font-mono text-[var(--text-2)]">{move.code ?? move.title}</span>
                      <span className="text-[var(--text-3)]" title={t('scenarioBalanceMoved', { code: move.code ?? move.title, from: periodWindowLabel(move.fromPeriods), to: periodWindowLabel(move.toPeriods) })}>
                        Y{move.yearIndex + 1} · {periodWindowLabel(move.fromPeriods)} → {periodWindowLabel(move.toPeriods)}
                      </span>
                      {!move.withinOffering && <span className="text-[var(--due)]">{t('scenarioBalanceVerify')}</span>}
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] leading-snug text-[var(--text-3)]">{t('scenarioBalanceHint')}</p>
              </>
            ) : (
              <p className="text-[10px] leading-snug text-[var(--text-3)]">{t('scenarioBalanceNoMoves')}</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {scenarioPrefs.cancelledCodes.map((code) => (
            <button key={code} onClick={() => removeCancelledCode(code)} title={t('scenarioRemoveCancelled')} className="app-badge inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] text-[var(--due)]">
              {code} ×
            </button>
          ))}
          <input value={newCancelledCode} onChange={(event) => setNewCancelledCode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addCancelledCode() }} placeholder={t('scenarioCancelPlaceholder')} className="app-input w-36 px-1.5 py-1 text-[10px]" />
          <button onClick={addCancelledCode} disabled={!newCancelledCode.trim()} className="app-btn-ghost px-2 py-1 text-[10px] disabled:opacity-50">{t('scenarioMarkCancelled')}</button>
        </div>
        {scenario.cancelled.length > 0 && (
          <p className="text-[10px] text-[var(--due)]">{t('scenarioCancelledList', { codes: scenario.cancelled.map((course) => course.code).join(', ') })}</p>
        )}
      </div>

      {/* 年限对比：同一份计划在 2/3/4 年下的结果并排，只读投影 */}
      <div className="app-card space-y-2 p-3">
        <div>
          <h3 className="app-card-label">{t('scenarioCompareTitle')}</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-3)]">{t('scenarioCompareHint')}</p>
        </div>
        <ul className="space-y-1">
          {scenarioComparison.map((row) => (
            <li
              key={row.targetYears}
              aria-current={row.targetYears === scenarioPrefs.targetYears ? 'true' : undefined}
              className={`min-w-0 rounded border px-2 py-1 ${row.targetYears === scenarioPrefs.targetYears ? 'border-[var(--info)]/50 bg-[var(--info)]/5' : 'border-[var(--line)] bg-[var(--surface-2)]'}`}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px]">
                <span className="w-10 shrink-0 font-semibold text-[var(--text-1)]">{t('scenarioCompareYears', { n: row.targetYears })}</span>
                <span className="text-[var(--text-2)]">{row.graduation ? t('scenarioCompareGraduation', { when: row.graduation }) : t('scenarioCompareUnfinished')}</span>
                <span className="text-[var(--text-3)]">{t('scenarioComparePerYear', { n: row.creditsPerYear })}</span>
                <span className="text-[var(--text-3)]">{t('scenarioComparePeak', { h: row.peakWeeklyHours })}</span>
                {row.delayedCount > 0 && <span className="text-[var(--due)]">{t('scenarioCompareDelayed', { n: row.delayedCount })}</span>}
                {row.overloadTerms > 0 && <span className="text-[var(--due)]">{t('scenarioCompareOverload', { n: row.overloadTerms, total: row.termCount })}</span>}
                {row.missingPrerequisiteCourses > 0 && <span className="text-[var(--due)]">{t('scenarioCompareMissingPrereq', { n: row.missingPrerequisiteCourses })}</span>}
                {row.fitsTarget && <span className="text-[var(--ok)]">{t('scenarioCompareFits')}</span>}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[10px] text-[var(--text-2)]">
          {feasibleYears ? t('scenarioCompareRecommend', { n: feasibleYears }) : t('scenarioCompareNone')}
        </p>
      </div>

      {/* 情景警告：先修、取消、延期、负荷 */}
      {scenario.warnings.length > 0 && (
        <div className="app-card space-y-1 p-3">
          <h3 className="app-card-label">{t('scenarioWarningsTitle')}</h3>
          <ul className="space-y-0.5 text-[10px]">
            {visibleWarnings.map((warning, index) => (
              <li key={`${warning.kind}:${index}`} className={`break-words ${warning.kind === 'cancelled' || warning.kind === 'prerequisite' || warning.kind === 'delayed' ? 'text-[var(--due)]' : 'text-[var(--text-3)]'}`}>
                {t(warning.messageKey, { detail: warning.detail, code: warning.courseCode ?? '' })}
              </li>
            ))}
            {scenario.warnings.length > visibleWarnings.length && (
              <li className="text-[var(--text-3)]">{t('scenarioWarningsMore', { n: scenario.warnings.length - visibleWarnings.length })}</li>
            )}
          </ul>
        </div>
      )}
        </div>
      </div>
      </div>

      <div
        id="sisu-panel-tools"
        role="tabpanel"
        aria-labelledby="sisu-tab-tools"
        className={tabCls('tools')}
      >
      {/* 可选课程：只推荐，不自动加入 */}
      <div className="app-card space-y-2 p-3">
        <div>
          <h3 className="app-card-label">{t('optionalTitle')}</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-3)]">{t('optionalHint')}</p>
        </div>
        {optionalRecommendations.length === 0
          ? <p className="py-2 text-center text-[10px] text-[var(--text-3)]">{t('optionalEmpty')}</p>
          : <div className="space-y-2">
            {optionalRecommendations.map((recommendation) => (
              <OptionalCard
                key={recommendation.course.code}
                recommendation={recommendation}
                onAdd={() => addOptionalCourse(recommendation)}
                onSwap={(ids) => applyOptionalSwap(recommendation, ids)}
              />
            ))}
          </div>}
      </div>

      {/* SISU 公开目录搜索：只补库，不冒充 PSP；默认展开、可整块收起 */}
      <details open className="app-card space-y-2 p-3">
        <summary className="cursor-pointer list-none">
          <h3 className="app-card-label inline">{t('sisuSearchTitle')}</h3>
          <span className="ml-2 text-[10px] text-[var(--text-3)]">{t('planDashToolsHint')}</span>
        </summary>
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-3)]">{t('sisuSearchHint')}</p>
        <div className="flex gap-1.5">
          <label className="relative min-w-0 flex-1">
            <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
            <input value={courseQuery} onChange={(event) => changeCourseQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchPublicCourses(event.currentTarget.value) }} placeholder={t('sisuCourseSearch')} className="app-input pl-7 pr-2 text-xs" />
          </label>
          <button onClick={() => void searchPublicCourses()} disabled={publicSearchLoading || courseQuery.trim().length < 3} className="app-btn-ghost shrink-0 px-2 py-1 text-[10px] disabled:opacity-50">
            {publicSearchLoading ? t('sisuPublicSearching') : t('sisuPublicSearch')}
          </button>
        </div>
        {searchResult && <p role="status" className="text-[10px] text-[var(--text-3)]">{t('sisuPublicSearchComplete', { query: searchResult.query, n: searchResult.total })}</p>}
        {publicSearchError && <p role="alert" className="text-[10px] text-[var(--danger)]">{publicSearchError}</p>}
        {visibleCandidates.length > 0 && (
          <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {visibleCandidates.map((item) => {
              const selected = isPlannerCourseSelected(item, coursePreferences.selectedCourseKeys)
              const inPlan = alreadyPlanned.has(coursePlanIdentity(item))
              return (
                <li key={item.key} className="flex items-start gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
                  <input type="checkbox" checked={selected} onChange={() => toggleCourseSelection(item.key)} aria-label={`${item.code ?? ''} ${item.name}`} className="mt-0.5 accent-sky-500" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px]">
                      {item.code && item.url
                        ? <ExternalLink href={item.url} className="font-mono font-semibold text-[var(--info)] hover:underline">{item.code}</ExternalLink>
                        : item.code && <span className="font-mono font-semibold text-[var(--text-2)]">{item.code}</span>}
                      <span className="font-medium text-[var(--text-1)]">{item.name}</span>
                      {inPlan && <span className="app-badge px-1 py-0 text-[9px]">{t('sisuCourseAlreadyPlanned')}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-[var(--text-3)]">
                      <span>{t(`sisuCourseCategory_${item.category}`)}</span>
                      <span>{item.credits !== undefined ? t('sisuPlanCreditsShort', { n: item.credits }) : item.creditRange ? t('sisuCourseCreditRange', item.creditRange) : t('sisuCourseCreditsUnknown')}</span>
                      {item.studyYears?.length ? <span>{item.studyYears.join(', ')}</span> : <span>{t('sisuCourseYearUnknown')}</span>}
                      {item.periods && <span>{item.periods}</span>}
                      {item.sources.map((source) => <span key={source}>{t(`sisuCourseSource_${source}`)}</span>)}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {plannerMessage && <p role="status" className="text-[10px] text-[var(--ok)]">{plannerMessage}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[10px] text-[var(--text-3)]">{creditEstimateText}</span>
          <button onClick={addSelectedCourses} disabled={selectedNotPlannedCount === 0} className="app-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] disabled:opacity-50">
            <Icon name="plus" size={11} /> {t('sisuCourseAddSelected')}
          </button>
        </div>
      </details>

      </div>

      <div
        id="sisu-panel-plan"
        role="tabpanel"
        aria-labelledby="sisu-tab-plan"
        className={tabCls('plan')}
      >
      {/* 计划本体 */}
      <div className="app-card p-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <h3 className="app-card-label inline-flex items-center gap-1.5"><Icon name="graduation" size={13} /> {t('sisuPlanTitle')}</h3>
            <p className="mt-1 text-[10px] text-[var(--text-3)]">{t('sisuPlanLocalOnly')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onOpenSettings && <button onClick={onOpenSettings} className="app-btn-ghost px-2 py-1 text-[10px]">{t('sisuPlanChangeInSettings')}</button>}
            <ExternalLink href="https://sisu.lut.fi/" className="app-btn-ghost px-2 py-1 text-[10px]" title={t('sisuOpen')}>{t('sisuOpen')} <Icon name="external" size={11} /></ExternalLink>
          </div>
        </div>
        <div className="mb-2 flex flex-wrap gap-1">
          {(['unfinished', 'all', ...CATEGORIES] as PlanFilter[]).map((filter) => (
            <button
              key={filter}
              onClick={() => setPlanFilter(filter)}
              aria-pressed={planFilter === filter}
              className={`app-btn px-1.5 py-0.5 text-[10px] ${planFilter === filter ? 'app-btn-primary' : ''}`}
            >
              {filter === 'unfinished' ? t('planFilterUnfinished') : filter === 'all' ? t('planFilterAll') : t(`sisuCourseCategory_${filter}`)}
            </button>
          ))}
        </div>
        {groupsByYear.length === 0
          ? <p className="py-4 text-center text-xs text-[var(--text-3)]">{plan.items.length === 0 ? t('sisuPlanEmpty') : t('planFilterEmpty')}</p>
          : <div className="space-y-2">
            {groupsByYear.map(([year, items]) => (
              <div key={year}>
                <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--text-2)]">
                  <span>{year === '—' ? t('sisuCourseYearUnknown') : year}</span>
                  <span>{t('planYearCredits', { n: items.reduce((sum, item) => sum + (item.credits ?? 0), 0) })}</span>
                </div>
                <ul className="animate-stagger space-y-1">
                  {items.map((item) => {
                    const catalog = item.courseCode ? catalogViewFor(item) : null
                    const match = catalog?.check.match ?? null
                    return (
                      <li key={item.id} className="resource-row flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2 py-2">
                        <input type="checkbox" checked={item.completed} onChange={(event) => setPlanItemCompleted(item.id, event.target.checked)} aria-label={t('sisuPlanMarkDone', { title: item.title })} className="accent-sky-500" />
                        <div className="min-w-0 flex-1">
                          <div title={item.title} className={'truncate text-xs font-medium ' + (item.completed ? 'line-through text-[var(--text-3)]' : 'text-[var(--text-1)]')}>
                            {item.courseCode && <span className="mr-1 font-mono text-[10px] text-[var(--text-3)]">{item.courseCode}</span>}
                            {item.title}
                          </div>
                          <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-[var(--text-3)]">
                            {item.category && <span>{t(`sisuCourseCategory_${item.category}`)}</span>}
                            {item.credits !== undefined && <span>{t('sisuPlanCreditsShort', { n: item.credits })}</span>}
                            {item.periods?.length ? <span>{item.periods.map((p) => `P${p}`).join('/')}</span> : null}
                            {item.dueAt && <span>{new Date(item.dueAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                          </div>
                          {catalog && (catalog.checking
                            ? <p className="mt-0.5 text-[10px] text-[var(--text-3)]">{t('sisuPlanChecking')}</p>
                            : catalog.check.verdict === 'not-found'
                              ? <p className="mt-0.5 text-[10px] text-[var(--due)]">{t('sisuPlanMatchMissing')}</p>
                              : match
                                ? (
                                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px]">
                                    {catalog.check.differs.length === 0
                                      ? <span className="text-[var(--ok)]">{t('sisuPlanMatchOk')}</span>
                                      : (
                                        <>
                                          {catalog.check.differs.includes('name') && <span className="min-w-0 truncate text-[var(--due)]" title={match.name}>{t('sisuPlanMatchName', { name: match.name })}</span>}
                                          {catalog.check.differs.includes('credits') && <span className="text-[var(--due)]">{t('sisuPlanMatchCredits', { n: match.credits ?? '' })}</span>}
                                        </>
                                      )}
                                    {match.id && <ExternalLink href={`https://sisu.lut.fi/student/courseunit/${match.id}`} className="shrink-0 text-[var(--info)] hover:underline">{t('sisuPlanOpenInSisu')} <Icon name="external" size={10} /></ExternalLink>}
                                  </div>
                                )
                                : null)}
                        </div>
                        <button onClick={() => deletePlanItem(item.id)} className="app-btn-ghost p-1 text-[var(--text-3)]" title={t('delete')} aria-label={`${t('delete')}: ${item.title}`}><Icon name="trash" size={12} /></button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>}
        <details className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
          <summary className="cursor-pointer text-[11px] font-medium text-[var(--text-2)]">{t('sisuPlanAddManual')}</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <select value={kind} onChange={(event) => setKind(event.target.value as SisuPlanKind)} className="app-input text-xs">
              {KINDS.map((value) => <option key={value} value={value}>{t(`sisuPlanKind_${value}`)}</option>)}
            </select>
            <input value={courseCode} onChange={(event) => setCourseCode(event.target.value)} placeholder={t('sisuPlanCourseCode')} className="app-input text-xs" />
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={t('sisuPlanItemTitle')} className="app-input text-xs sm:col-span-2" />
            <input type="number" min="0" step="0.5" value={credits} onChange={(event) => setCredits(event.target.value)} placeholder={t('sisuPlanCreditsField')} className="app-input text-xs" />
            <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} aria-label={t('sisuPlanDate')} className="app-input text-xs" />
          </div>
          {error && <p className="mt-1 text-[11px] text-[var(--danger)]">{error}</p>}
          <button onClick={addPlanItem} className="app-btn-primary mt-2 inline-flex items-center gap-1 px-3 py-1.5 text-xs"><Icon name="plus" size={12} /> {t('sisuPlanAdd')}</button>
        </details>
      </div>

      </div>

      <div className={tabCls('tools')}>
      {/* 学习时段建议（保留既有行为） */}
      <div className="app-card space-y-3 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="app-card-label">{t('studyBlockTitle')}</h3>
            <p className="mt-1 text-[10px] text-[var(--text-3)]">{t('studyBlockWindowHint')}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {studyBlockRecommendations.length > 1 && (
              <button
                onClick={confirmAllStudyBlockRecommendations}
                aria-label={`${t('studyBlockConfirmAll')}: ${studyBlockRecommendations.length}`}
                className="app-btn px-2.5 py-1.5 text-[11px]"
              >{t('studyBlockConfirmAll')}</button>
            )}
            <button onClick={generateStudyBlockRecommendations} className="app-btn-primary shrink-0 px-2.5 py-1.5 text-[11px]">{t('studyBlockGenerate')}</button>
          </div>
        </div>
        {studyBlockRecommendations.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold text-[var(--text-2)]">{t('studyBlockRecommendations')}</h4>
            {studyBlockRecommendations.map((recommendation) => (
              <article key={`${recommendation.sourceKind}:${recommendation.sourceId}`} className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
                <div title={recommendation.title} className="truncate text-xs font-medium text-[var(--text-1)]">{recommendation.title}</div>
                <div className="mt-1 flex flex-wrap gap-x-2 text-[10px] text-[var(--text-3)]">
                  <span>{t(recommendation.sourceKind === 'task' ? 'studyBlockTaskSource' : 'studyBlockPlanSource')}</span>
                  <span>{new Date(recommendation.startAt).toLocaleString(localeOf[lang], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}–{new Date(recommendation.endAt).toLocaleTimeString(localeOf[lang], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span>{t('studyBlockDeadline')}: {new Date(recommendation.dueAt).toLocaleString(localeOf[lang], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={() => confirmStudyBlockRecommendation(recommendation)} className="app-btn px-2 py-1 text-[10px]" aria-label={`${t('studyBlockConfirm')}: ${recommendation.title}`}>{t('studyBlockConfirm')}</button>
                  <button onClick={() => skipStudyBlockRecommendation(recommendation.sourceKind, recommendation.sourceId)} className="app-btn-ghost px-2 py-1 text-[10px]" aria-label={`${t('studyBlockSkip')}: ${recommendation.title}`}>{t('studyBlockSkip')}</button>
                </div>
              </article>
            ))}
          </div>
        )}
        {unscheduledStudyItems.length > 0 && (
          <div className="rounded-lg border border-[var(--due)]/30 bg-[var(--surface-2)] p-2">
            <h4 className="text-[11px] font-semibold text-[var(--due)]">{t('studyBlockUnscheduled')}</h4>
            <ul className="mt-1 space-y-1 text-[10px] text-[var(--text-2)]">
              {unscheduledStudyItems.map((item) => <li key={`${item.sourceKind}:${item.sourceId}`} title={item.title} className="min-w-0 truncate">{item.title}</li>)}
            </ul>
          </div>
        )}
        <div>
          <h4 className="mb-1 text-[11px] font-semibold text-[var(--text-2)]">{t('studyBlockConfirmed')}</h4>
          {studyBlocks.length === 0
            ? <p className="text-[10px] text-[var(--text-3)]">{t('studyBlockUnscheduledEmpty')}</p>
            : <ul className="space-y-1">
              {studyBlocks.map((block) => (
                <li key={block.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
                  <input
                    type="checkbox"
                    checked={block.completed === true}
                    onChange={(event) => setStudyBlockCompleted(block.id, event.target.checked)}
                    aria-label={t('studyBlockMarkDone', { title: block.title })}
                    className="shrink-0 accent-sky-500"
                  />
                  <div className="min-w-0 flex-1">
                    <div title={block.title} className={`truncate text-[11px] font-medium ${block.completed === true ? 'line-through text-[var(--text-3)]' : 'text-[var(--text-1)]'}`}>{block.title}</div>
                    <div className="text-[10px] text-[var(--text-3)]">{new Date(block.startAt).toLocaleString(localeOf[lang], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}–{new Date(block.endAt).toLocaleTimeString(localeOf[lang], { hour: '2-digit', minute: '2-digit' })}</div>
                  </div>
                  <button onClick={() => deleteStudyBlock(block.id)} className="app-btn-ghost shrink-0 px-2 py-1 text-[10px]" aria-label={`${t('studyBlockDelete')}: ${block.title}`}>{t('studyBlockDelete')}</button>
                </li>
              ))}
            </ul>}
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
          <h4 className="text-[11px] font-semibold text-[var(--text-2)]">{t('studyLoadTitle')}</h4>
          {studyLoad.blocks === 0
            ? <p className="mt-1 text-[10px] text-[var(--text-3)]">{t('studyLoadEmpty')}</p>
            : (
              <>
                <p className="mt-1 text-[11px] text-[var(--text-1)]">{t('studyLoadBlocks', { total: studyLoad.blocks, done: studyLoad.completedBlocks })}</p>
                <p className="text-[10px] text-[var(--text-3)]">{t('studyLoadMinutes', { minutes: studyLoad.minutes, done: studyLoad.completedMinutes })}</p>
                {studyLoad.overdueBlocks > 0 && <p className="text-[10px] text-[var(--due)]">{t('studyLoadOverdue', { n: studyLoad.overdueBlocks })}</p>}
                <div className="mt-1.5 grid grid-cols-7 gap-1">
                  {studyLoad.days.map((day) => (
                    <div
                      key={day.date}
                      className="rounded border border-[var(--line)] px-1 py-0.5 text-center"
                      title={t('studyLoadDayTitle', { day: day.date, total: day.blocks, minutes: day.minutes })}
                    >
                      <div className="text-[9px] text-[var(--text-3)]">{day.date.slice(8)}</div>
                      <div className="text-[10px] font-medium text-[var(--text-2)]">{day.minutes}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
        </div>
      </div>
      </div>
    </section>
  )
}
