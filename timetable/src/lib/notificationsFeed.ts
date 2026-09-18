import { wsCall, validateGradesSource } from './grades'
import { KEYS, readJson, writeJson } from './storage'
import { htmlToText } from './html'

/**
 * Pusat notifikasi Moodle — aliran bacaan: umpan balik dinilai, pengingat
 * tenggat, balasan forum, pesan admin.
 *
 * Fungsi: core_message_get_messages(type='notifications') — core_message_get_notifications
 * TIDAK berada dalam whitelist layanan mobile LUT (invalidrecord). Responsnya
 * berbentuk { messages: [...] }; field sama dengan varian get_notifications
 * (subject, fullmessagehtml, contexturl, timecreated, customdata JSON
 * berisi courseid). Filter: 30 hari terakhir, terbaru dulu, maks 30.
 * Cache 30 menit + read-state lokal (markRead) agar "belum dibaca" tetap
 * bekerja offline.
 */

export type NotificationKind = 'forum' | 'submission' | 'quiz' | 'receipt' | 'system'

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
  /** Kategori untuk filter UI (dari URL modul / customdata). */
  kind: NotificationKind
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
  /** core_message_get_messages: courseid tersembunyi di customdata JSON. */
  customdata?: string | { courseid?: number; cmid?: number }
}

/** Buang HTML + ratakan spasi (owner: lib/html). */
function plainText(html: string | undefined): string | undefined {
  return htmlToText(html)
}

/**
 * Kategori notifikasi dari sinyal nyata LUT (murni, dapat diuji):
 *  - URL modul: /mod/forum/ (diskusi), /mod/assign/ (tugas), /mod/quiz/ (kuis)
 *  - customdata: discussionid / assignmentid / quizid / messagetype
 *  - Subjek kwitansi pengiriman dari assign (bentuk LUT nyata:
 *    "You have submitted your assignment submission for …", template standar
 *    "Submission receipt (…)") = tidak ada info baru → 'receipt'
 *    (UI: tersembunyi bawaan).
 * Sisanya → 'system' (pengingat admin, dsb.).
 */
const RECEIPT_SUBJECT_RE = /^(submission receipt( \()|you have submitted your assignment submission)/i

export function classifyNotification(
  url: string | undefined,
  customdata: Record<string, unknown> | null,
  subject?: string,
): NotificationKind {
  const u = url ?? ''
  const cd = customdata ?? {}
  if (u.includes('/mod/quiz/') || 'quizid' in cd) return 'quiz'
  if (u.includes('/mod/assign/') || 'assignmentid' in cd) {
    if (subject && RECEIPT_SUBJECT_RE.test(subject.trim())) return 'receipt'
    return 'submission'
  }
  if (u.includes('/mod/forum/') || 'discussionid' in cd) return 'forum'
  return 'system'
}

/** courseid bisa datang sebagai string dari customdata JSON — normalkan. */
function toNumId(v: unknown): number | undefined {
  if (v == null) return undefined
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

/** Pesan mentah → MoodleNotification (bila sah). */
export function parseNotification(
  n: RawNotification,
  readSet: Set<string> | null = null,
): MoodleNotification | null {
  if (n.id == null || !n.subject) return null
  const time = n.timecreated ? new Date(n.timecreated * 1000).toISOString() : undefined
  const id = `ntf-${n.id}`
  // customdata: JSON string ATAU objek — berisi courseid notifikasi kursus.
  let cd: { courseid?: number } | null = null
  if (typeof n.customdata === 'string') {
    try { cd = JSON.parse(n.customdata) as { courseid?: number } } catch { cd = null }
  } else if (n.customdata && typeof n.customdata === 'object') {
    cd = n.customdata
  }
  // Sudah-baca = server bilang read ATAU pengguna pernah membukanya di app
  // (readSet lokal menimpa "belum dibaca" server; offline-safe).
  const read = n.read === true || n.read === 1 || (readSet?.has(id) ?? false)
  const url = n.contexturl?.replace(/&amp;/g, '&')
  return {
    id,
    subject: htmlToText(n.subject) || '',
    body: plainText(n.fullmessagehtml ?? n.fullmessage),
    url,
    read,
    time,
    from: n.userfromfullname ?? n.userfrom?.fullname ?? undefined,
    // courseid: LUT 把它放在 customdata JSON（字符串形态）——统一归一为数字，
    // 否则与 enrol 列表的数字 courseid 对不上（Map 键/严格等全部错位）。
    courseid: toNumId(n.courseid ?? cd?.courseid),
    kind: classifyNotification(url, cd as Record<string, unknown> | null, n.subject),
  }
}

export function parseNotifications(response: unknown, readSet: Set<string> | null = null): MoodleNotification[] {
  // core_message_get_messages membungkus di { messages: [...] };
  // terima juga bentuk array mentah / { notifications: [...] } untuk tes.
  const res = response as { messages?: unknown[]; notifications?: unknown[] } | null
  const list = Array.isArray(response)
    ? (response as unknown[])
    : Array.isArray(res?.messages)
      ? res.messages
      : Array.isArray(res?.notifications)
        ? res.notifications
        : null
  if (!list) return []
  const out: MoodleNotification[] = []
  for (const n of list as RawNotification[]) {
    const parsed = parseNotification(n, readSet)
    if (parsed) out.push(parsed)
  }
  out.sort((a, b) => (b.time ?? '').localeCompare(a.time ?? ''))
  return out.slice(0, 30)
}

/**
 * Jumlah notifikasi belum dibaca — murni, dipakai badge navigasi.
 * Kwitansi pengiriman ('receipt', disembunyikan bawaan di UI) tidak ikut
 * dihitung: badge harus mencerminkan apa yang benar-benar terlihat.
 */
export function countUnread(list: readonly MoodleNotification[] | null): number {
  if (!list) return 0
  let n = 0
  for (const item of list) if (!item.read && item.kind !== 'receipt') n++
  return n
}

/**
 * Belum-dibaca per kategori (murni) — untuk badge chip filter di UI.
 * Berbeda dari countUnread: kategori receipt IKUT dihitung di sini (chip
 * receipt memang menampilkannya); pemanggil memutuskan pakai yang mana.
 */
/**
 * Kelompok per kursus (murni) — untuk chip filter kursus di UI.
 * Hanya kursus yang punya notifikasi; urut: belum-dibaca terbanyak dulu,
 * lalu jumlah terbanyak, lalu courseid (stabil antar-render).
 */
export function notificationCourses(
  list: readonly MoodleNotification[] | null,
): Array<{ courseid: number; count: number; unread: number }> {
  const map = new Map<number, { count: number; unread: number }>()
  for (const n of list ?? []) {
    // Cache lama menyimpan courseid sebagai string — koersikan agar
    // pengelompokan cocok dengan courseid angka di daftar enrol.
    const cid = toNumId(n.courseid)
    if (cid == null) continue
    const e = map.get(cid) ?? { count: 0, unread: 0 }
    e.count++
    if (!n.read) e.unread++
    map.set(cid, e)
  }
  return [...map.entries()]
    .map(([courseid, v]) => ({ courseid, ...v }))
    .sort((a, b) => b.unread - a.unread || b.count - a.count || a.courseid - b.courseid)
}

export function unreadByKind(
  list: readonly MoodleNotification[] | null,
): Record<NotificationKind, number> {
  const out: Record<NotificationKind, number> = { forum: 0, submission: 0, quiz: 0, receipt: 0, system: 0 }
  if (!list) return out
  for (const item of list) if (!item.read) out[item.kind]++
  return out
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
      // Migration: cache lama sebelum kolom `kind` ada — isi dari URL;
      // courseid lama berbentuk string — normalkan ke angka agar filter
      // dan pengelompokan cocok dengan courseid angka daftar enrol.
      return raw.items.map((it) => ({
        ...it,
        kind: it.kind ?? classifyNotification(it.url, null),
        courseid: toNumId(it.courseid),
      }))
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
    // Dua panggilan: belum dibaca + sudah dibaca (field read tidak dikirim
    // untuk type='notifications'); gabungkan, urutkan, potong 30.
    const [unread, read] = await Promise.all([
      wsCall<{ messages?: unknown[] }>(token, 'core_message_get_messages', {
        useridto: userid,
        type: 'notifications',
        read: 0,
        limitnum: 20,
      }).catch(() => null),
      wsCall<{ messages?: unknown[] }>(token, 'core_message_get_messages', {
        useridto: userid,
        type: 'notifications',
        read: 1,
        limitnum: 20,
      }).catch(() => null),
    ])
    const list = parseNotifications(
      { notifications: [...(unread?.messages ?? []), ...(read?.messages ?? [])] },
      readSet,
    )
    if (list.length > 0 || !cached) saveCachedNotifications(list)
    return list.length > 0 ? list : cached ?? []
  } catch {
    return cached ?? []
  }
}
