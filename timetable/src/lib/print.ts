import { Capacitor } from '@capacitor/core'

/**
 * Android WebView 没有系统打印服务，`window.print()` 只会静默无反应。
 * 与其放一个点了没用的按钮，不如在 Android 上不提供打印入口
 * （导出 .ics / 分享链接仍然可用）。
 */
export function canPrintSchedule(platform: string = Capacitor.getPlatform()): boolean {
  return platform !== 'android'
}
