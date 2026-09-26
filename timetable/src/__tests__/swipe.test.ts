import { describe, expect, it } from 'vitest'
import { SWIPE_MIN_PX, swipeIntent } from '../lib/swipe'

describe('swipeIntent', () => {
  it('ignores movement below the distance threshold', () => {
    expect(swipeIntent(2, SWIPE_MIN_PX - 1, 0)).toBeNull()
    expect(swipeIntent(2, -(SWIPE_MIN_PX - 1), 0)).toBeNull()
  })

  it('ignores gestures that are mostly vertical (page scroll)', () => {
    // 水平位移不足垂直位移的 1.4 倍 → 视为滚动，不翻页
    expect(swipeIntent(2, 100, 100)).toBeNull()
    expect(swipeIntent(2, -60, 200)).toBeNull()
  })

  it('swiping left moves to the next day inside the week', () => {
    expect(swipeIntent(2, -120, 10)).toEqual({ day: 3, weekDelta: 0 })
  })

  it('swiping right moves to the previous day inside the week', () => {
    expect(swipeIntent(3, 120, -10)).toEqual({ day: 2, weekDelta: 0 })
  })

  it('crosses into next week from Sunday (index 6)', () => {
    expect(swipeIntent(6, -90, 5)).toEqual({ day: 0, weekDelta: 1 })
  })

  it('crosses into previous week from Monday (index 0)', () => {
    expect(swipeIntent(0, 90, 5)).toEqual({ day: 6, weekDelta: -1 })
  })

  it('accepts diagonal swipes as long as horizontal dominates', () => {
    // |dx| = 60 > |dy| * 1.4 = 42 → 有效
    expect(swipeIntent(4, -60, 30)).toEqual({ day: 5, weekDelta: 0 })
  })
})
