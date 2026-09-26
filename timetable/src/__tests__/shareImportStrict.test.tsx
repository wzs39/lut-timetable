// @vitest-environment jsdom
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { I18nProvider } from '../i18n'
import { ThemeProvider } from '../theme'
import { parseShareHash, shareLinkFor } from '../lib/shareLink'
import { KEYS } from '../lib/storage'
import type { Lesson } from '../types'

/**
 * 【回归】分享导入必须在 StrictMode 下也**只落库一次**、并给出正确的文案。
 *
 * `importLessons` 是副作用：一旦被写进 `setState(prev => ...)` 的 updater，StrictMode
 * （见 src/main.tsx）会把 updater 跑两次——第一次真的导入，第二次只会看到「课已存在」，
 * 于是用户永远看到 shareImportAllPresent（“这些课都已在你的课表里”），永远看不到
 * shareImportDone（“已导入 N 节”）。这个测试用真 <App/> + 真 hash 入口锁住次序。
 */
const lesson: Lesson = {
  id: 'imp-1',
  source: 'manual',
  title: '导入验证课',
  code: 'IMP100',
  type: 'lecture',
  location: 'M19_AUD1B',
  start: '2026-09-28T07:00:00.000Z',
  end: '2026-09-28T08:00:00.000Z',
}

function openImportLink() {
  const link = shareLinkFor([lesson], 'https://lut.example/app/')
  expect(link, 'shareLinkFor 必须能为这一节课生成链接').toBeTruthy()
  const payload = parseShareHash(new URL(link as string).hash)
  expect(payload, 'parseShareHash 必须能解回载荷').toBeTruthy()
  window.location.hash = `#/import/${payload}`
}

function renderApp() {
  render(
    <StrictMode>
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>
    </StrictMode>,
  )
}

beforeEach(() => {
  cleanup()
  localStorage.clear()
  localStorage.setItem(KEYS.onboardingDone, '1')
  localStorage.setItem(KEYS.lessons, '[]')
  openImportLink()
})

describe('分享导入 × StrictMode', () => {
  it('导入一次并报「已导入 N 节」，而不是去重文案', async () => {
    renderApp()

    const confirm = await screen.findByRole('button', { name: '导入' })
    confirm.click()

    await waitFor(() => expect(screen.getByText(/已导入 1 节/)).toBeTruthy())
    // 去重文案不该出现，课也只落了一次
    expect(screen.queryByText(/这些课都已在你的课表里/)).toBeNull()
    expect(JSON.parse(localStorage.getItem(KEYS.lessons) || '[]')).toHaveLength(1)
  })

  it('取消不落库：关掉确认框后课表仍是空的', async () => {
    renderApp()

    const cancel = await screen.findByRole('button', { name: '取消' })
    cancel.click()

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(JSON.parse(localStorage.getItem(KEYS.lessons) || '[]')).toHaveLength(0)
  })
})
