// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import TimelineSection from '../../components/moodle/TimelineSection'
import { I18nProvider } from '../../i18n'
import type { MoodleData } from '../../hooks/useMoodleData'
import type { Task } from '../../lib/tasks'
import type { Lesson } from '../../types'

// 【渲染契约】时间线四桶卡片 ⇄ 内嵌作业列表（assign 视图并入后的替代交互）：
// - 卡片点击 → 列表分组筛选 + onClearAssignPreset（清 App 级预置，卡片接管）
// - 外部预置（App 级 assignPreset：成绩卡未评项、命令面板任务项跳转）优先于卡片
// - 再点同卡片 = 取消筛选，回到全部

const NOW = new Date()
/** 相对今天 ±offset 天的本地正午，规避手写 UTC 字面量的时区差一天问题。 */
const day = (offset: number) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset, 12).toISOString()

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
  start: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1, 9).toISOString(),
  end: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1, 11).toISOString(),
}

const overdueTask = task({ id: 't1', title: 'Overdue report', dueAt: day(-1) })
const weekTask = task({ id: 't2', title: 'Due in three days', dueAt: day(3) })
const laterTask = task({ id: 't3', title: 'Due in twenty days', dueAt: day(20) })

let mockMd: MoodleData

vi.mock('../../hooks/useMoodleData', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../hooks/useMoodleData')>()
  return { ...orig, useMoodleData: () => mockMd }
})

beforeEach(() => {
  // Mock provider value: only the fields AssignmentsView/TaskRow read.
  mockMd = {
    ics: null,
    token: { token: 'tok', userid: 2 },
    connected: true,
    grades: null,
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
    pushTaskCompletion: vi.fn(),
  } as unknown as MoodleData
})

afterEach(cleanup)

type SectionProps = Parameters<typeof TimelineSection>[0]

function renderSection(props: Partial<SectionProps> = {}) {
  const base: SectionProps = {
    tasks: [overdueTask, weekTask, laterTask],
    lessons: [lesson],
    onTasks: () => {},
  }
  return render(
    <I18nProvider>
      <TimelineSection {...base} {...props} />
    </I18nProvider>,
  )
}

/** 四桶卡片是唯一带 aria-pressed 的按钮（作业列表的分组 chips 没有），按此定位。 */
function cards(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button[aria-pressed]')] as HTMLButtonElement[]
}

describe('TimelineSection — cards drive the embedded assignment list', () => {
  it('renders the four bucket cards unfiltered by default', () => {
    renderSection()
    expect(cards()).toHaveLength(4)
    expect(screen.getByText('Overdue report')).toBeTruthy()
    expect(screen.getByText('Due in three days')).toBeTruthy()
    expect(screen.getByText('Due in twenty days')).toBeTruthy()
  })

  it('clicking a card filters the list and pressing again clears it', () => {
    renderSection()
    const overdue = cards()[0] // 桶序：overdue | today | week | month
    fireEvent.click(overdue)
    expect(overdue.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Overdue report')).toBeTruthy()
    expect(screen.queryByText('Due in three days')).toBeNull()
    expect(screen.queryByText('Due in twenty days')).toBeNull()

    fireEvent.click(overdue) // 再点 = 取消筛选
    expect(overdue.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('Due in twenty days')).toBeTruthy()
  })

  it('clicking a card clears the external preset so the local filter takes over', () => {
    const clear = vi.fn()
    const { rerender } = renderSection({
      assignPreset: { filter: 'due7', query: 'BM20A9200' },
      onClearAssignPreset: clear,
    })
    // 预置优先：列表按 due7 + 搜索词过滤
    expect(screen.queryByText('Overdue report')).toBeNull()

    fireEvent.click(cards()[0])
    expect(clear).toHaveBeenCalledTimes(1)

    // App 清掉预置后（assignPreset=null），卡片本地筛选接管
    rerender(
      <I18nProvider>
        <TimelineSection
          tasks={[overdueTask, weekTask, laterTask]}
          lessons={[lesson]}
          onTasks={() => {}}
          assignPreset={null}
          onClearAssignPreset={clear}
        />
      </I18nProvider>,
    )
    expect(cards()[0].getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Overdue report')).toBeTruthy()
    expect(screen.queryByText('Due in three days')).toBeNull()
  })

  it('an arriving preset re-filters the list on rerender (jump points)', () => {
    const { rerender } = renderSection()
    expect(screen.getByText('Overdue report')).toBeTruthy()

    rerender(
      <I18nProvider>
        <TimelineSection
          tasks={[overdueTask, weekTask, laterTask]}
          lessons={[lesson]}
          onTasks={() => {}}
          assignPreset={{ filter: 'later', query: undefined }}
        />
      </I18nProvider>,
    )
    expect(screen.getByText('Due in twenty days')).toBeTruthy()
    expect(screen.queryByText('Overdue report')).toBeNull()
  })
})
