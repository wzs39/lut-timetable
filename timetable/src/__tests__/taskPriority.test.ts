import { describe, expect, it } from 'vitest'
import type { CourseGrades, GradeItem } from '../lib/grades'
import type { Task } from '../lib/tasks'
import {
  buildWeightIndex,
  courseRemainingWeight,
  NEUTRAL_WEIGHT,
  priorityHintIds,
  sortByImpact,
  taskImpacts,
  urgencyOf,
} from '../lib/taskPriority'

// 【作业优先级契约】score = 课程剩余权重 × 紧迫度：大权重的作业不会被
// 一份 5% 的小作业挤到后面；未知课程用中性权重，不掉底。

const item = (grade: number | null, weight: number | null): GradeItem => ({
  name: 'x',
  grade,
  max: 100,
  classAvg: null,
  weight,
})

const course = (code: string, items: GradeItem[]): CourseGrades =>
  ({ course: code, items, matched: true, average: null }) as unknown as CourseGrades

const task = (over: Partial<Task>): Task =>
  ({
    id: 't',
    title: 'task',
    completed: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  }) as Task

// 用 UTC 基准与任务里的 ISO(Z) 对齐，否则本地时区会把天数向上取整多算一天
const NOW = new Date('2026-09-21T12:00:00.000Z')

describe('courseRemainingWeight', () => {
  it('sums only weighted, ungraded items', () => {
    expect(
      courseRemainingWeight(
        course('CT60A0250', [item(80, 30), item(null, 40), item(null, null), item(null, 30)]),
      ),
    ).toBe(70)
    expect(courseRemainingWeight(undefined)).toBe(0)
  })
})

describe('urgencyOf', () => {
  it('decays with the days left and floors at the same day', () => {
    expect(urgencyOf(0)).toBe(1)
    expect(urgencyOf(-3)).toBe(1) // 逾期与今天同等紧迫（逾期另有分组提示）
    expect(urgencyOf(1)).toBeCloseTo(0.5, 6)
    expect(urgencyOf(7)).toBeCloseTo(0.125, 6)
    // 无截止时间：给一个“约等于 9 天后”的低紧迫度，而不是 0（否则永远垫底）
    expect(urgencyOf(null)).toBeGreaterThan(0)
    expect(urgencyOf(null)).toBeLessThan(urgencyOf(1))
  })
})

describe('taskImpacts', () => {
  const weights = new Map([
    ['CT60A0250', 70],
    ['HDD4010', 5],
  ])

  it('ranks a high-weight course ahead of a low-weight one, and near deadlines first', () => {
    const tasks = [
      task({ id: 'big', course: 'CT60A0250', dueAt: '2026-09-28T12:00:00.000Z' }), // 7 天
      task({ id: 'small', course: 'HDD4010', dueAt: '2026-09-22T12:00:00.000Z' }), // 1 天
      task({ id: 'unknown', course: 'Nope', dueAt: '2026-09-23T12:00:00.000Z' }), // 2 天
    ]
    const imp = taskImpacts(tasks, weights, NOW)
    expect(imp.get('big')!.score).toBeCloseTo(70 * 0.125, 6)
    expect(imp.get('small')!.score).toBeCloseTo(5 * 0.5, 6)
    expect(imp.get('unknown')!.approximate).toBe(true)
    expect(imp.get('unknown')!.remainingWeight).toBe(0)
    expect([...sortByImpact(tasks, imp).map((x) => x.id)]).toEqual(['big', 'unknown', 'small'])
  })

  it('skips completed tasks and keeps input order for ties', () => {
    const tasks = [
      task({ id: 'a', course: 'Nope', dueAt: '2026-09-22T12:00:00.000Z' }),
      task({ id: 'b', course: 'Nope', dueAt: '2026-09-22T12:00:00.000Z' }),
      task({ id: 'c', course: 'Nope', dueAt: '2026-09-22T12:00:00.000Z', completed: true }),
    ]
    const imp = taskImpacts(tasks, weights, NOW)
    expect(imp.has('c')).toBe(false)
    expect([...sortByImpact(tasks, imp).map((x) => x.id)]).toEqual(['a', 'b', 'c'])
  })

  it('treats a missing deadline as low urgency and never overrates an unknown course', () => {
    const tasks = [task({ id: 'nodue', course: 'Nope' })]
    const imp = taskImpacts(tasks, weights, NOW)
    expect(imp.get('nodue')!.daysLeft).toBeNull()
    expect(imp.get('nodue')!.score).toBeCloseTo(NEUTRAL_WEIGHT * 0.1, 6)
  })

  it('marks only tasks with real weight data above the meaningful threshold', () => {
    const tasks = [
      task({ id: 'big', course: 'CT60A0250', dueAt: '2026-09-28T12:00:00.000Z' }),
      task({ id: 'small', course: 'HDD4010', dueAt: '2026-09-22T12:00:00.000Z' }),
      task({ id: 'unknown', course: 'Nope', dueAt: '2026-09-22T12:00:00.000Z' }),
    ]
    const imp = taskImpacts(tasks, weights, NOW)
    // HDD4010 只剩 5% 权重（< MEANINGFUL_WEIGHT）、Nope 无数据 → 都不标
    expect([...priorityHintIds(imp, 3)]).toEqual(['big'])
    expect(priorityHintIds(imp, 0).size).toBe(0)
    // 拿不到任何成绩数据 → 不标任何人，而不是把所有任务都标上
    const blind = taskImpacts(tasks, new Map(), NOW)
    expect(priorityHintIds(blind, 3).size).toBe(0)
  })
})

describe('buildWeightIndex', () => {
  it('indexes both the Moodle course name and its calendar code', () => {
    const index = buildWeightIndex(
      [course('CT60A0250 Software Engineering', [item(null, 60)]), course('HDD4010', [item(90, 5)])],
      (name) => (name.startsWith('CT60A0250') ? 'CT60A0250' : null),
    )
    expect(index.get('CT60A0250 Software Engineering')).toBe(60)
    expect(index.get('CT60A0250')).toBe(60)
    expect(index.get('HDD4010')).toBe(0)
  })
})
