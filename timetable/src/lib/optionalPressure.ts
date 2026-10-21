import type { Lesson } from '../types'
import type { CourseOffering } from './sisuCourseFacts'

/**
 * 候选课的开课窗口 vs 已订阅课表：这个窗口还塞不塞得下一门新课。
 *
 * 为什么单独成文件：推荐引擎（`optionalCourses`）原来只看学分与周工作量，
 * 完全不知道学生某一学期的课表已经被排到什么程度。真实数据里 2026 学年
 * P1–P2 的工作日 8–18 点几乎全满（一周 28 节课，且现计划内部已经互相撞），
 * 这时候"周负荷还有余量"是假象——课时根本插不进去。
 *
 * 口径：把一周拆成「工作日 × 整点」的格子（周一到周五 8:00–18:00，共 50 个），
 * 窗口内出现过的课时把它覆盖的格子标记为占用。空档比例决定结论。
 */

export const WORKDAY_START_HOUR = 8
export const WORKDAY_END_HOUR = 18
export const TIMETABLE_WEEKDAYS = [1, 2, 3, 4, 5] as const

export const WEEKLY_SLOT_COUNT =
  TIMETABLE_WEEKDAYS.length * (WORKDAY_END_HOUR - WORKDAY_START_HOUR)

export type WindowPressureStatus = 'no-data' | 'roomy' | 'tight' | 'full'

export interface WindowPressure {
  window: { start: string; end: string }
  /** 窗口内已排课时数（含跨小时的课按整点展开前的原始条数）。 */
  lessons: number
  /** 被占用的「工作日 × 整点」格子数（平行分组不计入，见 `parallelGroups`）。 */
  occupiedSlots: number
  /** 同一范围内仍然空着的格子数。 */
  freeSlots: number
  status: WindowPressureStatus
  /** 平行分组数：同一门课同一周同一学时类型给出多个时段，学生只选其一。 */
  parallelGroups: number
  /** 连一个空档时段都挑不到的平行分组数——这类组必然撞课。 */
  parallelBlocked: number
}

/**
 * 窗口内至少要有这么多条已排课时，格子统计才可信。真实数据里 2027 年春季
 * 只发布了 1 条考试记录——按它算会得出「50 格全空」，那是没发布，不是有空。
 */
export const MIN_TIMETABLE_SAMPLE = 5

/**
 * 全年在线课（如 "Online teaching 2026-08-01 – 2027-07-31"）没有固定周课表，
 * 把整学年的课时压进一个窗口必然算出「全满」。跨度超过一学年就按无数据处理。
 */
export const ROLLING_WINDOW_DAYS = 200

/** 排序用权重：证有空档最好，没数据次之，拥挤/全满依次降权。 */
export const PRESSURE_SCORE: Record<WindowPressureStatus, number> = {
  roomy: 0,
  'no-data': -2,
  tight: -6,
  full: -12,
}

function slotKey(weekday: number, hour: number): string {
  return `${weekday}-${hour}`
}

function inWindow(iso: string, start: string, end: string): boolean {
  return iso >= start && iso <= end
}

/** 周一所在日期，用来把课时归到同一周（全程按本地时间，避免 UTC/本地差一天）。 */
function localWeekKey(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const day = monday.getDay() || 7
  monday.setDate(monday.getDate() + 1 - day)
  return `${monday.getFullYear()}-${monday.getMonth()}-${monday.getDate()}`
}

/** 一组里至少要有这么多个时段，才说明它们是「平行可选」而不是都要出席。 */
export const PICK_ONE_MIN_SLOTS = 2

/**
 * 平行分组：一门课在同一周、同一学时类型下给出多个时段，学生只注册其中一个。
 *
 * LUT 的 tutorial / exercise / seminar 就是这个报名模式。真实案例：
 * CT60A0250 一周给出 10 个 tutorial 时段（Tue 12-14、Tue 14-16、Wed 8-10、
 * …、Fri 14-16），学生只去一节。把它们当 10 节都必到，会把明明空着 30 格的
 * 课表算成「只剩 2 格」。
 *
 * `lecture` 不参与分组：HDD4010 这类密集课一周两次 lecture 都要出席，
 * 误判成选一反而会低估占用。宁可保守。
 */
export function findParallelGroups(
  lessons: readonly Lesson[],
  start: string,
  end: string,
): Map<string, Lesson[]> {
  const buckets = new Map<string, Lesson[]>()
  for (const lesson of lessons) {
    if (!lesson?.start || !inWindow(lesson.start, start, end)) continue
    if (lesson.type === 'lecture') continue
    const from = new Date(lesson.start)
    if (Number.isNaN(from.getTime())) continue
    const key = `${lesson.code ?? lesson.title}|${lesson.type ?? 'other'}|${localWeekKey(from)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(lesson)
    else buckets.set(key, [lesson])
  }
  for (const [key, list] of buckets) {
    if (list.length < PICK_ONE_MIN_SLOTS) buckets.delete(key)
  }
  return buckets
}

/** 一条课时覆盖的格子（越界部分按工作时段裁剪）。 */
function lessonSlots(lesson: Lesson): string[] {
  const from = new Date(lesson.start)
  const to = new Date(lesson.end)
  const weekday = from.getDay()
  if (!TIMETABLE_WEEKDAYS.includes(weekday as 1 | 2 | 3 | 4 | 5)) return []
  const out: string[] = []
  const firstHour = Math.max(from.getHours(), WORKDAY_START_HOUR)
  const lastHour = Math.min(to.getHours(), WORKDAY_END_HOUR)
  for (let hour = firstHour; hour < lastHour; hour++) {
    if (hour >= WORKDAY_START_HOUR && hour < WORKDAY_END_HOUR) out.push(slotKey(weekday, hour))
  }
  return out
}

/**
 * 一个开课窗口内的课表拥挤程度。
 *
 * `lessons` 为空（课表还没发布或未订阅）一律 `no-data`：这与「有空」不是
 * 一回事，UI 必须把它显示成待确认，而不是当成可以放心选。
 */
export function windowPressure(
  lessons: readonly Lesson[],
  start: string,
  end: string,
): WindowPressure {
  const groups = findParallelGroups(lessons, start, end)
  const pickOne = new Set<Lesson>()
  for (const list of groups.values()) for (const lesson of list) pickOne.add(lesson)

  const occupied = new Set<string>()
  let count = 0
  let hasWeekdaySlots = false
  for (const lesson of lessons) {
    if (!lesson?.start || !inWindow(lesson.start, start, end)) continue
    count++
    const from = new Date(lesson.start)
    const to = new Date(lesson.end)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) continue
    const slots = lessonSlots(lesson)
    // 平行分组也会落在工作日格子上——它们是可挪的，但存在本身就是排课证据。
    if (slots.length > 0) hasWeekdaySlots = true
    // 平行分组的时段学生只会去其中一个，它落在哪格是可以挑的——先不占格。
    if (pickOne.has(lesson)) continue
    for (const slot of slots) occupied.add(slot)
  }

  // 平行分组反过来要能塞下：组内只剩「至少还有一个时段完全落在空档」才算不冲突。
  let parallelBlocked = 0
  for (const list of groups.values()) {
    const fits = list.some((lesson) => lessonSlots(lesson).every((slot) => !occupied.has(slot)))
    if (!fits) parallelBlocked++
  }

  const freeSlots = WEEKLY_SLOT_COUNT - occupied.size
  const ratio = freeSlots / WEEKLY_SLOT_COUNT
  const spanDays = (Date.parse(end) - Date.parse(start)) / 86_400_000
  // 三种情况都算「判断不了」，不能当成空档放行：
  // ① 窗口内没有课（课表未发布）；② 一条工作日课时都没排（课表只有周末/晚间）；
  // ③ 样本太少或窗口是全年在线课——格子统计没有代表性。
  // 注意 ② 不能用「被占格子为 0」来判断：平行分组不占格，但它们本身就是排课证据。
  const unverifiable =
    !hasWeekdaySlots || count < MIN_TIMETABLE_SAMPLE ||
    !Number.isFinite(spanDays) || spanDays > ROLLING_WINDOW_DAYS
  const status: WindowPressureStatus =
    unverifiable ? 'no-data' : ratio <= 0.15 ? 'full' : ratio < 0.4 ? 'tight' : 'roomy'

  return {
    window: { start, end },
    lessons: count,
    occupiedSlots: occupied.size,
    freeSlots,
    status,
    parallelGroups: groups.size,
    parallelBlocked,
  }
}

/**
 * 一门课通常有多个开课窗口（含暑期）。学生能挑，所以推荐时按「最宽松的那个」
 * 判断能不能放下——真实案例：Basics of Linux 的 P1–P2 窗口已全满，但暑期窗口
 * 是空的，结论必须是「挪到暑假」而不是「别选」。
 */
export function bestOfferingPressure(
  lessons: readonly Lesson[],
  offerings: readonly CourseOffering[],
): WindowPressure | undefined {
  const usable = offerings.filter((offering) => offering.startDate && offering.endDate)
  if (usable.length === 0) return undefined
  return usable
    .map((offering) => windowPressure(lessons, offering.startDate, offering.endDate))
    .sort((a, b) =>
      PRESSURE_SCORE[b.status] - PRESSURE_SCORE[a.status] ||
      b.freeSlots - a.freeSlots ||
      a.window.start.localeCompare(b.window.start),
    )[0]
}
