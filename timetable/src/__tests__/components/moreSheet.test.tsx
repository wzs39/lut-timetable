// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import MoreSheet from '../../components/MoreSheet'
import type { SheetAction } from '../../lib/sheetActions'
import { I18nProvider } from '../../i18n'
import type { SyncSource } from '../../types'

// 【渲染契约】移动端「更多」抽屉：
// 1) 默认只露动作网格，来源同步 / 手动添加 / 查询 / 常用平台四块全部收起；
// 2) 格子按状态自适应：有待处理事项的排最前并带角标，无事的落到底部；
// 3) 展开状态存在独立的 sheet* key，重开抽屉仍保持上次选择；
// 4) 动作点击即「执行 + 关闭」，背景/关闭按钮同样能收起。

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

const GROUP_TITLES = ['同步日历', '手动添加课程', '查询课程（SISU）', '常用平台']

/** 基础动作集：两个有事（可更新 + 5 条重复）、两个无事 */
function defaultActions(onRun: () => void): SheetAction[] {
  return [
    { key: 'settings', icon: 'settings', label: '设置', onRun },
    { key: 'dups', icon: 'puzzle', label: '整理重复', pending: 5, priority: 3, onRun },
    { key: 'update', icon: 'sync', label: '更新到 1.2.3', attention: true, priority: 4, onRun },
    { key: 'lang', icon: 'globe', label: '语言 · EN', onRun },
  ]
}

function mount(overrides: Partial<Parameters<typeof MoreSheet>[0]> = {}) {
  const onRun = vi.fn()
  const onClose = vi.fn()
  const onSync = vi.fn()
  const utils = render(
    <I18nProvider>
      <MoreSheet
        open
        actions={defaultActions(onRun)}
        sources={sources}
        syncing={false}
        syncMessage={null}
        onSync={onSync}
        onAddManual={vi.fn()}
        onOpenSettings={vi.fn()}
        onClose={onClose}
        {...overrides}
      />
    </I18nProvider>,
  )
  return { onRun, onClose, onSync, utils }
}

/** 动作网格里的按钮，按渲染顺序 */
const gridLabels = (utils: ReturnType<typeof mount>['utils']) =>
  [...utils.container.querySelectorAll('div.grid button')].map(
    (b) => b.textContent?.trim() ?? '',
  )

const group = (title: string) => screen.getByRole('button', { name: new RegExp(title) })
const expanded = (title: string) => group(title).getAttribute('aria-expanded')

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('MoreSheet', () => {
  it('hoists the tiles that need attention and badges their count', () => {
    const { utils } = mount()
    expect(gridLabels(utils)).toEqual(['更新到 1.2.3', '整理重复5', '设置', '语言 · EN'])
    // 数量角标与「有事」提示点
    const badge = utils.container.querySelector('div.grid button .app-badge')
    expect(badge?.textContent).toBe('5')
    expect(utils.container.querySelector('div.grid .bg-\\[var\\(--due\\)\\]')).toBeTruthy()
    // 无事的格子不带角标
    const idle = [...utils.container.querySelectorAll('div.grid button')].filter(
      (b) => b.textContent === '设置',
    )
    expect(idle[0].querySelector('.app-badge')).toBeNull()
  })

  it('falls back to the declared order when nothing is pending', () => {
    const { utils } = mount({
      actions: [
        { key: 'settings', icon: 'settings', label: '设置', onRun: vi.fn() },
        { key: 'dups', icon: 'puzzle', label: '整理重复', pending: 0, onRun: vi.fn() },
      ],
    })
    expect(gridLabels(utils)).toEqual(['设置', '整理重复'])
  })

  it('shows the action grid and leaves every section folded', () => {
    mount()
    expect(screen.getByRole('dialog', { name: '更多' })).toBeTruthy()
    expect(screen.getByText('设置')).toBeTruthy()
    for (const title of GROUP_TITLES) expect(expanded(title)).toBe('false')
    // 收起时留摘要（来源数量），折叠区不至于变成黑箱
    expect(screen.getByText('1 个来源')).toBeTruthy()
  })

  it('remembers an expanded section in its own sheet key', () => {
    mount()
    fireEvent.click(group('同步日历'))
    expect(expanded('同步日历')).toBe('true')
    expect(localStorage.getItem('tt_sheet_sources_open')).toBe('1')
    // 桌面侧栏的 key 不被抽屉改动
    expect(localStorage.getItem('tt_sidebar_manual_open')).toBeNull()

    cleanup()
    mount()
    expect(expanded('同步日历')).toBe('true')
    expect(expanded('常用平台')).toBe('false')
  })

  it('runs an action and closes the sheet in one tap', () => {
    const { onRun, onClose } = mount()
    fireEvent.click(screen.getByText('设置'))
    expect(onRun).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('syncs a single source after unfolding the section', () => {
    const { onSync } = mount()
    fireEvent.click(group('同步日历'))
    expect(screen.getByText('https://sisu.lut.fi/x')).toBeTruthy()
    fireEvent.click(screen.getByText('同步'))
    expect(onSync).toHaveBeenCalledWith(sources[0])
  })

  it('closes via the close button and via the backdrop', () => {
    const { onClose, utils } = mount()
    fireEvent.click(screen.getByLabelText('关闭'))
    expect(onClose).toHaveBeenCalledTimes(1)
    const backdrop = utils.container.querySelector('.fixed.inset-0')
    expect(backdrop).toBeTruthy()
    fireEvent.click(backdrop as Element)
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
