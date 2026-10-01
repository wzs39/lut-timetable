// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Onboarding from '../../components/Onboarding'
import { I18nProvider } from '../../i18n'

function renderOnboarding(ssoAvailable: boolean) {
  const onLoginMoodle = vi.fn()
  render(
    <I18nProvider>
      <Onboarding
        onAddSource={() => 'source-id'}
        ssoAvailable={ssoAvailable}
        onLoginMoodle={onLoginMoodle}
        onFinish={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    </I18nProvider>,
  )

  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'https://example.test/calendar.ics' } })
  fireEvent.click(screen.getByRole('button', { name: '添加并同步' }))
  return onLoginMoodle
}

afterEach(cleanup)

describe('Onboarding Moodle SSO step', () => {
  it('omits the SSO action when the host cannot complete the login flow', () => {
    const onLoginMoodle = renderOnboarding(false)

    expect(screen.queryByRole('button', { name: '用 LUT 账号登录' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '跳过，稍后在设置里连接' }))
    expect(screen.getByText('准备就绪')).toBeTruthy()
    expect(onLoginMoodle).not.toHaveBeenCalled()
  })

  it('offers SSO and dispatches login when the host supports it', () => {
    const onLoginMoodle = renderOnboarding(true)

    fireEvent.click(screen.getByRole('button', { name: '用 LUT 账号登录' }))
    expect(onLoginMoodle).toHaveBeenCalledOnce()
    expect(screen.getByText('准备就绪')).toBeTruthy()
  })
})
