import { useState } from 'react'
import { readString, writeString } from './storage'

/**
 * Satu-satunya pemilik status "panel ini terbuka".
 *
 * Nilai dibaca dari localStorage saat mount dan ditulis saat di-toggle, jadi
 * pilihan pengguna bertahan setelah reload. Dipakai oleh setiap panel yang
 * bisa dilipat (TodayView) sehingga cara menyimpannya tidak digandakan.
 */
/**
 * `defaultOpen` hanya dipakai saat pengguna BELUM pernah memilih (kunci belum
 * ada) — panel yang jarang dipakai bisa default tertutup tanpa memaksa.
 */
export function useCollapse(key: string, defaultOpen = true): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    const stored = readString(key)
    return stored === null ? defaultOpen : stored !== '0'
  })

  const toggle = () => {
    const next = !open
    setOpen(next)
    writeString(key, next ? '1' : '0')
  }

  return [open, toggle]
}
