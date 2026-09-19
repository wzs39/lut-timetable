import type { Lesson } from '../types'

/**
 * Aturan teks notifikasi → peringatan kartu pelajaran.
 *
 * Murni tanpa I/O: aliran notifikasi (satu-satunya sumber info Moodle)
 * memberikan AlertSource[], modul ini menghubungkannya ke Lesson (hari ini /
 * pratinjau hari depan) berdasarkan kode kursus dan jendela relevansi waktu.
 */

/**
 * Sumber pemberitahuan minimal yang diperlukan matcher — structurally
 * kompatibel dulu dengan Announcement, sekarang dengan MoodleNotification.
 */
export interface AlertSource {
  id: string
  subject: string
  excerpt?: string
  course?: string
  postedAt?: string
}

export type NoticeKind = 'room-change' | 'deadline-change'

export interface LessonNotice {
  kind: NoticeKind
  /** Ruang baru bila terdeteksi ("B234"). */
  room?: string
  /** Source pengumuman (untuk tooltip / deep-link). */
  announcementId: string
}

/* ----------------------------- parse teks ----------------------------- */

/** Pola perubahan ruangan: id/bahasa Inggris + Cina. */
const ROOM_CHANGE_RE =
  /(room (?:change[ds]?|moved?|now)|moved to|new (?:room|location)|luokka (?:muuttu|on nyt)|siirtyy|教室(?:已)?(?:变|变更|改|换)|换到|搬迁)/i

/** Pola perubahan tenggat: id/bahasa Inggris + Cina. */
const DEADLINE_CHANGE_RE =
  /(deadline (?:extended|changed|moved|postponed)|due date (?:extended|changed|moved)|extended (?:by|to|until)|postponed|延期|截止(?:日期)?(?:延|变|改|调整)|推迟)/i

/**
 * Ruang baru: "room ... A123 → B234" | "moved to room 2513" | "教室改为 B234".
 * Pindai SEMUA kandidat: lewati kata pengisi ("due to maintenance") dan kata
 * "room/hall" sebelum kode ruang; kandidat harus bernomor atau kapital.
 */
const ROOM_EXTRACT_RE =
  /(?:→|->|to|now|改为|换到|变更为)\s*(?:(?:room|hall|luokka|location|教室|地点)\s*)?([A-Za-z0-9][A-Za-z0-9\-/\.]{0,11})/gi

/** Kode kursus LUT di teks: CT60A4050, BM40A0102 (huruf+huruf+angka). */
const COURSE_CODE_RE = /\b([A-Z]{2,4}[0-9]{1,4}[A-Z]?[0-9]{0,4})\b/

/** Ekstrak kode kursus LUT pertama dari string apa pun (null bila tidak ada). */
export function extractCourseCode(text: string): string | null {
  const m = COURSE_CODE_RE.exec(text || '')
  return m ? m[1] : null
}

/** Satu pengumuman → jenis peringatan + ruang baru (null bila bukan pemberitahuan). */
export function parseNotice(a: AlertSource): LessonNotice | null {
  const hay = `${a.subject} ${a.excerpt ?? ''}`
  const isDeadline = DEADLINE_CHANGE_RE.test(hay)
  const isRoom = ROOM_CHANGE_RE.test(hay)
  if (isRoom) {
    const room = extractRoom(a.excerpt ?? a.subject)
    return { kind: 'room-change', room, announcementId: a.id }
  }
  if (isDeadline) {
    return { kind: 'deadline-change', announcementId: a.id }
  }
  return null
}

/** Ruang baru dari teks; "A123 → B234" → "B234" (sisi kanan panah). */
export function extractRoom(text: string): string | undefined {
  if (!text) return undefined
  ROOM_EXTRACT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ROOM_EXTRACT_RE.exec(text))) {
    // Buang tanda baca ekor (titik/koma yang menempel di akhir kalimat)
    const cand = m[1].replace(/[\.,;:!]+$/, '')
    // Buang kata umum yang bukan ruangan
    if (/^(the|a|an|to|at|on|day|date|time|next|week|room|hall)$/i.test(cand)) continue
    // Ruangan punya setidaknya satu digit ATAU format huruf-angka kapital
    if (!/\d/.test(cand) && !/^[A-Z]/.test(cand)) continue
    return cand.toUpperCase()
  }
  return undefined
}

/* --------------------------- matcher pelajaran --------------------------- */

/** Apakah kode kursus cocok dengan pelajaran (normalisasi longgar). */
function lessonHasCode(l: Lesson, code: string): boolean {
  if (!l.code) return false
  const a = l.code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const b = code.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!a || !b) return false
  return a === b || a.startsWith(b) || b.startsWith(a)
}

/** Pelajaran cocok dengan kode kursus di teks pengumuman ATAU judulnya menyebut pelajaran. */
function matchesLesson(a: AlertSource, l: Lesson): boolean {
  const code = extractCourseCode(`${a.course ?? ''} ${a.subject} ${a.excerpt ?? ''}`)
  if (code && lessonHasCode(l, code)) return true
  // Tanpa kode: cocokkan kata kunci judul kursus di pelajaran (longgar, ≥5 char)
  if (a.course && a.course.length >= 5) {
    const title = l.title.toUpperCase()
    return title.includes(a.course.toUpperCase())
  }
  return false
}

/**
 * Pemberitahuan yang berlaku untuk sebuah pelajaran:
 * - pengumuman harus menghasilkan parseNotice
 * - kode kursus cocok
 * - jendela: diposting tidak lebih dari 7 hari SEBELUM awal pelajaran,
 *   dan tidak SETELAH pelajaran berakhir (pengumuman sesudah kelas selesai
 *   tidak lagi relevan untuk kelas itu).
 */
export function noticeForLesson(
  sources: AlertSource[] | null | undefined,
  l: Lesson,
): LessonNotice | null {
  if (!sources || sources.length === 0) return null
  const start = new Date(l.start).getTime()
  const end = new Date(l.end).getTime()
  for (const a of sources) {
    const n = parseNotice(a)
    if (!n) continue
    if (!matchesLesson(a, l)) continue
    if (a.postedAt) {
      const t = new Date(a.postedAt).getTime()
      if (t >= start - 7 * 86400_000 && t <= end) return n
    } else {
      // Tanpa tanggal: tetap tampilkan (moderasi lebih longgar)
      return n
    }
  }
  return null
}

/** Ambil pemberitahuan pertama yang cocok untuk kumpulan pelajaran (dipakai TodayView). */
export function noticesForLessons(
  sources: AlertSource[] | null | undefined,
  lessons: Lesson[],
): Record<string, LessonNotice> {
  const out: Record<string, LessonNotice> = {}
  for (const l of lessons) {
    const n = noticeForLesson(sources, l)
    if (n) out[l.id] = n
  }
  return out
}
