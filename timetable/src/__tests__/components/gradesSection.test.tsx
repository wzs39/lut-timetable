// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import GradesSection from '../../components/moodle/GradesSection'
import { I18nProvider } from '../../i18n'
import type { MoodleData } from '../../hooks/useMoodleData'
import type { CourseGrades, GradeItem } from '../../lib/grades'

// 【渲染契约】成绩段：卡片字段（代码/标题/当前分）、未评项跳转链接带课程码、
// 排序持久化、匹配/未匹配过滤、空态分支。mock 掉 MoodleData（组件只读它）。

const item = (over: Partial<GradeItem>): GradeItem => ({
  name: 'item',
  grade: null,
  max: 100,
  classAvg: null,
  weight: null,
  ...over,
})

const course = (over: Partial<CourseGrades> = {}): CourseGrades => ({
  course: 'BM20A9200',
  matched: true,
  average: 82.5,
  items: [item({ name: 'Quiz 1', grade: 8, max: 10, weight: 50 })],
  ...over,
})

let mockMd: MoodleData

vi.mock('../../hooks/useMoodleData', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../hooks/useMoodleData')>()
  return { ...orig, useMoodleData: () => mockMd }
})

function md(grades: CourseGrades[] | null): MoodleData {
  return {
    ics: null,
    token: { token: 'tok', userid: 2 },
    connected: true,
    grades,
    subStatus: new Map(),
    subByCmid: new Map(),
    busy: 'idle',
    message: null,
    notifications: null,
    unread: 0,
    markNotificationRead: () => {},
    refreshNotifications: async () => {},
    setIcsUrl: () => false,
    disconnectIcs: () => {},
    connectToken: async () => false,
    disconnectToken: () => {},
    loginWithSso: () => {},
    ssoState: 'idle',
    ssoMessage: null,
    syncNow: async () => {},
    refreshGrades: async () => {},
    syncSubmissions: async () => {},
    applyCompletion: () => {},
    pushTaskCompletion: () => {},
  } as unknown as MoodleData
}

function renderGrades() {
  return render(
    <I18nProvider>
      <GradesSection onOpenAssignments={() => {}} />
    </I18nProvider>,
  )
}

function buttonsMatching(re: RegExp): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((b) => re.test(b.textContent || ''))
}

describe('GradesSection — rendering contracts', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders card code, title and current score', () => {
    mockMd = md([course({ courseTitle: 'Mathematics A' })])
    renderGrades()
    expect(screen.getByText('BM20A9200')).toBeTruthy()
    expect(screen.getByText('Mathematics A')).toBeTruthy()
    // 当前分 = getFinalCourseGrade（官方 total 优先链）；单 item 50% 权重 8/10
    // → 加权 4.0%，coveredAvg 兜底显示 (8%)。契约：headline 是加权分不是裸均值。
    expect(document.body.textContent).toMatch(/4\.0%/)
    expect(document.body.textContent).toMatch(/\(8%\)/)
  })

  it('turns the ungraded badge into a jump link carrying the course code (null filter + query)', () => {
    mockMd = md([
      course({
        items: [
          item({ name: 'Quiz 1', grade: 8, max: 10, weight: 50 }),
          item({ name: 'Exam', grade: null, max: 10, weight: 50 }),
        ],
      }),
    ])
    const onOpenAssignments = vi.fn((_f: 'overdue' | 'due7' | 'later' | null, _q?: string) => {})
    render(
      <I18nProvider>
        <GradesSection onOpenAssignments={onOpenAssignments} />
      </I18nProvider>,
    )
    const link = buttonsMatching(/项未评分/)[0]
    expect(link).toBeTruthy()
    fireEvent.click(link)
    // 分组锁 null（未评项可能逾期也可能未来）+ 课程码 query
    expect(onOpenAssignments).toHaveBeenCalledWith(null, 'BM20A9200')
  })

  it('no ungraded link when every item is graded', () => {
    mockMd = md([course()])
    const onOpenAssignments = vi.fn((_f: 'overdue' | 'due7' | 'later' | null, _q?: string) => {})
    render(
      <I18nProvider>
        <GradesSection onOpenAssignments={onOpenAssignments} />
      </I18nProvider>,
    )
    expect(buttonsMatching(/项未评分/).length).toBe(0)
  })

  it('unmatched course code is plain text (not a jump button)', () => {
    mockMd = md([course({ matched: false })])
    renderGrades()
    const code = screen.getByText('BM20A9200')
    expect(code.tagName).toBe('SPAN')
  })

  it('matched course code is a jump button calling onJumpToCourse', () => {
    mockMd = md([course()])
    const onJumpToCourse = vi.fn((_c: string) => {})
    render(
      <I18nProvider>
        <GradesSection onJumpToCourse={onJumpToCourse} onOpenAssignments={() => {}} />
      </I18nProvider>,
    )
    const code = screen.getByText('BM20A9200')
    expect(code.tagName).toBe('BUTTON')
    fireEvent.click(code)
    expect(onJumpToCourse).toHaveBeenCalledWith('BM20A9200')
  })

  it('sorts by ungraded count when the 未评多 chip is chosen and persists the choice', () => {
    const graded1 = course({ course: 'AA00AA01', items: [item({ name: 'a', grade: 9, max: 10, weight: 100 })] })
    const threeUngraded = course({
      course: 'BB00BB02',
      items: [
        item({ name: 'b1', grade: null, max: 10, weight: 30 }),
        item({ name: 'b2', grade: null, max: 10, weight: 30 }),
        item({ name: 'b3', grade: null, max: 10, weight: 40 }),
      ],
    })
    mockMd = md([graded1, threeUngraded])
    renderGrades()
    fireEvent.click(buttonsMatching(/未评多/)[0])
    const codes = [...document.querySelectorAll('li > span.font-mono, li button.font-mono')].map(
      (el) => el.textContent,
    )
    expect(codes.indexOf('BB00BB02')).toBeLessThan(codes.indexOf('AA00AA01'))
    // 持久化：刷新后 sort 从 localStorage 恢复（loadSort）
    expect(localStorage.getItem('tt_grades_sort')).toContain('ungraded')
  })

  it('shows the empty hint when grades is an empty array', () => {
    mockMd = md([])
    renderGrades()
    expect(screen.getByText('还没有成绩数据，点上方按钮拉取')).toBeTruthy()
  })
})
