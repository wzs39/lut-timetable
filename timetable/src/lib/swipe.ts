/**
 * 手势判定：把一次触摸位移翻译成「切换日期 / 切换周」的意图。
 *
 * 纯函数（不碰 DOM），便于单测。阈值同时承担防误触职责：纵向滚动时
 * 垂直位移通常远大于水平位移，因此永远达不到 SWIPE_DOMINANCE。
 */

/** 触发翻页所需的最小水平位移（px） */
export const SWIPE_MIN_PX = 48
/** 水平位移必须超过垂直位移的这个倍数，否则视为滚动 */
export const SWIPE_DOMINANCE = 1.4
/** 一周固定 7 天（周一..周日） */
export const SWIPE_DAYS = 7

export interface SwipeIntent {
  /** 目标日索引，0 = 周一 … 6 = 周日 */
  day: number
  /** 0 = 同一周；1 = 下一周；-1 = 上一周 */
  weekDelta: -1 | 0 | 1
}

/**
 * 判定一次滑动：dx/dy 为「结束点 - 起点」的像素位移。
 * 手指向左滑（dx < 0）= 看后一天；向右滑 = 看前一天。
 * 越过周日/周一自动跨周，返回的 day 落在新周内。
 * 返回 null = 不构成翻页手势（距离不足或更像纵向滚动）。
 */
export function swipeIntent(dayIndex: number, dx: number, dy: number): SwipeIntent | null {
  if (Math.abs(dx) < SWIPE_MIN_PX) return null
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_DOMINANCE) return null
  const forward = dx < 0
  const next = forward ? dayIndex + 1 : dayIndex - 1
  if (next < 0) return { day: SWIPE_DAYS - 1, weekDelta: -1 }
  if (next >= SWIPE_DAYS) return { day: 0, weekDelta: 1 }
  return { day: next, weekDelta: 0 }
}
