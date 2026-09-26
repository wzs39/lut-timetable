// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import App from '../App'
import { I18nProvider } from '../i18n'
import { ThemeProvider } from '../theme'

// 【接线契约】App ⇄ 桌面桥：挂载时拉一次状态、推一份当前语言的托盘文案，
// 托盘菜单发来的命令要真的落到「检查更新」这条链上。浏览器上桥不存在时
// （本文件之外的所有渲染路径）这些都必须静默——所以这里专门注入假桥。

type Call = { getState: number; labels: Array<Record<string, string>>; prefs: Array<unknown> }

function installBridge(over: Partial<{ shortcutActive: boolean; onCommand: (cb: (p: { command?: string }) => void) => () => void }> = {}) {
  const calls: Call = { getState: 0, labels: [], prefs: [] }
  let commands: Array<(p: { command?: string }) => void> = []
  ;(window as unknown as { lutDesktop?: unknown }).lutDesktop = {
    getState: async () => {
      calls.getState += 1
      return {
        closeToTray: true,
        shortcutEnabled: true,
        accelerator: 'CommandOrControl+Shift+L',
        shortcutActive: over.shortcutActive ?? true,
        platform: 'win32',
      }
    },
    setPrefs: async (patch: unknown) => {
      calls.prefs.push(patch)
      return {
        closeToTray: true,
        shortcutEnabled: true,
        accelerator: 'CommandOrControl+Shift+L',
        shortcutActive: true,
        platform: 'win32',
      }
    },
    setTrayLabels: (labels: Record<string, string>) => calls.labels.push(labels),
    onCommand: (cb: (p: { command?: string }) => void) => {
      commands.push(cb)
      return () => {
        commands = commands.filter((c) => c !== cb)
      }
    },
  }
  return { calls, fireCommand: (p: { command?: string }) => commands.forEach((cb) => cb(p)) }
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

afterEach(() => {
  cleanup()
  delete (window as unknown as { lutDesktop?: unknown }).lutDesktop
  delete (window as unknown as { lutUpdate?: unknown }).lutUpdate
})

describe('app ⇄ desktop bridge', () => {
  it('mirrors the tray state and pushes the localized menu on mount', async () => {
    const { calls } = installBridge()
    renderApp()

    await waitFor(() => expect(calls.getState).toBe(1))
    await waitFor(() => expect(calls.labels.length).toBeGreaterThan(0))
    // 键集与主进程的托盘文案契约同集（desktop.test.ts 把两边对齐）
    expect(Object.keys(calls.labels[0]).sort()).toEqual([
      'assignments',
      'checkUpdate',
      'quit',
      'show',
      'today',
      'week',
    ])
    expect(calls.labels[0].today).toBe('今日')
  })

  it('routes the tray「检查更新」command into the update check', async () => {
    const { fireCommand } = installBridge()
    const check = vi.fn(async () => ({ ok: true, version: '1.2.3' }))
    ;(window as unknown as { lutUpdate?: unknown }).lutUpdate = {
      check,
      onUpdate: () => () => {},
      install: () => {},
    }
    renderApp()
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy())

    fireCommand({ command: 'check-update' })
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1))
    // 无关命令不触发网络检查
    fireCommand({ command: 'nope' })
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('stays silent when no bridge is exposed (web / mobile)', async () => {
    renderApp()
    await waitFor(() => expect(document.querySelector('header')).toBeTruthy())
    expect((window as unknown as { lutDesktop?: unknown }).lutDesktop).toBeUndefined()
  })
})
