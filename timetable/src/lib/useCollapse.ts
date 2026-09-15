import { useState } from 'react'
import { readString, writeString } from './storage'

/**
 * Satu-satunya pemilik status "panel ini terbuka".
 *
 * Nilai dibaca dari localStorage saat mount dan ditulis saat di-toggle, jadi
 * pilihan pengguna bertahan setelah reload. Dipakai oleh setiap panel yang
 * bisa dilipat (TodayView) sehingga cara menyimpannya tidak digandakan.
 */
export function useCollapse(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => readString(key) !== '0')

  const toggle = () => {
    const next = !open
    setOpen(next)
    writeString(key, next ? '1' : '0')
  }

  return [open, toggle]
}
