import { KEYS, readString, writeString } from './storage'

export type Theme = 'system' | 'dark' | 'light'

/**
 * 预设主题（网络精选配色：Nord / Catppuccin / Tokyo Night / Rosé Pine /
 * Gruvbox 官方调色板）。每个预设都有暗、亮两套完整 token，覆盖
 * `:root[data-preset=…]` —— 全应用所有模块读同一批 CSS 变量，因此切换
 * 即全局生效。'default' 是应用原生配色（无覆盖块）。
 */
export type Preset = 'default' | 'nord' | 'catppuccin' | 'tokyonight' | 'rosepine' | 'gruvbox'

/** 设置页色卡数据：id + 显示名 + 三点预览（底色/主状态/成功色）。 */
export const THEME_PRESETS: ReadonlyArray<{
  id: Preset
  name: string
  swatch: [string, string, string]
}> = [
  { id: 'default', name: 'Default', swatch: ['#101012', '#7dd3fc', '#6ee7b7'] },
  { id: 'nord', name: 'Nord', swatch: ['#2e3440', '#88c0d0', '#a3be8c'] },
  { id: 'catppuccin', name: 'Catppuccin', swatch: ['#1e1e2e', '#cba6f7', '#a6e3a1'] },
  { id: 'tokyonight', name: 'Tokyo Night', swatch: ['#1a1b26', '#7aa2f7', '#9ece6a'] },
  { id: 'rosepine', name: 'Rosé Pine', swatch: ['#191724', '#c4a7e7', '#9ccfd8'] },
  { id: 'gruvbox', name: 'Gruvbox', swatch: ['#282828', '#fabd2f', '#b8bb26'] },
]

const PRESET_IDS = new Set(THEME_PRESETS.map((p) => p.id))

export function loadPreset(): Preset {
  const saved = readString(KEYS.themePreset)
  return saved != null && PRESET_IDS.has(saved as Preset) ? (saved as Preset) : 'default'
}

export function savePreset(preset: Preset): void {
  writeString(KEYS.themePreset, preset)
}

/** 预设写到 <html data-preset>；'default' 无对应 CSS 块，属无害属性。 */
export function applyPreset(preset: Preset): void {
  document.documentElement.dataset.preset = preset
}

/** Pilihan tema pengguna; 'system' mengikuti preferensi OS. */
export function loadTheme(): Theme {
  const saved = readString(KEYS.theme)
  return saved === 'light' || saved === 'system' || saved === 'dark' ? saved : 'dark'
}

export function saveTheme(theme: Theme): void {
  writeString(KEYS.theme, theme)
}

/** Tema efektif yang dipakai CSS (`data-theme` di <html>). */
export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = resolveTheme(theme)
}
