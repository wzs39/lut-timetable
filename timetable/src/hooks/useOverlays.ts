import { useCallback, useMemo, useState } from 'react'
import {
  blocksShortcuts,
  closeOverlay,
  isOverlayOpen,
  openOverlay,
  overlayValue,
  toggleOverlay,
  topEscapeTarget,
  type OverlayEntry,
  type OverlayId,
} from '../lib/overlays'

/**
 * 弹层状态（App 里唯一的弹层所有者）。
 *
 * 用法：`overlays.open('settings')` / `overlays.isOpen('settings')` /
 * `overlays.close('settings')` / `overlays.value('lesson')`。追加新弹层只改
 * `lib/overlays` 的登记表与 App 里的一行 JSX，不再新增 useState。
 */
export function useOverlays(initial: OverlayId[] = []) {
  const [stack, setStack] = useState<OverlayEntry[]>(() => initial.map((id) => ({ id })))

  const open = useCallback(
    (id: OverlayId, value?: string) => setStack((s) => openOverlay(s, id, value)),
    [],
  )
  const close = useCallback((id: OverlayId) => setStack((s) => closeOverlay(s, id)), [])
  const toggle = useCallback(
    (id: OverlayId, value?: string) => setStack((s) => toggleOverlay(s, id, value)),
    [],
  )

  /** Esc：只关最上层的轻量层（⋯ 菜单 / 抽屉），大弹层自己处理。返回是否关了东西。 */
  const closeTopLightweight = useCallback(() => {
    const target = topEscapeTarget(stack)
    if (!target) return false
    setStack((s) => closeOverlay(s, target))
    return true
  }, [stack])

  return useMemo(
    () => ({
      stack,
      open,
      close,
      toggle,
      closeTopLightweight,
      isOpen: (id: OverlayId) => isOverlayOpen(stack, id),
      value: (id: OverlayId) => overlayValue(stack, id),
      /** 打开即拦快捷键（与登记表一致，App 不再手写枚举） */
      blocking: blocksShortcuts(stack),
    }),
    [stack, open, close, toggle, closeTopLightweight],
  )
}

export type OverlayController = ReturnType<typeof useOverlays>
