import { describe, expect, it } from 'vitest'
import { pickSlots, restoreSlots } from '../lib/undo'
import type { Lesson } from '../types'

const lesson = (id: string): Lesson => ({
  id,
  source: 'manual',
  title: id,
  start: '2026-09-21T08:00:00.000Z',
  end: '2026-09-21T10:00:00.000Z',
})

describe('pickSlots', () => {
  it('collects the requested lessons with their original indexes', () => {
    const lessons = [lesson('a'), lesson('b'), lesson('c')]
    expect(pickSlots(lessons, ['b', 'c'])).toEqual([
      { lesson: lessons[1], index: 1 },
      { lesson: lessons[2], index: 2 },
    ])
  })

  it('ignores unknown ids and keeps array order', () => {
    const lessons = [lesson('a'), lesson('b')]
    expect(pickSlots(lessons, ['b', 'zz']).map((s) => s.lesson.id)).toEqual(['b'])
    expect(pickSlots(lessons, []).length).toBe(0)
  })
})

describe('restoreSlots', () => {
  it('puts removed lessons back at their original positions', () => {
    const all = [lesson('a'), lesson('b'), lesson('c'), lesson('d')]
    const slots = pickSlots(all, ['b', 'd'])
    expect(restoreSlots([all[0], all[2]], slots).map((l) => l.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('restores from the very start of the array too', () => {
    const all = [lesson('a'), lesson('b'), lesson('c')]
    const slots = pickSlots(all, ['a', 'b'])
    expect(restoreSlots([all[2]], slots).map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('is idempotent: already present lessons are not duplicated', () => {
    const all = [lesson('a'), lesson('b')]
    const slots = pickSlots(all, ['b'])
    const once = restoreSlots([all[0]], slots)
    expect(restoreSlots(once, slots).map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('clamps out-of-range indexes to the end', () => {
    const slot = { lesson: lesson('x'), index: 99 }
    expect(restoreSlots([lesson('a')], [slot]).map((l) => l.id)).toEqual(['a', 'x'])
  })
})
