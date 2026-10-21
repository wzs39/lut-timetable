import { KEYS, readJson, writeJson } from './storage'

/**
 * 学习时段偏好（作息窗口 / 块时长 / 间隔缓冲 / 推荐范围）。
 *
 * 纯数据 + 纯函数：读写、逐字段钳位、跨字段最小窗口都在这里，排程器只消费结果。
 * 单一存储键（KEYS.studyBlockPrefs）保存整组偏好，避免每加一个旋钮就多一个键。
 *
 * 【契约】`DEFAULT_STUDY_BLOCK_PREFS` 必须等于 Phase 1 排程器里硬编码的常量
 * （08:00–22:00 / 60 分钟 / 15 分钟 / 未来 7 天 / 不跳过周末 / 无按日覆盖）——不传偏好时
 * 排程结果与已验证行为逐字节一致，既有排程测试就是这条契约的守卫。
 */

/** 0 = 周日 … 6 = 周六（与 `Date#getDay()` 同键，不另造一套索引）。 */
export type StudyBlockWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** 周一 → 周日的显示顺序；存储键仍是 `getDay()` 的 0–6。 */
export const STUDY_BLOCK_WEEKDAYS: StudyBlockWeekday[] = [1, 2, 3, 4, 5, 6, 0]

/**
 * 单日作息覆盖。字段全部可选：只覆盖用户真正改过的那一侧，其余继续跟随全局窗口
 * ——否则调一次全局窗口，所有单独设过的日子都会被钉死在旧值上。
 */
export interface StudyDayOverride {
  /** true = 这一天不安排任何学习时段 */
  off?: boolean
  /** 这一天自己的窗口开始（整点） */
  startHour?: number
  /** 这一天自己的窗口结束（整点；24 = 当天结束） */
  endHour?: number
}

export type StudyDayOverrides = Partial<Record<StudyBlockWeekday, StudyDayOverride>>

export interface StudyBlockPrefs {
  /** 每日窗口开始（整点，0–23） */
  dayStartHour: number
  /** 每日窗口结束（整点，1–24；24 = 当天结束） */
  dayEndHour: number
  /** 单个学习块时长（分钟，15–240 且为 15 的倍数） */
  blockMinutes: number
  /** 块间缓冲（分钟，0–60） */
  bufferMinutes: number
  /** 推荐范围（未来几个本地日，1–14） */
  horizonDays: number
  /** true = 周六与周日不安排 */
  skipWeekends: boolean
  /** 已确认块开始前是否发本地提醒（提醒那一批使用；这里只负责保存） */
  remindEnabled: boolean
  /** 按星期几的覆盖（缺省 = 全部沿用上面的每日窗口） */
  dayOverrides: StudyDayOverrides
}

export const STUDY_BLOCK_LIMITS = {
  dayStartHour: { min: 0, max: 23 },
  dayEndHour: { min: 1, max: 24 },
  blockMinutes: { min: 15, max: 240, step: 15 },
  bufferMinutes: { min: 0, max: 60, step: 5 },
  horizonDays: { min: 1, max: 14 },
} as const

export const DEFAULT_STUDY_BLOCK_PREFS: StudyBlockPrefs = {
  dayStartHour: 8,
  dayEndHour: 22,
  blockMinutes: 60,
  bufferMinutes: 15,
  horizonDays: 7,
  skipWeekends: false,
  remindEnabled: false,
  dayOverrides: {},
}

/** 非数字/NaN → 回默认；否则按 step 取整并夹到 [min, max]。 */
function clampNumber(value: unknown, min: number, max: number, step: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const snapped = Math.round(value / step) * step
  return Math.min(max, Math.max(min, snapped))
}

/**
 * 窗口必须放得下一块 + 缓冲：不够就抬结束时间；抬到头（24:00）还不够，就把开始
 * 时间前移，而不是留一个永远排不出建议的窗口。
 */
function fitWindow(start: number, end: number, blockMinutes: number, bufferMinutes: number): [number, number] {
  const required = Math.ceil((blockMinutes + bufferMinutes) / 60)
  if (end - start >= required) return [start, end]
  const raisedEnd = Math.min(STUDY_BLOCK_LIMITS.dayEndHour.max, start + required)
  if (raisedEnd - start >= required) return [start, raisedEnd]
  return [
    Math.max(STUDY_BLOCK_LIMITS.dayStartHour.min, STUDY_BLOCK_LIMITS.dayEndHour.max - required),
    STUDY_BLOCK_LIMITS.dayEndHour.max,
  ]
}

/**
 * 按日覆盖的归一化：
 *
 * - 只保留用户真正填过的字段（没填的一侧继续继承全局窗口）；
 * - 非数字、非布尔一律丢弃（`'yes'`/1 不算 `off`，与 `skipWeekends` 同口径）；
 * - 单侧覆盖也要和全局另一侧合得成一块：放不下就把两个侧都落成显式的实际窗口，
 *   免得存储里留着一个「看起来 08:00–09:00、实际排到 10:00」的骗人值。
 * - 键不是 0–6 的条目（手改存储 / 旧备份）直接丢弃，不猜成周一。
 */
function normalizeDayOverrides(
  raw: unknown,
  base: { dayStartHour: number; dayEndHour: number; blockMinutes: number; bufferMinutes: number },
): StudyDayOverrides {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const out: StudyDayOverrides = {}
  for (const day of [0, 1, 2, 3, 4, 5, 6] as StudyBlockWeekday[]) {
    const entry = source[String(day)]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const value = entry as Partial<StudyDayOverride>
    const off = value.off === true ? true : undefined
    const startRaw = typeof value.startHour === 'number' && Number.isFinite(value.startHour) ? value.startHour : undefined
    const endRaw = typeof value.endHour === 'number' && Number.isFinite(value.endHour) ? value.endHour : undefined
    if (!off && startRaw === undefined && endRaw === undefined) continue

    const fittedStart = clampNumber(
      startRaw ?? base.dayStartHour,
      STUDY_BLOCK_LIMITS.dayStartHour.min,
      STUDY_BLOCK_LIMITS.dayStartHour.max,
      1,
      base.dayStartHour,
    )
    const fittedEnd = clampNumber(
      endRaw ?? base.dayEndHour,
      STUDY_BLOCK_LIMITS.dayEndHour.min,
      STUDY_BLOCK_LIMITS.dayEndHour.max,
      1,
      base.dayEndHour,
    )
    const [startHour, endHour] = fitWindow(fittedStart, fittedEnd, base.blockMinutes, base.bufferMinutes)
    const squeezed = startHour !== fittedStart || endHour !== fittedEnd
    const next: StudyDayOverride = {}
    if (off) next.off = true
    if (squeezed) {
      next.startHour = startHour
      next.endHour = endHour
    } else {
      if (startRaw !== undefined) next.startHour = startHour
      if (endRaw !== undefined) next.endHour = endHour
    }
    // 空记录（例如只把 off 关掉）不留在存储里：否则 UI 会把「没有覆盖」显示成「单独窗口」
    if (Object.keys(next).length > 0) out[day] = next
  }
  return out
}

/** 任意输入（含手改存储、旧备份）→ 一定可用的偏好；损坏一律回默认。 */
export function normalizeStudyBlockPrefs(raw: unknown): StudyBlockPrefs {
  const source = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Partial<StudyBlockPrefs>
  const blockMinutes = clampNumber(
    source.blockMinutes,
    STUDY_BLOCK_LIMITS.blockMinutes.min,
    STUDY_BLOCK_LIMITS.blockMinutes.max,
    STUDY_BLOCK_LIMITS.blockMinutes.step,
    DEFAULT_STUDY_BLOCK_PREFS.blockMinutes,
  )
  const bufferMinutes = clampNumber(
    source.bufferMinutes,
    STUDY_BLOCK_LIMITS.bufferMinutes.min,
    STUDY_BLOCK_LIMITS.bufferMinutes.max,
    STUDY_BLOCK_LIMITS.bufferMinutes.step,
    DEFAULT_STUDY_BLOCK_PREFS.bufferMinutes,
  )
  const [dayStartHour, dayEndHour] = fitWindow(
    clampNumber(
      source.dayStartHour,
      STUDY_BLOCK_LIMITS.dayStartHour.min,
      STUDY_BLOCK_LIMITS.dayStartHour.max,
      1,
      DEFAULT_STUDY_BLOCK_PREFS.dayStartHour,
    ),
    clampNumber(
      source.dayEndHour,
      STUDY_BLOCK_LIMITS.dayEndHour.min,
      STUDY_BLOCK_LIMITS.dayEndHour.max,
      1,
      DEFAULT_STUDY_BLOCK_PREFS.dayEndHour,
    ),
    blockMinutes,
    bufferMinutes,
  )
  return {
    dayStartHour,
    dayEndHour,
    blockMinutes,
    bufferMinutes,
    horizonDays: clampNumber(
      source.horizonDays,
      STUDY_BLOCK_LIMITS.horizonDays.min,
      STUDY_BLOCK_LIMITS.horizonDays.max,
      1,
      DEFAULT_STUDY_BLOCK_PREFS.horizonDays,
    ),
    // 布尔字段只认真布尔：'yes'/1 这类 truthy 值回默认，别把用户的字符串当同意
    skipWeekends: typeof source.skipWeekends === 'boolean' ? source.skipWeekends : DEFAULT_STUDY_BLOCK_PREFS.skipWeekends,
    remindEnabled: typeof source.remindEnabled === 'boolean' ? source.remindEnabled : DEFAULT_STUDY_BLOCK_PREFS.remindEnabled,
    dayOverrides: normalizeDayOverrides(source.dayOverrides, {
      dayStartHour,
      dayEndHour,
      blockMinutes,
      bufferMinutes,
    }),
  }
}

export function loadStudyBlockPrefs(): StudyBlockPrefs {
  return normalizeStudyBlockPrefs(readJson<unknown>(KEYS.studyBlockPrefs, DEFAULT_STUDY_BLOCK_PREFS))
}

/** 局部更新：与已存值合并、归一化后写回，返回真正落盘的那一份。 */
export function saveStudyBlockPrefs(patch: Partial<StudyBlockPrefs>): StudyBlockPrefs {
  const next = normalizeStudyBlockPrefs({ ...loadStudyBlockPrefs(), ...patch })
  writeJson(KEYS.studyBlockPrefs, next)
  return next
}

/**
 * 某个星期几**实际可用**的窗口；`null` = 这一天不安排（跳过周末 / 单日 `off`）。
 *
 * 排程器与设置页都只问这一个函数：日窗口的合成规则（继承 → 钳位 → 最小窗口）
 * 不允许多写一份，否则「设置里显示 08:00–16:00、排程却排到 18:00」这类漂移会静默发生。
 * 入参可以是原始存储值：内部先归一化，所以非法输入不会造出 `NaN` 时刻。
 */
export function studyDayWindow(
  prefs: StudyBlockPrefs,
  weekday: number,
): { startHour: number; endHour: number } | null {
  if (!Number.isFinite(weekday)) return null
  const day = (((Math.trunc(weekday) % 7) + 7) % 7) as StudyBlockWeekday
  const normalized = normalizeStudyBlockPrefs(prefs)
  if (normalized.skipWeekends && (day === 0 || day === 6)) return null
  const override = normalized.dayOverrides[day]
  if (override?.off) return null
  return {
    startHour: override?.startHour ?? normalized.dayStartHour,
    endHour: override?.endHour ?? normalized.dayEndHour,
  }
}

/**
 * 纯函数形式的「改一天」：`null` = 清除该日覆盖（回到继承全局窗口）。
 * 归一化仍在唯一所有者里做，组件只负责把结果交给 `saveStudyBlockPrefs`。
 */
export function withStudyDayOverride(
  prefs: StudyBlockPrefs,
  weekday: StudyBlockWeekday,
  override: StudyDayOverride | null,
): StudyBlockPrefs {
  const current = normalizeStudyBlockPrefs(prefs)
  const dayOverrides: StudyDayOverrides = { ...current.dayOverrides }
  if (override === null) delete dayOverrides[weekday]
  else dayOverrides[weekday] = override
  return normalizeStudyBlockPrefs({ ...current, dayOverrides })
}
