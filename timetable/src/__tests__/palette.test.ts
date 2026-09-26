import { describe, expect, it } from 'vitest'
import {
  PALETTE_BROWSE_LIMIT,
  PALETTE_GROUP_ORDER,
  buildPalette,
  filterPalette,
  scoreItem,
  type PaletteItem,
} from '../lib/palette'
import type { Lesson } from '../types'
import type { Task } from '../lib/tasks'

/** 测试用翻译桩：只覆盖面板用到的键，其余原样返回键名 */
function makeT(): (key: string, params?: Record<string, string | number>) => string {
  const dict: Record<string, string> = {
    viewToday: '今日',
    viewWeek: '本周课表',
    assignNav: '作业',
    moodleNav: 'Moodle',
    thisWeek: '本周',
    prevWeek: '上一周',
    nextWeek: '下一周',
    settingsTitle: '设置',
    paletteSyncAll: '同步全部来源',
    batchButton: '批量筛选',
    conflictsButton: '冲突检查',
    exportData: '导出数据',
    exportIcs: '导出日历 (.ics)',
    updateCheck: '检查更新',
    obReplay: '重新打开引导',
  }
  return (key, params) => {
    if (key === 'dupButton') return `重复项 ${params?.n ?? ''}`.trim()
    return dict[key] ?? key
  }
}

function lesson(p: Partial<Lesson>): Lesson {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    source: 'sisu',
    title: p.title ?? 'Software Engineering',
    code: p.code,
    start: p.start ?? '2026-09-21T08:00:00.000Z',
    end: p.end ?? '2026-09-21T10:00:00.000Z',
    ...p,
  }
}

function task(p: Partial<Task>): Task {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    title: p.title ?? 'Exercise 1',
    completed: p.completed ?? false,
    createdAt: p.createdAt ?? '2026-09-01T00:00:00.000Z',
    updatedAt: p.updatedAt ?? '2026-09-01T00:00:00.000Z',
    ...p,
  }
}

/** 动作组里的 id 顺序（用于断言插入位置，不依赖魔法下标） */
const actionIds = (items: PaletteItem[]) =>
  items.filter((i) => i.group === 'actions').map((i) => i.id)

const build = (over: Partial<Parameters<typeof buildPalette>[0]> = {}) =>
  buildPalette({
    t: makeT(),
    locale: 'en-US',
    lessons: [
      lesson({ id: 'l1', code: 'CT60A4050', title: 'Software Engineering' }),
      lesson({ id: 'l2', code: 'CT60A4050', title: 'Software Engineering' }),
      lesson({ id: 'l3', code: 'HDD4010', title: 'Engineering Mathematics I' }),
      lesson({ id: 'l4', title: 'Free-form lesson without code' }),
    ],
    tasks: [
      task({ id: 't1', title: 'Essay deadline', course: 'HDD4010', dueAt: '2026-10-01T12:00:00.000Z' }),
      task({ id: 't2', title: 'Quiz 2', completed: true }),
    ],
    dupCount: 0,
    ...over,
  })

const labelsOf = (items: PaletteItem[]) => items.map((i) => i.label)

describe('buildPalette', () => {
  it('offers views, actions, deduped courses and pending tasks', () => {
    const items = build()
    const groups = new Set(items.map((i) => i.group))
    expect(groups).toEqual(new Set(['views', 'actions', 'courses', 'tasks']))
    // 课程按代码去重（两条 CT60A4050 合成一条）
    const courses = items.filter((i) => i.group === 'courses')
    expect(labelsOf(courses).sort()).toEqual(
      ['CT60A4050', 'Free-form lesson without code', 'HDD4010'].sort(),
    )
    // 已完成任务不进面板
    expect(labelsOf(items.filter((i) => i.group === 'tasks'))).toEqual(['Essay deadline'])
    // 无代码的手动课：code 留空 + 带上 title（App 回退到标题跳转）
    const manual = items.find((i) => i.label === 'Free-form lesson without code')
    expect(manual?.action).toEqual({
      kind: 'course',
      code: '',
      title: 'Free-form lesson without code',
    })
  })

  it('keeps course code as label and course title as secondary text', () => {
    const course = build().find((i) => i.group === 'courses' && i.label === 'HDD4010')
    expect(course?.sub).toBe('Engineering Mathematics I')
    expect(course?.action).toEqual({
      kind: 'course',
      code: 'HDD4010',
      title: 'Engineering Mathematics I',
    })
  })

  it('shows the duplicate-cleanup action only when duplicates exist', () => {
    expect(build().some((i) => i.action.kind === 'dupes')).toBe(false)
    const withDupes = build({ dupCount: 3 })
    const dupes = withDupes.find((i) => i.action.kind === 'dupes')
    expect(dupes?.label).toBe('重复项 3')
  })
})

describe('filterPalette', () => {
  it('caps courses and tasks when browsing without a query', () => {
    const many = build({
      lessons: Array.from({ length: 12 }, (_, i) =>
        lesson({ id: `c${i}`, code: `CODE${i}`, title: `Course ${i}` }),
      ),
      tasks: Array.from({ length: 12 }, (_, i) => task({ id: `k${i}`, title: `Task ${i}` })),
    })
    const out = filterPalette(many, '')
    expect(out.filter((i) => i.group === 'courses').length).toBe(PALETTE_BROWSE_LIMIT)
    expect(out.filter((i) => i.group === 'tasks').length).toBe(PALETTE_BROWSE_LIMIT)
    // 视图与操作不截断
    expect(out.filter((i) => i.group === 'views').length).toBeGreaterThan(3)
  })

  it('finds courses by code, by title and case-insensitively', () => {
    const items = build()
    expect(labelsOf(filterPalette(items, 'ct60'))).toContain('CT60A4050')
    expect(labelsOf(filterPalette(items, 'mathematics'))).toContain('HDD4010')
    expect(filterPalette(items, 'MATH')).toHaveLength(1)
  })

  it('finds actions and views by their labels', () => {
    const items = build()
    expect(filterPalette(items, 'moodle').map((i) => i.action.kind)).toContain('view')
    expect(filterPalette(items, '检查更新').map((i) => i.action.kind)).toEqual(['checkUpdate'])
  })

  it('requires every token to match (AND search)', () => {
    const items = build()
    expect(filterPalette(items, 'ct60 zzz')).toHaveLength(0)
    expect(filterPalette(items, 'essay hdd')).toHaveLength(1)
  })

  it('keeps the fixed group order in results', () => {
    const items = build()
    const groups = filterPalette(items, 'e').map((i) => PALETTE_GROUP_ORDER.indexOf(i.group))
    expect([...groups].sort((a, b) => a - b)).toEqual(groups)
  })

  it('returns nothing for a query that matches nothing', () => {
    expect(filterPalette(build(), 'zzzzz')).toHaveLength(0)
  })
})

describe('scoreItem', () => {
  it('ranks a label prefix above a secondary-text hit', () => {
    const items = build()
    const prefix = scoreItem(
      items.find((i) => i.label === 'CT60A4050')!,
      'ct60',
    )
    const secondary = scoreItem(
      items.find((i) => i.label === 'HDD4010')!,
      'mathematics',
    )
    expect(prefix).not.toBeNull()
    expect(secondary).not.toBeNull()
    expect(prefix!).toBeGreaterThan(secondary!)
  })

  it('returns null when a token is missing', () => {
    const item = build().find((i) => i.group === 'courses')!
    expect(scoreItem(item, 'zzz')).toBeNull()
  })
})

describe('export actions', () => {
  // 导出 .ics 之前在面板里只是「声明了 action 但没有条目」的死类型，
  // 手机上只能翻 设置 → 数据备份；这个测试锁住它能被搜到。
  it('exposes both export actions, with duplicates inserted before them', () => {
    const ids = actionIds(build({ dupCount: 0 }))
    expect(ids).toContain('act:exportBackup')
    expect(ids).toContain('act:exportIcs')

    const withDups = actionIds(build({ dupCount: 3 }))
    expect(withDups.indexOf('act:dupes')).toBeLessThan(withDups.indexOf('act:exportBackup'))
    expect(withDups).toHaveLength(ids.length + 1)
  })

  it('finds the .ics export by searching for it', () => {
    const hits = filterPalette(build(), '导出日历')
    expect(hits.some((h) => h.id === 'act:exportIcs')).toBe(true)
  })
})
