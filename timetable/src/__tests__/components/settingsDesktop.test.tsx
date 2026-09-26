// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Settings from '../../components/Settings'
import { I18nProvider } from '../../i18n'
import { MoodleProvider } from '../../hooks/useMoodleData'
import { ThemeProvider } from '../../theme'
import type { DesktopPrefs, DesktopState } from '../../lib/desktop'

// 【渲染契约】设置 → 桌面端：只有 Electron（有 lutDesktop 桥）才出现整个分区；
// 开关把偏好交给 App（唯一写入方在主进程），快捷键被占用时给出可见提示。
// Settings 里唯一的重依赖是 moodle 数据，用真的 Provider（空态）即可，其余全是 props。

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
  onClose: () => {},
}

const state = (over: Partial<DesktopState> = {}): DesktopState => ({
  closeToTray: true,
  shortcutEnabled: true,
  accelerator: 'CommandOrControl+Shift+L',
  shortcutActive: true,
  platform: 'win32',
  ...over,
})

function renderSettings(desktop: DesktopState | null, onDesktopPrefs = vi.fn()) {
  render(
    <I18nProvider>
      <ThemeProvider>
        <MoodleProvider tasks={[]} lessons={[]} onTasks={() => {}}>
          <Settings {...baseProps} desktop={desktop} onDesktopPrefs={onDesktopPrefs} />
        </MoodleProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
  return onDesktopPrefs
}

/** 开关按文案定位：label 里还夹着高亮 span，所以匹配 textContent 而不是节点文本。 */
function desktopCheckbox(re: RegExp): HTMLInputElement {
  const label = [...document.querySelectorAll('label')].find((l) => re.test(l.textContent || ''))
  const input = label?.querySelector('input')
  if (!input) throw new Error('checkbox not found: ' + re)
  return input
}

afterEach(cleanup)

describe('settings → desktop section', () => {
  it('is absent on web / mobile (no desktop state)', () => {
    renderSettings(null)
    expect(screen.queryByText('桌面端')).toBeNull()
  })

  it('shows the tray + shortcut switches and reports the active accelerator', () => {
    renderSettings(state())
    expect(screen.getByText('桌面端')).toBeTruthy()
    expect(screen.getByText(/Ctrl \+ Shift \+ L/)).toBeTruthy()
    expect(desktopCheckbox(/收进托盘/).checked).toBe(true)
    expect(desktopCheckbox(/Ctrl \+ Shift \+ L/).checked).toBe(true)
  })

  it('renders the accelerator for the actual platform', () => {
    renderSettings(state({ platform: 'darwin', accelerator: 'CommandOrControl+Shift+L' }))
    expect(screen.getByText(/⌘ \+ ⇧ \+ L/)).toBeTruthy()
  })

  it('warns when the shortcut is owned by someone else', () => {
    renderSettings(state({ shortcutActive: false }))
    expect(screen.getByText(/未生效——该组合键已被其他程序占用/)).toBeTruthy()
    // 占用提示只在开关打开时出现（关掉时它本来就不该生效）
    cleanup()
    renderSettings(state({ shortcutActive: false, shortcutEnabled: false }))
    expect(screen.queryByText(/未生效/)).toBeNull()
  })

  it('hands each switch flip to the owner of the state (main process bridge)', () => {
    const onDesktopPrefs = renderSettings(state())
    fireEvent.click(desktopCheckbox(/收进托盘/))
    expect(onDesktopPrefs).toHaveBeenCalledWith({ closeToTray: false } satisfies Partial<DesktopPrefs>)
    fireEvent.click(desktopCheckbox(/Ctrl \+ Shift \+ L/))
    expect(onDesktopPrefs).toHaveBeenCalledWith({ shortcutEnabled: false })
    expect(onDesktopPrefs).toHaveBeenCalledTimes(2)
  })
})
