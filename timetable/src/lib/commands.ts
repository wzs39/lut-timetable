import type { IconName } from '../components/Icon'
import type { SheetAction } from './sheetActions'

/**
 * 应用动作的唯一声明处。
 *
 * 以前加一个动作要同时改四处：`PaletteAction` 联合类型、`buildPalette` 的
 * 动作数组、App 的 dispatch switch、以及桌面 ⋯ 菜单 / 移动「更多」抽屉。
 * 现在只在 `buildAppCommands` 里加一条：三处入口都从这份列表派生，
 * 顺序与「待处理优先」也由同一条规则决定。
 *
 * 这里保持纯函数（回调由调用方注入），所以「哪些动作出现 / 谁的标签是什么 /
 * 谁排前面」可以单测，不需要渲染任何组件。
 */

export interface AppCommand {
  id: string
  /** 已本地化的文案（调用方已经把 t() 应用过） */
  label: string
  icon: IconName
  run: () => void
  /** 命令面板（Ctrl+K）里出现；默认 false */
  showInPalette?: boolean
  /** 桌面 ⋯ 菜单里出现；默认 false */
  showInMenu?: boolean
  /** 移动端「更多」抽屉的动作格子里出现；默认 false */
  showInSheet?: boolean
  /** 待处理数量（重复项 / 已隐藏项） */
  pending?: number
  /** 有事项但数不出来（如「可更新」） */
  attention?: boolean
  /** 同为待处理时的排序权重，越大越靠前 */
  priority?: number
}

export interface AppCommandInput {
  t: (key: string, params?: Record<string, string | number>) => string
  lang: string
  onToggleLang: () => void
  openSettings: () => void
  openBatch: () => void
  openConflicts: () => void
  openDupResolver: () => void
  unhideAll: () => void
  hiddenCount: number
  syncAll: () => void
  exportBackup: () => void
  exportIcs: () => void
  printWeek: () => void
  shareWeek: () => void
  checkUpdate: () => void
  openOnboarding: () => void
  dupCount: number
  update: { version: string; kind: string } | null
  updateChecking: boolean
  canPrint: boolean
}

/**
 * 动作清单。声明顺序 = 命令面板顺序；「更多」抽屉再按待处理优先重排。
 * 只在真的有事可做时才产出该条（重复 / 隐藏 / 打印平台）。
 */
export function buildAppCommands(input: AppCommandInput): AppCommand[] {
  const {
    t,
    lang,
    onToggleLang,
    openSettings,
    openBatch,
    openConflicts,
    openDupResolver,
    unhideAll,
    hiddenCount,
    syncAll,
    exportBackup,
    exportIcs,
    printWeek,
    shareWeek,
    checkUpdate,
    openOnboarding,
    dupCount,
    update,
    updateChecking,
    canPrint,
  } = input

  const updatePending =
    !!update &&
    (update.kind === 'available' || update.kind === 'ready' || update.kind === 'downloading')

  const commands: AppCommand[] = [
    {
      id: 'settings',
      label: t('settingsTitle'),
      icon: 'settings',
      run: openSettings,
      showInPalette: true,
      showInMenu: true,
      showInSheet: true,
    },
    {
      id: 'sync',
      label: t('paletteSyncAll'),
      icon: 'sync',
      run: syncAll,
      showInPalette: true,
    },
    {
      id: 'batch',
      label: t('batchButton'),
      icon: 'search',
      run: openBatch,
      showInPalette: true,
      showInMenu: true,
      showInSheet: true,
    },
    {
      id: 'conflicts',
      label: t('conflictsButton'),
      icon: 'warn',
      run: openConflicts,
      showInPalette: true,
      showInMenu: true,
      showInSheet: true,
    },
  ]

  if (dupCount > 0) {
    commands.push({
      id: 'dupes',
      label: t('dupButton', { n: dupCount }),
      icon: 'puzzle',
      run: openDupResolver,
      showInPalette: true,
      showInMenu: true,
      showInSheet: true,
      pending: dupCount,
      priority: 3,
    })
  }

  if (hiddenCount > 0) {
    commands.push({
      id: 'unhide',
      label: t('hiddenN', { n: hiddenCount }),
      icon: 'eye-off',
      run: unhideAll,
      showInMenu: true,
      showInSheet: true,
      pending: hiddenCount,
      priority: 2,
    })
  }

  commands.push(
    {
      id: 'exportBackup',
      label: t('exportData'),
      icon: 'link',
      run: exportBackup,
      showInPalette: true,
    },
    {
      id: 'exportIcs',
      label: t('exportIcs'),
      icon: 'link',
      run: exportIcs,
      showInPalette: true,
    },
  )

  if (canPrint) {
    commands.push({
      id: 'print',
      label: t('printWeek'),
      icon: 'note',
      run: printWeek,
      showInPalette: true,
    })
  }

  commands.push(
    {
      id: 'shareWeek',
      label: t('shareWeek'),
      icon: 'link',
      run: shareWeek,
      showInPalette: true,
    },
    {
      id: 'update',
      label: updatePending
        ? t(update?.kind === 'ready' ? 'updateTileReady' : 'updateTileAvailable', {
            v: update?.version ?? '',
          })
        : updateChecking
          ? t('updateChecking')
          : t('updateCheck'),
      icon: 'sync',
      run: checkUpdate,
      showInPalette: true,
      showInMenu: true,
      showInSheet: true,
      attention: updatePending,
      priority: 4,
    },
    {
      id: 'lang',
      label: `${t('langTitle')} · ${lang === 'zh' ? 'EN' : '中文'}`,
      icon: 'globe',
      run: onToggleLang,
      showInSheet: true,
    },
    {
      id: 'onboarding',
      label: t('obReplay'),
      icon: 'compass',
      run: openOnboarding,
      showInPalette: true,
      showInMenu: true,
      showInSheet: true,
    },
  )

  return commands
}

/** 动作清单 → 移动端「更多」抽屉的格子（排序仍由 sheetActions 负责）。 */
export function toSheetActions(commands: AppCommand[]): SheetAction[] {
  return commands
    .filter((c) => c.showInSheet)
    .map((c) => ({
      key: c.id,
      icon: c.icon,
      label: c.label,
      onRun: c.run,
      pending: c.pending,
      attention: c.attention,
      priority: c.priority,
    }))
}
