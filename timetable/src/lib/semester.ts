import type { Lesson } from '../types'
import type { Task } from './tasks'

/**
 * 学期全景：把整学期按自然周（周一起）聚合成一条可扫读的带子。
 *
 * 纯函数，只做两件事：算出学期窗口（受 `MIN/MAX_SEMESTER_WEEKS` 约束），
 * 再把课程与到期任务按**本地日**分到周里。组件只渲染，不自己定阈值。
 *
 * 为什么不用「学期开始/结束」设置项：课表本身已经给出真实的首末课时间，
 * 再让用户填一遍是多余输入；课表为空时才回退到当前周 ±8 周。
 */

export const MIN_SEMESTER_WEEKS = 4
export const MAX_SEMESTER_WEEKS = 30
/** 热力等级上限（0 = 完全没课/没任务） */
export const MAX_LOAD_LEVEL = 5

export interface SemesterWeek {
  /** 该周周一（本地）的 yyyy-mm-dd，作为稳定 key */
  start: string
  lessons: number
  tasks: number
  /** 1–5 的相对负荷；0 = 这一周什么都没有 */
  load: number
}

export interface SemesterOverview {
  weeks: SemesterWeek[]
  /** 当前周在 weeks 里的下标；学期已结束时为 -1 */
  currentIndex: number
  /** 0–1 的学期进度（当前时刻在窗口里的位置，已夹紧） */
  progress: number
}

/** 本地日 key（yyyy-mm-dd）。刻意不用 toISOString：UTC+8 会差一天。 */
export function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 周一 00:00（本地）。 */
function mondayOf(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  const dow = (c.getDay() + 6) % 7
  c.setDate(c.getDate() - dow)
  return c
}

function addWeeks(d: Date, n: number): Date {
  const c = new Date(d)
  c.setDate(c.getDate() + n * 7)
  return c
}

/** 两个周一之间相差几周（用日期字段算，夏令时不会挪错一周）。 */
function weeksBetween(from: Date, to: Date): number {
  const a = mondayOf(from).getTime()
  const b = mondayOf(to).getTime()
  return Math.round((b - a) / (7 * 24 * 3600 * 1000))
}

function validTime(iso: string | undefined): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * 学期周窗口：课表首末课所在周；课表为空 → 当前周前后各 8 周。
 * 超过 30 周时以当前周为中心截断，少于 4 周时向后补足。
 */
export function semesterWindow(
  lessons: Lesson[],
  now: Date = new Date(),
): { first: Date; weeks: number } {
  const times: number[] = []
  for (const l of lessons) {
    const s = validTime(l.start)
    const e = validTime(l.end)
    if (s != null) times.push(s)
    if (e != null) times.push(e)
  }

  let first: Date
  let last: Date
  if (times.length === 0) {
    first = addWeeks(mondayOf(now), -8)
    last = addWeeks(mondayOf(now), 8)
  } else {
    first = mondayOf(new Date(Math.min(...times)))
    last = mondayOf(new Date(Math.max(...times)))
  }

  let weeks = Math.max(1, weeksBetween(first, last) + 1)

  if (weeks > MAX_SEMESTER_WEEKS) {
    const nowIdx = weeksBetween(first, now)
    const startIdx = Math.min(
      Math.max(0, nowIdx - Math.floor(MAX_SEMESTER_WEEKS / 2)),
      weeks - MAX_SEMESTER_WEEKS,
    )
    first = addWeeks(first, startIdx)
    weeks = MAX_SEMESTER_WEEKS
  } else if (weeks < MIN_SEMESTER_WEEKS) {
    weeks = MIN_SEMESTER_WEEKS
  }

  return { first, weeks }
}

/**
 * 学期总览。任务按截止日归周；没有截止时间的任务不参与（它不属于任何一周）。
 * 负荷等级相对「本窗口最忙的一周」归一化，所以同一个学期里深浅可比较，
 * 换学期也不会因为绝对课时变少而整条变浅。
 */
export function semesterOverview(
  lessons: Lesson[],
  tasks: Task[],
  now: Date = new Date(),
): SemesterOverview {
  const { first, weeks } = semesterWindow(lessons, now)

  const starts = Array.from({ length: weeks }, (_, i) => addWeeks(first, i))
  const buckets = starts.map((start) => ({
    start,
    lessons: 0,
    tasks: 0,
  }))
  const indexOf = (t: number): number => {
    for (let i = weeks - 1; i >= 0; i--) {
      const s = starts[i].getTime()
      if (t >= s) {
        // 只接受落在本窗口内的时刻
        return i < weeks && t < addWeeks(starts[i], 1).getTime() ? i : -1
      }
    }
    return -1
  }

  for (const l of lessons) {
    const s = validTime(l.start)
    if (s == null) continue
    const i = indexOf(s)
    if (i >= 0) buckets[i].lessons++
  }
  for (const task of tasks) {
    const due = validTime(task.dueAt)
    if (due == null) continue
    const i = indexOf(due)
    if (i >= 0) buckets[i].tasks++
  }

  const maxScore = Math.max(0, ...buckets.map((b) => b.lessons + b.tasks))
  const out: SemesterWeek[] = buckets.map((b) => {
    const score = b.lessons + b.tasks
    const load =
      score === 0 || maxScore === 0
        ? 0
        : Math.min(MAX_LOAD_LEVEL, Math.max(1, Math.ceil((score / maxScore) * MAX_LOAD_LEVEL)))
    return { start: localDayKey(b.start), lessons: b.lessons, tasks: b.tasks, load }
  })

  const currentIndex = (() => {
    const i = weeksBetween(first, now)
    return i >= 0 && i < weeks ? i : -1
  })()

  const windowStart = first.getTime()
  const windowEnd = addWeeks(first, weeks).getTime()
  const progress =
    windowEnd <= windowStart
      ? 0
      : Math.min(1, Math.max(0, (now.getTime() - windowStart) / (windowEnd - windowStart)))

  return { weeks: out, currentIndex, progress }
}
