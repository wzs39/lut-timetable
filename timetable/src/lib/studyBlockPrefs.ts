import { KEYS, readJson, writeJson } from './storage'

/**
 * 学习时段偏好（作息窗口 / 块时长 / 间隔缓冲 / 推荐范围）。
 *
 * 纯数据 + 纯函数：读写、逐字段钳位、跨字段最小窗口都在这里，排程器只消费结果。
 * 单一存储键（KEYS.studyBlockPrefs）保存整组偏好，避免每加一个旋钮就多一个键。
 *
 * 【契约】`DEFAULT_STUDY_BLOCK_PREFS` 必须等于 Phase 1 排程器里硬编码的常量
 * （08:00–22:00 / 60 分钟 / 15 分钟 / 未来 7 天 / 不跳过周末）——不传偏好时排程结果
 * 与已验证行为逐字节一致，既有排程测试就是这条契约的守卫。
 */

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
