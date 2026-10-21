// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  blocksShortcuts,
  closeOverlay,
  isOverlayOpen,
  openOverlay,
  overlayValue,
  topEscapeTarget,
  toggleOverlay,
  type OverlayEntry,
} from '../lib/overlays'
import { useOverlays } from '../hooks/useOverlays'

// 【弹层契约】这一层存在的意义是「加一个弹层只改登记表」，所以测试锁的是
// 行为契约（打开顺序 / 值 / 快捷键闸门 / Esc 只关轻量层），不是实现细节。

describe('lib/overlays', () => {
  it('opens in order and re-opening moves the layer to the top', () => {
    let stack: OverlayEntry[] = []
    stack = openOverlay(stack, 'settings')
    stack = openOverlay(stack, 'palette')
    expect(stack.map((e) => e.id)).toEqual(['settings', 'palette'])

    stack = openOverlay(stack, 'settings')
    expect(stack.map((e) => e.id)).toEqual(['palette', 'settings'])
  })

  it('close removes once and is a no-op for absent ids', () => {
    const stack = openOverlay(openOverlay([], 'batch'), 'dupes')
    expect(closeOverlay(stack, 'batch').map((e) => e.id)).toEqual(['dupes'])
    const untouched = closeOverlay(stack, 'settings')
    expect(untouched).toEqual(stack)
    expect(untouched).not.toBe(stack)
  })

  it('keeps a value with the layer and drops it on close', () => {
    const stack = openOverlay([], 'lesson', 'l-42')
    expect(overlayValue(stack, 'lesson')).toBe('l-42')
    expect(overlayValue(stack, 'settings')).toBeNull()
    expect(overlayValue(closeOverlay(stack, 'lesson'), 'lesson')).toBeNull()
  })

  it('toggles on and off', () => {
    const on = toggleOverlay([], 'actionSheet')
    expect(isOverlayOpen(on, 'actionSheet')).toBe(true)
    expect(isOverlayOpen(toggleOverlay(on, 'actionSheet'), 'actionSheet')).toBe(false)
  })

  it('blocks shortcuts for modal layers but not for lightweight ones', () => {
    expect(blocksShortcuts([])).toBe(false)
    expect(blocksShortcuts([{ id: 'actionSheet' }, { id: 'sheet' }])).toBe(false)
    expect(blocksShortcuts([{ id: 'sheet' }, { id: 'settings' }])).toBe(true)
    expect(blocksShortcuts([{ id: 'lesson', value: 'x' }])).toBe(true)
  })

  it('Esc targets the topmost lightweight layer, never a big dialog', () => {
    expect(topEscapeTarget([])).toBeNull()
    expect(topEscapeTarget([{ id: 'settings' }])).toBeNull()
    expect(
      topEscapeTarget([{ id: 'sheet' }, { id: 'actionSheet' }, { id: 'settings' }]),
    ).toBe('actionSheet')
  })
})

describe('useOverlays', () => {
  it('exposes open/close/isOpen/value and blocks shortcuts', () => {
    const { result } = renderHook(() => useOverlays())
    expect(result.current.isOpen('settings')).toBe(false)
    expect(result.current.blocking).toBe(false)

    act(() => result.current.open('settings'))
    act(() => result.current.open('lesson', 'l-1'))
    expect(result.current.isOpen('settings')).toBe(true)
    expect(result.current.value('lesson')).toBe('l-1')
    expect(result.current.blocking).toBe(true)

    act(() => result.current.close('settings'))
    expect(result.current.isOpen('settings')).toBe(false)
    // lesson 还开着 → 仍然拦快捷键
    expect(result.current.blocking).toBe(true)
  })

  it('starts from the given stack (首次启动引导)', () => {
    const { result } = renderHook(() => useOverlays(['onboarding']))
    expect(result.current.isOpen('onboarding')).toBe(true)
  })

  it('closeTopLightweight closes the menu but leaves dialogs open', () => {
    const { result } = renderHook(() => useOverlays(['settings']))
    act(() => result.current.open('actionSheet'))

    let closed = false
    act(() => {
      closed = result.current.closeTopLightweight()
    })
    expect(closed).toBe(true)
    expect(result.current.isOpen('actionSheet')).toBe(false)
    expect(result.current.isOpen('settings')).toBe(true)

    act(() => {
      closed = result.current.closeTopLightweight()
    })
    expect(closed).toBe(false)
    expect(result.current.isOpen('settings')).toBe(true)
  })
})
