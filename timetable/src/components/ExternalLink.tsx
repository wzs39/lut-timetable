import type { ReactNode } from 'react'
import { openExternal } from '../lib/openExternal'

interface Props {
  href: string
  className?: string
  title?: string
  /** Jangan teruskan klik ke baris induk yang juga bisa diklik. */
  stopPropagation?: boolean
  children: ReactNode
}

/**
 * Satu-satunya cara membuka tautan luar di aplikasi ini.
 *
 * Membuka tab baru (target kosong, atau jendela lewat JS) tidak berfungsi di
 * WebView native — lihat lib/openExternal.ts. Keputusan platform ada di sana,
 * jadi setiap tautan baru cukup memakai komponen ini.
 */
export default function ExternalLink({
  href,
  className,
  title,
  stopPropagation,
  children,
}: Props) {
  return (
    <a
      href={href}
      className={className}
      title={title}
      rel="noreferrer"
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation()
        e.preventDefault()
        openExternal(href)
      }}
    >
      {children}
    </a>
  )
}
