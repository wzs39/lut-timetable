import { useCallback, useEffect, useState } from 'react'
import {
  desktopBridge,
  trayLabels as buildTrayLabels,
  type DesktopPrefs,
  type DesktopState,
} from '../lib/desktop'
import type { Lang } from '../i18n'

/**
 * 桌面端（Electron）常驻接线：托盘 + 全局快捷键。
 *
 * 状态的唯一所有者在主进程（userData/desktop-prefs.json），这里只镜一份给设置页
 * 用；浏览器 / 手机上没有 lutDesktop 桥，整块静默。托盘菜单文案跟着语言重推，
 * 托盘来的「检查更新」命令复用 App 那条检查路径（含 Android APK 分支）。
 */
export function useDesktopBridge(lang: Lang, checkForUpdate: () => void) {
  const [desktop, setDesktop] = useState<DesktopState | null>(null)

  useEffect(() => {
    desktopBridge()
      ?.getState()
      .then(setDesktop)
      .catch(() => {})
  }, [])

  // 只有切语言才发 IPC，不在每次渲染都推。
  useEffect(() => {
    desktopBridge()?.setTrayLabels(buildTrayLabels(lang))
  }, [lang])

  useEffect(() => {
    const bridge = desktopBridge()
    if (!bridge) return
    return bridge.onCommand((p) => {
      if (p?.command === 'check-update') void checkForUpdate()
    })
  }, [checkForUpdate])

  const applyDesktopPrefs = useCallback((patch: Partial<DesktopPrefs>) => {
    desktopBridge()
      ?.setPrefs(patch)
      .then(setDesktop)
      .catch(() => {})
  }, [])

  return { desktop, applyDesktopPrefs }
}
