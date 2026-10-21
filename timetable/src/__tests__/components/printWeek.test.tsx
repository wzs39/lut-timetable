// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import PrintWeek from '../../components/PrintWeek'
import { I18nProvider } from '../../i18n'
import type { Lesson } from '../../types'

afterEach(cleanup)

const WEEK_START = new Date(2026, 9, 19, 0, 0, 0, 0) // 周一

const lesson = (id: string, start: Date, title: string): Lesson =>
  ({
    id,
    title,
    code: 'CT60A0001',
    location: 'M19_AUD1B',
    start: start.toISOString(),
    end: new Date(start.getTime() + 2 * 3600_000).toISOString(),
    source: 'sisu',
  }) as unknown as Lesson

describe('PrintWeek', () => {
  it('prints only the visible week and keeps the scannable fields', () => {
    const thisWeek = lesson('a', new Date(2026, 9, 20, 10), 'Signals')
    const nextWeek = lesson('b', new Date(2026, 9, 27, 10), 'Next week only')
    const { container } = render(
      <I18nProvider>
        <PrintWeek lessons={[thisWeek, nextWeek]} weekStart={WEEK_START} />
      </I18nProvider>,
    )
    const sheet = container.querySelector('.print-sheet')
    expect(sheet).toBeTruthy()
    expect(sheet!.textContent).toContain('Signals')
    expect(sheet!.textContent).toContain('CT60A0001')
    expect(sheet!.textContent).toContain('M19_AUD1B')
    expect(sheet!.textContent).not.toContain('Next week only')
    expect(sheet!.querySelectorAll('.print-day')).toHaveLength(7)
    expect(sheet!.querySelectorAll('button')).toHaveLength(0)
  })

  it('renders an empty column for a free day', () => {
    const { container } = render(
      <I18nProvider>
        <PrintWeek lessons={[]} weekStart={WEEK_START} />
      </I18nProvider>,
    )
    expect(container.querySelectorAll('.print-empty')).toHaveLength(7)
  })
})
