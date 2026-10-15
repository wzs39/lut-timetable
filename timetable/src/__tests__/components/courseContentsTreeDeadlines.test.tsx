// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '../../i18n'
import { formatDateTime } from '../../lib/date'
import type { CourseSection } from '../../lib/contents'
import CourseContentsTree from '../../components/moodle/CourseContentsTree'

let mockDeadlines = new Map<number, string>()
let mockStatuses = new Map<number, { state: 'submitted' | 'graded'; dueAt?: string }>()
vi.mock('../../hooks/useMoodleData', () => ({
  useMoodleData: () => ({
    subByCmid: mockStatuses,
    activityDeadlinesByCmid: mockDeadlines,
    applyCompletion: vi.fn(),
  }),
}))
vi.mock('../../lib/contents', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/contents')>()
  return { ...original, markActivityCompletion: vi.fn(async () => true) }
})

const section = (cmid: number): CourseSection[] => [{
  id: 1,
  name: 'Week 1',
  visible: true,
  modules: [{
    id: cmid,
    name: 'Synthetic quiz',
    modname: 'quiz',
    url: `https://moodle.lut.fi/mod/quiz/view.php?id=${cmid}`,
    visible: true,
  }],
}]

afterEach(() => {
  cleanup()
  mockDeadlines = new Map()
  mockStatuses = new Map()
})

describe('CourseContentsTree activity deadlines', () => {
  it('shows a cmid-matched deadline even when there is no submission status', () => {
    const dueAt = new Date(Date.now() + 2 * 86400000).toISOString()
    mockDeadlines = new Map([[39201, dueAt]])
    render(<I18nProvider><CourseContentsTree sections={section(39201)} onRefresh={() => {}} busy={false} /></I18nProvider>)
    expect(screen.getByText(formatDateTime(dueAt, document.documentElement.lang || undefined))).toBeTruthy()
    expect(screen.getByText('Synthetic quiz')).toBeTruthy()
    expect(screen.queryByText(/已提交|已评分/)).toBeNull()
  })

  it('prefers the deadline bundled with submission status when available', () => {
    const statusDue = new Date(Date.now() + 3 * 86400000).toISOString()
    const fallbackDue = new Date(Date.now() + 5 * 86400000).toISOString()
    mockDeadlines = new Map([[39201, fallbackDue]])
    mockStatuses = new Map([[39201, { state: 'graded', dueAt: statusDue }]])
    render(<I18nProvider><CourseContentsTree sections={section(39201)} onRefresh={() => {}} busy={false} /></I18nProvider>)
    const locale = document.documentElement.lang || undefined
    expect(screen.getByText(formatDateTime(statusDue, locale))).toBeTruthy()
    expect(screen.queryByText(formatDateTime(fallbackDue, locale))).toBeNull()
  })
})
