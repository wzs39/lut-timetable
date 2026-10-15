// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import App from '../../App'
import { I18nProvider } from '../../i18n'
import { ThemeProvider } from '../../theme'
import { confirmStudyBlock, removeStudyBlock, type StudyBlockRecommendation } from '../../lib/studyBlocks'

/**
 * 【接线契约】变更即重算：确认/删除学习块后，周视图与今日页必须直接反映最新
 * 列表——不需要切换视图、也不需要重挂载。Phase 1 靠 `useMemo(..., [view])` 的
 * 隐式机制（三视图互斥，切回来才重算），本文件锁住升级后的显式版本计数：
 * 把 App 换回只依赖 `view`，第一条用例立刻变红。
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

/** 确定性的「今天 08:00–09:00」推荐，避免依赖真实当前时刻。 */
function recommendation(title: string): StudyBlockRecommendation {
  const start = new Date()
  start.setHours(8, 0, 0, 0)
  const end = new Date(start)
  end.setHours(9, 0, 0, 0)
  const due = new Date(start)
  due.setHours(20, 0, 0, 0)
  return {
    sourceKind: 'task',
    sourceId: `live-${title}`,
    title,
    dueAt: due.toISOString(),
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  }
}

function renderApp(view: 'week' | 'today') {
  window.location.hash = `#/view/${view}`
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
  localStorage.setItem('tt_onboarding_done', '1')
  mockWide(true)
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  window.location.hash = ''
  vi.restoreAllMocks()
})

describe('confirmed study blocks update live', () => {
  it('shows a block confirmed after mount in the week grid without switching views', async () => {
    renderApp('week')
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy())
    expect(screen.queryByText('Live update block')).toBeNull()

    act(() => { confirmStudyBlock(recommendation('Live update block')) })

    expect(await waitFor(() => screen.getByText('Live update block'))).toBeTruthy()
    expect(window.location.hash).toBe('#/view/week')
  })

  it('drops a block deleted after mount in the today view without switching views', async () => {
    const block = confirmStudyBlock(recommendation('Doomed block'))
    renderApp('today')
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy())
    expect(await waitFor(() => screen.getByText('Doomed block'))).toBeTruthy()

    act(() => { removeStudyBlock(block.id) })

    await waitFor(() => expect(screen.queryByText('Doomed block')).toBeNull())
    expect(window.location.hash).toBe('#/view/today')
  })
})
