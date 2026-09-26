import type { IconName } from '../components/Icon'

/**
 * 移动端「更多」抽屉里动作格子的声明式模型。
 *
 * 格子不再由 App 手动排好顺序：每个动作只声明「有没有待处理事项」
 * （`pending` 数量 / `attention` 有无），排序交给 `orderSheetActions`。
 * 纯函数，因此顺序规则可以单测，组件只负责渲染。
 */
export interface SheetAction {
  key: string
  icon: IconName
  label: string
  onRun: () => void
  /** 待处理数量（重复项 / 已隐藏项…）：>0 时提到最前并显示角标 */
  pending?: number
  /** 有事项但数不出来（如「可更新」）：同样提到最前，只显示提示点 */
  attention?: boolean
  /** 同为待处理时的排序权重，越大越靠前（默认 0） */
  priority?: number
}

/** 这个格子是否需要用户先动手 */
export function needsAttention(a: SheetAction): boolean {
  return (a.pending ?? 0) > 0 || a.attention === true
}

/**
 * 待处理的格子排到最前（先比 priority，再比数量），其余保持声明顺序。
 * 其余顺序即"无事的收到底部"：调用方按常用程度声明即可。
 */
export function orderSheetActions(actions: SheetAction[]): SheetAction[] {
  const hot = actions.filter(needsAttention)
  const rest = actions.filter((a) => !needsAttention(a))
  const ranked = [...hot].sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) || (b.pending ?? 0) - (a.pending ?? 0),
  )
  return [...ranked, ...rest]
}
