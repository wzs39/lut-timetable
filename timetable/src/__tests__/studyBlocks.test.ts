// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKUP_KEYS, KEYS } from '../lib/storage'
import {
  confirmStudyBlock,
  loadStudyBlocks,
  planStudyBlocks,
  removeStudyBlock,
  studyBlocksOnDay,
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
})
