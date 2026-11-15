import type { Lesson } from '../types'
import { CourseIdentityIndex, loadIdentities, type CourseIdentity } from './courseIdentity'
import { extractCourseCode, extractCourseTitle, type EnrolledCourse } from './courses'
import { displayTitle } from './display'
import type { CourseGrades } from './grades'
import { normalizeCourseCode } from './ics'
import { moodleCourseUrl } from './moodleUrl'
import {
  getSisuCourseFact,
  loadLiveSisuFacts,
  normalizeSisuFact,
  numberToTeachingPeriod,
  sisuCourseUrl,
  type SisuCourseFact,
  type TeachingPeriod,
} from './sisuCourse'
import type { SisuPlanItem } from './sisuStudyPlan'
import { KEYS, readJson } from './storage'
import {
  loadStudyBlocks,
  setStudyBlockCompleted,
  type StudyBlock,
} from './studyBlocks'
import { saveTasks, sortTasks, updateTask, type Task } from './tasks'

export type DiscrepancyKind =
  | 'moodle-only' // Enrolled in Moodle, 0 timetable lessons
  | 'timetable-only' // In timetable lessons, not linked to Moodle course
  | 'missing-sisu-facts' // Course code not found in static or live SISU catalog
  | 'plan-status-mismatch' // Graded/active in Moodle/Timetable, but 'planned'/incomplete in SISU Study Plan
  | 'weights-missing' // Moodle grades present without configured item weights

export interface CourseDiscrepancy {
  kind: DiscrepancyKind
  courseKey: string
  code: string
  messageKey: string
  meta?: Record<string, string | number>
}

export interface UnifiedCourseNode {
  /** Canonical key: normalized course code (e.g. "CT60A2411") or "moodle:<id>" */
  key: string
  /** Normalized LUT course code if known, else "" */
  code: string
  /** Best display title (Moodle fullname / SISU EN name / Lesson title) */
  title: string
  nameFi?: string
  /** Sources that contribute to this course entity */
  sources: Array<'timeedit' | 'sisu' | 'moodle' | 'manual'>
  /** Moodle linkage */
  moodleCourseId?: number
  moodleUrl?: string
  enrolled?: EnrolledCourse
  grades?: CourseGrades
  /** SISU linkage */
  sisuFact?: SisuCourseFact
  sisuId?: string
  sisuBrochureUrl?: string
  planItem?: SisuPlanItem
  credits?: number
  periods: TeachingPeriod[]
  totalStudyHours?: number
  /** Timetable linkage */
  lessons: Lesson[]
  teachers: string[]
  locations: string[]
  nextLesson?: Lesson
  /** Tasks & StudyBlocks linkage */
  tasks: Task[]
  pendingTaskCount: number
  studyBlocks: StudyBlock[]
  /** Detected cross-source discrepancies */
  discrepancies: CourseDiscrepancy[]
}

export interface CourseGraph {
  nodes: UnifiedCourseNode[]
  byKey: Map<string, UnifiedCourseNode>
  byMoodleId: Map<number, UnifiedCourseNode>
  discrepancies: CourseDiscrepancy[]
  missingSisuFactCodes: string[]
}

export interface BuildCourseGraphInput {
  lessons: Lesson[]
  enrolled?: EnrolledCourse[]
  identities?: CourseIdentity[]
  grades?: CourseGrades[]
  planItems?: SisuPlanItem[]
  tasks?: Task[]
  studyBlocks?: StudyBlock[]
  liveSisuFacts?: Record<string, SisuCourseFact>
  sisuIds?: Record<string, string>
  now?: Date
}

function addSource(
  list: Array<'timeedit' | 'sisu' | 'moodle' | 'manual'>,
  src: 'timeedit' | 'sisu' | 'moodle' | 'manual',
): void {
  if (!list.includes(src)) list.push(src)
}

function sisuNameEn(fact?: SisuCourseFact): string | undefined {
  if (!fact?.name) return undefined
  if (typeof fact.name === 'string') return fact.name.trim() || undefined
  return fact.name.en?.trim() || fact.name.fi?.trim() || undefined
}

function sisuNameFi(fact?: SisuCourseFact): string | undefined {
  if (fact?.nameFi) return fact.nameFi.trim() || undefined
  if (fact?.name && typeof fact.name === 'object' && fact.name.fi) {
    return fact.name.fi.trim() || undefined
  }
  return undefined
}

function looksLikeCourseCode(value: string | undefined): boolean {
  if (!value) return false
  const clean = value.trim()
  return /^[A-Z]{1,4}\d{1,3}[A-Z]{0,3}\d{0,4}(?:-\d{4})?$/i.test(clean)
}

export function buildCourseGraph(input: BuildCourseGraphInput): CourseGraph {
  const lessons = input.lessons ?? []
  const enrolled = input.enrolled ?? []
  const identities = input.identities ?? loadIdentities()
  const grades = input.grades ?? []
  const planItems = input.planItems ?? []
  const tasks = input.tasks ?? []
  const studyBlocks = input.studyBlocks ?? []
  const liveFacts = input.liveSisuFacts ?? loadLiveSisuFacts()
  const sisuIds = input.sisuIds ?? readJson<Record<string, string>>(KEYS.sisuCourseIds, {})
  const now = input.now ?? new Date()
  const nowMs = now.getTime()

  // Combine persisted identities with enrolled courses so code<->courseid lookups work even without saved identities
  const mergedIdentities: CourseIdentity[] = [...identities]
  const seenIdentityIds = new Set(identities.map((i) => i.courseid))
  for (const e of enrolled) {
    if (seenIdentityIds.has(e.courseid)) continue
    mergedIdentities.push({
      courseid: e.courseid,
      code: extractCourseCode(e.shortname) ?? extractCourseCode(e.fullname) ?? null,
      shortname: e.shortname,
      fullname: e.fullname,
    })
    seenIdentityIds.add(e.courseid)
  }
  const identityIndex = new CourseIdentityIndex(mergedIdentities)

  const byKey = new Map<string, UnifiedCourseNode>()
  const byMoodleId = new Map<number, UnifiedCourseNode>()

  const getOrCreateNode = (key: string, code: string, initialTitle = ''): UnifiedCourseNode => {
    const existing = byKey.get(key)
    if (existing) {
      if (!existing.code && code) existing.code = code
      if (!existing.title && initialTitle) existing.title = initialTitle
      return existing
    }
    const created: UnifiedCourseNode = {
      key,
      code,
      title: initialTitle || code || key,
      sources: [],
      periods: [],
      lessons: [],
      teachers: [],
      locations: [],
      tasks: [],
      pendingTaskCount: 0,
      studyBlocks: [],
      discrepancies: [],
    }
    byKey.set(key, created)
    return created
  }

  // 1. Enrolled Moodle courses
  for (const e of enrolled) {
    const rawCode =
      identityIndex.codeFor(e.courseid) ??
      extractCourseCode(e.shortname) ??
      extractCourseCode(e.fullname) ??
      ''
    const code = rawCode ? normalizeCourseCode(rawCode) : ''
    const key = code || `moodle:${e.courseid}`
    const title = extractCourseTitle(e.fullname) ?? (e.fullname || e.shortname)
    const node = getOrCreateNode(key, code, title)
    addSource(node.sources, 'moodle')
    node.moodleCourseId = e.courseid
    node.moodleUrl = moodleCourseUrl(e.courseid) ?? undefined
    node.enrolled = e
    if (title && (node.title === node.code || node.title === node.key)) {
      node.title = title
    }
    byMoodleId.set(e.courseid, node)
  }

  // 2. Course Identities (in case enrolled wasn't passed directly)
  for (const idRow of mergedIdentities) {
    if (byMoodleId.has(idRow.courseid)) continue
    const rawCode = idRow.code ?? extractCourseCode(idRow.shortname) ?? extractCourseCode(idRow.fullname) ?? ''
    const code = rawCode ? normalizeCourseCode(rawCode) : ''
    const key = code || `moodle:${idRow.courseid}`
    const title = extractCourseTitle(idRow.fullname) ?? (idRow.fullname || idRow.shortname)
    const node = getOrCreateNode(key, code, title)
    addSource(node.sources, 'moodle')
    node.moodleCourseId = idRow.courseid
    node.moodleUrl = moodleCourseUrl(idRow.courseid) ?? undefined
    byMoodleId.set(idRow.courseid, node)
  }

  // 3. Moodle Grades
  for (const g of grades) {
    let node: UnifiedCourseNode | undefined =
      g.courseId != null ? byMoodleId.get(g.courseId) : undefined
    if (!node) {
      const rawCode =
        (g.courseId != null ? identityIndex.codeFor(g.courseId) : null) ??
        extractCourseCode(g.course) ??
        (looksLikeCourseCode(g.course) ? g.course : '')
      const code = rawCode ? normalizeCourseCode(rawCode) : ''
      const key = code || (g.courseId != null ? `moodle:${g.courseId}` : `title:${g.course.trim().toLowerCase()}`)
      node = getOrCreateNode(key, code, g.courseTitle || g.course)
    }
    addSource(node.sources, 'moodle')
    node.grades = g
    if (g.courseId != null && node.moodleCourseId == null) {
      node.moodleCourseId = g.courseId
      node.moodleUrl = moodleCourseUrl(g.courseId) ?? undefined
      byMoodleId.set(g.courseId, node)
    }
    if (g.courseTitle && (node.title === node.code || node.title === node.key)) {
      node.title = g.courseTitle
    }
  }

  // 4. Timetable Lessons (TimeEdit / SISU / Manual)
  for (const lesson of lessons) {
    const rawCode = lesson.code?.trim() || extractCourseCode(lesson.title) || ''
    const code = rawCode ? normalizeCourseCode(rawCode) : ''
    const cleanedTitle = displayTitle(lesson)
    const key = code || `title:${cleanedTitle.toLowerCase()}`
    const node = getOrCreateNode(key, code, cleanedTitle)
    addSource(node.sources, lesson.source)
    for (const merged of lesson.mergedSources ?? []) {
      addSource(node.sources, merged)
    }
    node.lessons.push(lesson)
    if (lesson.location?.trim() && !node.locations.includes(lesson.location.trim())) {
      node.locations.push(lesson.location.trim())
    }
    const maybeTeacher = (lesson as { teacher?: string }).teacher?.trim()
    if (maybeTeacher && !node.teachers.includes(maybeTeacher)) {
      node.teachers.push(maybeTeacher)
    }
    if (cleanedTitle && (node.title === node.code || node.title === node.key)) {
      node.title = cleanedTitle
    }
  }

  // 5. SISU Study Plan Items
  for (const item of planItems) {
    const rawCode = item.courseCode?.trim() || extractCourseCode(item.title) || ''
    const code = rawCode ? normalizeCourseCode(rawCode) : ''
    if (!code && item.kind !== 'course') continue
    const key = code || `plan:${item.id}`
    const node = getOrCreateNode(key, code, item.title)
    addSource(node.sources, 'sisu')
    node.planItem = item
    if (item.title && (node.title === node.code || node.title === node.key)) {
      node.title = item.title
    }
  }

  // 6. Tasks linkage
  for (const task of tasks) {
    const taskCourseId = (task as { courseId?: number }).courseId
    let node: UnifiedCourseNode | undefined =
      taskCourseId != null ? byMoodleId.get(taskCourseId) : undefined
    if (!node && task.course) {
      const rawCode = extractCourseCode(task.course) ?? (looksLikeCourseCode(task.course) ? task.course : '')
      const normCode = rawCode ? normalizeCourseCode(rawCode) : ''
      if (normCode && byKey.has(normCode)) {
        node = byKey.get(normCode)
      } else {
        const lowerCourse = task.course.trim().toLowerCase()
        node = [...byKey.values()].find(
          (n) =>
            n.code.toLowerCase() === lowerCourse ||
            n.title.toLowerCase() === lowerCourse ||
            n.enrolled?.shortname.toLowerCase() === lowerCourse ||
            n.enrolled?.fullname.toLowerCase() === lowerCourse,
        )
        if (!node && normCode) {
          node = getOrCreateNode(normCode, normCode, task.course)
          if ( (task as { source?: string }).source === 'moodle' || task.url?.includes('moodle')) {
            addSource(node.sources, 'moodle')
          }
        }
      }
    }
    if (node) {
      node.tasks.push(task)
    }
  }

  // Build taskId -> node map so studyBlocks linked to a task find their course node even without courseCode
  const nodeByTaskId = new Map<string, UnifiedCourseNode>()
  for (const node of byKey.values()) {
    for (const t of node.tasks) {
      nodeByTaskId.set(t.id, node)
    }
  }

  // 7. StudyBlocks linkage
  for (const block of studyBlocks) {
    const blockCourseRaw = block.courseCode ?? (block as { course?: string }).course ?? ''
    const normCode = blockCourseRaw ? normalizeCourseCode(blockCourseRaw) : ''
    let node: UnifiedCourseNode | undefined = normCode ? byKey.get(normCode) : undefined
    if (!node) {
      const linkedTaskId = (block as { taskId?: string }).taskId ?? (block.sourceKind === 'task' ? block.sourceId : undefined)
      if (linkedTaskId) node = nodeByTaskId.get(linkedTaskId)
    }
    if (node) {
      node.studyBlocks.push(block)
    }
  }

  // 8. Enrich each node with SISU facts, sorted lessons/tasks, and discrepancy checks
  const allDiscrepancies: CourseDiscrepancy[] = []
  const missingSisuFactCodes: string[] = []

  for (const node of byKey.values()) {
    // Sort lessons chronologically and find next upcoming lesson
    node.lessons.sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    node.nextLesson = node.lessons.find((l) => Date.parse(l.end) > nowMs)

    // Sort tasks by deadline and count pending
    node.tasks = sortTasks(node.tasks)
    node.pendingTaskCount = node.tasks.filter((t) => !t.completed).length

    // Resolve SISU Fact (liveFacts map passed in input OR static COURSE_FACTS + persisted live cache)
    if (node.code) {
      const factFromInput = liveFacts[node.code] ? normalizeSisuFact(liveFacts[node.code]) : null
      const fact = factFromInput ?? getSisuCourseFact(node.code)
      if (fact) {
        node.sisuFact = fact
        addSource(node.sources, 'sisu')
      }
    }

    const fact = node.sisuFact
    const resolvedSisuId =
      (node.code ? sisuIds[node.code] : undefined) ||
      fact?.sisuId ||
      fact?.id ||
      node.planItem?.sisuId ||
      undefined
    if (resolvedSisuId) {
      node.sisuId = resolvedSisuId
      node.sisuBrochureUrl = sisuCourseUrl(resolvedSisuId)
    }

    const nameEn = sisuNameEn(fact)
    if (nameEn && (!node.title || node.title === node.code || node.title === node.key)) {
      node.title = nameEn
    }
    const nameFi = sisuNameFi(fact)
    if (nameFi) node.nameFi = nameFi

    const credits = fact?.credits ?? node.planItem?.credits
    if (credits !== undefined) node.credits = credits

    const periodsFromFact = fact?.periods && fact.periods.length > 0 ? fact.periods : undefined
    const periodsFromPlan = node.planItem?.periods
      ?.map(numberToTeachingPeriod)
      .filter((p): p is TeachingPeriod => p !== null)
    node.periods = periodsFromFact ?? periodsFromPlan ?? []

    const totalHours =
      fact?.totalHours && fact.totalHours > 0
        ? fact.totalHours
        : credits != null && credits > 0
          ? Math.round(credits * 27)
          : undefined
    if (totalHours !== undefined) {
      node.totalStudyHours = totalHours
    }

    // Discrepancy 1: moodle-only (enrolled/graded in Moodle, 0 timetable lessons, not already completed in study plan)
    if (
      node.sources.includes('moodle') &&
      node.lessons.length === 0 &&
      node.planItem?.completed !== true
    ) {
      const d: CourseDiscrepancy = {
        kind: 'moodle-only',
        courseKey: node.key,
        code: node.code,
        messageKey: 'discrepancyMoodleOnly',
        meta: { title: node.title },
      }
      node.discrepancies.push(d)
      allDiscrepancies.push(d)
    }

    // Discrepancy 2: timetable-only (active lessons in timetable, not linked to Moodle)
    if (
      node.lessons.length > 0 &&
      !node.sources.includes('moodle') &&
      node.moodleCourseId == null
    ) {
      const d: CourseDiscrepancy = {
        kind: 'timetable-only',
        courseKey: node.key,
        code: node.code,
        messageKey: 'discrepancyTimetableOnly',
        meta: { lessonCount: node.lessons.length },
      }
      node.discrepancies.push(d)
      allDiscrepancies.push(d)
    }

    // Discrepancy 3: missing-sisu-facts (course has a LUT code but no static or live SISU fact)
    if (node.code && !node.sisuFact) {
      missingSisuFactCodes.push(node.code)
      const d: CourseDiscrepancy = {
        kind: 'missing-sisu-facts',
        courseKey: node.key,
        code: node.code,
        messageKey: 'discrepancyMissingSisuFacts',
        meta: { code: node.code },
      }
      node.discrepancies.push(d)
      allDiscrepancies.push(d)
    }

    // Discrepancy 4: plan-status-mismatch
    if (node.planItem) {
      const planStatus = (node.planItem as { status?: string }).status
      const isPlannedOrIncomplete =
        planStatus === 'planned' || (!planStatus && !node.planItem.completed)
      const hasMoodleFinalOrActive =
        (node.grades?.officialTotal != null && node.grades.officialTotal >= 50) ||
        (planStatus === 'planned' && (node.lessons.length > 0 || node.sources.includes('moodle')))
      if (isPlannedOrIncomplete && hasMoodleFinalOrActive) {
        const d: CourseDiscrepancy = {
          kind: 'plan-status-mismatch',
          courseKey: node.key,
          code: node.code,
          messageKey: 'discrepancyPlanStatusMismatch',
          meta: { code: node.code || node.key },
        }
        node.discrepancies.push(d)
        allDiscrepancies.push(d)
      }
    }

    // Discrepancy 5: weights-missing (Moodle grades exist with items, but no item has weight > 0)
    if (
      node.grades &&
      node.grades.items.length > 0 &&
      !node.grades.items.some((it) => it.weight != null && it.weight > 0)
    ) {
      const d: CourseDiscrepancy = {
        kind: 'weights-missing',
        courseKey: node.key,
        code: node.code,
        messageKey: 'discrepancyWeightsMissing',
        meta: { itemCount: node.grades.items.length },
      }
      node.discrepancies.push(d)
      allDiscrepancies.push(d)
    }
  }

  const nodes = [...byKey.values()].sort((a, b) => {
    if (a.code && b.code) return a.code.localeCompare(b.code)
    if (a.code) return -1
    if (b.code) return 1
    return a.title.localeCompare(b.title)
  })

  return {
    nodes,
    byKey,
    byMoodleId,
    discrepancies: allDiscrepancies,
    missingSisuFactCodes: [...new Set(missingSisuFactCodes)].sort(),
  }
}

export function findUnifiedCourse(
  graph: CourseGraph,
  ref: { code?: string; courseId?: number; title?: string },
): UnifiedCourseNode | null {
  if (ref.courseId != null) {
    const byId = graph.byMoodleId.get(ref.courseId)
    if (byId) return byId
  }
  if (ref.code) {
    const clean = normalizeCourseCode(ref.code)
    const direct = graph.byKey.get(clean) ?? graph.byKey.get(ref.code)
    if (direct) return direct
    const extracted = extractCourseCode(ref.code)
    if (extracted) {
      const byExtracted = graph.byKey.get(normalizeCourseCode(extracted))
      if (byExtracted) return byExtracted
    }
  }
  if (ref.title) {
    const extracted = extractCourseCode(ref.title)
    if (extracted) {
      const byCode = graph.byKey.get(normalizeCourseCode(extracted))
      if (byCode) return byCode
    }
    const lower = ref.title.trim().toLowerCase()
    if (lower) {
      const byTitleKey = graph.byKey.get(`title:${lower}`)
      if (byTitleKey) return byTitleKey
      const match = graph.nodes.find(
        (n) =>
          n.title.toLowerCase() === lower ||
          n.title.toLowerCase().includes(lower) ||
          lower.includes(n.title.toLowerCase()),
      )
      if (match) return match
    }
  }
  return null
}

/* ---------------- Bidirectional Completion State Sync ---------------- */

export function applyTaskCompletionToStudyBlocks(
  blocks: StudyBlock[],
  taskId: string,
  completed: boolean,
  persist = false,
): StudyBlock[] {
  if (!taskId) return blocks
  let changed = false
  const next = blocks.map((block) => {
    const legacyTaskId = (block as { taskId?: string }).taskId
    const matchesTask =
      (block.sourceKind === 'task' && block.sourceId === taskId) ||
      legacyTaskId === taskId
    if (!matchesTask) return block
    const currentDone = block.completed ?? (block as { done?: boolean }).done ?? false
    if (currentDone === completed && block.completed === completed) return block
    changed = true
    if (persist) {
      setStudyBlockCompleted(block.id, completed)
    }
    return {
      ...block,
      completed,
      ...('done' in block ? { done: completed } : {}),
    }
  })
  return changed ? next : blocks
}

export function applyStudyBlockCompletionToTasks(
  tasks: Task[],
  blockOrId: StudyBlock | { id?: string; sourceKind?: string; sourceId?: string; taskId?: string; completed?: boolean; done?: boolean } | string,
  completed?: boolean,
  studyBlocks?: StudyBlock[],
  persist = false,
): Task[] {
  let targetTaskId: string | undefined
  let resolvedCompleted = completed ?? true

  if (typeof blockOrId === 'string') {
    const allBlocks = studyBlocks ?? loadStudyBlocks()
    const found = allBlocks.find((b) => b.id === blockOrId)
    if (found) {
      targetTaskId =
        (found as { taskId?: string }).taskId ??
        (found.sourceKind === 'task' ? found.sourceId : undefined)
      if (completed === undefined) {
        resolvedCompleted = found.completed ?? (found as { done?: boolean }).done ?? true
      }
    }
  } else if (blockOrId && typeof blockOrId === 'object') {
    const legacy = blockOrId as { taskId?: string; done?: boolean }
    targetTaskId =
      legacy.taskId ??
      (blockOrId.sourceKind === 'task' ? blockOrId.sourceId : undefined)
    if (completed === undefined) {
      resolvedCompleted = blockOrId.completed ?? legacy.done ?? true
    }
  }

  if (!targetTaskId) return tasks
  const targetTask = tasks.find((t) => t.id === targetTaskId)
  if (!targetTask || targetTask.completed === resolvedCompleted) return tasks

  if (persist) {
    return updateTask(tasks, targetTaskId, { completed: resolvedCompleted })
  }
  const nowIso = new Date().toISOString()
  return tasks.map((t) =>
    t.id === targetTaskId ? { ...t, completed: resolvedCompleted, updatedAt: nowIso } : t,
  )
}

export function syncTaskAndStudyBlocksCompletion(input: {
  tasks: Task[]
  studyBlocks: StudyBlock[]
  taskId?: string
  studyBlockId?: string
  completed: boolean
  persist?: boolean
}): { tasks: Task[]; studyBlocks: StudyBlock[] } {
  const persist = input.persist ?? false
  let tasks = input.tasks
  let studyBlocks = input.studyBlocks

  if (input.taskId) {
    const nowIso = new Date().toISOString()
    tasks = tasks.map((t) =>
      t.id === input.taskId ? { ...t, completed: input.completed, updatedAt: nowIso } : t,
    )
    if (persist) saveTasks(tasks)
    studyBlocks = applyTaskCompletionToStudyBlocks(
      studyBlocks,
      input.taskId,
      input.completed,
      persist,
    )
  } else if (input.studyBlockId) {
    const targetBlock = studyBlocks.find((b) => b.id === input.studyBlockId)
    studyBlocks = studyBlocks.map((b) =>
      b.id === input.studyBlockId
        ? { ...b, completed: input.completed, ...('done' in b ? { done: input.completed } : {}) }
        : b,
    )
    if (persist) setStudyBlockCompleted(input.studyBlockId, input.completed)
    if (targetBlock) {
      tasks = applyStudyBlockCompletionToTasks(
        tasks,
        targetBlock,
        input.completed,
        studyBlocks,
        persist,
      )
    }
  }

  return { tasks, studyBlocks }
}
