/**
 * 弹层登记表 + 状态转移（纯函数）。
 *
 * 以前 App 里每个弹层各占一个 useState 布尔，加一个弹层要在四处改：
 * state、打开它的回调、「快捷键要不要让路」的枚举、Esc 分支。漏掉第三处
 * 就是静默 bug（分享弹层打开时按「2」仍会切周视图）。现在只有这张表：
 *
 *   - 加一个弹层 = 在 OverlayId 里加一个名字 + 在 OVERLAY_META 里写两个属性，
 *     渲染时用 `overlays.isOpen('x')`。
 *   - `blocking` 从表推导，快捷键闸门不再手写枚举。
 *   - 栈顺序 = 打开顺序，`topEscapeTarget()` 取最上面那个「Esc 可关」的
 *     轻量层（⋯ 菜单 / 抽屉），不动设置这类大弹层。
 *
 * 有的弹层还带一个值（课程详情 = 选中课程的 id），所以栈里存 entry 而不是
 * 光秃秃的 id：这样「打开哪节课」和「有没有打开」只有一份真相。
 */

export type OverlayId =
  | 'settings'
  | 'batch'
  | 'conflicts'
  | 'dupes'
  | 'onboarding'
  | 'actionSheet'
  | 'sheet'
  | 'palette'
  | 'lesson'

export interface OverlayEntry {
  id: OverlayId
  /** 附带的字符串（课程详情 = lesson id）；其余弹层不用 */
  value?: string
}

interface OverlayMeta {
  /**
   * 打开期间单个按键（1-4 / 方向键 / T）一律让路。
   * 轻量菜单类为 false：它们只是个小浮层，用户仍可能想按数字切视图。
   */
  blocking: boolean
  /** Esc 关它（只列轻量层；大弹层各自处理 Esc 以保留退出动画）。 */
  escapeCloses: boolean
}

export const OVERLAY_META: Record<OverlayId, OverlayMeta> = {
  settings: { blocking: true, escapeCloses: false },
  batch: { blocking: true, escapeCloses: false },
  conflicts: { blocking: true, escapeCloses: false },
  dupes: { blocking: true, escapeCloses: false },
  onboarding: { blocking: true, escapeCloses: false },
  lesson: { blocking: true, escapeCloses: false },
  palette: { blocking: true, escapeCloses: false },
  actionSheet: { blocking: false, escapeCloses: true },
  sheet: { blocking: false, escapeCloses: true },
}

/** 打开顺序（末尾 = 最上层）。 */
export type OverlayStack = readonly OverlayEntry[]

/** 打开一个弹层（已打开则更新 value 并把顺序提到最上）。 */
export function openOverlay(
  stack: OverlayStack,
  id: OverlayId,
  value?: string,
): OverlayEntry[] {
  const rest = stack.filter((e) => e.id !== id)
  return [...rest, value === undefined ? { id } : { id, value }]
}

export function closeOverlay(stack: OverlayStack, id: OverlayId): OverlayEntry[] {
  return stack.some((e) => e.id === id) ? stack.filter((e) => e.id !== id) : [...stack]
}

export function toggleOverlay(
  stack: OverlayStack,
  id: OverlayId,
  value?: string,
): OverlayEntry[] {
  return stack.some((e) => e.id === id) ? closeOverlay(stack, id) : openOverlay(stack, id, value)
}

export function isOverlayOpen(stack: OverlayStack, id: OverlayId): boolean {
  return stack.some((e) => e.id === id)
}

/** 弹层携带的值（未打开时 null）。 */
export function overlayValue(stack: OverlayStack, id: OverlayId): string | null {
  return stack.find((e) => e.id === id)?.value ?? null
}

/** 是否有「打开即拦快捷键」的弹层（任意一个，不只看最上层）。 */
export function blocksShortcuts(stack: OverlayStack): boolean {
  return stack.some((e) => OVERLAY_META[e.id].blocking)
}

/** 最上层那个 Esc 可关的轻量弹层；没有则 null。 */
export function topEscapeTarget(stack: OverlayStack): OverlayId | null {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (OVERLAY_META[stack[i].id].escapeCloses) return stack[i].id
  }
  return null
}

