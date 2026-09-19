import { Capacitor } from '@capacitor/core'
import type { Lesson } from '../types'

/**
 * Jembatan data widget layar utama (Android AppWidget).
 *
 * Widget native (TodayWidgetProvider.kt) membaca payload JSON dari
 * Capacitor Preferences (SharedPreferences "CapacitorStorage", key
 * di bawah). Web menulis payload ringkas setiap kali pelajaran berubah
 * atau sinkron selesai — widget tidak pernah membaca localStorage
 * langsung, satu pemilik data: payload ini.
 */

const PREF_KEY = 'widget_payload_v1'

export interface WidgetPayload {
  /** epoch ms saat payload ditulis — widget menampilkan "usang" bila lama */
  updatedAt: number
  /** tanggal lokal (yyyy-mm-dd) yang digambarkan payload */
  date: string
  /**
   * Pelajaran hari ini urut waktu, SATU sesi satu entri — tanpa
   * penggabungan: sesi paralel "pilih salah satu" dan kelas berurutan
   * sama-sama ditampilkan. `sms/ems` (epoch ms) dipakai native untuk
   * menandai sesi yang sedang berlangsung saat render.
   */
  items: {
    /** hh:mm mulai (tampilan) */
    s: string
    /** hh:mm selesai (tampilan) */
    e: string
    /** kode kursus, fallback judul */
    name: string
    /** nama kursus ringkas (segmen pertama judul SISU) */
    title: string
    room: string
    /** epoch ms mulai — native menandai NOW bila now ∈ [sms, ems) */
    sms: number
    /** epoch ms selesai */
    ems: number
  }[]
  /** jumlah pelajaran minggu ini */
  weekCount: number
  /** judul pelajaran berikutnya yang belum selesai (opsional) */
  next?: { name: string; room: string; at: string } | null
  /** epoch ms mulai kelas berikutnya — widget menghitung mundur sendiri. */
  nextStartMs?: number | null
}

function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function hm(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Bangun payload murni dari daftar pelajaran (dapat diuji, tanpa I/O). */
export function buildWidgetPayload(
  lessons: Lesson[],
  now: Date = new Date(),
): WidgetPayload {
  const day = localDate(now)
  const today = lessons
    .filter((l) => localDate(new Date(l.start)) === day)
    .sort((a, b) => a.start.localeCompare(b.start))
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7)) // Senin
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)
  const weekCount = lessons.filter((l) => {
    const t = new Date(l.start)
    return t >= weekStart && t < weekEnd
  }).length
  const upcoming = today.find((l) => new Date(l.end) > now)

  return {
    updatedAt: now.getTime(),
    date: day,
    items: today.map((l) => ({
      s: hm(l.start),
      e: hm(l.end),
      name: l.code || l.title,
      title: (l.title || '').split(' · ')[0] || '',
      room: l.location || '—',
      sms: new Date(l.start).getTime(),
      ems: new Date(l.end).getTime(),
    })),
    weekCount,
    next: upcoming
      ? {
          name: upcoming.code || upcoming.title,
          room: upcoming.location || '—',
          at: hm(upcoming.start),
        }
      : null,
    nextStartMs: upcoming ? new Date(upcoming.start).getTime() : null,
  }
}

/** Tulis payload untuk widget (hanya di native; web tidak punya widget). */
export async function pushWidgetData(lessons: Lesson[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.set({
      key: PREF_KEY,
      value: JSON.stringify(buildWidgetPayload(lessons)),
    })
    await refreshWidgets()
  } catch {
    // Widget adalah bonus — kegagalan push tidak boleh mengganggu app.
  }
}

/**
 * Minta Android menggambar ulang widget sekarang. Tanpa ini widget hanya
 * diperbarui tiap updatePeriodMillis (30 menit) — pelajaran "hari ini" bisa
 * basi berjam-jam setelah sinkron. Gagal senyap: widget tetap di-refresh
 * sistem pada periode berikutnya.
 */
export async function refreshWidgets(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const bridge = (Capacitor as unknown as {
      Plugins?: { WidgetBridge?: { refresh: () => Promise<{ updated: number }> } }
    }).Plugins?.WidgetBridge
    await bridge?.refresh()
  } catch {
    // Widget adalah bonus.
  }
}
