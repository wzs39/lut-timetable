import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n.tsx'
import { ThemeProvider } from './theme.tsx'
import { applyPreset, applyTheme, loadPreset, loadTheme } from './lib/theme'
import { applyA11y, loadUiPrefs } from './lib/uiPrefs'
import { consumeWidgetNav } from './lib/widgetData'
import { installErrorLogging } from './lib/errorLog'

// Satu-satunya langkah sebelum render pertama: tulis tema & preset tersimpan
// ke <html> supaya frame pertama sudah bertema benar (tidak ada kedip putih).
applyTheme(loadTheme())
applyPreset(loadPreset())
// 无障碍偏好同样要在首帧前生效（大字号/高对比下不能先闪一下正常尺寸）
applyA11y(loadUiPrefs())
// 全局兜底日志：越早装越好（首帧前的异常也要能落盘）
installErrorLogging()

/**
 * 后台刷新入口（Android 隐藏 WebView / iOS 隐藏 WKWebView）。
 *
 * 同一份 bundle、同一个 `?bg=1` 分支——后台跑的就是 App 自己的同步代码，
 * 不是另一套实现。这里不渲染 React：只需要 lib/backgroundSync 与它的依赖。
 */
async function bootBackground() {
  const { runBackgroundEntry } = await import('./lib/backgroundSync')
  await runBackgroundEntry()
}

async function boot() {
  // Widget tap saat app MATI: MainActivity menulis view ke pref — baca dan
  // konsumsi SEBELUM render, karena view state App hanya dibaca sekali dari
  // location.hash saat mount. Web (bukan native) langsung render.
  const nav = await consumeWidgetNav()
  if (nav) location.hash = `#/view/${nav}`

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>
    </StrictMode>,
  )
}

/**
 * 后台刷新的判定：Android 用 `?bg=1`（WebViewAssetLoader 的 https origin 支持 query），
 * iOS 的 file:// 不能带 query，于是由宿主注入 `window.__LUT_BG__ = true`。
 * 两者都走同一个入口，不复制一份逻辑。
 */
const isBackgroundRun =
  new URLSearchParams(location.search).has('bg') ||
  (window as unknown as { __LUT_BG__?: boolean }).__LUT_BG__ === true

if (isBackgroundRun) void bootBackground()
else void boot()
