// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_UI_PREFS,
  SIDEBAR_DEFAULT_PX,
  SIDEBAR_MAX_PX,
  SIDEBAR_MIN_PX,
  WEEK_DENSITIES,
  applyA11y,
  clampSidebarWidth,
  hourPxOf,
  loadUiPrefs,
  saveUiPrefs,
} from '../lib/uiPrefs'

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
} as Storage

beforeEach(() => store.clear())

describe('hourPxOf', () => {
  it('maps the three density steps to increasing row heights', () => {
    const compact = hourPxOf('compact')
    const standard = hourPxOf('standard')
    const comfortable = hourPxOf('comfortable')
    expect(compact).toBeLessThan(standard)
    expect(standard).toBeLessThan(comfortable)
    // 标准档 = 周视图的基准 56px（其它模块的像素阈值以它为 1.0）
    expect(standard).toBe(56)
  })

  it('falls back to the standard step for unknown values', () => {
    expect(hourPxOf('nonsense' as never)).toBe(hourPxOf('standard'))
  })

  it('keeps every declared density usable', () => {
    for (const d of WEEK_DENSITIES) {
      expect(hourPxOf(d)).toBeGreaterThan(0)
    }
  })
})

describe('clampSidebarWidth', () => {
  it('clamps to the configured range', () => {
    expect(clampSidebarWidth(SIDEBAR_MIN_PX - 100)).toBe(SIDEBAR_MIN_PX)
    expect(clampSidebarWidth(SIDEBAR_MAX_PX + 100)).toBe(SIDEBAR_MAX_PX)
    expect(clampSidebarWidth(301.6)).toBe(302)
  })

  it('falls back to the default for non-finite input', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_PX)
    // 非有限值一律回默认宽度（不是夹到边界：NaN/Infinity 是坏输入，不是"过宽"）
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_DEFAULT_PX)
  })
})

describe('uiPrefs persistence', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadUiPrefs()).toEqual(DEFAULT_UI_PREFS)
  })

  it('round-trips density, width and the accessibility switches', () => {
    saveUiPrefs({ density: 'compact', sidebarWidth: 366, textScale: 'large', contrast: 'high' })
    expect(loadUiPrefs()).toEqual({
      density: 'compact',
      sidebarWidth: 366,
      textScale: 'large',
      contrast: 'high',
    })
  })

  it('repairs corrupted or hand-edited payloads', () => {
    store.set('tt_ui_prefs_v1', JSON.stringify({ density: 'huge', sidebarWidth: 99999 }))
    expect(loadUiPrefs()).toEqual({
      density: DEFAULT_UI_PREFS.density,
      sidebarWidth: SIDEBAR_MAX_PX,
      textScale: 'normal',
      contrast: 'normal',
    })
    store.set('tt_ui_prefs_v1', 'not json')
    expect(loadUiPrefs()).toEqual(DEFAULT_UI_PREFS)
  })

  it('writes the a11y prefs to <html> (and clears them again)', () => {
    applyA11y({ textScale: 'large', contrast: 'high' })
    expect(document.documentElement.dataset.a11ySize).toBe('large')
    expect(document.documentElement.dataset.a11yContrast).toBe('high')
    applyA11y({ textScale: 'normal', contrast: 'normal' })
    expect(document.documentElement.dataset.a11ySize).toBeUndefined()
    expect(document.documentElement.dataset.a11yContrast).toBeUndefined()
  })
})
