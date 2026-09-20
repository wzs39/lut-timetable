import { Capacitor } from '@capacitor/core'
import type { Lesson } from '../types'
import type { Task } from './tasks'

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
/** Tasks widget payload — TasksWidgetProvider.kt membaca key ini. */
const PREF_TASK_KEY = 'widget_tasks_payload_v1'
/** Deep-link nav dari widget tap: MainActivity menulis, web boot mengonsumsi. */
const PREF_NAV_KEY = 'widget_nav_v1'

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

export interface WidgetTasksPayload {
  updatedAt: number
  /**
   * Tugas belum selesai, paling dekat deadline dulu, maks 8. `d` = tanggal
   * jatuh tempo (dd.MM., tampilan), `dms` = epoch ms — native menandai LATE
   * bila dms < now, `late` sudah dihitung di sini juga untuk fallback.
   */
  items: { t: string; c: string; d: string; dms: number; late: boolean }[]
  openCount: number
}

/** Bangun payload tugas murni dari daftar task (dapat diuji). */
export function buildTasksPayload(
  tasks: Task[],
  now: Date = new Date(),
): WidgetTasksPayload {
  const open = tasks.filter((t) => !t.completed)
  const items = open
    .filter((t) => t.dueAt)
    .sort((a, b) => (a.dueAt || '').localeCompare(b.dueAt || ''))
    .slice(0, 8)
    .map((t) => {
      const due = new Date(t.dueAt as string)
      const p = (n: number) => String(n).padStart(2, '0')
      const dms = due.getTime()
      return {
        t: t.title,
        c: t.course || '',
        d: `${p(due.getDate())}.${p(due.getMonth() + 1)}.`,
        dms,
        late: dms < now.getTime(),
      }
    })
  return { updatedAt: now.getTime(), items, openCount: open.length }
}

/** Tulis payload tugas untuk widget (hanya di native; web tidak punya widget). */
export async function pushTasksData(tasks: Task[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.set({
      key: PREF_TASK_KEY,
      value: JSON.stringify(buildTasksPayload(tasks)),
    })
    await refreshWidgets()
  } catch {
    // Widget adalah bonus — kegagalan push tidak boleh mengganggu app.
  }
}

/**
 * Konsumsi deep-link nav dari tap widget (dipakai main.tsx sebelum render
 * pertama): baca view, HAPUS key-nya (sekali pakai), balikan view atau null.
 */
export async function consumeWidgetNav(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { Preferences } = await import('@capacitor/preferences')
    const { value } = await Preferences.get({ key: PREF_NAV_KEY })
    if (value) await Preferences.remove({ key: PREF_NAV_KEY })
    return value || null
  } catch {
    return null
  }
}

/**
 * Pasang jembatan nav warm-start: MainActivity mengevaluasi
 * `window.__widgetNav('assign')` lewat evaluateJavascript saat app sudah
 * berjalan. Menulis hash (listener hashchange di App memindah view) dan
 * menghapus pref agar boot berikutnya tidak nav ulang.
 */
export function installWidgetNavBridge(): void {
  const w = window as unknown as {
    __widgetNav?: (view: string) => void
  }
  w.__widgetNav = (view: string) => {
    if (!/^(today|week|assign|moodle)$/.test(view)) return
    location.hash = `#/view/${view}`
    void (async () => {
      try {
        const { Preferences } = await import('@capacitor/preferences')
        await Preferences.remove({ key: PREF_NAV_KEY })
      } catch {
        /* pref basi saja tidak masalah — konsumsi boot juga idempoten */
      }
    })()
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
    const plugins = (Capacitor as unknown as {
      Plugins?: { lutWidget?: { refresh: () => Promise<{ updated: number }> } }
    }).Plugins
    await plugins?.lutWidget?.refresh()
  } catch {
    // Widget adalah bonus.
  }
}
