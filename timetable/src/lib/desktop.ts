/**
 * 桌面端（Electron）常驻桥：系统托盘 + 全局快捷键。
 *
 * 浏览器 / Android / iOS 上 `window.lutDesktop` 不存在 —— 这不是「可选的额外
 * 参数」，而是「这个平台有没有桌面常驻功能」。所有调用点先过 `desktopBridge()`
 * 判空，UI 才会在有桥时出现。
 *
 * 状态的唯一所有者是主进程（userData/desktop-prefs.json）：渲染端只读状态、
 * 提交偏好、推托盘文案，不在本地再存一份。
 */
import type { Lang } from '../i18n'
// 托盘文案的唯一来源（主进程 require 同一份）：菜单是原生对象，读不到 web 的 i18n，
// 所以七条文案 + 两种语言放在 electron/tray-labels.json，两边都从这一个家取。
import TRAY_LABEL_VALUES from '../../electron/tray-labels.json'

export type DesktopPrefs = {
  /** 关闭窗口时收进托盘而不是退出 */
  closeToTray: boolean
  /** 全局快捷键呼出 / 收起窗口 */
  shortcutEnabled: boolean
}

export type DesktopState = DesktopPrefs & {
  /** Electron 加速键写法，如 `CommandOrControl+Shift+L` */
  accelerator: string
  /** 快捷键真的注册上了吗——组合键可能被别的程序占用 */
  shortcutActive: boolean
  /** `win32` / `darwin` / `linux` */
  platform: string
}

type DesktopBridge = {
  getState: () => Promise<DesktopState>
  setPrefs: (patch: Partial<DesktopPrefs>) => Promise<DesktopState>
  setTrayLabels: (labels: Record<string, string>) => void
  onCommand: (callback: (payload: { command?: string }) => void) => () => void
}

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as unknown as { lutDesktop?: DesktopBridge }).lutDesktop
  return bridge && typeof bridge.getState === 'function' ? bridge : null
}

/** 托盘菜单文案：主进程的兜底是中文，这里按语言重推一份。
 *  取语言而不是 t —— 调用点只依赖 lang，切语言才推 IPC（见 useDesktopBridge）。 */
export function trayLabels(lang: Lang): Record<string, string> {
  return { ...TRAY_LABEL_VALUES[lang] }
}

/** `CommandOrControl+Shift+L` → 当前平台看得懂的按键文本（Electron 写法不可读）。
 *  只服务这一个加速键，所以不做通用修饰键格式化——多出来的分支没人会走。 */
export function acceleratorLabel(accelerator: string, isMac: boolean): string {
  return accelerator
    .replace('CommandOrControl', isMac ? '⌘' : 'Ctrl')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace(/\+/g, ' + ')
}
