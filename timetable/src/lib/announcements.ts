import { wsCall, loadGradesSource } from './grades'
import { fetchEnrolledCourses, loadEnrolledCourses } from './courses'
import { fetchMoodleWebService } from './fetchIcs'
import { readJson, writeJson, TRANSIENT_KEYS } from './storage'

/**
 * Pengumuman kursus (forum News/Announcements) via webservice token:
 *
 *   core_course_get_courses      → daftar kursus (untuk mencari forum per kursus)
 *   mod_forum_get_forums_by_courses → forumid forum pengumuman per kursus
 *   mod_forum_get_discussions    → diskusi (posting pengumuman) per forum
 *
 * Filter tampilan: hanya posting 14 hari terakhir, terbaru dulu, maks 20.
 * Cache 30 menit (pengumuman tidak perlu real-time ketat) + pesan tanpa
 * token/token salah → feed kosong (fitur opsional, tidak pernah mengganggu).
 */

export interface Announcement {
  /** `forum-<discussionid>` — stabil antar sinkron. */
  id: string
  /** Judul posting. */
  subject: string
  /** Nama kursus (shortname bila ada) untuk pengelompokan. */
  course?: string
  /** URL halaman diskusi (deep-link ke posting). */
  url?: string
  /** Waktu posting ISO. */
  postedAt?: string
  /** Nama pengajar/pengirim. */
  author?: string
  /** Cuplikan isi (polos, tanpa HTML). */
  excerpt?: string
}

interface RawDiscussion {
  discussionid?: number
  name?: string
  subject?: string
  modified?: number
  userfullname?: string
  message?: string
  pinned?: boolean
}

const WINDOW_MS = 14 * 24 * 3600 * 1000
const MAX_ITEMS = 20
const CACHE_TTL = 30 * 60 * 1000

function cacheKey(): string {
  return TRANSIENT_KEYS.icsCachePrefix + 'announcements'
}

export function loadCachedAnnouncements(): Announcement[] | null {
  try {
    const raw = readJson<{ fetchedAt: number; items: Announcement[] } | null>(cacheKey(), null)
    if (raw && Array.isArray(raw.items) && Date.now() - raw.fetchedAt <= CACHE_TTL) {
      return raw.items
    }
  } catch {
    /* non-fatal */
  }
  return null
}

function saveCachedAnnouncements(items: Announcement[]): void {
  try {
    writeJson(cacheKey(), { fetchedAt: Date.now(), items })
  } catch {
    /* kuota penuh: abaikan */
  }
}

/** Buang tag HTML + decode entitas umum, ringkas ke `max` karakter. */
export function htmlToExcerpt(html: string | undefined, max = 160): string | undefined {
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
  if (!text) return undefined
  return text.length > max ? text.slice(0, max - 1) + '…' : text
}

/** Satu diskusi mentah → Announcement (filter jendela 14 hari). */
function toAnnouncement(
  d: RawDiscussion,
  forumUrlBase: string | undefined,
  courseName: string | undefined,
): Announcement | null {
  const id = d.discussionid
  if (id == null) return null
  const postedAt = d.modified ? new Date(d.modified * 1000).toISOString() : undefined
  if (postedAt && Date.now() - new Date(postedAt).getTime() > WINDOW_MS) return null
  return {
    id: `forum-${id}`,
    subject: (d.subject || d.name || '').trim() || '(tanpa judul)',
    course: courseName,
    url:
      forumUrlBase && d.discussionid
        ? `${forumUrlBase.replace(/&amp;/g, '&')}&d=${d.discussionid}`
        : undefined,
    postedAt,
    author: d.userfullname?.trim() || undefined,
    excerpt: htmlToExcerpt(d.message),
  }
}

/** mod_forum_get_discussions → Announcement[] (satu forum). */
export function parseDiscussions(
  response: unknown,
  forumUrlBase: string | undefined,
  courseName: string | undefined,
): Announcement[] {
  if (!Array.isArray(response)) return []
  const out: Announcement[] = []
  for (const d of response as RawDiscussion[]) {
    const a = toAnnouncement(d, forumUrlBase, courseName)
    if (a) out.push(a)
  }
  return out
}

/** Gabungkan beberapa forum → urut terbaru → maks MAX_ITEMS. */
export function mergeAnnouncementLists(lists: Announcement[][]): Announcement[] {
  const seen = new Set<string>()
  const flat = lists.flat().filter((a) => {
    if (seen.has(a.id)) return false
    seen.add(a.id)
    return true
  })
  flat.sort((a, b) => (b.postedAt ?? '').localeCompare(a.postedAt ?? ''))
  return flat.slice(0, MAX_ITEMS)
}

interface ForumInfo {
  forumid?: number
  course?: number
  name?: string
}

/**
 * Ambil pengumuman seluruh kursus. Token null → [] (fitur opsional).
 * Kesalahan jaringan/token DIBIASKAN ke [] setelah cache: panel hanya
 * menampilkan apa yang diketahui, tidak pernah menampilkan error keras.
 */
export async function fetchAnnouncements(
  src: { token: string; userid?: number } | null,
): Promise<Announcement[]> {
  const cached = loadCachedAnnouncements()
  if (!src?.token) return cached ?? []
  try {
    // Daftar kursus resmi (cache 24 jam dari courses.ts) untuk nama + filter.
    await fetchEnrolledCourses(src).catch(() => null)
    const forumsRes = await wsCall<{
      forums?: ForumInfo[]
    }>(src.token, 'mod_forum_get_forums_by_courses', { courseids: '[]' })
    // courseids kosong tidak selalu didukung; fallback: kirim semua courseid
    // dari daftar enrol bila respons kosong.
    let forums = forumsRes?.forums ?? []
    if (forums.length === 0) {
      const enrol = loadEnrolledCourses()
      const ids = (enrol ?? []).map((c) => c.courseid)
      if (ids.length === 0) return cached ?? []
      const retry = await wsCall<{ forums?: ForumInfo[] }>(
        src.token,
        'mod_forum_get_forums_by_courses',
        { courseids: JSON.stringify(ids) },
      )
      forums = retry?.forums ?? []
    }
    // Ambil maks 15 forum pertama (batch aman); kursus tanpa news forum dilewati.
    const targets = forums.slice(0, 15)
    if (targets.length === 0) return cached ?? []

    const lists = await Promise.all(
      targets.map(async (f) => {
        if (f.forumid == null) return []
        try {
          const disc = await wsCall<unknown>(
            src.token,
            'mod_forum_get_discussions',
            { forumid: f.forumid, sortby: 'modified', direction: 'DESC', limit: 10 },
          )
          // URL dasar diskusi: diberikan di respons forum (perlu siteinfo ringan)
          // — jika tidak ada, deep-link dikonstruksi dari courseid + forumid.
          const base = f.course
            ? `https://moodle.lut.fi/mod/forum/discuss.php?f=${f.forumid}`
            : undefined
          return parseDiscussions(disc, base, undefined)
        } catch {
          return [] // forum tunggal gagal → lewati
        }
      }),
    )
    const merged = mergeAnnouncementLists(lists)
    if (merged.length > 0 || cached === null) saveCachedAnnouncements(merged)
    return merged.length > 0 ? merged : cached ?? []
  } catch {
    return cached ?? []
  }
}

/** Sumber aktif (dari grades.ts) untuk panel — null bila belum terhubung. */
export function currentAnnouncementSource(): { token: string; userid?: number } | null {
  return loadGradesSource()
}

// Fetch mentah dipakai bila perlu URL diskusi lengkap; di sini wsCall cukup.
void fetchMoodleWebService
