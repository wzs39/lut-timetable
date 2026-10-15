// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_KEYS, KEYS } from '../lib/storage'
import { DEFAULT_STUDY_BLOCK_PREFS, type StudyBlockPrefs } from '../lib/studyBlockPrefs'
import {
  confirmStudyBlock,
  loadStudyBlocks,
  planStudyBlocks,
  removeStudyBlock,
  setStudyBlockCompleted,
  studyBlocksOnDay,
  subscribeStudyBlocks,
  type StudyBlock,
  type StudyBlockCandidate,
} from '../lib/studyBlocks'

const day = (offset: number, hour: number, minute = 0) => {
  const d = new Date(2026, 8, 14 + offset, hour, minute, 0, 0)
  return d
}
const iso = (offset: number, hour: number, minute = 0) => day(offset, hour, minute).toISOString()
const candidate = (sourceId: string, dueOffset: number, extra: Partial<StudyBlockCandidate> = {}): StudyBlockCandidate => ({
  sourceKind: 'task', sourceId, title: sourceId, dueAt: iso(dueOffset, 20), ...extra,
})
const plan = (over: Partial<Parameters<typeof planStudyBlocks>[0]> = {}) => planStudyBlocks({
  items: [candidate('one', 1)], lessons: [], confirmed: [], now: day(0, 7), ...over,
})

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(day(0, 7))
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('planStudyBlocks', () => {
  it('places a 60-minute block inside the 08:00–22:00 local window and before its deadline', () => {
    const result = plan()
    expect(result.recommendations).toHaveLength(1)
    const block = result.recommendations[0]
    expect(block.startAt).toBe(iso(0, 8))
    expect(block.endAt).toBe(iso(0, 9))
    expect(new Date(block.endAt).getTime() - new Date(block.startAt).getTime()).toBe(60 * 60_000)
    expect(result.unscheduled).toEqual([])
  })

  it('avoids lesson overlap and reserves a 15-minute buffer on both sides', () => {
    const result = plan({
      lessons: [{ start: iso(0, 8, 30), end: iso(0, 9, 30) }],
    })
    expect(result.recommendations[0]).toMatchObject({ startAt: iso(0, 9, 45), endAt: iso(0, 10, 45) })
  })

  it('leaves at least 15 minutes between blocks for separate due items', () => {
    const result = plan({ items: [candidate('a', 1), candidate('b', 1)] })
    expect(result.recommendations).toHaveLength(2)
    expect(new Date(result.recommendations[1].startAt).getTime() - new Date(result.recommendations[0].endAt).getTime()).toBeGreaterThanOrEqual(15 * 60_000)
  })

  it('orders closer deadlines first and keeps input order stable for ties', () => {
    const result = plan({ items: [candidate('later', 3), candidate('second-tie', 1), candidate('first-tie', 1)] })
    expect(result.recommendations.map((r) => r.sourceId)).toEqual(['second-tie', 'first-tie', 'later'])
  })

  it('includes deadlines after 22:00 on the seventh local day when an earlier slot fits', () => {
    const now = new Date(2026, 8, 14, 7)
    const dueAt = new Date(2026, 8, 20, 23, 30).toISOString()
    const result = planStudyBlocks({
      items: [{ ...candidate('late-deadline', 6), dueAt }], lessons: [], confirmed: [], now,
    })
    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0].startAt).toBe(iso(0, 8))
  })

  it('includes Saturday and Sunday in the seven local-day search window', () => {
    const now = new Date(2026, 8, 18, 21, 30) // Friday
    const result = planStudyBlocks({
      items: [{ ...candidate('weekend', 2), dueAt: new Date(2026, 8, 20, 20).toISOString() }], lessons: [], confirmed: [], now,
    })
    expect(new Date(result.recommendations[0].startAt).getDay()).toBe(6)
  })

  it('does not schedule after the deadline or after the current time and preserves the item as unscheduled', () => {
    const beforeWindowDeadline = candidate('too-soon', 0)
    beforeWindowDeadline.dueAt = iso(0, 8, 30)
    const result = plan({ items: [beforeWindowDeadline] })
    expect(result.recommendations).toEqual([])
    expect(result.unscheduled.map((item) => item.sourceId)).toEqual(['too-soon'])
  })

  it('ignores invalid and zero-length lesson intervals', () => {
    const result = plan({ lessons: [
      { start: 'invalid', end: iso(0, 18) },
      { start: iso(0, 8), end: iso(0, 8) },
    ] })
    expect(result.recommendations[0].startAt).toBe(iso(0, 8))
  })

  it('does not recommend a source already represented by a confirmed block', () => {
    const confirmed: StudyBlock[] = [{
      ...candidate('one', 1), id: 'saved', createdAt: iso(0, 7), startAt: iso(0, 10), endAt: iso(0, 11),
    }]
    const result = plan({ confirmed })
    expect(result.recommendations).toEqual([])
    expect(result.unscheduled).toEqual([])
  })

  it('distinguishes identical ids from different source kinds', () => {
    const result = plan({ items: [candidate('same', 1), candidate('same', 1, { sourceKind: 'sisu-plan' })] })
    expect(result.recommendations).toHaveLength(2)
    expect(result.recommendations.map((item) => item.sourceKind)).toEqual(['task', 'sisu-plan'])
  })

  it('rejects malformed due dates without constructing invalid times', () => {
    const bad = { ...candidate('bad', 1), dueAt: 'not-a-date' }
    const result = plan({ items: [bad] })
    expect(result.recommendations).toEqual([])
    expect(result.unscheduled).toEqual([])
  })
})

describe('studyBlocksOnDay', () => {
  const block = (id: string, startOffset: number, hour: number, over: Partial<StudyBlock> = {}): StudyBlock => ({
    ...candidate(id, 3), id, createdAt: iso(0, 7),
    startAt: iso(startOffset, hour), endAt: iso(startOffset, hour + 1), ...over,
  })

  it('keeps only blocks starting on that local day, ordered by start time', () => {
    const blocks = [block('evening', 1, 19), block('morning', 1, 9), block('other-day', 2, 9)]
    expect(studyBlocksOnDay(blocks, day(1, 0)).map((b) => b.id)).toEqual(['morning', 'evening'])
    expect(studyBlocksOnDay(blocks, day(0, 0)).map((b) => b.id)).toEqual([])
  })

  it('matches local-day boundaries instead of UTC dates', () => {
    // 本地 00:30 的块：在 UTC+8 下它的 UTC 日期是前一天，归属仍按本地日判定。
    const midnight = block('midnight', 1, 0, { startAt: iso(1, 0, 30), endAt: iso(1, 1, 30) })
    expect(studyBlocksOnDay([midnight], day(1, 0)).map((b) => b.id)).toEqual(['midnight'])
    expect(studyBlocksOnDay([midnight], day(0, 0))).toEqual([])
  })

  it('keeps input order for equal start times and ignores malformed records', () => {
    const first = block('first', 1, 9)
    const second = block('second', 1, 9)
    const malformed = { id: '', title: 'bad' } as unknown as StudyBlock
    expect(studyBlocksOnDay([first, malformed, second], day(1, 0)).map((b) => b.id)).toEqual(['first', 'second'])
  })

  it('returns an empty list for an unusable day', () => {
    expect(studyBlocksOnDay([block('one', 1, 9)], new Date('nope'))).toEqual([])
  })
})

// 偏好只影响排程参数：不传 prefs 时必须与 Phase 1 的行为逐字节一致。
describe('planStudyBlocks with user preferences', () => {
  const withPrefs = (over: Partial<StudyBlockPrefs>): StudyBlockPrefs => ({ ...DEFAULT_STUDY_BLOCK_PREFS, ...over })

  it('honours a narrower window, a longer block and no buffer', () => {
    const result = planStudyBlocks({
      items: [candidate('one', 1)], lessons: [], confirmed: [], now: day(0, 7),
      prefs: withPrefs({ dayStartHour: 12, dayEndHour: 16, blockMinutes: 120, bufferMinutes: 0 }),
    })
    expect(result.recommendations[0]).toMatchObject({ startAt: iso(0, 12), endAt: iso(0, 14) })
  })

  it('places shorter blocks on the 15-minute grid', () => {
    const result = planStudyBlocks({
      items: [candidate('one', 1)], lessons: [], confirmed: [], now: day(0, 7),
      prefs: withPrefs({ blockMinutes: 30 }),
    })
    expect(result.recommendations[0]).toMatchObject({ startAt: iso(0, 8), endAt: iso(0, 8, 30) })
  })

  it('skips weekends only when the student asks for it', () => {
    const now = new Date(2026, 8, 18, 21, 30) // 周五 21:30：当天已经放不下 60 分钟块
    const dueAt = new Date(2026, 8, 21, 20).toISOString()
    const item = { ...candidate('weekend', 3), dueAt }

    const defaultPrefs = planStudyBlocks({ items: [item], lessons: [], confirmed: [], now })
    expect(new Date(defaultPrefs.recommendations[0].startAt).getDay()).toBe(6) // 周六

    const skipped = planStudyBlocks({
      items: [item], lessons: [], confirmed: [], now, prefs: withPrefs({ skipWeekends: true }),
    })
    expect(skipped.recommendations[0].startAt).toBe(iso(7, 8)) // 2026-09-21 周一 08:00
  })

  it('uses a longer horizon when the deadline is further out', () => {
    const now = new Date(2026, 8, 14, 7)
    const item = { ...candidate('far', 9), dueAt: new Date(2026, 8, 23, 20).toISOString() }

    expect(planStudyBlocks({ items: [item], lessons: [], confirmed: [], now }).recommendations).toEqual([])
    const longer = planStudyBlocks({
      items: [item], lessons: [], confirmed: [], now, prefs: withPrefs({ horizonDays: 14 }),
    })
    expect(longer.recommendations).toHaveLength(1)
  })
})

describe('StudyBlock persistence', () => {
  it('registers the independent local key in backup storage and defaults to an empty list', () => {
    expect(KEYS.studyBlocks).toBe('tt_study_blocks_v1')
    expect(BACKUP_KEYS).toContain(KEYS.studyBlocks)
    expect(loadStudyBlocks()).toEqual([])
  })

  it('validates records, confirms once per source, survives reload and deletes by block id', () => {
    const recommendation = plan().recommendations[0]
    const first = confirmStudyBlock(recommendation, iso(0, 7))
    const duplicate = confirmStudyBlock(recommendation, iso(0, 7))
    expect(first.id).toBeTruthy()
    expect(duplicate.id).toBe(first.id)
    expect(loadStudyBlocks()).toEqual([first])
    localStorage.setItem(KEYS.studyBlocks, JSON.stringify([{ id: '', title: 'bad' }, first]))
    expect(loadStudyBlocks()).toEqual([first])
    expect(removeStudyBlock(first.id)).toEqual([])
    expect(loadStudyBlocks()).toEqual([])
  })

  it('accepts legacy records that predate the completion field', () => {
    const legacy = { ...plan().recommendations[0], id: 'legacy', createdAt: iso(0, 7) }
    localStorage.setItem(KEYS.studyBlocks, JSON.stringify([legacy]))
    expect(loadStudyBlocks()).toHaveLength(1)
    expect(loadStudyBlocks()[0].completed).toBeUndefined()
  })
})

// 完成状态属于学习块自己：只写学习块键，不碰来源任务/SISU 计划项，也不碰 Moodle。
describe('StudyBlock completion', () => {
  it('persists completion on the block itself and survives a reload without touching other blocks', () => {
    localStorage.setItem(KEYS.tasks, JSON.stringify([{ id: 'task-a', completed: false }]))
    localStorage.setItem(KEYS.sisuStudyPlan, JSON.stringify({ goalCredits: 180, items: [{ id: 'plan-a', completed: false }] }))
    const tasksBefore = localStorage.getItem(KEYS.tasks)
    const planBefore = localStorage.getItem(KEYS.sisuStudyPlan)
    const first = confirmStudyBlock(plan().recommendations[0], iso(0, 7))
    const second = confirmStudyBlock(plan({ items: [candidate('two', 2)] }).recommendations[0], iso(0, 7))

    const next = setStudyBlockCompleted(first.id, true)

    expect(next.map((item) => [item.id, item.completed === true])).toEqual([[first.id, true], [second.id, false]])
    expect(loadStudyBlocks().map((item) => [item.id, item.completed === true])).toEqual([[first.id, true], [second.id, false]])
    // 落盘的 JSON 里真的带上了这个字段，而不是只在内存里改了一下
    const stored = JSON.parse(localStorage.getItem(KEYS.studyBlocks) ?? '[]')
    expect(stored.find((item: StudyBlock) => item.id === first.id).completed).toBe(true)
    expect(stored.find((item: StudyBlock) => item.id === second.id).completed).toBeUndefined()
    // 来源数据（任务 / SISU 计划）逐字节未动
    expect(localStorage.getItem(KEYS.tasks)).toBe(tasksBefore)
    expect(localStorage.getItem(KEYS.sisuStudyPlan)).toBe(planBefore)

    // 取消完成后重载仍保留「未完成」
    setStudyBlockCompleted(first.id, false)
    expect(loadStudyBlocks().find((item) => item.id === first.id)?.completed).toBe(false)
  })

  it('ignores an unknown block id and announces the change to subscribers', () => {
    const block = confirmStudyBlock(plan().recommendations[0], iso(0, 7))
    const listener = vi.fn()
    const unsubscribe = subscribeStudyBlocks(listener)

    const unchanged = setStudyBlockCompleted('missing-id', true)
    expect(unchanged).toEqual([block])
    expect(listener).not.toHaveBeenCalled()

    setStudyBlockCompleted(block.id, true)
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    setStudyBlockCompleted(block.id, false)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
