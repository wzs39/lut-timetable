import { describe, expect, it } from 'vitest'
import {
  applyActivityDatesToTasks,
  datesFromTasks,
  mergeActivityDates,
  parseModuleDates,
  type ActivityDatesByCmid,
} from '../lib/activityDates'
import type { Task } from '../lib/tasks'

/**
 * 【活动日期契约】活动自己声明的开始/截止是唯一真相：assign 元数据与内容树
 * 模块 `dates[]` 合成 cmid 键控的映射，套用到同步任务上时只覆盖有值的字段。
 * 模块 dates 的 label 被站点语言翻译，所以解析只看时间戳先后。
 */

const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  title: id,
  completed: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...patch,
})

const iso = (y: number, m: number, d: number, h = 12): string => new Date(y, m - 1, d, h, 0, 0, 0).toISOString()

describe('parseModuleDates', () => {
  it('treats a single module date as the deadline (labels are site-localised)', () => {
    expect(parseModuleDates([{ timestamp: 1_793_000_000 }])).toEqual({
      dueAt: new Date(1_793_000_000 * 1000).toISOString(),
    })
  })

  it('uses the earliest timestamp as the opening and the latest as the deadline', () => {
    const parsed = parseModuleDates([
      { timestamp: 1_793_000_000 },
      { timestamp: 1_792_000_000 },
      { timestamp: 1_794_000_000 },
    ])
    expect(parsed.startAt).toBe(new Date(1_792_000_000 * 1000).toISOString())
    expect(parsed.dueAt).toBe(new Date(1_794_000_000 * 1000).toISOString())
  })

  // 真实数据（2026-10-20 回放）：K200DJ96 的 7 个作业只有 `Opened:`（dataid=allowsubmissionsfromdate，
  // assign.duedate=0），旧启发式会把开放日写成截止日，连带逾期/提醒/ICS 全错。
  it('keeps an open-only date as an opening when dataid says so', () => {
    expect(parseModuleDates([{ timestamp: 1_787_778_000, dataid: 'allowsubmissionsfromdate' }])).toEqual({
      startAt: new Date(1_787_778_000 * 1000).toISOString(),
    })
    expect(parseModuleDates([{ timestamp: 1_787_634_000, dataid: 'timeopen' }])).toEqual({
      startAt: new Date(1_787_634_000 * 1000).toISOString(),
    })
  })

  it('maps a lone close-type id to the deadline', () => {
    for (const dataid of ['duedate', 'timeclose', 'submissionend', 'assessmentend']) {
      expect(parseModuleDates([{ timestamp: 1_793_000_000, dataid }])).toEqual({
        dueAt: new Date(1_793_000_000 * 1000).toISOString(),
      })
    }
  })

  it('splits open and close ids instead of blindly taking min/max', () => {
    const parsed = parseModuleDates([
      { timestamp: 1_794_000_000, dataid: 'timeclose' },
      { timestamp: 1_792_000_000, dataid: 'timeopen' },
    ])
    expect(parsed).toEqual({
      startAt: new Date(1_792_000_000 * 1000).toISOString(),
      dueAt: new Date(1_794_000_000 * 1000).toISOString(),
    })
  })

  it('handles a four-part assessment window', () => {
    const parsed = parseModuleDates([
      { timestamp: 1_795_000_000, dataid: 'assessmentend' },
      { timestamp: 1_791_000_000, dataid: 'assessmentstart' },
      { timestamp: 1_794_000_000, dataid: 'submissionend' },
      { timestamp: 1_792_000_000, dataid: 'submissionstart' },
    ])
    expect(parsed).toEqual({
      startAt: new Date(1_791_000_000 * 1000).toISOString(),
      dueAt: new Date(1_795_000_000 * 1000).toISOString(),
    })
  })

  it('falls back to the timestamp heuristic when dataid is missing or unknown', () => {
    // 无 dataid（旧站点/第三方模块）→ 行为与以前一致
    expect(parseModuleDates([{ timestamp: 1_793_000_000 }])).toEqual({
      dueAt: new Date(1_793_000_000 * 1000).toISOString(),
    })
    // 认不出的 dataid 也不猜语义，同样退回启发式
    expect(parseModuleDates([{ timestamp: 1_793_000_000, dataid: 'mysterydate' }])).toEqual({
      dueAt: new Date(1_793_000_000 * 1000).toISOString(),
    })
  })

  it('deduplicates repeated timestamps and ignores garbage instead of inventing dates', () => {
    expect(parseModuleDates([{ timestamp: 1_793_000_000 }, { timestamp: 1_793_000_000 }])).toEqual({
      dueAt: new Date(1_793_000_000 * 1000).toISOString(),
    })
    expect(parseModuleDates(undefined)).toEqual({})
    expect(parseModuleDates([{ timestamp: 0 }, { timestamp: -5 }, null, {}])).toEqual({})
  })
})

describe('mergeActivityDates', () => {
  it('lets later maps win per field while keeping fields they do not provide', () => {
    const content: ActivityDatesByCmid = new Map([[7, { startAt: iso(2026, 10, 1), dueAt: iso(2026, 10, 5) }]])
    const assignment: ActivityDatesByCmid = new Map([[7, { dueAt: iso(2026, 10, 9) }]])
    expect([...mergeActivityDates(content, assignment)]).toEqual([
      [7, { startAt: iso(2026, 10, 1), dueAt: iso(2026, 10, 9) }],
    ])
  })

  it('drops cmids whose merged record has no usable date', () => {
    expect(mergeActivityDates(new Map([[1, {}]])).size).toBe(0)
  })
})

describe('datesFromTasks', () => {
  it('reads dates back only from Moodle-synced tasks with a cmid link', () => {
    const map = datesFromTasks([
      task('moodle-act:1', { url: 'https://moodle.lut.fi/mod/quiz/view.php?id=456', dueAt: iso(2026, 10, 6) }),
      task('moodle:2@calendar', { url: 'https://moodle.lut.fi/calendar/view.php?event=9', dueAt: iso(2026, 10, 6) }),
      task('manual', { url: 'https://moodle.lut.fi/mod/assign/view.php?id=123', dueAt: iso(2026, 10, 6) }),
      task('moodle:4', { url: 'https://moodle.lut.fi/mod/assign/view.php?id=789' }),
    ])
    expect([...map]).toEqual([[456, { startAt: undefined, dueAt: iso(2026, 10, 6) }]])
  })
})

describe('applyActivityDatesToTasks', () => {
  const byCmid: ActivityDatesByCmid = new Map([
    [123, { startAt: iso(2026, 10, 2), dueAt: iso(2026, 10, 8) }],
  ])

  it('overrides ICS-derived task dates with the activity values', () => {
    const [applied] = applyActivityDatesToTasks([
      task('moodle:1@calendar', {
        url: 'https://moodle.lut.fi/mod/assign/view.php?id=123',
        startAt: iso(2026, 10, 1),
        dueAt: iso(2026, 10, 4),
      }),
    ], byCmid)
    expect(applied.startAt).toBe(iso(2026, 10, 2))
    expect(applied.dueAt).toBe(iso(2026, 10, 8))
  })

  it('keeps a field the activity does not declare instead of clearing it', () => {
    const [applied] = applyActivityDatesToTasks([
      task('moodle-act:1', {
        url: 'https://moodle.lut.fi/mod/quiz/view.php?id=123',
        startAt: iso(2026, 10, 1),
      }),
    ], new Map([[123, { dueAt: iso(2026, 10, 8) }]]))
    expect(applied.startAt).toBe(iso(2026, 10, 1))
    expect(applied.dueAt).toBe(iso(2026, 10, 8))
  })

  it('never rewrites manual tasks or moodle tasks without a cmid link', () => {
    const manual = task('manual', { url: 'https://moodle.lut.fi/mod/assign/view.php?id=123', dueAt: iso(2026, 10, 4) })
    const calendar = task('moodle:9@calendar', { url: 'https://moodle.lut.fi/calendar/view.php?event=9', dueAt: iso(2026, 10, 4) })
    const out = applyActivityDatesToTasks([manual, calendar], byCmid)
    expect(out[0]).toBe(manual)
    expect(out[1]).toBe(calendar)
  })

  it('returns the same array reference when nothing changes (no needless writes)', () => {
    const tasks = [task('moodle:1@calendar', {
      url: 'https://moodle.lut.fi/mod/assign/view.php?id=123',
      startAt: iso(2026, 10, 2),
      dueAt: iso(2026, 10, 8),
    })]
    expect(applyActivityDatesToTasks(tasks, byCmid)).toBe(tasks)
    expect(applyActivityDatesToTasks(tasks, new Map())).toBe(tasks)
  })
})

// 【2026-10-21】cutoffdate（迟交截止）与 due 是两件事：due 过了还能交到 cutoff。
// 混进 CLOSE 桶会把「实际截止」推后、把逾期判断变松，所以单独一桶。
describe('parseModuleDates — cutoffdate', () => {
  it('keeps the cutoff separate from the due date', () => {
    const parsed = parseModuleDates([
      { timestamp: 1_792_000_000, dataid: 'allowsubmissionsfromdate' },
      { timestamp: 1_793_000_000, dataid: 'duedate' },
      { timestamp: 1_795_000_000, dataid: 'cutoffdate' },
    ])
    expect(parsed).toEqual({
      startAt: new Date(1_792_000_000 * 1000).toISOString(),
      dueAt: new Date(1_793_000_000 * 1000).toISOString(),
      cutoffAt: new Date(1_795_000_000 * 1000).toISOString(),
    })
  })

  it('reads a known cutoff without pushing the real due to the max timestamp', () => {
    const parsed = parseModuleDates([
      { timestamp: 1_793_000_000, dataid: 'duedate' },
      { timestamp: 1_795_000_000, dataid: 'cutoffdate' },
    ])
    expect(parsed.dueAt).toBe(new Date(1_793_000_000 * 1000).toISOString())
    expect(parsed.cutoffAt).toBe(new Date(1_795_000_000 * 1000).toISOString())
  })

  it('survives merge and task application without clobbering due', () => {
    const cutoff = iso(2026, 10, 12)
    const due = iso(2026, 10, 5)
    const merged = mergeActivityDates(new Map([[9, { dueAt: due }]]), new Map([[9, { cutoffAt: cutoff }]]))
    expect(merged.get(9)).toEqual({ dueAt: due, cutoffAt: cutoff })

    const [applied] = applyActivityDatesToTasks(
      [task('moodle:1@calendar', { url: 'https://moodle.lut.fi/mod/assign/view.php?id=9', dueAt: due })],
      merged,
    )
    expect(applied.dueAt).toBe(due)
    expect(applied.cutoffAt).toBe(cutoff)
  })

  it('reads cutoff back from synced tasks', () => {
    const cutoff = iso(2026, 10, 12)
    const map = datesFromTasks([
      task('moodle-act:1', {
        url: 'https://moodle.lut.fi/mod/assign/view.php?id=77',
        dueAt: iso(2026, 10, 5),
        cutoffAt: cutoff,
      }),
    ])
    expect(map.get(77)?.cutoffAt).toBe(cutoff)
  })
})

// 【2026-10-21】gradingduedate（评分截止）是教师批改期限：真实载荷里它比 due
// 晚两天、与 cutoff 各自独立。既不能当 due（会把逾期判断放宽），也不是
// 迟交窗口（学生不能交到那一刻）。
describe('parseModuleDates — gradingduedate', () => {
  it('keeps the grading deadline out of due and cutoff', () => {
    const parsed = parseModuleDates([
      { timestamp: 1_792_000_000, dataid: 'allowsubmissionsfromdate' },
      { timestamp: 1_793_000_000, dataid: 'duedate' },
      { timestamp: 1_795_000_000, dataid: 'cutoffdate' },
      { timestamp: 1_797_000_000, dataid: 'gradingduedate' },
    ])
    expect(parsed).toEqual({
      startAt: new Date(1_792_000_000 * 1000).toISOString(),
      dueAt: new Date(1_793_000_000 * 1000).toISOString(),
      cutoffAt: new Date(1_795_000_000 * 1000).toISOString(),
      gradingDueAt: new Date(1_797_000_000 * 1000).toISOString(),
    })
  })

  it('treats a lone grading date as grading, never as a submission deadline', () => {
    expect(parseModuleDates([{ timestamp: 1_797_000_000, dataid: 'gradingduedate' }])).toEqual({
      gradingDueAt: new Date(1_797_000_000 * 1000).toISOString(),
    })
  })

  it('survives merge, task application and read-back', () => {
    const due = iso(2026, 10, 5)
    const grading = iso(2026, 10, 20)
    const merged = mergeActivityDates(new Map([[9, { dueAt: due }]]), new Map([[9, { gradingDueAt: grading }]]))
    expect(merged.get(9)).toEqual({ dueAt: due, gradingDueAt: grading })

    const [applied] = applyActivityDatesToTasks(
      [task('moodle:1@calendar', { url: 'https://moodle.lut.fi/mod/assign/view.php?id=9' })],
      merged,
    )
    expect(applied.dueAt).toBe(due)
    expect(applied.gradingDueAt).toBe(grading)
    expect(datesFromTasks([applied]).get(9)?.gradingDueAt).toBe(grading)
  })
})
