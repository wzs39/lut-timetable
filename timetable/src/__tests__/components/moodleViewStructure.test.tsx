// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import MoodleView from '../../components/MoodleView'
import { I18nProvider } from '../../i18n'
import type { MoodleData } from '../../hooks/useMoodleData'
import type { Task } from '../../lib/tasks'

/**
 * 【渲染契约】Moodle 页的层级：
 * 1) 顶部「一眼概览」4 个数字（待办 / 逾期 / 未读 / 均分），点数字跳到对应分区；
 * 2) 分区导航从 6 个横排 tab 变成导轨（手机横滑、桌面竖排同一份 DOM）；
 * 3) 内容区一次只渲染一个分区，tab 与 panel 的 aria 关联保持正确。
 */

const NOW = Date.now()
const iso = (offsetDays: number) => new Date(NOW + offsetDays * 86_400_000).toISOString()

function task(p: Partial<Task> & { id: string; title: string }): Task {
  return {
    completed: false,
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    ...p,
  }
}

let mockMd: MoodleData
const syncNow = vi.fn(async () => {})

vi.mock('../../hooks/useMoodleData', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../hooks/useMoodleData')>()
  return { ...orig, useMoodleData: () => mockMd }
})

beforeEach(() => {
  localStorage.clear()
  syncNow.mockClear()
  mockMd = {
    ics: null,
    token: { token: 'tok' },
    connected: true,
    grades: [
      { course: 'CT60A4050', matched: false, average: 80, items: [] },
      { course: 'BM20A9200', matched: false, average: 60, items: [] },
    ],
    subStatus: new Map(),
    subByCmid: new Map(),
    activityDeadlinesByCmid: new Map(),
    activityDatesByCmid: new Map(),
    moduleKindByCmid: new Map(),
    registerContentsDates: () => {},
    busy: 'idle',
    message: null,
    notifications: [
      { id: 'n1', subject: 'Week 3 notes', read: false, kind: 'forum' },
      { id: 'n2', subject: 'Receipt', read: true, kind: 'receipt' },
    ],
    unread: 1,
    markNotificationRead: () => {},
    refreshNotifications: async () => {},
    refreshFromNotification: async () => {},
    setIcsUrl: () => false,
    disconnectIcs: () => {},
    connectToken: async () => false,
    disconnectToken: () => {},
    loginWithSso: () => {},
    ssoState: 'idle',
    ssoMessage: null,
    syncNow,
    refreshGrades: async () => {},
    syncSubmissions: async () => {},
    applyCompletion: () => {},
    pushTaskCompletion: vi.fn(),
  } as unknown as MoodleData
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.clearAllMocks()
})

const tasks: Task[] = [
  task({ id: 't1', title: 'Overdue report', dueAt: iso(-1) }),
  task({ id: 't2', title: 'Due in three days', dueAt: iso(3) }),
  task({ id: 't3', title: 'Already done', completed: true, dueAt: iso(1) }),
]

function mount() {
  return render(
    <I18nProvider>
      <MoodleView
        tasks={tasks}
        lessons={[]}
        onTasks={() => {}}
        onOpenAssignments={() => {}}
        onOpenSettings={() => {}}
      />
    </I18nProvider>,
  )
}

/** 概览块里的单个统计格：只在英雄卡里找，避开作业列表里的同名文案。 */
function tile(label: string): HTMLButtonElement {
  const hero = document.querySelector('.app-hero')!
  return within(hero as HTMLElement).getByText(label).closest('button') as HTMLButtonElement
}

describe('MoodleView — overview and section rail', () => {
  it('summarises pending, overdue, unread and average in one glance block', () => {
    mount()

    expect(screen.getByRole('heading', { name: '一眼概览' })).toBeTruthy()
    // 2 项未完成（已完成的不算）
    expect(tile('待办作业').textContent).toContain('2')
    expect(tile('已逾期').textContent).toContain('1')
    expect(tile('未读通知').textContent).toContain('1')
    // 80 与 60 的课程均分 → 70%
    expect(tile('当前均分').textContent).toContain('70%')
  })

  it('renders the six sections as one rail and keeps tab/panel aria wiring', () => {
    mount()

    const rail = screen.getByRole('tablist', { name: 'Moodle' })
    const tabs = [...rail.querySelectorAll('[role="tab"]')]
    expect(tabs).toHaveLength(6)
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
      'false',
      'false',
    ])
    // 导轨是一份 DOM：第 6 个分区不再需要「下一页」才能触达
    expect(screen.getByRole('tab', { name: /通知/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: /成绩/ }))
    const panel = document.getElementById('moodle-panel')!
    expect(panel.getAttribute('aria-labelledby')).toBe('moodle-tab-grades')
    expect(screen.getByRole('tab', { name: /成绩/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('lets the glance tiles jump straight to the matching section', () => {
    mount()

    fireEvent.click(tile('未读通知'))
    expect(document.getElementById('moodle-tab-notif')!.getAttribute('aria-selected')).toBe('true')
    // 通知分区确实挂载（内容来自 mock 的 notifications）
    expect(screen.getByText('Week 3 notes')).toBeTruthy()
  })

  it('refreshes through the single hero action', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: '同步' }))
    expect(syncNow).toHaveBeenCalledTimes(1)
  })
})
