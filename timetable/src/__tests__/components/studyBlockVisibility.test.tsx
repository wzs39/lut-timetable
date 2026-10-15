// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import App from '../../App'
import { I18nProvider } from '../../i18n'
import { ThemeProvider } from '../../theme'
import { KEYS } from '../../lib/storage'
import { confirmStudyBlock, planStudyBlocks, type StudyBlock } from '../../lib/studyBlocks'

/**
 * 【接线契约】App 是学习块在周视图/今日页可见性的唯一接线点：它按 `view`
 * 重读 `loadStudyBlocks()`，因为今日/周/Moodle 三视图互斥渲染，确认只可能
 * 发生在 Moodle 视图，切回时依赖变化即重算。本文件锁住这条隐式机制，
 * 免得将来被当成死代码删掉（Phase 2 会升级成「变更即重算」）。
 */

function mockWide(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/** 用真实排程+确认链路造一条今天的块，避免手写存储形状与实现漂移。 */
function seedConfirmedBlock(title: string): StudyBlock {
  const now = new Date()
  now.setHours(7, 0, 0, 0)
  const due = new Date(now)
  due.setHours(20, 0, 0, 0)
  const { recommendations } = planStudyBlocks({
    items: [{ sourceKind: 'task', sourceId: 'task-seed', title, dueAt: due.toISOString() }],
    lessons: [],
    confirmed: [],
    now,
  })
  return confirmStudyBlock(recommendations[0])
}

function renderApp() {
  render(
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  // 无来源无课程时首次引导会自动弹出：这里只关心周视图本身。
  localStorage.setItem('tt_onboarding_done', '1')
  window.location.hash = '#/view/week'
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.location.hash = ''
  vi.restoreAllMocks()
})

describe('confirmed study blocks in the week view', () => {
  it('shows a stored block in the week grid and keeps it read-only', async () => {
    mockWide(true)
    const block = seedConfirmedBlock('Focus on the report')
    expect(block.id).toBeTruthy()

    renderApp()
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy())

    const title = await waitFor(() => screen.getByText('Focus on the report'))
    expect(title.closest('button')).toBeNull()
    expect(title.closest('[title]')?.textContent).toContain('08:00')
    // 学习块不能落进课程存储
    expect(JSON.parse(localStorage.getItem(KEYS.lessons) ?? '[]')).toEqual([])
  })

  it('renders no block rows when nothing is confirmed', async () => {
    mockWide(true)
    renderApp()
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy())
    expect(screen.queryByText('Focus on the report')).toBeNull()
  })
})
