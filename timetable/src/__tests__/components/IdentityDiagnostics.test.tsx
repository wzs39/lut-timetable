// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import IdentityDiagnostics from '../../components/IdentityDiagnostics'
import { I18nProvider } from '../../i18n'
import type { SyncSource } from '../../types'

// 【渲染契约】诊断区块的「重新同步身份表」按钮：
//   点击 → 调 onResync → 反馈文案（成功/无 token/异常）；
//   请求期间按钮禁用防双击；无 token 时不清缓存不报错。

const src: SyncSource = {
  id: 's1',
  type: 'sisu',
  url: 'https://x',
  icsUrl: 'https://x/ics',
  label: 'SISU',
  count: 3,
}

function mount(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>)
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('IdentityDiagnostics resync button', () => {
  it('calls onResync and shows success feedback', async () => {
    const onResync = vi.fn(async () => true)
    mount(<IdentityDiagnostics sources={[src]} revision={0} onResync={onResync} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(onResync).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('已重新同步，身份数已更新')).toBeTruthy())
  })

  it('shows no-token feedback and does not throw', async () => {
    const onResync = vi.fn(async () => false)
    mount(<IdentityDiagnostics sources={[src]} revision={0} onResync={onResync} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByText('未连接 Moodle，无法重新同步')).toBeTruthy())
  })

  it('shows failure feedback when onResync throws', async () => {
    const onResync = vi.fn(async () => {
      throw new Error('network')
    })
    mount(<IdentityDiagnostics sources={[src]} revision={0} onResync={onResync} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByText('重新同步失败，请检查网络后重试')).toBeTruthy())
  })

  it('disables the button while resyncing', async () => {
    let resolveFn: (v: boolean) => void = () => {}
    const onResync = vi.fn(() => new Promise<boolean>((res) => { resolveFn = res }))
    mount(<IdentityDiagnostics sources={[src]} revision={0} onResync={onResync} />)
    fireEvent.click(screen.getByRole('button'))
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
    resolveFn(true)
    await waitFor(() => expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false))
  })
})
