import type { Lesson } from '../types'
import { buildingOf } from './display'

/**
 * 连堂课「赶得上吗」：上一节下课到下一节上课之间的空档，是否够从一个教室
 * 走到另一个教室。
 *
 * 这里**不做路径规划**，只给保守的步行估计：
 * - 同一栋楼：`WALK_SAME_BUILDING_MIN`（找教室的时间，楼里不用跑）
 * - 换楼：`WALK_CROSS_BUILDING_MIN`（LUT 校园楼间距都在这量级）
 * 估计值和空档一起给用户看，判断权留给用户——说成"精确 X 分钟"反而是骗人。
 *
 * 只在空档够短（≤ HOP_MAX_GAP_MIN）时才提示：上午两节中间隔着 2 小时，
 * 那不是"赶得上吗"的问题。
 */

/** 同楼内的步行/找教室时间（分钟） */
export const WALK_SAME_BUILDING_MIN = 3
/** 换楼的步行时间（分钟） */
export const WALK_CROSS_BUILDING_MIN = 6
/** 超过这个空档就不提示（再远也来得及） */
export const HOP_MAX_GAP_MIN = 30
/** 到教室后至少留这么多分钟才不算紧 */
export const HOP_BUFFER_MIN = 5

export interface RoomHop {
  /** 上一节的教室（原样字符串） */
  from: string
  /** 下一节的教室（原样字符串） */
  to: string
  /** 空档（分钟，向下取整） */
  gapMin: number
  /** 步行估计（分钟） */
  walkMin: number
  /** 换楼（教室前缀不同） */
  crossBuilding: boolean
  /** 到教室后剩不到 HOP_BUFFER_MIN 分钟 */
  tight: boolean
}

function minutes(iso: string): number {
  return new Date(iso).getTime() / 60000
}

/**
 * 楼号：LUT 有两种写法——
 * - 带下划线：`M19_AUD1B` → `M19`、`NIE73_B211` → `NIE73`（buildingOf 的语义，直接用）
 * - 纯房间号：`R112` → `R`、`MC105` → `MC`（buildingOf 会把它整个当楼号，
 *   所以这里取字母前缀——否则 R112 与 R113 会被当成两栋楼）
 */
function buildingToken(location: string): string | null {
  if (location.includes('_')) return buildingOf(location)
  const m = location.trim().match(/^([A-Za-z]{1,6})\d+/)
  return m ? m[1] : null
}

/**
 * 两节相邻课之间的「赶课」提示；不需要提示时返回 null：
 * - 有一节没写教室（无从判断）
 * - 教室相同（不用挪）
 * - 两节重叠/并行（不是连堂）
 * - 空档超过 HOP_MAX_GAP_MIN
 */
export function roomHop(prev: Lesson, next: Lesson): RoomHop | null {
  const from = (prev.location ?? '').trim()
  const to = (next.location ?? '').trim()
  if (!from || !to || from === to) return null
  const gap = minutes(next.start) - minutes(prev.end)
  if (gap < 0 || gap > HOP_MAX_GAP_MIN) return null

  const a = buildingToken(from)
  const b = buildingToken(to)
  const crossBuilding = !!a && !!b && a !== b
  // 两边都能识别出楼号时按「同楼/换楼」分档；无法识别就按最坏情况估
  const sameBuilding = !!a && !!b && a === b
  const walkMin = sameBuilding ? WALK_SAME_BUILDING_MIN : WALK_CROSS_BUILDING_MIN

  const gapMin = Math.floor(gap)
  return {
    from,
    to,
    gapMin,
    walkMin,
    crossBuilding,
    tight: gapMin - walkMin < HOP_BUFFER_MIN,
  }
}

/**
 * 一天内每节「上一节课」对应的赶课提示，以**上一节的 id** 为键，
 * 方便列表渲染时挂在那一行下面（同一天内按时间排序为前置条件）。
 */
export function roomHops(lessons: Lesson[]): Map<string, RoomHop> {
  const out = new Map<string, RoomHop>()
  const sorted = [...lessons].sort((x, y) => x.start.localeCompare(y.start))
  for (let i = 0; i < sorted.length - 1; i++) {
    const hop = roomHop(sorted[i], sorted[i + 1])
    if (hop) out.set(sorted[i].id, hop)
  }
  return out
}
