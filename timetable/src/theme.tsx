import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  applyPreset,
  applyTheme,
  loadPreset,
  loadTheme,
  resolveTheme,
  savePreset,
  saveTheme,
  type Preset,
  type Theme,
} from './lib/theme'

interface ThemeCtx {
  /** Preferensi tersimpan: 'system' | 'dark' | 'light' */
  theme: Theme
  setTheme: (theme: Theme) => void
  /** 预设配色（Nord/Catppuccin/…），与深浅模式正交组合。 */
  preset: Preset
  setPreset: (preset: Preset) => void
}

const Ctx = createContext<ThemeCtx | null>(null)

/**
 * Satu-satunya pemilik preferensi tema (mode + preset warna).
 *
 * main.tsx tetap menerapkan tema & preset tersimpan sebelum render pertama
 * supaya tidak ada kedip tema saat memuat; setelah itu provider inilah yang
 * menyimpan, menerapkan ke <html data-theme data-preset>, dan membagikannya
 * ke seluruh pohon. Konsumen cukup `useTheme()` — tidak perlu tahu cara
 * persist-nya.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [preset, setPreset] = useState<Preset>(loadPreset)

  useEffect(() => {
    applyTheme(theme)
    saveTheme(theme)
  }, [theme])

  // Preset warna: tulis ke <html data-preset> + persist.
  useEffect(() => {
    applyPreset(preset)
    savePreset(preset)
  }, [preset])

  // Mode 'system' ikut berubah saat pengaturan OS berganti.
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => applyTheme(resolveTheme('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  return <Ctx.Provider value={{ theme, setTheme, preset, setPreset }}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
