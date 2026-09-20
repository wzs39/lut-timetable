import { describe, expect, it } from 'vitest'
import { moduleTypeOf, withDerivedModtypes, type Task } from '../lib/tasks'

function task(over: Partial<Task>): Task {
  return {
    id: 't1',
    title: 'T',
    completed: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('moduleTypeOf', () => {
  it('prefers explicit modtype over URL derivation', () => {
    expect(moduleTypeOf({ modtype: 'quiz', url: 'https://m.x/mod/assign/view.php?id=1' })).toBe('quiz')
  })

  it('derives type from activity URL when modtype missing', () => {
    expect(moduleTypeOf({ url: 'https://moodle.lut.fi/mod/workshop/view.php?id=3358' })).toBe('workshop')
    expect(moduleTypeOf({ url: 'https://moodle.lut.fi/mod/attendance/view.php?id=2105240' })).toBe('attendance')
    expect(moduleTypeOf({ url: 'https://moodle.lut.fi/mod/quiz/view.php?id=2105246' })).toBe('quiz')
    expect(moduleTypeOf({ url: 'https://moodle.lut.fi/mod/assign/view.php?id=2179011' })).toBe('assign')
  })

  it('returns null for manual tasks and calendar-event URLs', () => {
    expect(moduleTypeOf({})).toBeNull()
    expect(moduleTypeOf({ url: 'https://moodle.lut.fi/calendar/view.php?event=4641881' })).toBeNull()
  })
})

describe('withDerivedModtypes', () => {
  it('fills modtype from URL once and keeps other tasks untouched', () => {
    const out = withDerivedModtypes([
      task({ id: 'a', url: 'https://m/mod/quiz/view.php?id=9' }),
      task({ id: 'b', title: 'manual' }),
      task({ id: 'c', url: 'https://m/calendar/view.php?event=1' }),
      task({ id: 'd', modtype: 'assign', url: 'https://m/mod/quiz/view.php?id=9' }),
    ])
    expect(out[0].modtype).toBe('quiz')
    expect(out[1].modtype).toBeUndefined()
    expect(out[2].modtype).toBeUndefined()
    expect(out[3].modtype).toBe('assign')
  })

  it('returns the same array when nothing to derive (no re-render churn)', () => {
    const arr = [task({ id: 'b' })]
    expect(withDerivedModtypes(arr)).toBe(arr)
  })
})
