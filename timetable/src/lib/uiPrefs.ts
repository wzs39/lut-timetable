import { KEYS, readJson, writeJson } from './storage'

/**
 * 界面布局偏好（周视图密度 / 侧栏宽度）。
 *
 * 纯数据 + 纯函数：读写、钳位、密度→行高映射都在这里，组件只消费结果。
 * 单一存储键（KEYS.uiPrefs）保存整组偏好，避免每加一个布局开关就多一个键。
 */

export type WeekDensity = 'compact' | 'standard' | 'comfortable'

/** 无障碍：字号档（界面里字号多为 px 写死，所以靠 zoom 整体放大） */
export type TextScale = 'normal' | 'large'
export const TEXT_SCALES: TextScale[] = ['normal', 'large']
export const LARGE_TEXT_ZOOM = 1.15

/** 无障碍：对比度档（高对比会加强次要文字/分隔线，不改色调） */
export type Contrast = 'normal' | 'high'
export const CONTRASTS: Contrast[] = ['normal', 'high']

export const WEEK_DENSITIES: WeekDensity[] = ['compact', 'standard', 'comfortable']

/** 周视图每小时的行高（px）。紧凑档用于「一天全塞进一屏」的通览。 */
const HOUR_PX: Record<WeekDensity, number> = {
  compact: 40,
  standard: 56,
  comfortable: 76,
}

export const SIDEBAR_MIN_PX = 240
export const SIDEBAR_MAX_PX = 420
export const SIDEBAR_DEFAULT_PX = 320

export interface UiPrefs {
  density: WeekDensity
  sidebarWidth: number
  textScale: TextScale
  contrast: Contrast
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  density: 'standard',
  sidebarWidth: SIDEBAR_DEFAULT_PX,
  textScale: 'normal',
  contrast: 'normal',
}

/** 密度 → 每小时像素；未知值回退标准档（旧备份/手改存储不会画崩） */
export function hourPxOf(density: WeekDensity): number {
  return HOUR_PX[density] ?? HOUR_PX.standard
}

/** 侧栏宽度钳位：非数字回默认，超出范围夹到边界 */
export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return SIDEBAR_DEFAULT_PX
  return Math.min(SIDEBAR_MAX_PX, Math.max(SIDEBAR_MIN_PX, Math.round(px)))
}

function isDensity(v: unknown): v is WeekDensity {
  return typeof v === 'string' && (WEEK_DENSITIES as string[]).includes(v)
}

function isTextScale(v: unknown): v is TextScale {
  return typeof v === 'string' && (TEXT_SCALES as string[]).includes(v)
}

function isContrast(v: unknown): v is Contrast {
  return typeof v === 'string' && (CONTRASTS as string[]).includes(v)
}

/**
 * 把无障碍偏好写到 <html>（与主题同一套路：CSS 只管显示，数据在存储）。
 * 单一入口——首帧前（main.tsx）和用户改开关时都走这里，不会两处写两份属性名。
 */
export function applyA11y(p: Pick<UiPrefs, 'textScale' | 'contrast'>): void {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  if (p.textScale === 'large') el.dataset.a11ySize = 'large'
  else delete el.dataset.a11ySize
  if (p.contrast === 'high') el.dataset.a11yContrast = 'high'
  else delete el.dataset.a11yContrast
}

/** 读偏好（损坏/缺失一律回默认），保证返回值永远可用 */
export function loadUiPrefs(): UiPrefs {
  const raw = readJson<Partial<UiPrefs>>(KEYS.uiPrefs, {})
  return {
    density: isDensity(raw.density) ? raw.density : DEFAULT_UI_PREFS.density,
    sidebarWidth: clampSidebarWidth(
      typeof raw.sidebarWidth === 'number' ? raw.sidebarWidth : SIDEBAR_DEFAULT_PX,
    ),
    textScale: isTextScale(raw.textScale) ? raw.textScale : DEFAULT_UI_PREFS.textScale,
    contrast: isContrast(raw.contrast) ? raw.contrast : DEFAULT_UI_PREFS.contrast,
  }
}

export function saveUiPrefs(p: UiPrefs): void {
  writeJson(KEYS.uiPrefs, p)
}
