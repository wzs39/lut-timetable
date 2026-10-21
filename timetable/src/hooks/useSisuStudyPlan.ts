import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import type { Lesson } from '../types'
import type { EnrolledCourse } from '../lib/courses'
import { loadIdentityIndex } from '../lib/courseIdentity'
import { lookupSisuCourseByCode, normalizeSisuCode, searchSisuPublicCatalog, type SisuCatalogMatch } from '../lib/sisuCourse'
import { checkPlanItemAgainstCatalog, planCourseCodes, type SisuPlanCatalogCheck } from '../lib/sisuPlanMatch'
import {
  buildPlannerCourses,
  loadSisuCoursePreferences,
  saveSisuCoursePreferences,
  type PublicPlannerCourse,
} from '../lib/sisuCourseCatalog'
import {
  coursePlanIdentity,
  planItemIdentity,
  publicPlannerCourseIdentity,
  selectedPlannerCourses,
  selectedPlannerCourseCredits,
  togglePlannerCourseSelection,
  visiblePlannerCourses,
} from '../lib/sisuCourseSelection'
import {
  createSisuPlanItem,
  loadSisuStudyPlan,
  restorePersonalPlan,
  saveSisuStudyPlan,
  type SisuPlanItem,
  type SisuPlanKind,
} from '../lib/sisuStudyPlan'
import { cleanPlanCode, buildScenario, compareScenarios, earliestFeasibleYears, graduationLabel, planCategoryProgress, planStartYear } from '../lib/sisuScenario'
import { compareRebalancedScenarios, rebalanceScenario } from '../lib/sisuRebalance'
import { loadScenarioPrefs, saveScenarioPrefs, type SisuScenarioPrefs } from '../lib/sisuScenarioPrefs'
import { COURSE_FACTS } from '../lib/sisuCourseFacts'
import { recommendOptionalCourses, type OptionalRecommendation } from '../lib/optionalCourses'
import { refreshSisuPlanReminders } from '../lib/sisuStudyPlanReminders'
import { loadTasks } from '../lib/tasks'
import {
  confirmStudyBlock as persistStudyBlock,
  loadStudyBlocks,
  planStudyBlocks,
  removeStudyBlock as persistStudyBlockRemoval,
  setStudyBlockCompleted as persistStudyBlockCompletion,
  type StudyBlock,
  type StudyBlockCandidate,
  type StudyBlockRecommendation,
} from '../lib/studyBlocks'
import { loadStudyBlockPrefs } from '../lib/studyBlockPrefs'
import { studyLoadSummary } from '../lib/studyLoad'
import { startOfWeek } from '../lib/date'

export function useSisuStudyPlan(lessons: Lesson[], enrolled: EnrolledCourse[]) {
  const { t, lang } = useI18n()
  const [plan, setPlan] = useState(loadSisuStudyPlan)
  const [scenarioPrefs, setScenarioPrefsState] = useState<SisuScenarioPrefs>(loadScenarioPrefs)
  const [studyBlocks, setStudyBlocks] = useState<StudyBlock[]>(loadStudyBlocks)
  const [studyBlockRecommendations, setStudyBlockRecommendations] = useState<StudyBlockRecommendation[]>([])
  const [unscheduledStudyItems, setUnscheduledStudyItems] = useState<StudyBlockCandidate[]>([])
  const [coursePreferences, setCoursePreferences] = useState(loadSisuCoursePreferences)
  const [title, setTitle] = useState('')
  const [courseCode, setCourseCode] = useState('')
  const [kind, setKind] = useState<SisuPlanKind>('course')
  const [credits, setCredits] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [error, setError] = useState('')
  const [plannerMessage, setPlannerMessage] = useState('')
  const [courseQuery, setCourseQuery] = useState('')
  const [searchResult, setSearchResult] = useState<{ query: string; total: number; courses: PublicPlannerCourse[] } | null>(null)
  const [publicSearchLoading, setPublicSearchLoading] = useState(false)
  const [publicSearchError, setPublicSearchError] = useState('')
  const [newCancelledCode, setNewCancelledCode] = useState('')
  // SISU 公开目录对账：计划项代码 → 目录记录（null = 未找到）。
  const [catalogMatches, setCatalogMatches] = useState<Record<string, SisuCatalogMatch | null>>({})
  const searchController = useRef<AbortController | null>(null)
  const resolvedCodes = useRef<Set<string>>(new Set())
  const identityIndex = useMemo(() => loadIdentityIndex(), [])
  const publicCourses = useMemo(
    () => [...(searchResult?.courses ?? []), ...coursePreferences.selectedCourses],
    [searchResult?.courses, coursePreferences.selectedCourses],
  )
  const plannerCourses = useMemo(
    () => buildPlannerCourses(lessons, enrolled, publicCourses, identityIndex, plan.items),
    [lessons, enrolled, publicCourses, identityIndex, plan.items],
  )
  const alreadyPlanned = useMemo(() => new Set(
    plan.items.filter((item) => item.kind === 'course').map(planItemIdentity),
  ), [plan.items])
  const visibleCandidates = useMemo(() => visiblePlannerCourses({
    courses: plannerCourses,
    query: courseQuery,
    currentResultQuery: searchResult?.query,
    currentResultIdentities: searchResult?.courses.map(publicPlannerCourseIdentity),
    selectedKeys: coursePreferences.selectedCourseKeys,
  }), [plannerCourses, coursePreferences.selectedCourseKeys, courseQuery, searchResult])
  const selectedCourses = useMemo(
    () => selectedPlannerCourses(plannerCourses, coursePreferences.selectedCourseKeys),
    [plannerCourses, coursePreferences.selectedCourseKeys],
  )
  const selectedNotPlanned = selectedCourses.filter((course) => !alreadyPlanned.has(coursePlanIdentity(course)))
  const selectedCredits = selectedPlannerCourseCredits(selectedCourses)
  const creditEstimateText = `${t('sisuCourseEstimate', { n: selectedCourses.length, credits: selectedCredits.credits })}${selectedCredits.unknown > 0 ? ` · ${t('sisuCourseUnknownCredits', { n: selectedCredits.unknown })}` : ''}`
  const earnedCredits = useMemo(() => plan.items.reduce((sum, item) => sum + (item.completed ? item.credits ?? 0 : 0), 0), [plan.items])
  const startYear = useMemo(() => planStartYear(plan), [plan])
  const categoryProgress = useMemo(() => planCategoryProgress(plan), [plan])

  /** Scenario is a pure projection of the stored plan; it never writes back. */
  const scenarioInput = useMemo(() => ({
    plan,
    facts: COURSE_FACTS,
    targetYears: scenarioPrefs.targetYears,
    cancelledCodes: scenarioPrefs.cancelledCodes,
    reduceToMinimum: scenarioPrefs.reduceToMinimum,
  }), [plan, scenarioPrefs.targetYears, scenarioPrefs.cancelledCodes, scenarioPrefs.reduceToMinimum])
  // 削峰同样是纯投影：只把课在同年 P1–P4 之间挪，绝不写回计划或当前编排。
  const rebalanceOptions = useMemo(
    () => ({ allowOutsideOffering: !scenarioPrefs.strictOffering }),
    [scenarioPrefs.strictOffering],
  )
  const rebalance = useMemo(
    () => (scenarioPrefs.autoBalance ? rebalanceScenario(scenarioInput, rebalanceOptions) : null),
    [scenarioInput, scenarioPrefs.autoBalance, rebalanceOptions],
  )
  const scenario = useMemo(
    () => rebalance?.scenario ?? buildScenario(scenarioInput),
    [rebalance, scenarioInput],
  )
  const graduation = graduationLabel(scenario, startYear)
  // Same plan under 2/3/4 years; purely derived, never written back.
  // 当前年限也一并投影：仪表盘的风险小卡直接读这一行，不必再算一遍警告。
  const comparisonTargets = useMemo(() => [scenarioPrefs.targetYears, 2, 3, 4], [scenarioPrefs.targetYears])
  const comparisonInput = useMemo(() => ({
    plan,
    facts: COURSE_FACTS,
    cancelledCodes: scenarioPrefs.cancelledCodes,
    reduceToMinimum: scenarioPrefs.reduceToMinimum,
  }), [plan, scenarioPrefs.cancelledCodes, scenarioPrefs.reduceToMinimum])
  const scenarioComparison = useMemo(() => (scenarioPrefs.autoBalance
    ? compareRebalancedScenarios(comparisonInput, comparisonTargets, rebalanceOptions)
    : compareScenarios(comparisonInput, comparisonTargets)),
  [comparisonInput, comparisonTargets, rebalanceOptions, scenarioPrefs.autoBalance])
  const feasibleYears = useMemo(() => earliestFeasibleYears(scenarioComparison), [scenarioComparison])
  const optionalRecommendations = useMemo(() => recommendOptionalCourses(plan, COURSE_FACTS, {
    limit: 8,
    targetYears: scenarioPrefs.targetYears,
    maxWeeklyHours: 50,
  }), [plan, scenarioPrefs.targetYears])

  useEffect(() => () => searchController.current?.abort(), [])

  // 计划项的课程代码各去 SISU 公开目录核对一次；成功/未找到都记账，不重复请求。
  const planCodes = useMemo(() => planCourseCodes(plan.items), [plan.items])
  useEffect(() => {
    const controller = new AbortController()
    // The committed facts snapshot already covers every personal-plan code; only
    // unknown/manual codes need a live catalogue lookup.
    const pending = planCodes.filter((code) => !resolvedCodes.current.has(code) && !COURSE_FACTS[code])
    if (pending.length > 0) {
      void (async () => {
        for (const code of pending) {
          try {
            const match = await lookupSisuCourseByCode(code, controller.signal)
            if (controller.signal.aborted) return
            // 成功/真·未找到才记账；网络失败不记，下一次渲染还会重试。
            resolvedCodes.current.add(code)
            setCatalogMatches((prev) => ({ ...prev, [code]: match }))
          } catch {
            if (controller.signal.aborted) return
            setCatalogMatches((prev) => (code in prev ? { ...prev, [code]: undefined } as typeof prev : prev))
          }
        }
      })()
    }
    return () => controller.abort()
  }, [planCodes])
  const translateReminder = useCallback(
    (key: string, params?: Record<string, string | number>) => t(key, params),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang],
  )
  useEffect(() => {
    void refreshSisuPlanReminders(plan.items, {
      title: translateReminder('sisuPlanReminderTitle'),
      body: (item, beforeHours) => translateReminder('sisuPlanReminderBody', { title: item.title, h: beforeHours }),
    }).catch(() => {})
  }, [plan.items, translateReminder])

  const updatePlanItems = (items: SisuPlanItem[]) => {
    setPlan(saveSisuStudyPlan({ ...plan, items }))
  }
  const changeScenario = (patch: Partial<SisuScenarioPrefs>) => {
    setScenarioPrefsState(saveScenarioPrefs(patch))
  }
  const addCancelledCode = () => {
    const code = cleanPlanCode(newCancelledCode)
    if (!code) return
    changeScenario({ cancelledCodes: [...scenarioPrefs.cancelledCodes, code] })
    setNewCancelledCode('')
  }
  const removeCancelledCode = (code: string) => {
    changeScenario({ cancelledCodes: scenarioPrefs.cancelledCodes.filter((item) => item !== code) })
  }
  const restorePlan = () => {
    setPlan(restorePersonalPlan())
    setPlannerMessage(t('sisuPlanRestored'))
  }
  const optionalPlanItem = (recommendation: OptionalRecommendation): SisuPlanItem => createSisuPlanItem({
    kind: 'course',
    title: recommendation.fact.name ?? recommendation.course.title,
    courseCode: recommendation.course.code,
    credits: recommendation.fact.credits,
    creditRange: recommendation.fact.creditRange,
    studyYear: `${startYear + scenarioPrefs.targetYears - 1}-${startYear + scenarioPrefs.targetYears}`,
    periods: recommendation.fact.offeringPattern.filter((period) => period >= 1 && period <= 4),
    category: recommendation.course.categoryImpact,
    sisuId: recommendation.fact.sisuId,
    timingSource: 'scenario',
  })
  const addOptionalCourse = (recommendation: OptionalRecommendation) => {
    if (plan.items.some((item) => item.courseCode && cleanPlanCode(item.courseCode) === recommendation.course.code)) return
    updatePlanItems([optionalPlanItem(recommendation), ...plan.items])
    setPlannerMessage(t('optionalAdded', { code: recommendation.course.code }))
  }
  const applyOptionalSwap = (recommendation: OptionalRecommendation, swapIds: readonly string[]) => {
    const removed = new Set(swapIds)
    updatePlanItems([optionalPlanItem(recommendation), ...plan.items.filter((item) => !removed.has(item.id))])
    setPlannerMessage(t('optionalSwapped', { code: recommendation.course.code, n: swapIds.length }))
  }
  const generateStudyBlockRecommendations = () => {
    const now = new Date()
    const taskItems = loadTasks().filter((item) => !item.completed && item.dueAt).map((item) => ({
      sourceKind: 'task' as const,
      sourceId: item.id,
      title: item.title,
      dueAt: item.dueAt as string,
      courseCode: item.course,
    }))
    const planItems = plan.items.filter((item) => !item.completed && item.dueAt).map((item) => ({
      sourceKind: 'sisu-plan' as const,
      sourceId: item.id,
      title: item.title,
      dueAt: item.dueAt as string,
      courseCode: item.courseCode,
    }))
    const prefs = loadStudyBlockPrefs()
    const result = planStudyBlocks({ items: [...taskItems, ...planItems], lessons, confirmed: loadStudyBlocks(), now, prefs })
    setStudyBlocks(loadStudyBlocks())
    setStudyBlockRecommendations(result.recommendations)
    setUnscheduledStudyItems(result.unscheduled)
  }
  const confirmStudyBlockRecommendation = (recommendation: StudyBlockRecommendation) => {
    const block = persistStudyBlock(recommendation)
    setStudyBlocks(loadStudyBlocks())
    setStudyBlockRecommendations((current) => current.filter((item) =>
      item.sourceKind !== recommendation.sourceKind || item.sourceId !== recommendation.sourceId,
    ))
    return block
  }
  const confirmAllStudyBlockRecommendations = () => {
    for (const recommendation of studyBlockRecommendations) persistStudyBlock(recommendation)
    setStudyBlocks(loadStudyBlocks())
    setStudyBlockRecommendations([])
  }
  const skipStudyBlockRecommendation = (sourceKind: StudyBlockRecommendation['sourceKind'], sourceId: string) => {
    setStudyBlockRecommendations((current) => current.filter((item) =>
      item.sourceKind !== sourceKind || item.sourceId !== sourceId,
    ))
    setUnscheduledStudyItems((current) => current.filter((item) =>
      item.sourceKind !== sourceKind || item.sourceId !== sourceId,
    ))
  }
  const deleteStudyBlock = (id: string) => setStudyBlocks(persistStudyBlockRemoval(id))
  const setStudyBlockCompleted = (id: string, completed: boolean) =>
    setStudyBlocks(persistStudyBlockCompletion(id, completed))
  const studyLoad = studyLoadSummary(studyBlocks, startOfWeek(new Date()), new Date())
  const setPlanItemCompleted = (itemId: string, completed: boolean) => {
    updatePlanItems(plan.items.map((item) => item.id === itemId ? { ...item, completed } : item))
  }
  const deletePlanItem = (itemId: string) => {
    updatePlanItems(plan.items.filter((item) => item.id !== itemId))
  }
  const searchPublicCourses = async (term = courseQuery) => {
    const query = term.trim()
    searchController.current?.abort()
    if (query.length < 3) {
      searchController.current = null
      setPublicSearchLoading(false)
      setPublicSearchError(t('sisuPublicSearchTooShort'))
      setSearchResult(null)
      return
    }
    const controller = new AbortController()
    searchController.current = controller
    setPublicSearchLoading(true)
    setPublicSearchError('')
    setSearchResult(null)
    try {
      const result = await searchSisuPublicCatalog(query, controller.signal)
      if (!controller.signal.aborted) setSearchResult({ query, total: result.total, courses: result.courses })
    } catch {
      if (!controller.signal.aborted) setPublicSearchError(t('sisuPublicSearchFailed'))
    } finally {
      if (searchController.current === controller) {
        searchController.current = null
        setPublicSearchLoading(false)
      }
    }
  }
  const changeCourseQuery = (value: string) => {
    setCourseQuery(value)
    searchController.current?.abort()
    searchController.current = null
    setPublicSearchLoading(false)
    setPublicSearchError('')
    setSearchResult(null)
  }
  const toggleCourseSelection = (courseKey: string) => {
    const course = plannerCourses.find((item) => item.key === courseKey)
    if (!course) return
    setCoursePreferences(saveSisuCoursePreferences(togglePlannerCourseSelection(coursePreferences, course)))
    setPlannerMessage('')
  }
  const addSelectedCourses = () => {
    if (selectedNotPlanned.length === 0) {
      setPlannerMessage(t('sisuCourseAdded', { n: 0 }))
      return
    }
    const newItems = selectedNotPlanned.map((item) => createSisuPlanItem({
      kind: 'course',
      title: item.name,
      courseCode: item.code,
      credits: item.credits,
      creditRange: item.creditRange,
      studyYear: item.studyYears?.[0],
      category: 'elective',
      sisuId: item.publicCourse?.id,
      note: 'Found in the public SISU catalogue; verify exact credits, offering and PSP status in SISU.',
      timingSource: 'scenario',
    }))
    updatePlanItems([...newItems, ...plan.items])
    setPlannerMessage(t('sisuCourseAdded', { n: newItems.length }))
  }
  const addPlanItem = () => {
    if (!title.trim()) { setError(t('sisuPlanTitleRequired')); return }
    if (dueAt && !Number.isFinite(new Date(dueAt).getTime())) { setError(t('sisuPlanInvalidDate')); return }
    const item = createSisuPlanItem({
      kind,
      title,
      courseCode,
      credits: credits ? Number(credits) : undefined,
      dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
    })
    updatePlanItems([item, ...plan.items])
    setTitle('')
    setCourseCode('')
    setCredits('')
    setDueAt('')
    setError('')
  }
  const updateGoal = (goalCredits: number) => setPlan(saveSisuStudyPlan({ ...plan, goalCredits }))
  const catalogViewFor = useCallback((item: SisuPlanItem): { checking: boolean; check: SisuPlanCatalogCheck } => {
    const code = item.courseCode ? normalizeSisuCode(item.courseCode) : ''
    if (!code) return { checking: false, check: checkPlanItemAgainstCatalog(item, null) }
    const fact = COURSE_FACTS[code]
    if (fact) {
      // Courses outside the public catalogue must not pretend to be verified.
      if (!fact.sisuId) return { checking: false, check: checkPlanItemAgainstCatalog(item, null) }
      // SISU snapshot = the runtime source of truth; no per-course request.
      return {
        checking: false,
        check: checkPlanItemAgainstCatalog(item, {
          id: fact.sisuId,
          code,
          name: fact.name ?? item.title,
          credits: fact.credits,
          creditRange: fact.creditRange,
        }),
      }
    }
    const resolved = code in catalogMatches
    return {
      checking: !resolved,
      check: checkPlanItemAgainstCatalog(item, resolved ? catalogMatches[code] ?? null : null),
    }
  }, [catalogMatches])

  return {
    plan,
    scenario,
    rebalance,
    scenarioPrefs,
    changeScenario,
    scenarioComparison,
    feasibleYears,
    newCancelledCode,
    setNewCancelledCode,
    addCancelledCode,
    removeCancelledCode,
    restorePlan,
    startYear,
    graduation,
    categoryProgress,
    optionalRecommendations,
    addOptionalCourse,
    applyOptionalSwap,
    studyBlocks,
    studyBlockRecommendations,
    unscheduledStudyItems,
    generateStudyBlockRecommendations,
    confirmStudyBlockRecommendation,
    confirmAllStudyBlockRecommendations,
    skipStudyBlockRecommendation,
    deleteStudyBlock,
    setStudyBlockCompleted,
    studyLoad,
    title, setTitle,
    courseCode, setCourseCode,
    kind, setKind,
    credits, setCredits,
    dueAt, setDueAt,
    error,
    coursePreferences,
    plannerCourses,
    visibleCandidates,
    alreadyPlanned,
    selectedNotPlannedCount: selectedNotPlanned.length,
    creditEstimateText,
    earnedCredits,
    catalogMatches,
    catalogViewFor,
    courseQuery,
    searchResult,
    publicSearchLoading,
    publicSearchError,
    plannerMessage,
    searchPublicCourses,
    changeCourseQuery,
    toggleCourseSelection,
    addSelectedCourses,
    addPlanItem,
    setPlanItemCompleted,
    deletePlanItem,
    updateGoal,
  }
}
