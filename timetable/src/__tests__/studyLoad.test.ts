import { describe, expect, it } from 'vitest'
import { studyLoadSummary } from '../lib/studyLoad'
import type { StudyBlock } from '../lib/studyBlocks'

/**
 * 【概览契约】本周负荷是**只读汇总**：只统计已确认学习块（未确认的建议不参与），
 * 按设备本地日分桶，坏数据/非法日期一律忽略而不是把它算成负荷。
 *
 * 2026-10-12 是周一，所以 fixture 用 `new Date(2026, 9, 12 + offset, …)` 构造本地时刻。
 */

const WEEK_START = new Date(2026, 9, 12, 0, 0, 0, 0)
const NOW = new Date(2026, 9, 14, 12, 0, 0, 0) // 周三中午

const block = (id: string, dayOffset: number, hour: number, minutes: number, over: Partial<StudyBlock> = {}): StudyBlock => {
  const start = new Date(2026, 9, 12 + dayOffset, hour, 0, 0, 0)
  const end = new Date(start.getTime() + minutes * 60_000)
  const due = new Date(start.getTime() + 8 * 3_600_000)
  return {
    id,
    sourceKind: 'task',
    sourceId: id,
    title: `Focus ${id}`,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    dueAt: due.toISOString(),
    createdAt: start.toISOString(),
    ...over,
  }
}

describe('studyLoadSummary', () => {
  it('returns a zeroed seven-day week for empty input', () => {
    const load = studyLoadSummary([], WEEK_START, NOW)
    expect(load).toMatchObject({
      blocks: 0,
      completedBlocks: 0,
      remainingBlocks: 0,
      minutes: 0,
      completedMinutes: 0,
      remainingMinutes: 0,
      overdueBlocks: 0,
    })
    expect(load.days).toHaveLength(7)
    expect(load.days.every((day) => day.blocks === 0 && day.minutes === 0 && day.completed === 0)).toBe(true)
    expect(load.weekStart).toBe(new Date(2026, 9, 12, 0, 0, 0, 0).toISOString())
    expect(load.weekEnd).toBe(new Date(2026, 9, 19, 0, 0, 0, 0).toISOString())
    expect(load.days.map((day) => day.date)).toEqual([
      '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18',
    ])
  })

  it('counts only confirmed blocks inside the local week and splits completed from remaining', () => {
    const load = studyLoadSummary([
      block('mon', 0, 9, 60, { completed: true }),
      block('tue', 1, 14, 90),
      block('next-week', 7, 9, 60),
      block('last-week', -1, 9, 60),
    ], WEEK_START, NOW)

    expect(load.blocks).toBe(2)
    expect(load.completedBlocks).toBe(1)
    expect(load.remainingBlocks).toBe(1)
    expect(load.minutes).toBe(150)
    expect(load.completedMinutes).toBe(60)
    expect(load.remainingMinutes).toBe(90)
    expect(load.days[0]).toMatchObject({ blocks: 1, completed: 1, minutes: 60 })
    expect(load.days[1]).toMatchObject({ blocks: 1, completed: 0, minutes: 90 })
    expect(load.days.slice(2).every((day) => day.blocks === 0 && day.minutes === 0)).toBe(true)
  })

  it('counts only blocks that already started without being completed as overdue', () => {
    const load = studyLoadSummary([
      block('started-unfinished', 0, 9, 60),
      block('started-finished', 0, 8, 60, { completed: true }),
      block('still-upcoming', 3, 9, 60),
    ], WEEK_START, NOW)
    expect(load.overdueBlocks).toBe(1)
  })

  it('buckets by the device local day instead of the UTC date', () => {
    // 本地周一 00:30：在 UTC+8 下它的 UTC 日期是周日，仍必须落在周一桶里。
    const early = block('midnight', 0, 0, 30)
    early.startAt = new Date(2026, 9, 12, 0, 30).toISOString()
    early.endAt = new Date(2026, 9, 12, 1, 0).toISOString()
    const load = studyLoadSummary([early], WEEK_START, NOW)
    expect(load.days[0].blocks).toBe(1)
    expect(load.days[6].blocks).toBe(0)
    expect(load.days[1].blocks).toBe(0)
  })

  it('ignores malformed records and unusable week anchors instead of counting garbage', () => {
    const reversed = block('reversed', 1, 9, 60)
    reversed.endAt = new Date(2026, 9, 13, 8, 0).toISOString()
    const blankTitle = block('blank', 1, 9, 60, { title: '   ' })
    const badStart = block('bad-start', 1, 9, 60, { startAt: 'not-a-date' })
    const load = studyLoadSummary([
      null as unknown as StudyBlock,
      {} as unknown as StudyBlock,
      reversed,
      blankTitle,
      badStart,
      block('good', 2, 9, 45),
    ], WEEK_START, NOW)

    expect(load.blocks).toBe(1)
    expect(load.minutes).toBe(45)
    expect(load.days[1].blocks).toBe(0)

    const unusable = studyLoadSummary([block('good', 2, 9, 45)], new Date('nope'), NOW)
    expect(unusable.blocks).toBe(0)
    expect(unusable.days).toEqual([])
  })

  it('does not see unconfirmed recommendations: the input is the confirmed block list', () => {
    // 纯函数只吃已确认块——未确认建议存在于 hook 内存里，永远进不到这里。
    const withPendingOnly = studyLoadSummary([], WEEK_START, NOW)
    expect(withPendingOnly.blocks).toBe(0)
    expect(withPendingOnly.minutes).toBe(0)
  })
})
