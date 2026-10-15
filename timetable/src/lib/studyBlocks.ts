import type { Lesson } from '../types'
import { KEYS, readJson, writeJson } from './storage'

export type StudyBlockSourceKind = 'task' | 'sisu-plan'

export interface StudyBlockCandidate {
  sourceKind: StudyBlockSourceKind
  sourceId: string
  title: string
  dueAt: string
  courseCode?: string
}

export interface StudyBlockRecommendation extends StudyBlockCandidate {
  startAt: string
  endAt: string
}

export interface StudyBlock extends StudyBlockRecommendation {
  id: string
  createdAt: string
}

const DAY_COUNT = 7
const BLOCK_MINUTES = 60
const BUFFER_MINUTES = 15
const SLOT_MINUTES = 15
const DAY_START_HOUR = 8
const DAY_END_HOUR = 22

function timestamp(value: string): number {
  const result = Date.parse(value)
  return Number.isFinite(result) ? result : NaN
}

function sourceKey(item: Pick<StudyBlockCandidate, 'sourceKind' | 'sourceId'>): string {
  return `${item.sourceKind}:${item.sourceId}`
}

function validCandidate(item: StudyBlockCandidate): boolean {
  return (item.sourceKind === 'task' || item.sourceKind === 'sisu-plan') &&
    typeof item.sourceId === 'string' && item.sourceId.trim().length > 0 &&
    typeof item.title === 'string' && item.title.trim().length > 0 &&
    Number.isFinite(timestamp(item.dueAt))
}

function validInterval(start: string, end: string): boolean {
  const startMs = timestamp(start)
  const endMs = timestamp(end)
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
}

function isStudyBlock(value: unknown): value is StudyBlock {
  if (!value || typeof value !== 'object') return false
  const block = value as Partial<StudyBlock>
  return typeof block.id === 'string' && block.id.trim().length > 0 &&
    (block.sourceKind === 'task' || block.sourceKind === 'sisu-plan') &&
    typeof block.sourceId === 'string' && block.sourceId.trim().length > 0 &&
    typeof block.title === 'string' && block.title.trim().length > 0 &&
    typeof block.dueAt === 'string' && Number.isFinite(timestamp(block.dueAt)) &&
    typeof block.startAt === 'string' && typeof block.endAt === 'string' &&
    validInterval(block.startAt, block.endAt) && timestamp(block.endAt) <= timestamp(block.dueAt) &&
    typeof block.createdAt === 'string' && Number.isFinite(timestamp(block.createdAt)) &&
    (block.courseCode === undefined || typeof block.courseCode === 'string')
}

function localDay(date: Date, offset: number): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  result.setDate(result.getDate() + offset)
  return result
}

function overlapsWithBuffer(start: number, end: number, otherStart: number, otherEnd: number): boolean {
  const buffer = BUFFER_MINUTES * 60_000
  return start < otherEnd + buffer && end + buffer > otherStart
}

/** Return earliest non-conflicting, deadline-safe recommendations for local days [today, today+6]. */
export function planStudyBlocks(input: {
  items: StudyBlockCandidate[]
  lessons: Array<Pick<Lesson, 'start' | 'end'>>
  confirmed: StudyBlock[]
  now: Date
}): { recommendations: StudyBlockRecommendation[]; unscheduled: StudyBlockCandidate[] } {
  const nowMs = input.now.getTime()
  if (!Number.isFinite(nowMs)) return { recommendations: [], unscheduled: input.items.filter(validCandidate) }

  const dueLimit = localDay(input.now, DAY_COUNT - 1)
  dueLimit.setHours(23, 59, 59, 999)
  const unique = new Map<string, { item: StudyBlockCandidate; index: number }>()
  const unscheduled: StudyBlockCandidate[] = []
  input.items.forEach((item, index) => {
    if (!validCandidate(item)) return
    const due = timestamp(item.dueAt)
    if (due <= nowMs || due > dueLimit.getTime()) return
    const key = sourceKey(item)
    if (unique.has(key)) return
    unique.set(key, { item, index })
  })

  const ordered = [...unique.values()].sort((a, b) =>
    timestamp(a.item.dueAt) - timestamp(b.item.dueAt) || a.index - b.index,
  )
  const confirmedKeys = new Set(input.confirmed.filter(isStudyBlock).map(sourceKey))
  const intervals = [
    ...input.lessons.filter((lesson) => validInterval(lesson.start, lesson.end)).map((lesson) => ({
      start: timestamp(lesson.start), end: timestamp(lesson.end),
    })),
    ...input.confirmed.filter(isStudyBlock).map((block) => ({ start: timestamp(block.startAt), end: timestamp(block.endAt) })),
  ]
  const recommendations: StudyBlockRecommendation[] = []
  const recommendedKeys = new Set<string>()
  const durationMs = BLOCK_MINUTES * 60_000

  for (const { item } of ordered) {
    const key = sourceKey(item)
    if (confirmedKeys.has(key)) continue
    const due = timestamp(item.dueAt)
    let placed: StudyBlockRecommendation | undefined
    for (let offset = 0; offset < DAY_COUNT && !placed; offset++) {
      const startOfDay = localDay(input.now, offset)
      const windowStart = new Date(startOfDay)
      windowStart.setHours(DAY_START_HOUR, 0, 0, 0)
      const windowEnd = new Date(startOfDay)
      windowEnd.setHours(DAY_END_HOUR, 0, 0, 0)
      const first = Math.max(windowStart.getTime(), nowMs + 1)
      const roundedFirst = new Date(first)
      const remainder = roundedFirst.getMinutes() % SLOT_MINUTES
      if (remainder !== 0 || roundedFirst.getSeconds() !== 0 || roundedFirst.getMilliseconds() !== 0) {
        roundedFirst.setMinutes(roundedFirst.getMinutes() + (SLOT_MINUTES - remainder), 0, 0)
      }
      else roundedFirst.setSeconds(0, 0)
      for (let start = roundedFirst.getTime(); start + durationMs <= windowEnd.getTime() && start + durationMs <= due; start += SLOT_MINUTES * 60_000) {
        const end = start + durationMs
        if (intervals.some((other) => overlapsWithBuffer(start, end, other.start, other.end))) continue
        placed = { ...item, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() }
        intervals.push({ start, end })
        recommendations.push(placed)
        recommendedKeys.add(key)
        break
      }
    }
    if (!placed && !recommendedKeys.has(key)) unscheduled.push(item)
  }

  return { recommendations, unscheduled }
}

export function loadStudyBlocks(): StudyBlock[] {
  const raw = readJson<unknown>(KEYS.studyBlocks, [])
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  return raw.filter((value): value is StudyBlock => {
    if (!isStudyBlock(value)) return false
    const key = sourceKey(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function confirmStudyBlock(recommendation: StudyBlockRecommendation, createdAt = new Date().toISOString()): StudyBlock {
  const current = loadStudyBlocks()
  const existing = current.find((block) => sourceKey(block) === sourceKey(recommendation))
  if (existing) return existing
  if (!validCandidate(recommendation) || !validInterval(recommendation.startAt, recommendation.endAt) ||
    timestamp(recommendation.endAt) > timestamp(recommendation.dueAt) || !Number.isFinite(timestamp(createdAt))) {
    throw new RangeError('Invalid study block recommendation')
  }
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const block: StudyBlock = { ...recommendation, id, createdAt }
  writeJson(KEYS.studyBlocks, [...current, block])
  return block
}

export function removeStudyBlock(id: string): StudyBlock[] {
  const next = loadStudyBlocks().filter((block) => block.id !== id)
  writeJson(KEYS.studyBlocks, next)
  return next
}
