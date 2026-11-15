// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import AppHeader from '../../components/AppHeader'
import BottomNav from '../../components/BottomNav'
import { I18nProvider, translate } from '../../i18n'
import { MoodleProvider } from '../../hooks/useMoodleData'
import { PomodoroProvider, usePomodoro } from '../../hooks/usePomodoro'
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

describe('Spatial Workbench Floating Instrument Dock & Mini HUD', () => {
  it('renders Tri-Source sync pulse LEDs (SISU · TimeEdit · Moodle) and Omni-Command trigger', () => {
    const { container } = renderHeader('today')
    expect(container.querySelector('header.instrument-dock')).toBeTruthy()
    const leds = screen.getByTestId('tri-source-leds')
    expect(leds.textContent).toContain('SISU')
    expect(leds.textContent).toContain('TimeEdit')
    expect(leds.textContent).toContain('Moodle')
    expect(screen.getByTestId('omni-command-trigger')).toBeTruthy()
  })

  it('displays the persistent Course-Linked Focus Mini HUD when a Pomodoro session is active', () => {
    const onInspectCourse = vi.fn()
    function TriggerBind() {
      const { startForCourse } = usePomodoro()
      return (
        <button
          type="button"
          data-testid="test-start-course-focus"
          onClick={() => startForCourse('CT60A2411')}
        >
          bind
        </button>
      )
    }
    render(
      <I18nProvider>
        <PomodoroProvider>
          <MoodleProvider tasks={[]} lessons={[]} onTasks={() => {}}>
            <TriggerBind />
            <AppHeader
              view="today"
              onView={() => {}}
              lessonCount={4}
              sourceCount={2}
              pendingTaskCount={1}
              weekNum={42}
              weekRangeText="10月12日 – 10月18日"
              isCurrentWeek={true}
              onWeekNav={() => {}}
              onOpenPalette={() => {}}
              menuOpen={false}
              onToggleMenu={() => {}}
              onCloseMenu={() => {}}
              menuCommands={[]}
              onInspectCourse={onInspectCourse}
            />
          </MoodleProvider>
        </PomodoroProvider>
      </I18nProvider>,
    )

    fireEvent.click(screen.getByTestId('test-start-course-focus'))
    const hud = screen.getByTestId('focus-mini-hud')
    expect(hud.textContent).toContain('CT60A2411')
    fireEvent.click(screen.getByText('CT60A2411'))
    expect(onInspectCourse).toHaveBeenCalledWith('CT60A2411')
    localStorage.clear()
  })

  it('renders mobile BottomNav floating instrument dock capsule and switches views', () => {
    const onView = vi.fn()
    const { container } = render(
      <I18nProvider>
        <MoodleProvider tasks={[]} lessons={[]} onTasks={() => {}}>
          <BottomNav view="today" pendingTaskCount={3} onView={onView} onOpenSheet={() => {}} />
        </MoodleProvider>
      </I18nProvider>,
    )
    expect(container.querySelector('nav.instrument-dock')).toBeTruthy()
    const navButtons = [...container.querySelectorAll('.app-nav-item')]
    fireEvent.click(navButtons[1])
    expect(onView).toHaveBeenCalledWith('week')
  })
})
