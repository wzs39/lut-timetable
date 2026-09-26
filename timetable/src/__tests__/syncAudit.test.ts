// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { Lesson } from '../types'
import {
  appendAudit,
  clearAudits,
  diffLessons,
  firstNotableChange,
  hasNotableChanges,
  loadAudits,
  MAX_AUDITS,
  recentChangeMarks,
  WIDGET_MARK_TTL_MS,
  MAX_CHANGES_PER_AUDIT,
  saveAudits,
  summarizeChanges,
  type SyncAudit,
} from '../lib/syncAudit'
import { KEYS } from '../lib/storage'

// 【审计契约】同步前后两张课表 → 可读的变更明细：
// 新加的课 = added；同一天同一门课换时间 = moved（key 含开始时间，所以时间一改
// key 就变，必须先按 key 比、再把「同日同课 删+加」配对）；字段变化 = room/title；
// 只删不加 = cancelled（课程取消）。状态变化才算，重排顺序不算。

const l = (p: Partial<Lesson> = {}): Lesson => ({
  id: p.id ?? 'x1',
  source: 'sisu',
  code: p.code ?? 'CT60A4050',
  title: p.title ?? 'Software Engineering',
  location: p.location ?? 'R112',
  start: p.start ?? '2026-09-21T08:00:00.000Z',
  end: p.end ?? '2026-09-21T10:00:00.000Z',
  ...p,
})

beforeEach(() => localStorage.clear())

describe('diffLessons', () => {
  it('reports nothing when the timetable is unchanged', () => {
    const week = [l(), l({ id: 'x2', start: '2026-09-22T08:00:00.000Z', end: '2026-09-22T10:00:00.000Z' })]
    expect(diffLessons(week, [...week])).toEqual([])
  })

  it('does not emit a paired move as added as well', () => {
    const before = [l()]
    const after = [l({ start: '2026-09-21T12:00:00.000Z', end: '2026-09-21T14:00:00.000Z' })]
    expect(summarizeChanges(diffLessons(before, after))).toMatchObject({ moved: 1, added: 0, cancelled: 0 })
  })

  it('keeps same-key duplicates apart instead of collapsing them', () => {
    const a = l({ id: 'a', source: 'sisu' })
    const b = l({ id: 'b', source: 'timeedit' })
    // 同代码同时间、不同来源：跨来源重复，key 相同但条目有两条
    expect(diffLessons([a], [a, b]).map((c) => c.kind)).toEqual(['added'])
    expect(diffLessons([a, b], [a]).map((c) => c.kind)).toEqual(['cancelled'])
  })

  it('classifies a brand new lesson as added', () => {
    const next = [l(), l({ id: 'x2', code: 'BM20A9200', start: '2026-09-23T10:00:00.000Z', end: '2026-09-23T12:00:00.000Z' })]
    const changes = diffLessons([l()], next)
    expect(changes.map((c) => c.kind)).toEqual(['added'])
    expect(changes[0].label).toBe('BM20A9200')
  })

  it('pairs a same-day, same-course removal and addition as a time move', () => {
    const before = [l({ start: '2026-09-21T08:00:00.000Z', end: '2026-09-21T10:00:00.000Z' })]
    const after = [l({ start: '2026-09-21T12:00:00.000Z', end: '2026-09-21T14:00:00.000Z' })]
    const changes = diffLessons(before, after)
    expect(summarizeChanges(changes)).toEqual({
      added: 0,
      moved: 1,
      room: 0,
      title: 0,
      cancelled: 0,
    })
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      kind: 'moved',
      label: 'CT60A4050',
      from: '2026-09-21T08:00:00.000Z',
      to: '2026-09-21T12:00:00.000Z',
    })
  })

  it('does not pair moves across different days or courses', () => {
    const before = [l({ start: '2026-09-21T08:00:00.000Z' })]
    // 同门课但换了一天 + 换了一门课 => 一个 cancelled、一个 added
    const after = [
      l({ start: '2026-09-23T08:00:00.000Z' }),
      l({ id: 'y1', code: 'HDD4010', start: '2026-09-21T08:00:00.000Z' }),
    ]
    const s = summarizeChanges(diffLessons(before, after))
    expect(s).toMatchObject({ added: 2, cancelled: 1, moved: 0 })
  })

  it('picks the closest candidate when several additions share the day', () => {
    const before = [l({ start: '2026-09-21T08:00:00.000Z', end: '2026-09-21T10:00:00.000Z' })]
    const after = [
      l({ id: 'far', start: '2026-09-21T18:00:00.000Z', end: '2026-09-21T19:00:00.000Z' }),
      l({ id: 'near', start: '2026-09-21T09:00:00.000Z', end: '2026-09-21T11:00:00.000Z' }),
    ]
    const changes = diffLessons(before, after)
    expect(changes.filter((c) => c.kind === 'moved')).toHaveLength(1)
    expect(changes.find((c) => c.kind === 'moved')?.to).toBe('2026-09-21T09:00:00.000Z')
    expect(changes.filter((c) => c.kind === 'added')).toHaveLength(1)
  })

  it('reports room and title edits on the same lesson', () => {
    const before = [l()]
    const after = [l({ location: 'MC105', title: 'Software Engineering (new name)' })]
    const changes = diffLessons(before, after)
    expect(summarizeChanges(changes)).toMatchObject({ room: 1, title: 1, moved: 0, added: 0 })
    expect(changes.find((c) => c.kind === 'room')).toMatchObject({ before: 'R112', after: 'MC105' })
  })

  it('still reports an unmatched removal as cancelled', () => {
    const changes = diffLessons([l()], [])
    expect(changes).toHaveLength(1)
    expect(changes[0].kind).toBe('cancelled')
  })

  it('marks added/moved/cancelled/room as notable but not a rename', () => {
    expect(hasNotableChanges(diffLessons([l()], [l({ location: 'MC105' })]))).toBe(true)
    expect(hasNotableChanges(diffLessons([l()], [l({ title: 'Renamed' })]))).toBe(false)
    expect(firstNotableChange(diffLessons([l()], [l({ title: 'Renamed' })]))).toBeNull()
  })
})

describe('audit log', () => {
  const audit = (i: number, changes = 1): SyncAudit => ({
    at: `2026-09-2${i}T08:00:00.000Z`,
    sourceId: 's1',
    sourceLabel: 'SISU',
    changes: Array.from({ length: changes }, (_, k) => ({
      kind: 'added' as const,
      key: `k${i}-${k}`,
      label: 'CT60A4050',
    })),
  })

  it('keeps the newest audits first and caps the list', () => {
    let list: SyncAudit[] = []
    for (let i = 0; i < MAX_AUDITS + 3; i++) list = appendAudit(audit(i), list)
    expect(list).toHaveLength(MAX_AUDITS)
    expect(list[0].at).toBe(audit(MAX_AUDITS + 2).at)
  })

  it('caps the changes per audit', () => {
    const [only] = appendAudit(audit(1, MAX_CHANGES_PER_AUDIT + 25), [])
    expect(only.changes).toHaveLength(MAX_CHANGES_PER_AUDIT)
  })

  it('round-trips through storage and clears', () => {
    saveAudits([audit(1), audit(2)])
    expect(loadAudits()).toHaveLength(2)
    expect(JSON.parse(localStorage.getItem(KEYS.syncAudit) ?? '[]')).toHaveLength(2)
    clearAudits()
    expect(loadAudits()).toEqual([])
  })

  it('ignores garbage in storage', () => {
    localStorage.setItem(KEYS.syncAudit, '{not json')
    expect(loadAudits()).toEqual([])
  })
})

describe('recentChangeMarks', () => {
  const at = '2026-09-21T08:00:00.000Z'
  const now = new Date(at).getTime()
  const audit: SyncAudit = {
    at,
    sourceId: 's1',
    sourceLabel: 'SISU',
    changes: [
      { kind: 'moved', key: 'k1', label: 'CT60A0250', from: 'a', to: 'b' },
      { kind: 'room', key: 'k2', label: 'HDD5020', before: 'M19', after: 'MC105' },
      { kind: 'title', key: 'k3', label: 'BM20A9200', before: 'x', after: 'y' },
      { kind: 'added', key: 'k4', label: 'CT60A0250', to: 'c' },
    ],
  }

  it('counts notable kinds only and de-duplicates codes', () => {
    expect(recentChangeMarks([audit], now)).toEqual({ codes: ['CT60A0250', 'HDD5020'], n: 3 })
  })

  it('expires after the TTL and when there is nothing notable', () => {
    expect(recentChangeMarks([audit], now + WIDGET_MARK_TTL_MS + 1)).toBeNull()
    expect(recentChangeMarks([], now)).toBeNull()
    const renameOnly: SyncAudit = {
      ...audit,
      changes: [{ kind: 'title', key: 'k', label: 'X', before: 'a', after: 'b' }],
    }
    expect(recentChangeMarks([renameOnly], now)).toBeNull()
  })
})
