import type { Lesson } from '../types'
import type { Task } from './tasks'
import { wsCall, validateGradesSource } from './grades'
import { KEYS, readJson, writeJson } from './storage'
import { matchCourseCode, extractCourseCode } from './courses'
import { loadIdentityIndex } from './courseIdentity'

/**
 * Tugas dari Moodle timeline via webservice token — sumber KANONIS:
 *
 *   core_calendar_get_action_events_by_timesort
 *     ?timesortfrom=<sec>&limitnum=100
 *
 * Kelebihan dibanding ICS kalender:
 *  - link "action" resmi langsung ke halaman aktivitas (submit/kuis)
 *  - nama kursus eksplisit (shortname), tidak perlu ditebak dari CATEGORIES
 *  - token yang sama dipakai nilai + status submission (satu kunci saja)
 *
 * ID tugas = `moodle-act:<eventid>` (stabil antar sinkron). Task ICS lama
 * (`moodle:<uid>@moodle.lut.fi`) dengan eventid yang sama dimigrasi saat
 * sinkron — completed/note pengguna tidak hilang.
 */

export interface ActionEvent {
  /** Stabil `moodle-act:<id>` — sinkron meng-update, tidak duplikat. */
  id: string
  title: string
  course?: string
  /** Waktu aktivitas (deadline) ISO. */
  dueAt?: string
  /** URL tindakan resmi (halaman aktivitas: submit/kuis). */
  url?: string
  /** Modul Moodle, mis. "assign" | "quiz". */
  modtype?: string
}

interface RawActionEvent {
  id?: number
  name?: string
  timesort?: number
  modulename?: string
  action?: { actionable?: boolean; itemtype?: string; url?: string }
  course?: { shortname?: string; fullname?: string }
  url?: string
}

/** Modul yang dianggap "tugas" (punya deadline & bisa dikerjakan). */
const ASSIGNMENT_MODULES = new Set(['assign', 'quiz'])

/**
 * Upgrade URL tugas ICS (`calendar/view.php?event=N`) → halaman aktivitas
 * (`mod/<mod>/view.php?id=<cmid>`); event tanpa modul (maintenance dsb.)
 * diarahkan ke halaman kursus Moodle-nya.
 *
 * Sumber: `core_calendar_get_calendar_event_by_id` PER EVENT — responsnya
 * membawa `url` aktivitas siap-pakai dengan cmid SEBENAR (terverifikasi di
 * LUT: event quiz 4672733 → url id=2193942, sama dengan action URL resmi).
 * PENTING: `core_calendar_get_calendar_events` (bentuk jamak) TIDAK bisa
 * dipakai — `instance`-nya id tabel modul (mis. quiz 91185), bukan cmid;
 * URL darinya menghasilkan "Can't find data record in database".
 * Hasil di-cache permanen (URL aktivitas tidak berubah) sehingga biaya
 * 1-call-per-event hanya dibayar sekali seumur event.
 */
export async function fetchActivityUrls(
  token: string,
  eventIds: number[],
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const cache = readJson<Record<string, string>>(KEYS.eventCmidCache, {})
  let cacheDirty = false
  const pending: number[] = []
  for (const id of eventIds) {
    const hit = cache[String(id)]
    if (hit) out.set(id, hit)
    else pending.push(id)
  }

  for (const eventId of pending) {
    try {
      const res = await wsCall<{
        event?: {
          id?: number
          modulename?: string
          url?: string
          course?: { id?: number } | null
        }
      }>(token, 'core_calendar_get_calendar_event_by_id', { eventid: eventId })
      const ev = res.event
      if (!ev) continue
      // url = halaman aktivitas (cmid benar); bila kosong (event tanpa
      // modul, mis. maintenance) → halaman kursus pemilik event.
      const url =
        ev.url && ev.url.includes('/mod/')
          ? ev.url
          : ev.course?.id != null
            ? `https://moodle.lut.fi/course/view.php?id=${ev.course.id}`
            : undefined
      if (url) {
        out.set(eventId, url)
        cache[String(eventId)] = url
        cacheDirty = true
      }
    } catch {
      // Event gagal di-resolve → biarkan tanpa upgrade (URL kalender lama).
    }
  }
  if (cacheDirty) writeJson(KEYS.eventCmidCache, cache)
  return out
}

/**
 * Terapkan hasil fetchActivityUrls ke task ICS lama yang masih menempel
 * halaman event kalender. Task manual & timeline (moodle-act:) tak tersentuh.
 */
export function upgradeIcsTaskUrls(
  tasks: Task[],
  urls: Map<number, string>,
): { tasks: Task[]; upgraded: number } {
  if (urls.size === 0) return { tasks, upgraded: 0 }
  const now = new Date().toISOString()
  let upgraded = 0
  const next = tasks.map((t) => {
    const eventId = Number(t.id.match(/^moodle:(\d+)@moodle\.lut\.fi$/i)?.[1])
    const target = Number.isFinite(eventId) ? urls.get(eventId) : undefined
    if (target && t.url !== target) {
      upgraded++
      return { ...t, url: target, updatedAt: now }
    }
    return t
  })
  return { tasks: next, upgraded }
}

/** Filter event timeline: hanya yang punya action URL + modul tugas. */
export function parseActionEvents(response: unknown): ActionEvent[] {
  const events = (response as { events?: RawActionEvent[] })?.events
  if (!Array.isArray(events)) return []
  const out: ActionEvent[] = []
  for (const e of events) {
    if (e.id == null || !e.name) continue
    const actionUrl = e.action?.url || e.url
    if (!actionUrl) continue
    const mod = e.modulename ?? ''
    if (!ASSIGNMENT_MODULES.has(mod)) continue
    out.push({
      id: `moodle-act:${e.id}`,
      title: e.name.trim(),
      course: e.course?.shortname || e.course?.fullname || undefined,
      dueAt: e.timesort ? new Date(e.timesort * 1000).toISOString() : undefined,
      url: actionUrl,
      modtype: mod,
    })
  }
  return out
}

/**
 * Merge event aksi ke task list (full re-sync per sumber):
 * - re-sync update in place; event hilang dari feed → task dihapus
 * - task ICS lama `moodle:<eventid>@…` dengan eventid sama dimigrasi ke
 *   ID `moodle-act:<eventid>` (completed/note dipertahankan)
 * - task manual & ICS non-Moodle tidak tersentuh
 */
export function mergeActionEvents(
  existing: Task[],
  events: ActionEvent[],
  lessons: Lesson[],
): { tasks: Task[]; added: number; updated: number } {
  const now = new Date().toISOString()
  const byId = new Map(existing.map((t) => [t.id, t]))
  const feedIds = new Set<string>()
  let added = 0
  let updated = 0

  // Indeks migrasi: eventid → task ICS lama.
  const icsByEventId = new Map<string, Task>()
  for (const t of existing) {
    const m = t.id.match(/^moodle:(\d+)@moodle\.lut\.fi$/i)
    if (m) icsByEventId.set(m[1], t)
  }
  const migratedLegacyIds = new Set<string>()

  for (const ev of events) {
    feedIds.add(ev.id)
    const prev = byId.get(ev.id)
    // Semantik sama dengan merge ICS (moodle.ts): kode jadwal dari tabel
    // identitas dulu; heuristik lama hanya fallback.
    const course =
      loadIdentityIndex().forName(ev.course)?.code ??
      matchCourseCode(ev.course, lessons) ??
      extractCourseCode(ev.course) ??
      ev.course
    if (prev) {
      if (prev.title !== ev.title || prev.dueAt !== ev.dueAt || prev.course !== course || prev.modtype !== ev.modtype) updated++
      byId.set(ev.id, { ...prev, title: ev.title, dueAt: ev.dueAt, course, url: ev.url, modtype: ev.modtype, updatedAt: now })
      continue
    }
    const legacyEventId = ev.id.slice('moodle-act:'.length)
    const legacy = icsByEventId.get(legacyEventId)
    if (legacy && !migratedLegacyIds.has(legacy.id)) {
      migratedLegacyIds.add(legacy.id)
      byId.delete(legacy.id)
      byId.set(ev.id, {
        ...legacy,
        id: ev.id,
        title: ev.title,
        dueAt: ev.dueAt,
        course: course ?? legacy.course,
        url: ev.url,
        modtype: ev.modtype,
        updatedAt: now,
      })
    } else {
      added++
      byId.set(ev.id, {
        id: ev.id,
        title: ev.title,
        course,
        dueAt: ev.dueAt,
        url: ev.url,
        modtype: ev.modtype,
        completed: false,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  const merged = [...byId.values()].filter(
    (t) => !t.id.startsWith('moodle-act:') || feedIds.has(t.id),
  )
  return { tasks: merged, added, updated }
}

/**
 * Ambil event aksi dari timeline Moodle. Token dari sumber nilai (grades.ts):
 * satu kunci untuk kalender + nilai + status submission.
 */
export async function fetchActionEvents(
  src: { token: string; userid?: number } | null,
  lessons?: Lesson[],
): Promise<ActionEvent[]> {
  if (!src?.token) return []
  const { token } = await validateGradesSource(src)
  // Enrol-anchor sudah dijawab backgroundRefresh (primeEnrolAnchor) —
  // matchCourseCode di merge membaca cache-nya. Tidak ada pra-fetch di sini.
  void lessons
  const from = Math.floor(Date.now() / 1000) - 14 * 24 * 3600 // 2 minggu overdue ke belakang
  // limitnum MAKS 50 (server menolak >50 dengan exception — dulu 100, dan
  // kegagalan senyap ini yang membuat semua tugas selamanya menempel URL
  // kalender alih-alih URL aktivitas mod/assign).
  const res = await wsCall<{ events?: unknown[] }>(
    token,
    'core_calendar_get_action_events_by_timesort',
    { timesortfrom: from, limitnum: 50 },
  )
  return parseActionEvents(res)
}
