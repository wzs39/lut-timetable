import { useSisuStudyPlan } from '../hooks/useSisuStudyPlan'
import { localeOf, useI18n } from '../i18n'
import type { Lesson } from '../types'
import type { EnrolledCourse } from '../lib/courses'
import { HDD_COURSES, HDD_COURSE_SOURCE_URL } from '../lib/sisuCourseCatalog'
import { coursePlanIdentity, isPlannerCourseSelected } from '../lib/sisuCourseSelection'
import type { SisuPlanKind } from '../lib/sisuStudyPlan'
import ExternalLink from './ExternalLink'
import Icon from './Icon'

const KINDS: SisuPlanKind[] = ['course', 'registration', 'exam', 'milestone']

export default function SisuStudyPlan({ lessons = [], enrolled = [], onOpenSettings }: {
  lessons?: Lesson[]
  enrolled?: EnrolledCourse[]
  /** 打开设置（偏好与目标的唯一编辑入口） */
  onOpenSettings?: () => void
} = {}) {
  const { t, lang } = useI18n()
  const {
    plan, studyBlocks, studyBlockRecommendations, unscheduledStudyItems,
    generateStudyBlockRecommendations, confirmStudyBlockRecommendation,
    confirmAllStudyBlockRecommendations, skipStudyBlockRecommendation, deleteStudyBlock,
    setStudyBlockCompleted, studyLoad,
    title, setTitle, courseCode, setCourseCode, kind, setKind,
    credits, setCredits, dueAt, setDueAt, error, coursePreferences,
    plannerCourses, visibleCandidates, alreadyPlanned, selectedNotPlannedCount,
    creditEstimateText, earnedCredits, catalogViewFor, courseQuery,
    searchResult, publicSearchLoading, publicSearchError, onlySseRelevant,
    setOnlySseRelevant, plannerMessage, searchPublicCourses, changeCourseQuery,
    toggleCourseSelection, addSelectedCourses, addPlanItem,
    setPlanItemCompleted, deletePlanItem,
  } = useSisuStudyPlan(lessons, enrolled)

  return (
    <section className="space-y-3">
      <div className="app-card space-y-3 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="app-card-label inline-flex items-center gap-1.5"><Icon name="graduation" size={13} /> {t('sisuCoursePlannerTitle')}</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-3)]">{t('sisuCoursePlannerIntro')}</p>
            <p className="mt-1 text-[10px] text-[var(--text-3)]">{t('sisuCourseSources', {
              programme: HDD_COURSES.length,
              timetable: plannerCourses.filter((item) => item.sources.includes('timetable')).length,
              moodle: plannerCourses.filter((item) => item.sources.includes('moodle')).length,
              sisu: searchResult?.total ?? 0,
            })}</p>
          </div>
          <ExternalLink href={HDD_COURSE_SOURCE_URL} className="app-btn-ghost shrink-0 px-2 py-1 text-[10px]">{t('sisuCourseSource')} <Icon name="external" size={10} /></ExternalLink>
        </div>
        <p className="text-[10px] text-[var(--text-3)]">
          {t('sisuCourseFocus')}：{t(`sisuCourseFocus_${coursePreferences.focus}`)}
          {onOpenSettings && (
            <>
              {' · '}
              <button onClick={onOpenSettings} className="text-[var(--info)] hover:underline">{t('sisuPlanChangeInSettings')}</button>
            </>
          )}
        </p>
        <p className="text-[11px] font-medium text-[var(--text-2)]">{creditEstimateText}</p>
        <label className="relative block">
          <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input value={courseQuery} onChange={(event) => changeCourseQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void searchPublicCourses(event.currentTarget.value) }} placeholder={t('sisuCourseSearch')} className="app-input pl-7 pr-24 text-xs" />
          <button onClick={() => void searchPublicCourses()} disabled={publicSearchLoading || courseQuery.trim().length < 3} className="app-btn-ghost absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-[10px] disabled:opacity-50">
            {publicSearchLoading ? t('sisuPublicSearching') : t('sisuPublicSearch')}
          </button>
        </label>
        <label className="flex items-center gap-2 text-[10px] text-[var(--text-3)]">
          <input type="checkbox" checked={onlySseRelevant} onChange={(event) => setOnlySseRelevant(event.target.checked)} className="accent-sky-500" />
          {t('sisuPublicRelevantOnly')}
        </label>
        {searchResult && <p role="status" className="text-[10px] text-[var(--text-3)]">{t('sisuPublicSearchComplete', { query: searchResult.query, n: searchResult.total })}</p>}
        {publicSearchError && <p role="alert" className="text-[10px] text-[var(--danger)]">{publicSearchError}</p>}
        <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
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
                    {item.periods && <span>{t('sisuCoursePeriod', { period: item.periods })}</span>}
                    {item.sources.map((source) => <span key={source}>{t(`sisuCourseSource_${source}`)}</span>)}
                  </div>
                </div>
              </li>
            )
          })}
          {visibleCandidates.length === 0 && <li className="py-4 text-center text-[10px] text-[var(--text-3)]">{t('sisuCourseNoResults')}</li>}
        </ul>
        {plannerMessage && <p role="status" className="text-[10px] text-[var(--ok)]">{plannerMessage}</p>}
        <button onClick={addSelectedCourses} disabled={selectedNotPlannedCount === 0} className="app-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] disabled:opacity-50">
          <Icon name="plus" size={11} /> {t('sisuCourseAddSelected')}
        </button>
      </div>
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
        {/* 本周负荷：只读汇总（已确认块）。未确认建议不参与，也不写入任何日程 */}
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
      <div className="app-card p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <h3 className="app-card-label inline-flex items-center gap-1.5"><Icon name="graduation" size={13} /> {t('sisuPlanTitle')}</h3>
            <p className="mt-1 text-[10px] text-[var(--text-3)]">{t('sisuPlanLocalOnly')}</p>
          </div>
          <ExternalLink href="https://sisu.lut.fi/" className="app-btn-ghost px-2 py-1 text-[10px]" title={t('sisuOpen')}>{t('sisuOpen')} <Icon name="external" size={11} /></ExternalLink>
        </div>
        <div className="mb-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span>{t('sisuPlanCredits', { earned: earnedCredits, goal: plan.goalCredits })}</span>
            {onOpenSettings && (
              <button onClick={onOpenSettings} className="shrink-0 text-[10px] text-[var(--info)] hover:underline">{t('sisuPlanChangeInSettings')}</button>
            )}
          </div>
          <div className="sisu-progress mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--line)]"><span className="block h-full rounded-full bg-[var(--info)]" style={{ width: `${Math.min(100, earnedCredits / plan.goalCredits * 100)}%` }} /></div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
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
      </div>
      {plan.items.length === 0 ? <p className="py-4 text-center text-xs text-[var(--text-3)]">{t('sisuPlanEmpty')}</p> : (
        <ul className="space-y-1.5">
          {plan.items.map((item) => {
            const catalog = item.courseCode ? catalogViewFor(item) : null
            const match = catalog?.check.match ?? null
            return (
              <li key={item.id} className="resource-row flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2.5">
                <input type="checkbox" checked={item.completed} onChange={(event) => setPlanItemCompleted(item.id, event.target.checked)} aria-label={t('sisuPlanMarkDone', { title: item.title })} className="accent-sky-500" />
                <div className="min-w-0 flex-1">
                  <div title={item.title} className={'truncate text-xs font-medium ' + (item.completed ? 'line-through text-[var(--text-3)]' : 'text-[var(--text-1)]')}>{item.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-[var(--text-3)]">
                    <span>{t(`sisuPlanKind_${item.kind}`)}</span>
                    {item.courseCode && <span>{item.courseCode}</span>}
                    {item.credits !== undefined && <span>{t('sisuPlanCreditsShort', { n: item.credits })}</span>}
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
                            <ExternalLink href={`https://sisu.lut.fi/student/courseunit/${match.id}`} className="shrink-0 text-[var(--info)] hover:underline">{t('sisuPlanOpenInSisu')} <Icon name="external" size={10} /></ExternalLink>
                          </div>
                        )
                        : null)}
                </div>
                <button onClick={() => deletePlanItem(item.id)} className="app-btn-ghost p-1 text-[var(--text-3)]" title={t('delete')} aria-label={`${t('delete')}: ${item.title}`}><Icon name="trash" size={12} /></button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
