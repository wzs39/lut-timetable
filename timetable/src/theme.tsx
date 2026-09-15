import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { applyTheme, loadTheme, resolveTheme, saveTheme, type Theme } from './lib/theme'

interface ThemeCtx {
  /** Preferensi tersimpan: 'system' | 'dark' | 'light' */
  theme: Theme
  setTheme: (theme: Theme) => void
}

const Ctx = createContext<ThemeCtx | null>(null)

/**
 * Satu-satunya pemilik preferensi tema.
 *
 * main.tsx tetap menerapkan tema tersimpan sebelum render pertama supaya
 * tidak ada kedip tema saat memuat; setelah itu provider inilah yang
 * menyimpan, menerapkan ke <html data-theme>, dan membagikannya ke seluruh
 * pohon. Konsumen cukup `useTheme()` — tidak perlu tahu cara persist-nya.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(loadTheme)

  useEffect(() => {
    applyTheme(theme)
    saveTheme(theme)
  }, [theme])

  // Mode 'system' ikut berubah saat pengaturan OS berganti.
  useEffect(() => {
    if (theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => applyTheme(resolveTheme('system'))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  return <Ctx.Provider value={{ theme, setTheme }}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
