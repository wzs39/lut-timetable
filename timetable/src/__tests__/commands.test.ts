import { describe, expect, it, vi } from 'vitest'
import { buildAppCommands, toSheetActions, type AppCommandInput } from '../lib/commands'
import { translate } from '../i18n'

/**
 * 【动作注册表契约】三处入口（命令面板 / 桌面 ⋯ 菜单 / 移动「更多」）都从
 * 这一份清单派生。这里锁住：条件动作只在有事时出现、入口集合正确、
 * 待处理动作带 pending/attention、每个动作都有可读文案。
 */

const base = (over: Partial<AppCommandInput> = {}): AppCommandInput => ({
  t: (key, params) => translate('zh', key, params),
  lang: 'zh',
  onToggleLang: vi.fn(),
  openSettings: vi.fn(),
  openBatch: vi.fn(),
  openConflicts: vi.fn(),
  openDupResolver: vi.fn(),
  unhideAll: vi.fn(),
  hiddenCount: 0,
  syncAll: vi.fn(),
  exportBackup: vi.fn(),
  exportIcs: vi.fn(),
  printWeek: vi.fn(),
  shareWeek: vi.fn(),
  checkUpdate: vi.fn(),
  openOnboarding: vi.fn(),
  dupCount: 0,
  update: null,
  updateChecking: false,
  canPrint: true,
  ...over,
})

const ids = (list: { id: string }[]) => list.map((c) => c.id)

describe('buildAppCommands', () => {
  it('produces one unique entry per action with readable labels', () => {
    const commands = buildAppCommands(base())
    expect(new Set(ids(commands)).size).toBe(commands.length)
    expect(commands.every((c) => c.label.trim().length > 0)).toBe(true)
    expect(commands.find((c) => c.id === 'settings')?.label).toBe('设置')
    expect(commands.find((c) => c.id === 'sync')?.label).toBe('同步全部来源')
    // 没有重复/隐藏项时，这两个动作根本不出现（不是灰掉）
    expect(ids(commands)).not.toContain('dupes')
    expect(ids(commands)).not.toContain('unhide')
  })

  it('adds conditional actions with their pending counts', () => {
    const withDupes = buildAppCommands(base({ dupCount: 3, hiddenCount: 2 }))
    expect(withDupes.find((c) => c.id === 'dupes')).toMatchObject({
      pending: 3,
      priority: 3,
    })
    expect(withDupes.find((c) => c.id === 'unhide')).toMatchObject({
      pending: 2,
      priority: 2,
    })
    expect(withDupes.find((c) => c.id === 'dupes')?.label).toBe('整理重复 (3)')
  })

  it('hides print on platforms without a print service', () => {
    expect(ids(buildAppCommands(base({ canPrint: true })))).toContain('print')
    expect(ids(buildAppCommands(base({ canPrint: false })))).not.toContain('print')
  })

  it('marks an available update as attention with top priority', () => {
    const update = buildAppCommands(base({ update: { version: '0.4.0', kind: 'ready' } }))
      .find((c) => c.id === 'update')
    expect(update).toMatchObject({ attention: true, priority: 4 })
    expect(update?.label).toContain('0.4.0')
  })

  it('splits entry points from the same registry', () => {
    const commands = buildAppCommands(base({ dupCount: 1, hiddenCount: 1 }))

    expect(ids(commands.filter((c) => c.showInPalette))).toEqual([
      'settings',
      'sync',
      'batch',
      'conflicts',
      'dupes',
      'exportBackup',
      'exportIcs',
      'print',
      'shareWeek',
      'update',
      'onboarding',
    ])
    expect(ids(commands.filter((c) => c.showInMenu))).toEqual([
      'settings',
      'batch',
      'conflicts',
      'dupes',
      'unhide',
      'update',
      'onboarding',
    ])
    // 语言切换只在移动抽屉里；桌面语言在设置里
    expect(ids(commands.filter((c) => c.showInSheet))).toContain('lang')
    expect(ids(commands.filter((c) => c.showInPalette))).not.toContain('lang')
  })

  it('converts to sheet actions without losing the callback', () => {
    const run = vi.fn()
    const actions = toSheetActions([
      {
        id: 'settings',
        label: '设置',
        icon: 'settings',
        run,
        showInSheet: true,
      },
      {
        id: 'sync',
        label: '同步',
        icon: 'sync',
        run: vi.fn(),
        showInPalette: true,
      },
    ])
    expect(actions).toHaveLength(1)
    actions[0].onRun()
    expect(run).toHaveBeenCalledTimes(1)
  })
})
