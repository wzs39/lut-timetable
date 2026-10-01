import { KEYS, readJson, writeJson } from './storage'

export type SisuPlanKind = 'course' | 'registration' | 'exam' | 'milestone'

export interface SisuPlanItem {
  id: string
  kind: SisuPlanKind
  title: string
  courseCode?: string
  credits?: number
  dueAt?: string
  note?: string
  completed: boolean
  createdAt: string
}

export interface SisuStudyPlan {
  goalCredits: number
  items: SisuPlanItem[]
}

const EMPTY_PLAN: SisuStudyPlan = { goalCredits: 180, items: [] }
const VALID_KINDS = new Set<SisuPlanKind>(['course', 'registration', 'exam', 'milestone'])

export function loadSisuStudyPlan(): SisuStudyPlan {
  const raw = readJson<Partial<SisuStudyPlan> | null>(KEYS.sisuStudyPlan, null)
  if (!raw || !Array.isArray(raw.items)) return { ...EMPTY_PLAN }
  const items = raw.items.filter(isPlanItem)
  const goalCredits = Number(raw.goalCredits)
  return {
    goalCredits: Number.isFinite(goalCredits) && goalCredits > 0 ? goalCredits : EMPTY_PLAN.goalCredits,
    items,
  }
}

export function saveSisuStudyPlan(plan: SisuStudyPlan): SisuStudyPlan {
  const safe: SisuStudyPlan = {
    goalCredits: Number.isFinite(plan.goalCredits) && plan.goalCredits > 0 ? plan.goalCredits : EMPTY_PLAN.goalCredits,
    items: plan.items.filter(isPlanItem),
  }
  writeJson(KEYS.sisuStudyPlan, safe)
  return safe
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
    credits: Number.isFinite(input.credits) && (input.credits ?? 0) > 0 ? input.credits : undefined,
    dueAt: input.dueAt || undefined,
    note: input.note?.trim() || undefined,
    completed: false,
    createdAt: new Date().toISOString(),
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
    (item.dueAt === undefined || (typeof item.dueAt === 'string' && Number.isFinite(Date.parse(item.dueAt)))) &&
    (item.note === undefined || typeof item.note === 'string')
}
