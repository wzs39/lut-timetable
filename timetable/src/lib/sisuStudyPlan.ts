import { KEYS, readJson, writeJson } from './storage'
import { personalPlanItems } from './personalStudyPlan'

export type SisuPlanKind = 'course' | 'registration' | 'exam' | 'milestone'
export type PlanCategory = 'general' | 'language' | 'intermediate' | 'minor' | 'elective'
export type PlanTimingSource = 'pdf-plan' | 'scenario'

export interface SisuPlanItem {
  id: string
  kind: SisuPlanKind
  title: string
  courseCode?: string
  credits?: number
  creditRange?: { min: number; max: number }
  studyYear?: string
  periods?: number[]
  category?: PlanCategory
  groupKey?: string
  groupTitle?: string
  sisuId?: string
  timingNote?: string
  grade?: number | 'pass'
  dueAt?: string
  note?: string
  completed: boolean
  createdAt: string
  timingSource?: PlanTimingSource
}

export interface SisuStudyPlan {
  goalCredits: number
  items: SisuPlanItem[]
}

export const DEFAULT_GOAL_CREDITS = 180
const EMPTY_PLAN: SisuStudyPlan = { goalCredits: DEFAULT_GOAL_CREDITS, items: [] }
const VALID_KINDS = new Set<SisuPlanKind>(['course', 'registration', 'exam', 'milestone'])
const VALID_CATEGORIES = new Set<PlanCategory>(['general', 'language', 'intermediate', 'minor', 'elective'])
const VALID_GRADES = new Set<number | 'pass'>([0, 1, 2, 3, 4, 5, 'pass'])

function isValidYear(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{4}$/.test(value)
}

function isValidPeriods(value: unknown): value is number[] {
  return Array.isArray(value) &&
    value.every((period) => Number.isInteger(period) && period >= 1 && period <= 4) &&
    new Set(value).size === value.length
}

function isValidCreditRange(value: unknown): value is { min: number; max: number } {
  if (!value || typeof value !== 'object') return false
  const range = value as { min?: unknown; max?: unknown }
  return typeof range.min === 'number' && Number.isFinite(range.min) && range.min >= 0 &&
    typeof range.max === 'number' && Number.isFinite(range.max) && range.max >= range.min
}

/**
 * First run (or a cleared backup) gets the user's Sisu plan. An existing plan —
 * including an intentionally empty one — is never overwritten.
 */
export function loadSisuStudyPlan(): SisuStudyPlan {
  const raw = readJson<Partial<SisuStudyPlan> | null>(KEYS.sisuStudyPlan, null)
  if (raw === null) {
    return saveSisuStudyPlan({ goalCredits: DEFAULT_GOAL_CREDITS, items: personalPlanItems() })
  }
  if (!raw || !Array.isArray(raw.items)) return { ...EMPTY_PLAN }
  const items = raw.items.filter(isPlanItem)
  const goalCredits = Number(raw.goalCredits)
  return {
    goalCredits: Number.isFinite(goalCredits) && goalCredits > 0 ? goalCredits : DEFAULT_GOAL_CREDITS,
    items,
  }
}

export function saveSisuStudyPlan(plan: SisuStudyPlan): SisuStudyPlan {
  const safe: SisuStudyPlan = {
    goalCredits: Number.isFinite(plan.goalCredits) && plan.goalCredits > 0 ? plan.goalCredits : DEFAULT_GOAL_CREDITS,
    items: plan.items.filter(isPlanItem),
  }
  writeJson(KEYS.sisuStudyPlan, safe)
  return safe
}

export function restorePersonalPlan(): SisuStudyPlan {
  return saveSisuStudyPlan({ goalCredits: DEFAULT_GOAL_CREDITS, items: personalPlanItems() })
}

export function createSisuPlanItem(
  input: Omit<SisuPlanItem, 'id' | 'completed' | 'createdAt'>,
): SisuPlanItem {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return {
    id,
    kind: input.kind,
    title: input.title.trim(),
    courseCode: input.courseCode?.trim().toUpperCase() || undefined,
    credits: Number.isFinite(input.credits) && (input.credits ?? 0) >= 0 ? input.credits : undefined,
    creditRange: isValidCreditRange(input.creditRange) ? input.creditRange : undefined,
    studyYear: isValidYear(input.studyYear) ? input.studyYear : undefined,
    periods: isValidPeriods(input.periods) ? [...input.periods].sort((a, b) => a - b) : undefined,
    category: input.category && VALID_CATEGORIES.has(input.category) ? input.category : undefined,
    groupKey: input.groupKey?.trim() || undefined,
    groupTitle: input.groupTitle?.trim() || undefined,
    sisuId: input.sisuId?.trim() || undefined,
    timingNote: input.timingNote?.trim() || undefined,
    grade: input.grade !== undefined && VALID_GRADES.has(input.grade) ? input.grade : undefined,
    dueAt: input.dueAt || undefined,
    note: input.note?.trim() || undefined,
    completed: false,
    createdAt: new Date().toISOString(),
    timingSource: input.timingSource,
  }
}

export function isSisuPlanItem(value: unknown): value is SisuPlanItem {
  return isPlanItem(value)
}

function isPlanItem(value: unknown): value is SisuPlanItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<SisuPlanItem>
  return typeof item.id === 'string' && item.id.trim().length > 0 &&
    typeof item.title === 'string' && item.title.trim().length > 0 &&
    VALID_KINDS.has(item.kind as SisuPlanKind) &&
    typeof item.completed === 'boolean' &&
    typeof item.createdAt === 'string' &&
    (item.courseCode === undefined || typeof item.courseCode === 'string') &&
    (item.credits === undefined || (typeof item.credits === 'number' && Number.isFinite(item.credits) && item.credits >= 0)) &&
    (item.creditRange === undefined || isValidCreditRange(item.creditRange)) &&
    (item.studyYear === undefined || isValidYear(item.studyYear)) &&
    (item.periods === undefined || isValidPeriods(item.periods)) &&
    (item.category === undefined || VALID_CATEGORIES.has(item.category)) &&
    (item.groupKey === undefined || typeof item.groupKey === 'string') &&
    (item.groupTitle === undefined || typeof item.groupTitle === 'string') &&
    (item.sisuId === undefined || typeof item.sisuId === 'string') &&
    (item.timingNote === undefined || typeof item.timingNote === 'string') &&
    (item.grade === undefined || VALID_GRADES.has(item.grade)) &&
    (item.dueAt === undefined || (typeof item.dueAt === 'string' && Number.isFinite(Date.parse(item.dueAt)))) &&
    (item.note === undefined || typeof item.note === 'string') &&
    (item.timingSource === undefined || item.timingSource === 'pdf-plan' || item.timingSource === 'scenario')
}
