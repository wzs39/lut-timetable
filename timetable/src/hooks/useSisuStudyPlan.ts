import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import type { Lesson } from '../types'
import type { EnrolledCourse } from '../lib/courses'
import { loadIdentityIndex } from '../lib/courseIdentity'
import { searchSisuPublicCatalog } from '../lib/sisuCourse'
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
  saveSisuStudyPlan,
  type SisuPlanItem,
  type SisuPlanKind,
} from '../lib/sisuStudyPlan'
import { refreshSisuPlanReminders } from '../lib/sisuStudyPlanReminders'

export function useSisuStudyPlan(lessons: Lesson[], enrolled: EnrolledCourse[]) {
  const { t } = useI18n()
  const [plan, setPlan] = useState(loadSisuStudyPlan)
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
  const [onlySseRelevant, setOnlySseRelevant] = useState(true)
  const searchController = useRef<AbortController | null>(null)
  const identityIndex = useMemo(() => loadIdentityIndex(), [])
  const publicCourses = useMemo(
    () => [...(searchResult?.courses ?? []), ...coursePreferences.selectedCourses],
    [searchResult?.courses, coursePreferences.selectedCourses],
  )
  const plannerCourses = useMemo(
    () => buildPlannerCourses(lessons, enrolled, publicCourses, identityIndex),
    [lessons, enrolled, publicCourses, identityIndex],
  )
  const alreadyPlanned = useMemo(() => new Set(
    plan.items.filter((item) => item.kind === 'course').map(planItemIdentity),
  ), [plan.items])
  const visibleCandidates = useMemo(() => visiblePlannerCourses({
    courses: plannerCourses,
    focus: coursePreferences.focus,
    query: courseQuery,
    currentResultQuery: searchResult?.query,
    currentResultIdentities: searchResult?.courses.map(publicPlannerCourseIdentity),
    selectedKeys: coursePreferences.selectedCourseKeys,
    plannedIdentities: alreadyPlanned,
    onlySseRelevant,
  }), [plannerCourses, coursePreferences.focus, coursePreferences.selectedCourseKeys, courseQuery, searchResult, alreadyPlanned, onlySseRelevant])
  const selectedCourses = useMemo(
    () => selectedPlannerCourses(plannerCourses, coursePreferences.selectedCourseKeys),
    [plannerCourses, coursePreferences.selectedCourseKeys],
  )
  const selectedNotPlanned = selectedCourses.filter((course) => !alreadyPlanned.has(coursePlanIdentity(course)))
  const selectedCredits = selectedPlannerCourseCredits(selectedCourses)
  const creditEstimateText = `${t('sisuCourseEstimate', { n: selectedCourses.length, credits: selectedCredits.credits })}${selectedCredits.unknown > 0 ? ` · ${t('sisuCourseUnknownCredits', { n: selectedCredits.unknown })}` : ''}`
  const earnedCredits = useMemo(() => plan.items.reduce((sum, item) => sum + (item.completed ? item.credits ?? 0 : 0), 0), [plan.items])

  useEffect(() => () => searchController.current?.abort(), [])
  useEffect(() => {
    void refreshSisuPlanReminders(plan.items, {
      title: t('sisuPlanReminderTitle'),
      body: (item, beforeHours) => t('sisuPlanReminderBody', { title: item.title, h: beforeHours }),
    }).catch(() => {})
  }, [plan.items, t])

  const updatePlanItems = (items: SisuPlanItem[]) => {
    setPlan(saveSisuStudyPlan({ ...plan, items }))
  }
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
  const changeFocus = (focus: typeof coursePreferences.focus) => {
    setCoursePreferences(saveSisuCoursePreferences({ ...coursePreferences, focus }))
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
      note: item.sources.includes('programme')
        ? 'HEBUT / HDD programme catalogue 2026–2027; verify required/equivalent status in SISU.'
        : item.sources.includes('sisu')
          ? 'Found in the public SISU catalogue; verify exact credits, study year, offering and PSP status in SISU.'
          : 'Found in locally available timetable and/or Moodle enrolments; verify credits and PSP status in SISU.',
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

  return {
    plan,
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
    courseQuery,
    searchResult,
    publicSearchLoading,
    publicSearchError,
    onlySseRelevant, setOnlySseRelevant,
    plannerMessage,
    searchPublicCourses,
    changeCourseQuery,
    changeFocus,
    toggleCourseSelection,
    addSelectedCourses,
    addPlanItem,
    setPlanItemCompleted,
    deletePlanItem,
    updateGoal,
  }
}
