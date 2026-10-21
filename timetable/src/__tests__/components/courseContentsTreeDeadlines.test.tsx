// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '../../i18n'
import { formatDateTime, formatDateTimeShort } from '../../lib/date'
import type { CourseSection } from '../../lib/contents'
import CourseContentsTree from '../../components/moodle/CourseContentsTree'

let mockDeadlines = new Map<number, string>()
let mockStatuses = new Map<number, { state: 'submitted' | 'graded'; dueAt?: string }>()
let mockActivityDates = new Map<number, { startAt?: string; dueAt?: string; cutoffAt?: string; gradingDueAt?: string }>()
vi.mock('../../hooks/useMoodleData', () => ({
  useMoodleData: () => ({
    subByCmid: mockStatuses,
    activityDeadlinesByCmid: mockDeadlines,
    activityDatesByCmid: mockActivityDates,
    registerContentsDates: vi.fn(),
    applyCompletion: vi.fn(),
  }),
}))
vi.mock('../../lib/contents', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/contents')>()
  return { ...original, markActivityCompletion: vi.fn(async () => true) }
})

const section = (cmid: number, modname = 'quiz'): CourseSection[] => [{
  id: 1,
  name: 'Week 1',
  visible: true,
  modules: [{
    id: cmid,
    name: modname === 'quiz' ? 'Synthetic quiz' : 'Synthetic assignment',
    modname,
    url: `https://moodle.lut.fi/mod/${modname}/view.php?id=${cmid}`,
    visible: true,
  }],
}]

afterEach(() => {
  cleanup()
  mockDeadlines = new Map()
  mockStatuses = new Map()
  mockActivityDates = new Map()
})

/** 窄行只显示紧凑时间；完整时间放 title（同一份 ActivityDatesText）。 */
function expectDeadlineText(dueAt: string): void {
  const locale = document.documentElement.lang || undefined
  const node = screen.getByText(formatDateTimeShort(dueAt, locale))
  expect(node.closest('[title]')?.getAttribute('title')).toContain(formatDateTime(dueAt, locale))
}

describe('CourseContentsTree activity deadlines', () => {
  it('shows a cmid-matched deadline even when there is no submission status', () => {
    const dueAt = new Date(Date.now() + 2 * 86400000).toISOString()
    mockDeadlines = new Map([[39201, dueAt]])
    render(<I18nProvider><CourseContentsTree sections={section(39201)} onRefresh={() => {}} busy={false} /></I18nProvider>)
    expectDeadlineText(dueAt)
    expect(screen.getByText('Synthetic quiz')).toBeTruthy()
    expect(screen.queryByText(/已提交|已评分/)).toBeNull()
  })

  it('prefers the deadline bundled with submission status when available', () => {
    const statusDue = new Date(Date.now() + 3 * 86400000).toISOString()
    const fallbackDue = new Date(Date.now() + 5 * 86400000).toISOString()
    mockDeadlines = new Map([[39201, fallbackDue]])
    mockStatuses = new Map([[39201, { state: 'graded', dueAt: statusDue }]])
    render(<I18nProvider><CourseContentsTree sections={section(39201)} onRefresh={() => {}} busy={false} /></I18nProvider>)
    expectDeadlineText(statusDue)
    expect(screen.queryByText(formatDateTimeShort(fallbackDue, document.documentElement.lang || undefined))).toBeNull()
  })

  // 真实数据：K200DJ96 的作业只有 `Opened:`（没有 due）。开放日绝不能渲染成「截止」。
  it('renders an open-only activity date as an opening, never as a deadline', () => {
    const startAt = new Date(Date.now() + 86400000).toISOString()
    mockActivityDates = new Map([[39201, { startAt }]])
    render(<I18nProvider><CourseContentsTree sections={section(39201)} onRefresh={() => {}} busy={false} /></I18nProvider>)

    const locale = document.documentElement.lang || undefined
    const node = screen.getByText(formatDateTimeShort(startAt, locale))
    const title = node.closest('[title]')?.getAttribute('title') ?? ''
    expect(title).toContain(formatDateTime(startAt, locale))
    expect(title).not.toContain('截止')
    expect(title).not.toContain('Due')
    // 没有截止时间就不该有 "start → due" 的连接符，也不该出现逾期标记
    expect(screen.queryByText('→')).toBeNull()
    expect(screen.queryByText(/已逾期/)).toBeNull()
  })

  it('calls a quiz deadline "closed", not "due"', () => {
    const dueAt = new Date(Date.now() + 2 * 86400000).toISOString()
    mockActivityDates = new Map([[39201, { dueAt }]])
    render(<I18nProvider><CourseContentsTree sections={section(39201, 'quiz')} onRefresh={() => {}} busy={false} /></I18nProvider>)
    const title = screen.getByText(formatDateTimeShort(dueAt, document.documentElement.lang || undefined)).closest('[title]')?.getAttribute('title') ?? ''
    expect(title).toContain('关闭')
    expect(title).not.toContain('截止')
  })

  it('shows the late-submission cutoff separately from the assignment due date', () => {
    const dueAt = new Date(Date.now() + 2 * 86400000).toISOString()
    const cutoffAt = new Date(Date.now() + 6 * 86400000).toISOString()
    mockActivityDates = new Map([[39201, { dueAt, cutoffAt }]])
    render(<I18nProvider><CourseContentsTree sections={section(39201, 'assign')} onRefresh={() => {}} busy={false} /></I18nProvider>)
    expectDeadlineText(dueAt)
    const title = screen.getByText(formatDateTimeShort(dueAt, document.documentElement.lang || undefined)).closest('[title]')?.getAttribute('title') ?? ''
    expect(title).toContain('迟交截止')
    expect(title).toContain(formatDateTime(cutoffAt, document.documentElement.lang || undefined))
    expect(title).not.toContain('关闭')
    expect(screen.getByText(/迟交/)).toBeTruthy()
  })

  it('shows the grading deadline separately from due and cutoff', () => {
    const dueAt = new Date(Date.now() + 2 * 86400000).toISOString()
    const cutoffAt = new Date(Date.now() + 6 * 86400000).toISOString()
    const gradingDueAt = new Date(Date.now() + 9 * 86400000).toISOString()
    mockActivityDates = new Map([[39201, { dueAt, cutoffAt, gradingDueAt }]])
    render(<I18nProvider><CourseContentsTree sections={section(39201, 'assign')} onRefresh={() => {}} busy={false} /></I18nProvider>)
    const locale = document.documentElement.lang || undefined
    const title = screen.getByText(formatDateTimeShort(dueAt, locale)).closest('[title]')?.getAttribute('title') ?? ''
    expect(title).toContain('评分截止')
    expect(title).toContain(formatDateTime(gradingDueAt, locale))
    expect(title).toContain('迟交截止')
    expect(screen.getByText(/评分/)).toBeTruthy()
  })

  it('prefers activity-declared dates over submission state and the deadline fallback', () => {
    const activityStart = new Date(Date.now() + 86400000).toISOString()
    const activityDue = new Date(Date.now() + 2 * 86400000).toISOString()
    const statusDue = new Date(Date.now() + 3 * 86400000).toISOString()
    mockActivityDates = new Map([[39201, { startAt: activityStart, dueAt: activityDue }]])
    mockDeadlines = new Map([[39201, new Date(Date.now() + 5 * 86400000).toISOString()]])
    mockStatuses = new Map([[39201, { state: 'submitted', dueAt: statusDue }]])
    render(<I18nProvider><CourseContentsTree sections={section(39201)} onRefresh={() => {}} busy={false} /></I18nProvider>)
    expectDeadlineText(activityDue)
    // 开始时间只在活动自己有声明时才显示
    expect(screen.getByText(formatDateTimeShort(activityStart, document.documentElement.lang || undefined))).toBeTruthy()
    expect(screen.queryByText(formatDateTimeShort(statusDue, document.documentElement.lang || undefined))).toBeNull()
  })
})
