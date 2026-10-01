// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Settings from '../../components/Settings'
import { I18nProvider } from '../../i18n'
import { MoodleProvider } from '../../hooks/useMoodleData'
import { ThemeProvider } from '../../theme'
import { KEYS } from '../../lib/storage'

// 【渲染契约】设置分类：15 个平铺小节归入 5 个分类，顶部有分类索引；
// SISU 学习偏好与目标学分是唯一编辑入口（其余界面只读 + 链接回来）。

const baseProps = {
  sources: [],
  syncing: false,
  syncMessage: null,
  autoSync: true,
  onToggleAutoSync: () => {},
  notifEnabled: true,
  onToggleNotif: () => {},
  digestEnabled: false,
  onToggleDigest: () => {},
  onAddSource: () => {},
  onRemoveSource: () => {},
  onSync: () => {},
  translatorUrl: '',
  onTranslatorUrl: () => {},
  onLinkTranslator: () => {},
  translatorMsg: null,
  notes: {},
  onRemoveNote: () => {},
  onExportIcs: () => {},
  onShareWeek: async () => '',
  subscriptions: [],
  onToggleSubscription: () => {},
  onRemoveSubscription: () => {},
  textScale: 'normal' as const,
  contrast: 'normal' as const,
  onTextScale: () => {},
  onContrast: () => {},
  errorCount: 0,
  onExportDiagnostics: async () => '',
  onClearErrors: () => {},
  audits: [],
  onClearAudits: () => {},
  desktop: null,
  onDesktopPrefs: () => {},
  onClose: () => {},
}

function renderSettings(onSisuPrefsChanged = vi.fn()) {
  render(
    <I18nProvider>
      <ThemeProvider>
        <MoodleProvider tasks={[]} lessons={[]} onTasks={() => {}}>
          <Settings {...baseProps} onSisuPrefsChanged={onSisuPrefsChanged} />
        </MoodleProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
  return onSisuPrefsChanged
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('settings categories', () => {
  it('groups every section under one of five labelled categories', () => {
    renderSettings()

    // 分类标题是 heading；分类索引里同名的是 button，所以按 role 区分
    expect(screen.getByRole('heading', { name: '外观与无障碍' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '同步与连接' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '学习偏好' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '数据与工具' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '日志与订阅' })).toBeTruthy()
  })

  it('offers a category index that jumps without throwing when scrollIntoView is absent', () => {
    renderSettings()

    const nav = screen.getByRole('navigation', { name: '设置分类' })
    const buttons = [...nav.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons).toEqual(['外观与无障碍', '同步与连接', '学习偏好', '数据与工具', '日志与订阅'])

    // jsdom 没有 Element.scrollIntoView：索引按钮必须容错而不是整个组件崩掉
    expect(() => fireEvent.click(nav.querySelectorAll('button')[3])).not.toThrow()
    expect(document.getElementById('settings-data')).toBeTruthy()
  })
})

describe('settings → study preferences', () => {
  it('owns the SISU study focus and persists it to the shared preference key', () => {
    const onSisuPrefsChanged = renderSettings()

    const focus = screen.getByRole('combobox')
    expect((focus as HTMLSelectElement).value).toBe('software')

    fireEvent.change(focus, { target: { value: 'systems' } })

    expect(JSON.parse(localStorage.getItem(KEYS.sisuCoursePreferences) ?? '{}').focus).toBe('systems')
    expect(onSisuPrefsChanged).toHaveBeenCalledTimes(1)
  })

  it('owns the credit goal and persists it without touching plan items', () => {
    localStorage.setItem(KEYS.sisuStudyPlan, JSON.stringify({
      goalCredits: 180,
      items: [{ id: 'keep-me', kind: 'course', title: 'Existing', completed: false, createdAt: new Date().toISOString() }],
    }))
    const onSisuPrefsChanged = renderSettings()

    const goal = screen.getByRole('spinbutton')
    expect((goal as HTMLInputElement).value).toBe('180')

    fireEvent.change(goal, { target: { value: '240' } })

    const plan = JSON.parse(localStorage.getItem(KEYS.sisuStudyPlan) ?? '{}')
    expect(plan.goalCredits).toBe(240)
    expect(plan.items).toHaveLength(1)
    expect(plan.items[0].id).toBe('keep-me')
    expect(onSisuPrefsChanged).toHaveBeenCalledTimes(1)
  })
})
