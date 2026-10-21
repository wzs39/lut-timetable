import type { Lesson } from '../types'
import {
  DEFAULT_STUDY_BLOCK_PREFS,
  STUDY_BLOCK_WEEKDAYS,
  normalizeStudyBlockPrefs,
  studyDayWindow,
  type StudyBlockPrefs,
  type StudyBlockWeekday,
  type StudyDayOverrides,
} from './studyBlockPrefs'

/**
 * 用已同步的课表为每个星期几推导建议学习窗口。
 *
 * 规则只有一条主线索：**窗口 = 该星期几在作息窗口内最宽的一段空档**。
 *
 * - 课表占用按星期几取并集（同一门课在多周出现只算一次），跨午夜的课占到 24:00；
 *   课间缓冲也算占用，所以建议窗口不会紧贴下课时间、导致排程器整段跳过。
 * - 空档向内取整到整点（开始上取、结束下取），宁可窄一点也不把课包进去；
 *   至少放得下一块 + 缓冲（与 `studyBlockPrefs.fitWindow` 同一判据），
 *   否则这一天算「没有可用空档」。
 * - 已有的单日覆盖参与分界（`studyDayWindow` 是唯一合成入口），但 `off` 的日子
 *   返回 `reason: 'off'`——推导不偷偷把用户主动关掉的日子重新打开。
 *
 * 纯函数：课表由调用方传入（App 传可见课表），不读存储、不看当前时间。
 */
export interface StudyWindowSuggestion {
  weekday: StudyBlockWeekday
  /** 建议窗口；`null` 表示这一天不安排（见 `reason`） */
  window: { startHour: number; endHour: number } | null
  /** `ok` = 有建议窗口；`off` = 当前偏好已关掉这一天；`no-gap` = 课表里没有够大的空档 */
  reason: 'ok' | 'off' | 'no-gap'
  /** 该日课表合并后的占用段数（0 = 没课；只用于界面说明推导依据） */
  busyBlocks: number
}

interface MinuteSpan {
  start: number
  end: number
}

const MINUTES_PER_DAY = 24 * 60

/** 按边界合并（含相接）；padding > 0 时先把每段向两侧扩出缓冲。 */
function mergeSpans(spans: MinuteSpan[], padding: number): MinuteSpan[] {
  const sorted = spans
    .map((span) => ({
      start: Math.max(0, span.start - padding),
      end: Math.min(MINUTES_PER_DAY, span.end + padding),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: MinuteSpan[] = []
  for (const span of sorted) {
    const last = merged[merged.length - 1]
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end)
    else merged.push({ ...span })
  }
  return merged
}

/**
 * 每星期几的课程占用：`busy` 是原始并集（用于计数），`padded` 加了课间缓冲
 * （用于切空档）。非法/零长度/反向的课程直接忽略，不伪造占用。
 */
function busyByWeekday(
  lessons: ReadonlyArray<Pick<Lesson, 'start' | 'end'>>,
  bufferMinutes: number,
): Map<StudyBlockWeekday, { busy: MinuteSpan[]; padded: MinuteSpan[] }> {
  const raw = new Map<StudyBlockWeekday, MinuteSpan[]>()
  for (const lesson of lessons) {
    if (!lesson || typeof lesson.start !== 'string' || typeof lesson.end !== 'string') continue
    const start = new Date(lesson.start)
    const end = new Date(lesson.end)
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) continue
    const startMinutes = start.getHours() * 60 + start.getMinutes()
    const sameDay =
      end.getFullYear() === start.getFullYear() &&
      end.getMonth() === start.getMonth() &&
      end.getDate() === start.getDate()
    const endMinutes = sameDay ? end.getHours() * 60 + end.getMinutes() : MINUTES_PER_DAY
    if (endMinutes <= startMinutes) continue
    const weekday = start.getDay() as StudyBlockWeekday
    const list = raw.get(weekday)
    if (list) list.push({ start: startMinutes, end: endMinutes })
    else raw.set(weekday, [{ start: startMinutes, end: endMinutes }])
  }

  const out = new Map<StudyBlockWeekday, { busy: MinuteSpan[]; padded: MinuteSpan[] }>()
  for (const [weekday, spans] of raw) {
    out.set(weekday, { busy: mergeSpans(spans, 0), padded: mergeSpans(spans, bufferMinutes) })
  }
  return out
}

/**
 * 窗口内最宽的可放学习块空档；空档向内取整到整点，至少 `requiredHours` 小时。
 * 等宽时取更早的一段（上午优先），结果只依赖输入，可复现。
 */
function widestGap(
  busy: MinuteSpan[],
  windowStart: number,
  windowEnd: number,
  requiredHours: number,
): { startHour: number; endHour: number } | null {
  const gaps: Array<[number, number]> = []
  let cursor = windowStart
  for (const span of busy) {
    if (span.end <= windowStart || span.start >= windowEnd) continue
    if (span.start > cursor) gaps.push([cursor, Math.min(span.start, windowEnd)])
    cursor = Math.max(cursor, span.end)
  }
  if (cursor < windowEnd) gaps.push([cursor, windowEnd])

  let best: { startHour: number; endHour: number } | null = null
  for (const [gapStart, gapEnd] of gaps) {
    const startHour = Math.ceil(gapStart / 60)
    const endHour = Math.floor(gapEnd / 60)
    if (endHour - startHour < requiredHours) continue
    if (!best || endHour - startHour > best.endHour - best.startHour) best = { startHour, endHour }
  }
  return best
}

/** 每个星期几一条建议（顺序固定 周一 → 周日，与设置页一致）。 */
export function suggestStudyWindows(
  lessons: ReadonlyArray<Pick<Lesson, 'start' | 'end'>>,
  prefs: StudyBlockPrefs = DEFAULT_STUDY_BLOCK_PREFS,
): StudyWindowSuggestion[] {
  const normalized = normalizeStudyBlockPrefs(prefs)
  const busy = busyByWeekday(lessons, normalized.bufferMinutes)
  // 与 fitWindow 同一判据：窗口至少要放得下一块 + 缓冲
  const requiredHours = Math.ceil((normalized.blockMinutes + normalized.bufferMinutes) / 60)

  return STUDY_BLOCK_WEEKDAYS.map((weekday) => {
    const day = busy.get(weekday)
    const busyBlocks = day?.busy.length ?? 0
    const window = studyDayWindow(normalized, weekday)
    if (!window) return { weekday, window: null, reason: 'off', busyBlocks }
    const suggestion = widestGap(
      day?.padded ?? [],
      window.startHour * 60,
      window.endHour * 60,
      requiredHours,
    )
    return suggestion
      ? { weekday, window: suggestion, reason: 'ok', busyBlocks }
      : { weekday, window: null, reason: 'no-gap', busyBlocks }
  })
}

/**
 * 建议 → 按日覆盖（可直接交给 `saveStudyBlockPrefs({ dayOverrides })`）。
 *
 * - **整份替换**：这是「一键采纳」的语义，预览里列出的就是采纳后的每一天。
 * - 与全局窗口一致的日子不写覆盖（继续继承，用户以后调全局窗口还能带上它）。
 * - `no-gap` / 已关掉的日子写 `off`；`skipWeekends` 开着时周末**不写**条目——
 *   那是开关的职责，写成 `off` 会在用户关掉开关后残留一份看不见的「不安排」。
 */
export function suggestionsToOverrides(
  suggestions: ReadonlyArray<StudyWindowSuggestion>,
  prefs: StudyBlockPrefs = DEFAULT_STUDY_BLOCK_PREFS,
): StudyDayOverrides {
  const normalized = normalizeStudyBlockPrefs(prefs)
  const overrides: StudyDayOverrides = {}
  for (const suggestion of suggestions) {
    if (normalized.skipWeekends && (suggestion.weekday === 0 || suggestion.weekday === 6)) continue
    if (!suggestion.window) {
      overrides[suggestion.weekday] = { off: true }
      continue
    }
    if (
      suggestion.window.startHour === normalized.dayStartHour &&
      suggestion.window.endHour === normalized.dayEndHour
    ) continue
    overrides[suggestion.weekday] = {
      startHour: suggestion.window.startHour,
      endHour: suggestion.window.endHour,
    }
  }
  return overrides
}
