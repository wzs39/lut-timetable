// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import WeekInsights from '../../components/WeekInsights'
import { I18nProvider } from '../../i18n'
import type { Lesson } from '../../types'

afterEach(cleanup)

const NOW = new Date(2026, 9, 19, 8, 0, 0, 0)

const lesson = (id: string, h: number, m: number, location: string): Lesson =>
  ({
    id,
    title: 'Course',
    code: 'CT60A0001',
    location,
    start: new Date(2026, 9, 19, h, m, 0, 0).toISOString(),
    end: new Date(2026, 9, 19, h + 1, m, 0, 0).toISOString(),
    source: 'sisu',
  }) as unknown as Lesson

describe('WeekInsights', () => {
  it('renders the tight changeover and opens the earlier lesson', () => {
    const a = lesson('a', 9, 0, 'M19_AUD1B')
    const b = lesson('b', 10, 5, 'NIE73_B211')
    const onSelect = vi.fn()
    render(
      <I18nProvider>
        <WeekInsights lessons={[a, b]} now={NOW} onSelect={onSelect} />
      </I18nProvider>,
    )
    const row = screen.getByTitle(/连堂可能赶不上/)
    expect(row.textContent).toContain('M19_AUD1B')
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('renders nothing when there is nothing worth flagging', () => {
    const only = lesson('a', 9, 0, 'M19_AUD1B')
    const { container } = render(
      <I18nProvider>
        <WeekInsights lessons={[only]} now={NOW} onSelect={() => {}} />
      </I18nProvider>,
    )
    expect(container.firstChild).toBeNull()
  })
})
