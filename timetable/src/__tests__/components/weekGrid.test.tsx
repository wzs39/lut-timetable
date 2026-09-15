// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WeekGrid from '../../components/WeekGrid'
import { I18nProvider } from '../../i18n'
import { KEYS } from '../../lib/storage'
import { startOfWeek } from '../../lib/date'
import type { Lesson } from '../../types'

/** Selasa 2026-09-15 — di dalam minggu yang diuji (mulai Senin 2026-09-14) */
const NOW = new Date(2026, 8, 15, 12, 0, 0)
const WEEK_START = startOfWeek(NOW)

function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 8, day, hour, minute, 0).toISOString()
}

function lesson(p: Partial<Lesson> & { id: string; start: string; end: string }): Lesson {
  return { source: 'sisu', title: `Course ${p.id}`, ...p }
}

/**
 * Selasa: dua collision group — (A,B) tumpang tindih 10:00, (C,D) tumpang
 * tindih 14:00. Empat pelajaran bentrok, tapi hanya DUA grup.
 */
const LESSONS: Lesson[] = [
  lesson({ id: 'A', code: 'AAA1111', start: at(15, 10), end: at(15, 11) }),
  lesson({ id: 'B', code: 'BBB2222', start: at(15, 10, 30), end: at(15, 11, 30) }),
  lesson({ id: 'C', code: 'CCC3333', start: at(15, 14), end: at(15, 15) }),
  lesson({ id: 'D', code: 'DDD4444', start: at(15, 14, 30), end: at(15, 15, 30) }),
]

/** Paksa salah satu cabang tampilan (≥768px = grid penuh). */
function mockWide(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

function renderGrid() {
  return render(
    <I18nProvider>
      <WeekGrid lessons={LESSONS} weekStart={WEEK_START} onSelect={() => {}} />
    </I18nProvider>,
  )
}

function conflictChips(): string[] {
  return [...document.querySelectorAll('[role="img"]')]
    .map((el) => el.getAttribute('aria-label') || '')
    .filter((label) => label.includes('处同时段冲突'))
}

describe('WeekGrid conflict display', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('counts collision groups, not clashing lessons, in the day chip', () => {
    mockWide(true)
    renderGrid()

    const chips = conflictChips()
    expect(chips.length).toBe(1)
    // 4 pelajaran bentrok, tetapi hanya 2 grup → chip harus menulis 2
    expect(chips[0].startsWith('2 处同时段冲突')).toBe(true)
    expect(screen.getByText(/本周 2 处冲突/)).toBeTruthy()
  })

  it('dismisses one collision group from the mobile branch', () => {
    mockWide(false)
    renderGrid()

    // dua kontainer grup, masing-masing berisi 2 pelajaran
    expect(screen.getAllByText('同时段 2 节').length).toBe(2)

    fireEvent.click(screen.getAllByText('点击忽略此冲突提醒（课程变动后会重新提示）')[0])

    const stored = JSON.parse(localStorage.getItem(KEYS.conflictDismissed) || '[]')
    expect(stored.length).toBe(1)
    // grup yang diabaikan menyusut jadi kartu tunggal → sisa satu kontainer
    expect(screen.getAllByText('同时段 2 节').length).toBe(1)
    expect(screen.getByText('已忽略 1 处冲突')).toBeTruthy()
  })

  it('keeps a dismissal made on mobile after switching to the desktop grid', () => {
    mockWide(false)
    renderGrid()
    fireEvent.click(screen.getAllByText('点击忽略此冲突提醒（课程变动后会重新提示）')[0])
    cleanup()

    mockWide(true)
    renderGrid()

    // cabang desktop memakai predikat yang sama: 2 grup → 1 grup terlihat
    const chips = conflictChips()
    expect(chips.length).toBe(1)
    expect(chips[0].startsWith('1 处同时段冲突')).toBe(true)
    // dan sisanya bisa dipulihkan dari header hari
    expect(screen.getByTitle('点击恢复该日 1 处已忽略的冲突提醒')).toBeTruthy()
  })
})
