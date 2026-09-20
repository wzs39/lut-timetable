// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AssignmentsView from '../../components/AssignmentsView'
import { I18nProvider } from '../../i18n'
import type { MoodleData } from '../../hooks/useMoodleData'
import type { SubmissionStatus } from '../../lib/submissions'
import type { Task } from '../../lib/tasks'
import type { Lesson } from '../../types'

// 【渲染契约】作业页的初值语义、分组 chips 计数、提交徽标联接、
// 模块图标与反向同步的勾选行为。mock 掉 MoodleData（组件只读它）。

const NOW = new Date(2026, 8, 15, 12, 0, 0) // 周二

function task(p: Partial<Task> & { id: string; title: string }): Task {
  return {
    completed: false,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...p,
  }
}

const lesson: Lesson = {
  id: 'l1',
  source: 'sisu',
  title: 'Mathematics A',
  code: 'BM20A9200',
  start: new Date(2026, 8, 16, 9, 0).toISOString(),
  end: new Date(2026, 8, 16, 11, 0).toISOString(),
}

const submitted: SubmissionStatus = { state: 'submitted' }
const graded: SubmissionStatus = { state: 'graded', grade: '9/10', feedback: 'Good' }

/** Mock provider value: only the fields AssignmentsView reads. */
function md(subByKey: Record<string, SubmissionStatus>): MoodleData {
  return {
    ics: null,
    token: { token: 'tok', userid: 2 },
    connected: true,
    grades: null,
    subStatus: new Map(Object.entries(subByKey)),
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
    pushTaskCompletion: vi.fn(),
  } as unknown as MoodleData
}

function buttonsMatching(re: RegExp): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((b) => re.test(b.textContent || ''))
}

let mockMd: MoodleData

vi.mock('../../hooks/useMoodleData', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../hooks/useMoodleData')>()
  return { ...orig, useMoodleData: () => mockMd }
})

function renderView(tasks: Task[], props: Partial<Parameters<typeof AssignmentsView>[0]> = {}) {
  return render(
    <I18nProvider>
      <AssignmentsView
        tasks={tasks}
        lessons={[lesson]}
        onChange={() => {}}
        {...props}
      />
    </I18nProvider>,
  )
}

describe('AssignmentsView — rendering contracts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    localStorage.clear()
    mockMd = md({})
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders all tasks directly without clicking a chip (initialFilter reset contract)', () => {
    const tasks = [
      task({ id: 'a', title: 'Overdue one', dueAt: new Date(2026, 8, 10).toISOString() }),
      task({ id: 'b', title: 'Later one', dueAt: new Date(2026, 10, 1).toISOString() }),
    ]
    renderView(tasks)
    // 侧栏导航（无预置筛选）→ 全部组直接显示 2 行
    expect(screen.getByText('Overdue one')).toBeTruthy()
    expect(screen.getByText('Later one')).toBeTruthy()
    // chip 计数：全部 2、已逾期 1
    const allChip = buttonsMatching(/^全部/)[0]
    expect(allChip.textContent).toContain('2')
    expect(buttonsMatching(/已逾期/)[0].textContent).toContain('1')
  })

  it('seeds the search box from initialQuery and filters rows by embedded course code', () => {
    const tasks = [
      task({ id: 'a', title: 'Assignment 2: Persona', course: 'BM20A9200 Contact teaching', dueAt: new Date(2026, 9, 20).toISOString() }),
      task({ id: 'b', title: 'Other course work', course: 'ZZ00AA11 Something', dueAt: new Date(2026, 9, 21).toISOString() }),
    ]
    renderView(tasks, { initialQuery: 'BM20A9200' })
    const input = document.querySelector<HTMLInputElement>('input[type="text"], input:not([type])')!
    expect(input.value).toBe('BM20A9200')
    // 预置查询命中第一门课（代码内嵌于 course 串），另一门被滤掉
    expect(screen.getByText('Assignment 2: Persona')).toBeTruthy()
    expect(screen.queryByText('Other course work')).toBeNull()
  })

  it('shows the shared submission badge (graded with score) from subStatus match-key join', () => {
    const tasks = [
      task({ id: 'a', title: 'Graded work', dueAt: new Date(2026, 9, 20).toISOString() }),
      task({ id: 'b', title: 'Submitted work', dueAt: new Date(2026, 9, 21).toISOString() }),
    ]
    // 键 = taskMatchKey：norm(title)|dueAt ISO 前 10 字符（UTC）。必须从同一
    // Date 推导而不是手写——本地午夜在 UTC+8 落到前一天，在 UTC runner 上不变，
    // 手写常量会随 runner 时区漂移（v0.3.2 发布时在 CI 上炸过一次）。
    const dueKey = (d: Date) => d.toISOString().slice(0, 10)
    mockMd = md({
      [`gradedwork|${dueKey(new Date(2026, 9, 20))}`]: graded,
      [`submittedwork|${dueKey(new Date(2026, 9, 21))}`]: submitted,
    })
    renderView(tasks)
    // 文本被 Icon + span 拆成多节点 → 查容器内容
    const gradedRow = screen.getByText('Graded work').closest('li')!
    const submittedRow = screen.getByText('Submitted work').closest('li')!
    expect(gradedRow.textContent).toContain('已评分 9/10')
    expect(submittedRow.textContent).toContain('已提交')
  })

  it('renders module-type icons per moduleTypeOf (quiz vs assign vs generic)', () => {
    const tasks = [
      task({ id: 'a', title: 'Quiz task', modtype: 'quiz', url: 'https://moodle.lut.fi/mod/quiz/view.php?id=1', dueAt: new Date(2026, 9, 20).toISOString() }),
      task({ id: 'b', title: 'Assign task', modtype: 'assign', url: 'https://moodle.lut.fi/mod/assign/view.php?id=2', dueAt: new Date(2026, 9, 21).toISOString() }),
      task({ id: 'c', title: 'Workshop task', url: 'https://moodle.lut.fi/mod/workshop/view.php?id=3', dueAt: new Date(2026, 9, 22).toISOString() }),
    ]
    renderView(tasks)
    const iconD = (row: HTMLElement) => row.querySelector('svg path')?.getAttribute('d') ?? ''
    const quizRow = screen.getByText('Quiz task').closest('li')!
    const assignRow = screen.getByText('Assign task').closest('li')!
    const workshopRow = screen.getByText('Workshop task').closest('li')!
    expect(iconD(quizRow).startsWith('M3 1h10v12')).toBe(true) // quiz icon
    expect(iconD(assignRow).startsWith('M4 2h8v12')).toBe(true) // assignment icon
    expect(iconD(workshopRow).startsWith('M5 2a2')).toBe(true) // workshop icon
  })

  it('fires pushTaskCompletion for Moodle activity tasks on checkbox toggle (reverse sync)', () => {
    const tasks = [
      task({ id: 'moodle-act:42', title: 'Synced task', url: 'https://moodle.lut.fi/mod/assign/view.php?id=777', dueAt: new Date(2026, 9, 20).toISOString() }),
    ]
    renderView(tasks)
    // 第一个 checkbox 是「显示已完成」开关，任务行内的是第二个
    const cbs = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    const cb = cbs[cbs.length - 1]
    expect(cb.checked).toBe(false)
    fireEvent.click(cb)
    expect(mockMd.pushTaskCompletion).toHaveBeenCalledWith(777, true)
  })

  it('never fires pushTaskCompletion for manual tasks without a mod activity URL', () => {
    const tasks = [task({ id: 'manual-1', title: 'Manual task' })]
    renderView(tasks)
    const cbs = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    fireEvent.click(cbs[cbs.length - 1])
    expect(mockMd.pushTaskCompletion).not.toHaveBeenCalled()
  })
})
