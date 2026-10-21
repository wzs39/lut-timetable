/**
 * 设置分区的常量与纯函数（与组件文件分开：同一文件既导出组件又导出常量会
 * 破坏 fast refresh，本仓把它当 warning 处理）。
 *
 * 【2026-10-21】设置从「一条长滚 + 滚动定位」改成「导轨 + 单区」：
 * 分类、图标、说明文案都从这里派生，新增分类只改这张表。
 */
import type { IconName } from '../Icon'

export const SETTINGS_GROUP_IDS = ['appearance', 'sync', 'study', 'data', 'logs'] as const
export type SettingsGroupId = (typeof SETTINGS_GROUP_IDS)[number]

export const GROUP_LABEL_KEYS: Record<SettingsGroupId, string> = {
  appearance: 'settingsGroupAppearance',
  sync: 'settingsGroupSync',
  study: 'settingsGroupStudy',
  data: 'settingsGroupData',
  logs: 'settingsGroupLogs',
}

export const GROUP_DESC_KEYS: Record<SettingsGroupId, string> = {
  appearance: 'settingsGroupDesc_appearance',
  sync: 'settingsGroupDesc_sync',
  study: 'settingsGroupDesc_study',
  data: 'settingsGroupDesc_data',
  logs: 'settingsGroupDesc_logs',
}

/** 导轨图标：外观 = 滑块感（settings），同步 = 同步箭头，学习 = 学位帽，
 *  数据 = 拼图（导出/工具），日志 = 盾牌（诊断/订阅）。 */
export const GROUP_ICON: Record<SettingsGroupId, IconName> = {
  appearance: 'settings',
  sync: 'sync',
  study: 'graduation',
  data: 'puzzle',
  logs: 'shield',
}

/** 打开设置时默认停在「外观」——第一组是全应用最常改的开关。 */
export const DEFAULT_SETTINGS_GROUP: SettingsGroupId = 'appearance'

/** 设置输入框的统一外观（各分区共用，改一处全跟上）。 */
export const inputCls =
  'w-full rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-xs focus:outline-none focus:border-[var(--info)]'

/** 整点显示：8 → 08:00（与今日页 / 周视图的时钟口径一致）。 */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}
