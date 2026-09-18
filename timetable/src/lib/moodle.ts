import type { Lesson } from '../types'
import type { Task } from './tasks'
import { parseIcs } from './ics'
import { fetchIcsText } from './fetchIcs'
import { KEYS, readJson, writeJson, removeKey } from './storage'
import { matchCourseCode, extractCourseCode } from './courses'

/**
 * Moodle calendar (moodle.lut.fi) → assignments.
 *
 * Moodle exposes the user calendar as ICS:
 *   https://moodle.lut.fi/my/ → Calendar → Export →
 *   https://moodle.lut.fi/calendar/export.php?preset_what=all&preset_time=recentupcoming&userid=<id>&authtoken=<hex>
 *
 * The Moodle calendar sends no CORS headers → native platforms fetch
 * directly (CapacitorHttp / Electron bridge); browser dev goes through the
 * Vite proxy; production browser falls back to public CORS proxies.
 */

export interface MoodleSource {
  url: string
  lastSync?: string
  count: number
}

export function loadMoodleSource(): MoodleSource | null {
  const raw = readJson<Partial<MoodleSource> | null>(KEYS.moodleSource, null)
  if (!raw || typeof raw.url !== 'string') return null
  return { url: raw.url, lastSync: raw.lastSync, count: raw.count ?? 0 }
}

export function saveMoodleSource(src: MoodleSource | null): void {
  if (src) writeJson(KEYS.moodleSource, src)
  else removeKey(KEYS.moodleSource)
}

/**
 * Accept any Moodle calendar export URL (with token) or a direct .ics URL:
 * - /calendar/export.php (the export form link)
 * - /calendar/export_execute.php (the generated subscription link)
 * - any other /calendar/* URL carrying userid + authtoken
 */
export function normalizeMoodleUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    if (!u.hostname.endsWith('moodle.lut.fi')) return null
    if (u.pathname.endsWith('.ics')) return u.toString()
    if (
      u.pathname.startsWith('/calendar/export') &&
      u.searchParams.get('userid') &&
      u.searchParams.get('authtoken')
    ) {
      return u.toString()
    }
    return null
  } catch {
    return null
  }
}

/**
 * Course name from CATEGORIES, else first line of DESCRIPTION.
 * CATEGORIES on LUT Moodle looks like "BH60A7201 Blended teaching 31.8.2026-30.7.2027";
 * keep only the leading course code when one is present so task labels stay
 * short (online courses have no timetable match, so this label IS the name).
 */
function courseNameOf(e: {
  description?: string
  categories?: string
}): string | undefined {
  const fromCategories = e.categories?.split(',')[0]?.trim()
  if (fromCategories) {
    // Leading LUT course code (e.g. "CT60A4500 Blended teaching ..." -> "CT60A4500")
    const code = extractCourseCode(fromCategories)
    if (code && fromCategories.toUpperCase().startsWith(code.toUpperCase())) return code
    return fromCategories
  }
  return e.description?.split('\n')[0]?.trim() || undefined
}

/**
 * Derive the Moodle event page URL from the ICS UID.
 * Moodle exports UID as `<calendarEventId>@moodle.lut.fi`; the canonical
 * event page is /calendar/view.php?event=<id>. Feed events carry no URL
 * property, so this is the only reliable deep link to the activity.
 * The page 303s to login without a session — in the user's own browser
 * their Moodle session applies and the event/course renders.
 */
export function moodleEventUrl(uid: string): string | undefined {
  const m = uid.match(/^(\d+)@moodle\.lut\.fi$/i)
  return m ? `https://moodle.lut.fi/calendar/view.php?event=${m[1]}` : undefined
}

// matchCourseCode dipindah ke courses.ts (satu pemilik logika pencocokan,
// dengan jangkar daftar enrol resmi); diekspor ulang di sini agar pemanggil lama
// tetap bekerja.
export { matchCourseCode } from './courses'

export interface MoodleAssignment {
  /** Stable ICS UID — re-syncs update instead of duplicating. */
  uid: string
  title: string
  course?: string
  /** Deadline (event start). */
  dueAt?: string
  /** Activity open date (DTSTART when the event marks availability). */
  startAt?: string
  url?: string
  note?: string
}

/** Convert one Moodle ICS event to an assignment (null for non-assignments). */
export function assignmentFromEvent(e: {
  uid?: string
  summary?: string
  description?: string
  categories?: string
  url?: string
  start: Date
  end: Date
}): MoodleAssignment | null {
  if (!e.uid || !e.summary) return null
  const courseName = courseNameOf(e)
  const desc = e.description?.trim()
  const note =
    desc && courseName && desc.startsWith(courseName)
      ? desc.split('\n').slice(1).join('\n').trim() || undefined
      : desc || undefined
  // Moodle assignment events span open→due; a multi-hour/overnight span
  // carries both dates. Short events (< 30 min) are pure deadlines.
  const spanMs = e.end.getTime() - e.start.getTime()
  const startAt = spanMs >= 30 * 60 * 1000 ? e.start.toISOString() : undefined
  const dueAt = spanMs >= 30 * 60 * 1000 ? e.end.toISOString() : e.start.toISOString()
  return {
    uid: e.uid,
    title: e.summary.trim(),
    course: courseName,
    dueAt,
    startAt,
    url: e.url ?? moodleEventUrl(e.uid),
    note,
  }
}

/** Parse a full Moodle ICS feed. */
export function parseMoodleAssignments(ics: string): MoodleAssignment[] {
  return parseIcs(ics)
    .map(assignmentFromEvent)
    .filter((a): a is MoodleAssignment => a !== null)
}

/**
 * Merge Moodle assignments into the task list.
 * - Key = `moodle:<uid>` → re-syncs update in place, never duplicate.
 * - Local changes (completed) survive re-syncs; title/due follow the feed.
 * - Moodle tasks absent from the feed are removed (full re-sync semantics).
 * - Manual user tasks are never touched.
 */
export function mergeMoodleAssignments(
  existing: Task[],
  assignments: MoodleAssignment[],
  lessons: Lesson[],
): { tasks: Task[]; added: number; updated: number } {
  const now = new Date().toISOString()
  const next = [...existing]
  const byId = new Map(next.map((t) => [t.id, t]))
  const feedIds = new Set<string>()
  let added = 0
  let updated = 0

  for (const a of assignments) {
    const id = `moodle:${a.uid}`
    feedIds.add(id)
    const prev = byId.get(id)
    // Sama dengan jalur timeline (actions.ts): kode jadwal bila cocok,
    // else kode pendek dari shortname (label pendek), else nama asli.
    const course = matchCourseCode(a.course, lessons) ?? extractCourseCode(a.course) ?? a.course
    if (prev) {
      if (prev.title !== a.title || prev.dueAt !== a.dueAt || prev.course !== course) updated++
      byId.set(id, { ...prev, title: a.title, dueAt: a.dueAt, startAt: a.startAt, course, url: a.url, updatedAt: now })
    } else {
      added++
      byId.set(id, {
        id,
        title: a.title,
        course,
        dueAt: a.dueAt,
        startAt: a.startAt,
        note: a.note,
        url: a.url,
        completed: false,
        createdAt: now,
        updatedAt: now,
      })
    }
  }
  const merged = [...byId.values()].filter(
    (t) => !t.id.startsWith('moodle:') || feedIds.has(t.id),
  )
  return { tasks: merged, added, updated }
}

/** Fetch + parse + merge in one step. Returns the new task list. */
export async function syncMoodle(
  src: MoodleSource,
  tasks: Task[],
  lessons: Lesson[],
): Promise<{ tasks: Task[]; added: number; updated: number }> {
  const ics = await fetchIcsText(src.url)
  const assignments = parseMoodleAssignments(ics)
  const result = mergeMoodleAssignments(tasks, assignments, lessons)
  saveMoodleSource({
    ...src,
    lastSync: new Date().toISOString(),
    count: assignments.length,
  })
  return result
}
