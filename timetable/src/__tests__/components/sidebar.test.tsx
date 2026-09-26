// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import Sidebar from '../../components/Sidebar'
import { I18nProvider } from '../../i18n'
import type { SyncSource } from '../../types'

// 【渲染契约】桌面侧栏（embedded 缺省 = 非抽屉）：
// 同步日历 / 查询课程是普通标题块（没有折叠开关），手动添加默认收起、
// 常用平台默认展开，折叠状态记在 sidebar* key —— 抽屉的 sheet* key 不受影响。

const sources: SyncSource[] = [
  {
    id: 's1',
    type: 'sisu',
    label: 'SISU',
    url: 'https://sisu.lut.fi/x',
    icsUrl: 'https://sisu.lut.fi/x.ics',
    count: 12,
  },
]

function mount() {
  render(
    <I18nProvider>
      <Sidebar
        sources={sources}
        syncing={false}
        syncMessage={null}
        onSync={vi.fn()}
        onAddManual={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    </I18nProvider>,
  )
}

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('Sidebar (desktop)', () => {
  it('keeps sources and course search as plain blocks, not folded ones', () => {
    mount()
    expect(screen.queryByRole('button', { name: /同步日历/ })).toBeNull()
    expect(screen.getByRole('heading', { name: '同步日历' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '查询课程（SISU）' })).toBeTruthy()
    expect(screen.getByText('https://sisu.lut.fi/x')).toBeTruthy()
  })

  it('folds manual add (closed) and platforms (open) under the sidebar keys', () => {
    mount()
    expect(
      screen.getByRole('button', { name: /手动添加课程/ }).getAttribute('aria-expanded'),
    ).toBe('false')
    const links = screen.getByRole('button', { name: /常用平台/ })
    expect(links.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(links)
    expect(localStorage.getItem('tt_sidebar_links_open')).toBe('0')
    expect(localStorage.getItem('tt_sheet_links_open')).toBeNull()
  })
})
