import type { Lesson } from '../types'
import { roomHops } from './roomHop'

/**
 * 「本周提示」：未来 7 天里值得提前知道的几件事。
 *
 * 只做只读推导，不改任何状态。三种信号都来自已有事实：
 * - 连堂换楼却几乎没有空档（复用 roomHop 的保守步行估计）
 * - 一天中间空出很长一段（两小时以上，足以回宿舍/去图书馆）
 * - 单日净课时达到 6 小时（含实验/练习）
 *
 * 刻意限制条数：提示一多就变成噪音，用户会学会无视它。
 */

export const INSIGHT_DAYS = 7
export const LONG_GAP_MIN = 120
export const LONG_DAY_MIN = 6 * 60
export const MAX_INSIGHTS = 3

export type InsightKind = 'tight-hop' | 'long-day' | 'long-gap'

export interface WeekInsight {
  id: string
  kind: InsightKind
  /** 本地日 yyyy-mm-dd */
  day: string
  /** 点击时打开的课（前一个信号取上一节，其余取当天第一节） */
  lessonId: string
  /** 空档 / 当天净课时（分钟） */
  minutes: number
  /** 仅 tight-hop：目标教室 */
  to?: string
  crossBuilding?: boolean
}


/** 严重度：赶不上 > 满课 > 空档 */
const RANK: Record<InsightKind, number> = {
  'tight-hop': 0,
  'long-day': 1,
  'long-gap': 2,
}

function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function timeOf(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : NaN
}

/**
 * 未来 `days` 天（含今天，按设备本地日）内的提示，最多 `MAX_INSIGHTS` 条。
 * 已经过去的时段不再提示；没有课的日子不会生成任何条目。
 */
export function weekInsights(
  lessons: Lesson[],
  now: Date = new Date(),
  days: number = INSIGHT_DAYS,
): WeekInsight[] {
  const dayCount = Math.max(1, Math.floor(days))
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  // 用日期字段向后推，避免夏令时切换时窗口边界差一小时（AGENTS 的本地日算术规则）
  const end = new Date(start)
  end.setDate(end.getDate() + dayCount)
  const endMs = end.getTime()

  const valid = lessons.filter((l) => {
    const s = timeOf(l.start)
    const e = timeOf(l.end)
    return Number.isFinite(s) && Number.isFinite(e) && s >= start.getTime() && s < endMs
  })

  const byDay = new Map<string, Lesson[]>()
  for (const l of valid) {
    const key = localDayKey(new Date(l.start))
    const arr = byDay.get(key) ?? []
    arr.push(l)
    byDay.set(key, arr)
  }

  const out: WeekInsight[] = []
  for (const [day, dayLessons] of byDay) {
    const sorted = [...dayLessons].sort((a, b) => a.start.localeCompare(b.start))

    // 连堂赶不上：roomHop 已经做了「没教室 / 同教室 / 空档太长」的过滤
    const hops = roomHops(sorted)
    for (const [prevId, hop] of hops) {
      if (!hop.tight) continue
      out.push({
        id: `hop:${day}:${prevId}`,
        kind: 'tight-hop',
        day,
        lessonId: prevId,
        minutes: hop.gapMin,
        to: hop.to,
        crossBuilding: hop.crossBuilding,
      })
    }

    // 长空档：只提示还没发生的空档（下一节尚未开始）
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = Math.floor((timeOf(sorted[i + 1].start) - timeOf(sorted[i].end)) / 60_000)
      if (gap < LONG_GAP_MIN) continue
      if (timeOf(sorted[i + 1].start) <= now.getTime()) continue
      out.push({
        id: `gap:${day}:${sorted[i + 1].id}`,
        kind: 'long-gap',
        day,
        lessonId: sorted[i + 1].id,
        minutes: gap,
      })
    }

    // 满课日：只提示还没结束的那天
    let minutes = 0
    for (const l of sorted) minutes += Math.max(0, timeOf(l.end) - timeOf(l.start)) / 60_000
    const dayEnd = Math.max(...sorted.map((l) => timeOf(l.end)))
    if (minutes >= LONG_DAY_MIN && dayEnd > now.getTime()) {
      out.push({
        id: `day:${day}`,
        kind: 'long-day',
        day,
        lessonId: sorted[0].id,
        minutes: Math.round(minutes),
      })
    }
  }

  return out
    .sort(
      (a, b) =>
        RANK[a.kind] - RANK[b.kind] ||
        a.day.localeCompare(b.day) ||
        b.minutes - a.minutes ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_INSIGHTS)
}
