// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AppHeader from '../../components/AppHeader'
import { I18nProvider, translate } from '../../i18n'
import { MoodleProvider } from '../../hooks/useMoodleData'
import { VIEWS, WEEK_NAV } from '../../lib/navigation'

/**
 * 头部是「同一份导航声明的两种壳」之一：按钮集合、顺序、角标挂载点都必须
 * 从 lib/navigation 派生。这里用渲染结果锁住派生关系——有人把三个按钮重新
 * 写死时，加视图的测试会先红。
 */

afterEach(cleanup)

function renderHeader(view: 'today' | 'week' | 'moodle', over: { isCurrentWeek?: boolean } = {}) {
  const onView = vi.fn()
  const onWeekNav = vi.fn()
  const { container } = render(
    <I18nProvider>
      <MoodleProvider tasks={[]} lessons={[]} onTasks={() => {}}>
        <AppHeader
          view={view}
          onView={onView}
          lessonCount={2}
          sourceCount={1}
          pendingTaskCount={0}
          weekNum={42}
          weekRangeText="10月12日 – 10月18日"
          isCurrentWeek={over.isCurrentWeek ?? false}
          onWeekNav={onWeekNav}
          onOpenPalette={() => {}}
          menuOpen={false}
          onToggleMenu={() => {}}
          onCloseMenu={() => {}}
          menuCommands={[]}
        />
      </MoodleProvider>
    </I18nProvider>,
  )
  return { container, onView, onWeekNav }
}

describe('header view switcher', () => {
  it('renders one tab per declared header view, in declaration order', () => {
    const { container } = renderHeader('today')
    const labels = [...container.querySelectorAll('.app-seg button')].map((button) => button.textContent ?? '')
    const expected = VIEWS.filter((decl) => decl.inHeader).map((decl) => translate('zh', decl.labelKey))
    expect(labels).toHaveLength(expected.length)
    labels.forEach((label, index) => expect(label).toContain(expected[index]))
  })

  it('marks the active view and reports the declared page on click', () => {
    const { container, onView } = renderHeader('week')
    const buttons = [...container.querySelectorAll('.app-seg button')]
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    fireEvent.click(buttons[2])
    expect(onView).toHaveBeenCalledWith('moodle')
  })
})

describe('header week navigation', () => {
  it('reports the declared week actions instead of a bare ±1', () => {
    const { onWeekNav } = renderHeader('week')
    fireEvent.click(screen.getByRole('button', { name: translate('zh', WEEK_NAV.prev.labelKey) }))
    expect(onWeekNav).toHaveBeenCalledWith('prev')
    fireEvent.click(screen.getByRole('button', { name: translate('zh', WEEK_NAV.next.labelKey) }))
    expect(onWeekNav).toHaveBeenCalledWith('next')
    fireEvent.click(screen.getByRole('button', { name: translate('zh', WEEK_NAV.this.labelKey) }))
    expect(onWeekNav).toHaveBeenCalledWith('this')
  })

  it('only renders week controls on the week view, and “this week” only when away from it', () => {
    renderHeader('today')
    expect(screen.queryByRole('button', { name: translate('zh', WEEK_NAV.prev.labelKey) })).toBeNull()
    cleanup()

    renderHeader('week', { isCurrentWeek: true })
    expect(screen.getByRole('button', { name: translate('zh', WEEK_NAV.prev.labelKey) })).toBeTruthy()
    expect(screen.queryByRole('button', { name: translate('zh', WEEK_NAV.this.labelKey) })).toBeNull()
  })
})
