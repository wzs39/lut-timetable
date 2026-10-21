import { describe, expect, it } from 'vitest'
import { DEFAULT_STUDY_BLOCK_PREFS, normalizeStudyBlockPrefs } from '../lib/studyBlockPrefs'
import {
  suggestStudyWindows,
  suggestionsToOverrides,
  type StudyWindowSuggestion,
} from '../lib/studyWindowSuggestions'

/**
 * 推导只吃传入的课表：日期从「当前周的某一天」构造，避免手写日期字面量
 * 过了几周就变红（本仓既有学费）。0 = 周日，与 `Date#getDay()` 一致。
 */
function dayOf(weekday: number, weekOffset = 0): Date {
  const base = new Date()
  base.setHours(0, 0, 0, 0)
  const monday = (base.getDay() + 6) % 7
  base.setDate(base.getDate() - monday + ((weekday + 6) % 7) + weekOffset * 7)
  return base
}

function at(weekday: number, hour: number, minute = 0, weekOffset = 0): string {
  const day = dayOf(weekday, weekOffset)
  day.setHours(hour, minute, 0, 0)
  return day.toISOString()
}

const lesson = (start: string, end: string) => ({ start, end })

const suggestionOn = (rows: StudyWindowSuggestion[], weekday: number) =>
  rows.find((row) => row.weekday === weekday)!

describe('suggestStudyWindows', () => {
  it('picks the widest free gap and keeps it inside the daily window', () => {
    // 周一 10–12、14–16：默认 15 分钟缓冲 → 最宽空档是下课后 16:15–22:00
    const rows = suggestStudyWindows([
      lesson(at(1, 10), at(1, 12)),
      lesson(at(1, 14), at(1, 16)),
    ])
    expect(suggestionOn(rows, 1)).toEqual({
      weekday: 1,
      window: { startHour: 17, endHour: 22 },
      reason: 'ok',
      busyBlocks: 2,
    })
  })

  it('rounds inward to whole hours so a lesson never falls inside the window', () => {
    const rows = suggestStudyWindows([lesson(at(1, 12), at(1, 14))])
    const monday = suggestionOn(rows, 1)
    // 下午空档从 14:15 开始 → 上取到 15:00；结束仍是 22:00
    expect(monday.window).toEqual({ startHour: 15, endHour: 22 })
  })

  it('gives a weekday without lessons the full daily window', () => {
    const rows = suggestStudyWindows([])
    expect(rows).toHaveLength(7)
    for (const row of rows) {
      expect(row.window).toEqual({ startHour: 8, endHour: 22 })
      expect(row.reason).toBe('ok')
      expect(row.busyBlocks).toBe(0)
    }
    // 固定 周一 → 周日 的显示顺序
    expect(rows.map((row) => row.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0])
  })

  it('merges the same weekly lesson across weeks and ignores other weekdays', () => {
    const rows = suggestStudyWindows([
      lesson(at(1, 10, 0, 0), at(1, 12, 0, 0)),
      lesson(at(1, 10, 0, 1), at(1, 12, 0, 1)),
      lesson(at(3, 9), at(3, 11)),
    ])
    expect(suggestionOn(rows, 1)).toMatchObject({ busyBlocks: 1, window: { startHour: 13, endHour: 22 } })
    // 周三的课不影响周一
    expect(suggestionOn(rows, 2).window).toEqual({ startHour: 8, endHour: 22 })
  })

  it('reports no-gap when classes fill the day', () => {
    const rows = suggestStudyWindows([
      lesson(at(1, 8), at(1, 12)),
      lesson(at(1, 12), at(1, 16)),
      lesson(at(1, 16), at(1, 22)),
    ])
    expect(suggestionOn(rows, 1)).toMatchObject({ window: null, reason: 'no-gap', busyBlocks: 1 })
  })

  it('rejects a gap too small for one block plus its buffer', () => {
    // 12:00–14:00 的空档扣掉两侧 15 分钟缓冲后不足一小时
    const rows = suggestStudyWindows([
      lesson(at(1, 8), at(1, 12)),
      lesson(at(1, 14), at(1, 22)),
    ])
    expect(suggestionOn(rows, 1)).toMatchObject({ window: null, reason: 'no-gap' })
  })

  it('respects a per-day window override when choosing the gap', () => {
    const prefs = normalizeStudyBlockPrefs({
      ...DEFAULT_STUDY_BLOCK_PREFS,
      dayOverrides: { 1: { startHour: 16, endHour: 22 } },
    })
    const rows = suggestStudyWindows([lesson(at(1, 18), at(1, 19))], prefs)
    // 空档只在 16:00–22:00 里找：19:15→22:00 取整成 20:00–22:00
    expect(suggestionOn(rows, 1).window).toEqual({ startHour: 20, endHour: 22 })
    // 未覆盖的日子仍用全局窗口
    expect(suggestionOn(rows, 2).window).toEqual({ startHour: 8, endHour: 22 })
  })

  it('marks switched-off weekdays and skipped weekends as off', () => {
    const prefs = normalizeStudyBlockPrefs({
      ...DEFAULT_STUDY_BLOCK_PREFS,
      skipWeekends: true,
      dayOverrides: { 1: { off: true } },
    })
    const rows = suggestStudyWindows([], prefs)
    expect(suggestionOn(rows, 1)).toMatchObject({ window: null, reason: 'off' })
    expect(suggestionOn(rows, 6)).toMatchObject({ window: null, reason: 'off' })
    expect(suggestionOn(rows, 0)).toMatchObject({ window: null, reason: 'off' })
    expect(suggestionOn(rows, 2).window).toEqual({ startHour: 8, endHour: 22 })
  })

  it('ignores invalid, reversed and zero-length lessons instead of inventing busy time', () => {
    const rows = suggestStudyWindows([
      { start: 'not a date', end: 'not a date' },
      lesson(at(1, 12), at(1, 10)),
      lesson(at(1, 12), at(1, 12)),
      null as unknown as { start: string; end: string },
    ])
    expect(suggestionOn(rows, 1)).toMatchObject({ busyBlocks: 0, window: { startHour: 8, endHour: 22 } })
  })

  it('counts a lesson running past midnight as busy until the end of its start day', () => {
    const rows = suggestStudyWindows([
      lesson(at(1, 8), at(1, 10)),
      lesson(at(1, 22), at(2, 2)),
    ])
    // 22:00 的课跨到次日；15 分钟缓冲把当天空档截到 21:45 → 取整 21:00
    expect(suggestionOn(rows, 1)).toMatchObject({
      busyBlocks: 2,
      window: { startHour: 11, endHour: 21 },
    })
  })
})

describe('suggestionsToOverrides', () => {
  const row = (weekday: number, window: { startHour: number; endHour: number } | null): StudyWindowSuggestion => ({
    weekday: weekday as StudyWindowSuggestion['weekday'],
    window,
    reason: window ? 'ok' : 'no-gap',
    busyBlocks: 0,
  })

  it('writes only the days whose window differs from the daily window', () => {
    const overrides = suggestionsToOverrides([
      row(1, { startHour: 8, endHour: 22 }),
      row(2, { startHour: 13, endHour: 22 }),
    ])
    expect(overrides).toEqual({ 2: { startHour: 13, endHour: 22 } })
  })

  it('turns a day without a free slot into an explicit off entry', () => {
    expect(suggestionsToOverrides([row(3, null)])).toEqual({ 3: { off: true } })
  })

  it('leaves skipped weekends out instead of storing stale off entries', () => {
    const prefs = normalizeStudyBlockPrefs({ ...DEFAULT_STUDY_BLOCK_PREFS, skipWeekends: true })
    const overrides = suggestionsToOverrides([row(6, null), row(0, null), row(5, null)], prefs)
    expect(overrides).toEqual({ 5: { off: true } })
    // 关掉「跳过周末」后周末回到继承的全局窗口，而不是被残留的 off 钉死
    const relaxed = normalizeStudyBlockPrefs({ ...prefs, skipWeekends: false, dayOverrides: overrides })
    expect(relaxed.dayOverrides[6]).toBeUndefined()
    expect(relaxed.dayOverrides[0]).toBeUndefined()
  })

  it('replaces the whole per-day map so a day that matches the daily window clears its old override', () => {
    const prefs = normalizeStudyBlockPrefs({
      ...DEFAULT_STUDY_BLOCK_PREFS,
      dayOverrides: { 1: { startHour: 12, endHour: 18 } },
    })
    const overrides = suggestionsToOverrides([row(1, { startHour: 8, endHour: 22 })], prefs)
    expect(overrides).toEqual({})
  })
})
