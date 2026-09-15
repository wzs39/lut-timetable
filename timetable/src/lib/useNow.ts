import { useEffect, useMemo, useState } from 'react'

/**
 * Satu jam bersama untuk seluruh aplikasi.
 *
 * Sebelumnya TodayView dan WeekGrid masing-masing memasang `setInterval`
 * 30 detik sendiri; sekarang keduanya berlangganan tick yang sama. Interval
 * dibuat saat subscriber pertama datang dan dibersihkan saat yang terakhir
 * pergi, jadi tidak ada timer yang menggantung.
 */
const TICK_MS = 30_000

type Listener = (now: number) => void

const listeners = new Set<Listener>()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  if (timer === null) timer = setInterval(pump, TICK_MS)
  // Segera beri nilai terkini agar komponen tidak menunggu satu tick.
  listener(Date.now())
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

function pump() {
  const now = Date.now()
  for (const listener of [...listeners]) listener(now)
}

/** Waktu sekarang (epoch ms), di-refresh tiap 30 detik dari satu timer bersama. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => subscribe(setNow), [])
  return now
}

/** Bentuk Date dari useNow() untuk komponen yang bekerja dengan objek Date. */
export function useNowDate(): Date {
  const now = useNow()
  return useMemo(() => new Date(now), [now])
}
