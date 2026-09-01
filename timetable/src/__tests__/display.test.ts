import { describe, expect, it } from 'vitest'
import { displayTitle } from '../lib/display'
import type { Lesson } from '../types'

function lesson(title: string, code?: string): Lesson {
  return {
    id: '1',
    source: 'sisu',
    title,
    code,
    start: '2026-08-31T07:00:00.000Z',
    end: '2026-08-31T09:00:00.000Z',
  }
}

describe('displayTitle', () => {
  it('strips the code duplicated at the start of the title', () => {
    expect(
      displayTitle(lesson('CT60A0250 · CT60A0250 · Fundamentals of Programming', 'CT60A0250')),
    ).toBe('Fundamentals of Programming')
  })

  it('strips the code appearing mid-title', () => {
    expect(
      displayTitle(lesson('BM20A9200 · Mathematics A · Contact teaching', 'BM20A9200')),
    ).toBe('Mathematics A · Contact teaching')
  })

  it('removes group-number codes from the title', () => {
    expect(
      displayTitle(lesson('Finnish 1 K200DJ96-3015 · KKIE26LABH · KKIE26LUTH', 'K200DJ96')),
    ).toBe('Finnish 1 · KKIE26LABH · KKIE26LUTH')
  })

  it('falls back to the original title when nothing to strip', () => {
    const t = 'Kukkonen Noora'
    expect(displayTitle(lesson(t))).toBe(t)
  })

  it('never returns an empty title', () => {
    expect(displayTitle(lesson('BM20A9200', 'BM20A9200'))).toBe('BM20A9200')
  })
})
