import { useCallback, useEffect, useRef, useState } from 'react'

/** Must match --dur-med in index.css: the exit classes run exactly this long. */
export const EXIT_MS = 220

type Close = () => void

/** Reduced-motion preference as a mutable probe (tests/edge runtimes override). */
export const reducedMotionProbe: { get: () => boolean } = {
  get: () =>
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
}

/**
 * Frame keluar untuk satu overlay: `closing` mengganti kelasnya ke
 * `animate-fade-out` / `animate-exit-down`, lalu `onClosed` melepas render.
 * Semua jalur tutup (klik luar, ESC, ✕, tombol aksi) memanggil `requestClose`,
 * bukan `onClosed` langsung — dan `requestClose` aman dipanggil dua kali.
 */
export function useExitAnimation(onClosed: Close): [boolean, Close] {
  const [closing, setClosing] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const onClosedRef = useRef(onClosed)
  onClosedRef.current = onClosed

  useEffect(() => {
    return () => {
      if (timer.current !== undefined) clearTimeout(timer.current)
    }
  }, [])

  const requestClose = useCallback(() => {
    if (reducedMotionProbe.get()) {
      onClosedRef.current()
      return
    }
    setClosing((prev) => {
      if (prev) return prev
      timer.current = window.setTimeout(() => onClosedRef.current(), EXIT_MS)
      return true
    })
  }, [])

  return [closing, requestClose]
}

/**
 * Menahan permukaan tetap ter-render selama frame keluarnya bermain
 * (dipakai drawer ponsel): mounted = `open || sedang menutup`. Buka ulang
 * di tengah frame keluar membatalkannya dan langsung tampil lagi.
 */
export function useDelayedUnmount(open: boolean, ms = EXIT_MS): boolean {
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (open) {
      setClosing(false)
      return
    }
    if (reducedMotionProbe.get()) return
    setClosing(true)
    const t = window.setTimeout(() => setClosing(false), ms)
    return () => clearTimeout(t)
  }, [open, ms])

  return open || closing
}
