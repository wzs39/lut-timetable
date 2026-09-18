import type { Lesson } from '../types'
import type { Task } from './tasks'
import { wsCall, validateGradesSource } from './grades'
import { matchCourseCode, fetchEnrolledCourses } from './courses'

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
    // Semantik sama dengan merge ICS (moodle.ts): kode jadwal bila cocok,
    // else pertahankan nama Moodle sebagai label teks biasa.
    const course = matchCourseCode(ev.course, lessons) ?? ev.course
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
): Promise<ActionEvent[]> {
  if (!src?.token) return []
  const { token, userid } = await validateGradesSource(src)
  // Pra-fetch daftar enrol resmi (cache 24 jam) untuk pencocokan kursus presisi.
  await fetchEnrolledCourses({ token, userid }).catch(() => null)
  const from = Math.floor(Date.now() / 1000) - 14 * 24 * 3600 // 2 minggu overdue ke belakang
  const res = await wsCall<{ events?: unknown[] }>(
    token,
    'core_calendar_get_action_events_by_timesort',
    { timesortfrom: from, limitnum: 100 },
  )
  return parseActionEvents(res)
}
