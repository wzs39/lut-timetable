// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SisuStudyPlan from '../../components/SisuStudyPlan'
import { I18nProvider } from '../../i18n'
import { KEYS } from '../../lib/storage'

vi.mock('../../lib/sisuCourse', () => ({
  searchSisuPublicCatalog: vi.fn(async () => ({ courses: [], total: 0 })),
  lookupSisuCourseByCode: vi.fn(async () => null),
  normalizeSisuCode: (code: string) => code.trim().toUpperCase().replace(/-\d{4}$/, ''),
}))
vi.mock('../../lib/sisuStudyPlanReminders', () => ({ refreshSisuPlanReminders: vi.fn(async () => {}) }))

// The default plan is seeded from the personal SISU plan on first run; it is
// overloaded in several terms, which is exactly the case this switch exists for.
function renderPage() {
  render(<I18nProvider><SisuStudyPlan /></I18nProvider>)
  return {
    toggle: screen.getByLabelText('自动均衡负荷（同年 P1–P4 重排课程）') as HTMLInputElement,
    strict: () => screen.queryByLabelText('只用 SISU 开课学段内的窗口（幅度更小，无需核对）') as HTMLInputElement | null,
  }
}

function planSnapshot(): string {
  return localStorage.getItem(KEYS.sisuStudyPlan) ?? ''
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('SisuStudyPlan auto levelling', () => {
  it('is off by default and leaves the scenario untouched', () => {
    const { toggle, strict } = renderPage()
    expect(toggle.checked).toBe(false)
    expect(strict()).toBeNull()
    expect(screen.queryByText(/挪了 \d+ 门/)).toBeNull()
  })

  it('levels overloaded terms and lists every moved course without writing back to the plan', async () => {
    const { toggle } = renderPage()
    const before = planSnapshot()

    fireEvent.click(toggle)

    await waitFor(() => expect(screen.getByText(/挪了 \d+ 门/)).toBeTruthy())
    const summary = screen.getByText(/挪了 \d+ 门/)
    expect(summary.textContent).toMatch(/峰值 [\d.]+h → [\d.]+h/)
    // A levelling pass may trade a higher peak for fewer overloaded terms; both
    // numbers must always be on screen so the trade-off is visible.
    expect(summary.textContent).toMatch(/超标学段 \d+ → \d+/)
    // At least one concrete move with a from → to window.
    expect(screen.getAllByTitle(/：P\d/).length).toBeGreaterThan(0)
    // The projection is read-only: the stored plan is byte-identical.
    expect(planSnapshot()).toBe(before)
    expect(JSON.parse(localStorage.getItem(KEYS.sisuScenario) ?? '{}')).toMatchObject({ autoBalance: true })
  })

  it('narrows the levelling when only SISU offering windows may be used', async () => {
    const { toggle } = renderPage()
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.getByText(/挪了 \d+ 门/)).toBeTruthy())
    const looseCount = screen.getAllByTitle(/：P\d/).length

    fireEvent.click(screen.getByLabelText('只用 SISU 开课学段内的窗口（幅度更小，无需核对）'))

    await waitFor(() => {
      const strictMoves = screen.queryAllByTitle(/：P\d/).length
      expect(strictMoves).toBeLessThan(looseCount)
      // Strict mode must never need verification badges.
      expect(screen.queryByText('需核对开课')).toBeNull()
    })
    expect(JSON.parse(localStorage.getItem(KEYS.sisuScenario) ?? '{}')).toMatchObject({ strictOffering: true })
  })
})
