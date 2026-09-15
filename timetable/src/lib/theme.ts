import { KEYS, readString, writeString } from './storage'

export type Theme = 'system' | 'dark' | 'light'

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
