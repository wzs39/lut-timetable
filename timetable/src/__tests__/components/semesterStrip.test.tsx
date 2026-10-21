// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import SemesterStrip from '../../components/SemesterStrip'
import { I18nProvider } from '../../i18n'
import type { Lesson } from '../../types'

/**
 * 【全景带渲染契约】周数、当前周标记与点击回调都来自 lib/semester 的结果，
 * 组件不得自己再算一遍窗口。
 */

afterEach(cleanup)

const NOW = new Date(2026, 9, 20, 12, 0, 0, 0)

const lesson = (id: string, start: Date, end: Date): Lesson =>
  ({
    id,
    title: 'Course',
    code: 'CT60A0001',
    start: start.toISOString(),
    end: end.toISOString(),
    source: 'sisu',
  }) as unknown as Lesson

function semester() {
  const items = [
    lesson('a', new Date(2026, 9, 5, 10), new Date(2026, 9, 5, 12)),
    lesson('b', new Date(2026, 11, 21, 10), new Date(2026, 11, 21, 12)),
  ]
  return items
}

describe('SemesterStrip', () => {
  it('renders one bar per semester week and marks the current week', () => {
    const { container } = render(
      <I18nProvider>
        <SemesterStrip lessons={semester()} now={NOW} />
      </I18nProvider>,
    )
    expect(screen.getByText('第 3/12 周')).toBeTruthy()
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(12)
    expect(container.querySelector('[aria-current="date"]')).toBeTruthy()
  })

  it('opens the week the user clicked', () => {
    const onOpenWeek = vi.fn()
    render(
      <I18nProvider>
        <SemesterStrip lessons={semester()} now={NOW} onOpenWeek={onOpenWeek} />
      </I18nProvider>,
    )
    fireEvent.click(screen.getAllByRole('listitem')[0])
    expect(onOpenWeek).toHaveBeenCalledTimes(1)
    const got = onOpenWeek.mock.calls[0][0] as Date
    expect(got.getFullYear()).toBe(2026)
    expect(got.getMonth()).toBe(9)
    expect(got.getDate()).toBe(5)
  })

  it('shows finished semesters instead of a week number', () => {
    const past = [lesson('p', new Date(2026, 0, 5, 10), new Date(2026, 0, 5, 12))]
    render(
      <I18nProvider>
        <SemesterStrip lessons={past} now={NOW} />
      </I18nProvider>,
    )
    expect(screen.getByText('学期已结束')).toBeTruthy()
  })
})
