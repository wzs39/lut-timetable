import type { Lesson } from '../types'
import { KEYS, readJson, writeJson } from './storage'

/**
 * 出勤打卡（本地、可备份）。
 *
 * 键必须是「课程发生」而不是 `lesson.id`：ICS 重新同步会重新生成 id，
 * 用 id 记账会让历史出勤在下次同步后全部失联。优先用 ICS UID，
 * 没有 UID 时退到 `代码|开始时刻`（同一节课在同步之间是稳定的）。
 *
 * 语义：
 * - 停课（cancelled）不计入分母——不是学生缺勤。
 * - 未结束的课不计入分母；默认只有过去/正在上的课才能打卡。
 * - 出勤率 = 到课 / (到课 + 缺勤)；没有可统计的课时返回 null。
 */

export type AttendanceStatus = 'attended' | 'missed' | 'cancelled'

export interface AttendanceRecord {
  status: AttendanceStatus
  /** 最后一次修改时间（ISO） */
  at: string
}

export type AttendanceMap = Record<string, AttendanceRecord>

/** 出勤率低于这个值就提示（LUT 不少课要求 80%） */
export const ATTENDANCE_WARN_RATE = 0.8

export interface CourseAttendance {
  attended: number
  missed: number
  cancelled: number
  /** 计入分母的课时数（attended + missed） */
  total: number
  /** 0–1；没有可统计课时时为 null */
  rate: number | null
  warn: boolean
}

/** 一次课程发生的稳定键；无效输入返回 ''。 */
export function lessonOccurrenceKey(lesson: Lesson): string {
  const uid = lesson.uid?.trim()
  if (uid) return uid
  const start = new Date(lesson.start).getTime()
  if (!Number.isFinite(start)) return ''
  const code = (lesson.code?.trim() || lesson.title?.trim() || '').toUpperCase()
  if (!code) return ''
  return `${code}|${lesson.start}`
}

export function loadAttendance(): AttendanceMap {
  const raw = readJson<Record<string, unknown>>(KEYS.attendance, {})
  const out: AttendanceMap = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue
    const status = value.status
    if (status !== 'attended' && status !== 'missed' && status !== 'cancelled') continue
    out[key] = { status, at: typeof value.at === 'string' ? value.at : '' }
  }
  return out
}

export function saveAttendance(map: AttendanceMap): AttendanceMap {
  writeJson(KEYS.attendance, map)
  return map
}

export function attendanceFor(
  records: AttendanceMap,
  lesson: Lesson,
): AttendanceStatus | null {
  const key = lessonOccurrenceKey(lesson)
  return key ? (records[key]?.status ?? null) : null
}

/**
 * 设置/清除一节课的出勤状态。`null` = 清除（回到未记）。
 * 键无法确定时原样返回，不写脏数据。
 */
export function setAttendance(
  records: AttendanceMap,
  lesson: Lesson,
  status: AttendanceStatus | null,
  at: Date = new Date(),
): AttendanceMap {
  const key = lessonOccurrenceKey(lesson)
  if (!key) return records
  const next = { ...records }
  if (status === null) delete next[key]
  else next[key] = { status, at: at.toISOString() }
  return next
}

/** 同一门课（按代码；无代码按标题）的出勤统计。结束时间晚于 `now` 的课不算。 */
export function courseAttendance(
  lessons: Lesson[],
  records: AttendanceMap,
  courseKey: string,
  now: Date = new Date(),
): CourseAttendance {
  const target = courseKey.trim().toUpperCase()
  let attended = 0
  let missed = 0
  let cancelled = 0

  if (target) {
    for (const lesson of lessons) {
      const key = (lesson.code?.trim() || lesson.title?.trim() || '').toUpperCase()
      if (key !== target) continue
      const end = new Date(lesson.end).getTime()
      if (!Number.isFinite(end) || end > now.getTime()) continue
      const status = attendanceFor(records, lesson)
      if (status === 'attended') attended++
      else if (status === 'missed') missed++
      else if (status === 'cancelled') cancelled++
    }
  }

  const total = attended + missed
  const rate = total > 0 ? attended / total : null
  return {
    attended,
    missed,
    cancelled,
    total,
    rate,
    warn: rate != null && rate < ATTENDANCE_WARN_RATE,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
