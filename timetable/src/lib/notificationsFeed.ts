import { wsCall, validateGradesSource } from './grades'
import { KEYS, readJson, writeJson } from './storage'

/**
 * Pusat notifikasi Moodle (core_message_get_notifications) — aliran bacaan:
 * umpan balik dinilai, pengingat tenggat, balasan forum, pesan admin.
 *
 * Filter: 30 hari terakhir, terbaru dulu, maks 30. Cache 30 menit +
 * read-state lokal (markRead) agar "belum dibaca" tetap bekerja offline.
 */

export interface MoodleNotification {
  /** `ntf-<id>` — stabil antar sinkron. */
  id: string
  subject: string
  /** Teks pesan polos (HTML dibuang). */
  body?: string
  /** URL notifikasi (modul terkait) bila ada. */
  url?: string
  read: boolean
  /** ISO time. */
  time?: string
  /** Pengirim (nama) bila ada. */
  from?: string
  courseid?: number
}

interface RawNotification {
  id?: number
  subject?: string
  fullmessagehtml?: string
  fullmessage?: string
  contexturl?: string
  timecreated?: number
  read?: number | boolean
  userfromfullname?: string
  userfrom?: { fullname?: string }
  courseid?: number
}

/** Buang HTML + ratakan spasi. */
function plainText(html: string | undefined): string | undefined {
  if (!html) return undefined
  const text = html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return text || undefined
}

/** Pesan mentah → MoodleNotification (bila sah). */
export function parseNotification(
  n: RawNotification,
  readSet: Set<string> | null = null,
): MoodleNotification | null {
  if (n.id == null || !n.subject) return null
  const time = n.timecreated ? new Date(n.timecreated * 1000).toISOString() : undefined
  const id = `ntf-${n.id}`
  // Sudah-baca = server bilang read ATAU pengguna pernah membukanya di app
  // (readSet lokal menimpa "belum dibaca" server; offline-safe).
  const read = n.read === true || n.read === 1 || (readSet?.has(id) ?? false)
  return {
    id,
    subject: n.subject.trim(),
    body: plainText(n.fullmessagehtml ?? n.fullmessage),
    url: n.contexturl?.replace(/&amp;/g, '&'),
    read,
    time,
    from: n.userfromfullname ?? n.userfrom?.fullname ?? undefined,
    courseid: n.courseid,
  }
}

export function parseNotifications(response: unknown, readSet: Set<string> | null = null): MoodleNotification[] {
  const list = (response as { notifications?: RawNotification[] })?.notifications
  if (!Array.isArray(list)) return []
  const out: MoodleNotification[] = []
  for (const n of list) {
    const parsed = parseNotification(n, readSet)
    if (parsed) out.push(parsed)
  }
  out.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))
  return out.slice(0, 30)
}

/** Jumlah notifikasi belum dibaca — murni, dipakai badge navigasi. */
export function countUnread(list: readonly MoodleNotification[] | null): number {
  if (!list) return 0
  let n = 0
  for (const item of list) if (!item.read) n++
  return n
}

/* ----------------------- read-state + cache lokal ----------------------- */

const READ_KEY = KEYS.ntfRead
const CACHE_TTL = 30 * 60 * 1000

function cacheKey(): string {
  return KEYS.ntfCache
}

export function loadReadIds(): Set<string> {
  try {
    const raw = readJson<string[]>(READ_KEY, [])
    return new Set(Array.isArray(raw) ? raw : [])
  } catch {
    return new Set()
  }
}

/** Tandai sudah dibaca (persisten, offline-safe). */
export function markRead(id: string): void {
  const set = loadReadIds()
  set.add(id)
  try {
    writeJson(READ_KEY, [...set].slice(-200))
  } catch {
    /* non-fatal */
  }
}

export function loadCachedNotifications(): MoodleNotification[] | null {
  try {
    const raw = readJson<{ fetchedAt: number; items: MoodleNotification[] } | null>(cacheKey(), null)
    if (raw && Array.isArray(raw.items) && Date.now() - raw.fetchedAt <= CACHE_TTL) {
      return raw.items
    }
  } catch {
    /* non-fatal */
  }
  return null
}

function saveCachedNotifications(items: MoodleNotification[]): void {
  try {
    writeJson(cacheKey(), { fetchedAt: Date.now(), items })
  } catch {
    /* non-fatal */
  }
}

/** Ambil notifikasi (cache → jaringan). Token null → cache / []. */
export async function fetchNotifications(
  src: { token: string; userid?: number } | null,
  opts: { force?: boolean } = {},
): Promise<MoodleNotification[]> {
  const cached = loadCachedNotifications()
  if (!opts.force) {
    if (cached) return cached
  }
  if (!src?.token) return cached ?? []
  const readSet = loadReadIds()
  try {
    const { token, userid } = await validateGradesSource(src)
    const res = await wsCall<unknown>(token, 'core_message_get_notifications', {
      userid,
      limit: 30,
    })
    const list = parseNotifications(res, readSet)
    if (list.length > 0 || !cached) saveCachedNotifications(list)
    return list.length > 0 ? list : cached ?? []
  } catch {
    return cached ?? []
  }
}
