import type { Lesson } from '../types'
import { KEYS, readJson, writeJson } from './storage'
import {
  DEFAULT_STUDY_BLOCK_PREFS,
  normalizeStudyBlockPrefs,
  studyDayWindow,
  type StudyBlockPrefs,
} from './studyBlockPrefs'

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
  /**
   * 用户标记完成。**属于学习块自己**：只写学习块键，绝不回写来源任务 / SISU
   * 计划项 / Moodle 数据。缺省（旧记录）= 未完成。
   */
  completed?: boolean
}

const SLOT_MINUTES = 15

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

/**
 * 已确认学习块的变更订阅：唯一变更入口（confirm / remove）写盘后发信号。
 *
 * App 由此「变更即重算」——周视图/今日页直接反映最新列表，不再依赖「三视图
 * 互斥、切回来才重算」的隐式机制。监听者抛错不影响写盘结果，逐个隔离。
 */
type StudyBlocksListener = () => void
const changeListeners = new Set<StudyBlocksListener>()

export function subscribeStudyBlocks(listener: StudyBlocksListener): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

function emitStudyBlocksChanged(): void {
  for (const listener of [...changeListeners]) {
    try {
      listener()
    } catch {
      /* 单个监听者出错不能影响已经落盘的写入 */
    }
  }
}

export function isStudyBlock(value: unknown): value is StudyBlock {
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
    (block.courseCode === undefined || typeof block.courseCode === 'string') &&
    (block.completed === undefined || typeof block.completed === 'boolean')
}

function localDay(date: Date, offset: number): Date {
  const result = new Date(date)
  result.setHours(0, 0, 0, 0)
  result.setDate(result.getDate() + offset)
  return result
}

function overlapsWithBuffer(start: number, end: number, otherStart: number, otherEnd: number, bufferMinutes: number): boolean {
  const buffer = bufferMinutes * 60_000
  return start < otherEnd + buffer && end + buffer > otherStart
}

/**
 * Return earliest non-conflicting, deadline-safe recommendations for the next
 * `prefs.horizonDays` local days (default: today through today + 6).
 *
 * `prefs` is optional and always normalized first, so callers may pass raw
 * storage values: omitting it reproduces the original 08:00–22:00 / 60-minute /
 * 15-minute-buffer behaviour byte for byte.
 */
export function planStudyBlocks(input: {
  items: StudyBlockCandidate[]
  lessons: Array<Pick<Lesson, 'start' | 'end'>>
  confirmed: StudyBlock[]
  now: Date
  prefs?: StudyBlockPrefs
}): {
  recommendations: StudyBlockRecommendation[]
  unscheduled: StudyBlockCandidate[]
  /**
   * 落在规划视野之外的候选（已过期，或截止日晚于 horizonDays 的最后一天）。
   *
   * 这些项以前被 `return` 直接丢掉，界面上既不进推荐也不进 unscheduled，
   * 用户只看到"5 个任务要安排"却数不清剩下的 20 个去哪了。现在单列出来，
   * 由界面说明"还有 N 项在视野外"，而不是静默消失。
   */
  outOfHorizon: StudyBlockCandidate[]
} {
  const prefs = normalizeStudyBlockPrefs(input.prefs ?? DEFAULT_STUDY_BLOCK_PREFS)
  const nowMs = input.now.getTime()
  if (!Number.isFinite(nowMs)) {
    return { recommendations: [], unscheduled: input.items.filter(validCandidate), outOfHorizon: [] }
  }

  const dueLimit = localDay(input.now, Math.max(0, prefs.horizonDays - 1))
  dueLimit.setHours(23, 59, 59, 999)
  const unique = new Map<string, { item: StudyBlockCandidate; index: number }>()
  const unscheduled: StudyBlockCandidate[] = []
  const outOfHorizon: StudyBlockCandidate[] = []
  input.items.forEach((item, index) => {
    if (!validCandidate(item)) return
    const due = timestamp(item.dueAt)
    if (due <= nowMs || due > dueLimit.getTime()) {
      outOfHorizon.push(item)
      return
    }
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
  const durationMs = prefs.blockMinutes * 60_000

  // 每天的可排起点 / 窗口结束只与 (now, prefs, offset) 有关，与候选无关。
  // 旧实现把这段（含 new Date + setHours + studyDayWindow 合成）放在
  // 「每个候选 × 每一天」的双层循环里，20 个候选 × 7 天 = 140 次重复计算；
  // 这里预计算一次，语义逐字保持等价。
  const dayPlans: Array<{ firstSlot: number; windowEndMs: number } | null> = []
  for (let offset = 0; offset < prefs.horizonDays; offset++) {
    const startOfDay = localDay(input.now, offset)
    // 每一天的窗口都由 `studyDayWindow` 合成（继承全局 → 单日覆盖 → 最小窗口），
    // 排程器不自己拼「全局窗口 + 例外」，否则设置页与排程会是两份口径。
    const window = studyDayWindow(prefs, startOfDay.getDay())
    if (!window) {
      dayPlans.push(null)
      continue
    }
    const windowStart = new Date(startOfDay)
    windowStart.setHours(window.startHour, 0, 0, 0)
    const windowEnd = new Date(startOfDay)
    windowEnd.setHours(window.endHour, 0, 0, 0)
    const first = Math.max(windowStart.getTime(), nowMs + 1)
    const roundedFirst = new Date(first)
    const remainder = roundedFirst.getMinutes() % SLOT_MINUTES
    if (remainder !== 0 || roundedFirst.getSeconds() !== 0 || roundedFirst.getMilliseconds() !== 0) {
      roundedFirst.setMinutes(roundedFirst.getMinutes() + (SLOT_MINUTES - remainder), 0, 0)
    }
    else roundedFirst.setSeconds(0, 0)
    dayPlans.push({ firstSlot: roundedFirst.getTime(), windowEndMs: windowEnd.getTime() })
  }

  for (const { item } of ordered) {
    const key = sourceKey(item)
    if (confirmedKeys.has(key)) continue
    const due = timestamp(item.dueAt)
    let placed: StudyBlockRecommendation | undefined
    for (let offset = 0; offset < prefs.horizonDays && !placed; offset++) {
      const plan = dayPlans[offset]
      if (!plan) continue
      for (let start = plan.firstSlot; start + durationMs <= plan.windowEndMs && start + durationMs <= due; start += SLOT_MINUTES * 60_000) {
        const end = start + durationMs
        if (intervals.some((other) => overlapsWithBuffer(start, end, other.start, other.end, prefs.bufferMinutes))) continue
        placed = { ...item, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString() }
        intervals.push({ start, end })
        recommendations.push(placed)
        recommendedKeys.add(key)
        break
      }
    }
    if (!placed && !recommendedKeys.has(key)) unscheduled.push(item)
  }

  return { recommendations, unscheduled, outOfHorizon }
}

/**
 * 某个本地日内的已确认块（按开始时刻升序；同一时刻保持输入顺序）。
 *
 * 日界线比较留在纯函数里：组件不得自己拆 ISO 串比日期（UTC 日期与本地日
 * 在 UTC+8 下差一天，跨日边界会静默漏块）。坏数据、非法日期一律当空处理。
 */
export function studyBlocksOnDay(blocks: StudyBlock[], day: Date): StudyBlock[] {
  if (!Number.isFinite(day.getTime())) return []
  return blocks
    .filter((block) => isStudyBlock(block) && sameLocalDay(block.startAt, day))
    .sort((a, b) => timestamp(a.startAt) - timestamp(b.startAt))
}

function sameLocalDay(value: string, day: Date): boolean {
  const at = new Date(value)
  if (!Number.isFinite(at.getTime())) return false
  return at.getFullYear() === day.getFullYear() &&
    at.getMonth() === day.getMonth() &&
    at.getDate() === day.getDate()
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
  emitStudyBlocksChanged()
  return block
}

/**
 * 标记 / 取消完成。完成状态是学习块自己的字段：只写学习块键并发变更信号，
 * 绝不回写来源任务、SISU 计划项或 Moodle 数据；未知 id 是空操作（返回当前列表）。
 */
export function setStudyBlockCompleted(id: string, completed: boolean): StudyBlock[] {
  const current = loadStudyBlocks()
  const index = current.findIndex((block) => block.id === id)
  if (index === -1) return current
  const next = current.map((block, i) => (i === index ? { ...block, completed } : block))
  writeJson(KEYS.studyBlocks, next)
  emitStudyBlocksChanged()
  return next
}

export function removeStudyBlock(id: string): StudyBlock[] {
  const next = loadStudyBlocks().filter((block) => block.id !== id)
  writeJson(KEYS.studyBlocks, next)
  emitStudyBlocksChanged()
  return next
}

/**
 * 复核「已确认」的学习块：排程当时避开了课程，但之后课表会变（换教室、调时间、
 * 新加一门课、手动改课）。已确认的块是冻结的，不会自己挪，于是可能压到课上，
 * 而界面上完全看不出来——用户按计划去自习，发现教室在上课。
 *
 * 这里只做「找出被压到的块」，不自动挪：自动改用户确认过的时间比不改更糟。
 * 纯函数，`lessons` 用结构类型接，避免把 Lesson 的耦合引进来。
 */
export interface StaleStudyBlock {
  block: StudyBlock
  /** 与这个块重叠的课程（可能多门） */
  lessons: { start: string; end: string; title?: string; code?: string }[]
}

export function staleStudyBlocks(
  blocks: StudyBlock[],
  lessons: { start: string; end: string; title?: string; code?: string }[],
  bufferMinutes = 0,
): StaleStudyBlock[] {
  const buffer = Math.max(0, Math.trunc(bufferMinutes)) * 60_000
  const out: StaleStudyBlock[] = []
  for (const block of blocks) {
    if (!isStudyBlock(block) || block.completed === true) continue
    const bs = timestamp(block.startAt)
    const be = timestamp(block.endAt)
    if (!Number.isFinite(bs) || !Number.isFinite(be) || be <= bs) continue
    const clashing = lessons.filter((lesson) => {
      const ls = timestamp(lesson.start)
      const le = timestamp(lesson.end)
      if (!Number.isFinite(ls) || !Number.isFinite(le) || le <= ls) return false
      // 缓冲只向外扩学习块，课程本身的时间不动
      return bs - buffer < le && ls < be + buffer
    })
    if (clashing.length > 0) out.push({ block, lessons: clashing })
  }
  return out.sort((a, b) => timestamp(a.block.startAt) - timestamp(b.block.startAt))
}
