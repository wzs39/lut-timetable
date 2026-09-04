import type { Lesson } from '../types'
import { extractCourseCode, normalizeCourseCode } from './ics'

/** Identitas stabil sebuah kursus: kode ternormalisasi (nomor grup 4 digit
 *  dibuang), atau kode hasil ekstraksi judul, fallback ke judul utuh. */
export function courseKeyOf(l: Lesson): string {
  const raw = l.code || extractCourseCode(l.title) || l.title
  return normalizeCourseCode(raw)
}

/** Kode kursus untuk ditampilkan (lesson.code dulu, lalu ekstraksi judul). */
export function courseCodeOf(l: Lesson): string {
  return l.code || extractCourseCode(l.title) || ''
}

export interface CourseCandidate {
  key: string
  code: string
  title: string
  count: number
}

/** Kumpulkan kursus (identitas per kode) yang cocok dengan kata kunci. */
export function matchCourses(
  lessons: Lesson[],
  query: string,
  limit = 12,
): CourseCandidate[] {
  const kw = query.trim().toLowerCase()
  if (!kw) return []
  const byKey = new Map<string, CourseCandidate>()
  for (const l of lessons) {
    const hay = `${l.code || ''} ${l.title}`.toLowerCase()
    if (!hay.includes(kw)) continue
    const key = courseKeyOf(l)
    const cur = byKey.get(key)
    if (cur) cur.count++
    else
      byKey.set(key, { key, code: courseCodeOf(l), title: l.title, count: 1 })
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count).slice(0, limit)
}

export interface ConflictDetail {
  /** Pelajaran dari kursus yang dicari */
  mine: Lesson
  /** Pelajaran lain (kursus beda) yang bentrok di slot itu */
  others: Lesson[]
}

export interface CourseConflictReport {
  /** Total kejadian (slot) kursus ini di data */
  occurrences: number
  /** Berapa slot yang bentrok */
  slots: number
  /** Ada berapa kursus lain yang terlibat */
  otherCourses: number
  details: ConflictDetail[]
}

function sameDay(a: Lesson, b: Lesson): boolean {
  const da = new Date(a.start)
  const db = new Date(b.start)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

/** Tumpang tindih waktu (> 0 detik) */
export function overlaps(a: Lesson, b: Lesson): boolean {
  const as = new Date(a.start).getTime()
  const ae = new Date(a.end).getTime()
  const bs = new Date(b.start).getTime()
  const be = new Date(b.end).getTime()
  return as < be && bs < ae
}

/**
 * Laporan konflik untuk satu kursus: semua slot kursus itu yang bertabrakan
 * dengan pelajaran kursus LAIN di hari yang sama. Sesama kursus (mis. dua
 * grup paralel) tidak dianggap konflik. Hasil diurutkan ascending.
 */
export function findCourseConflicts(
  lessons: Lesson[],
  courseKey: string,
): CourseConflictReport {
  const key = courseKey.trim()
  const mine = lessons.filter((l) => courseKeyOf(l) === key)
  const others = lessons.filter((l) => courseKeyOf(l) !== key)

  const details: ConflictDetail[] = []
  const otherKeys = new Set<string>()
  for (const m of mine) {
    const clashing = others.filter((o) => sameDay(m, o) && overlaps(m, o))
    if (clashing.length === 0) continue
    clashing.forEach((c) => otherKeys.add(courseKeyOf(c)))
    details.push({ mine: m, others: clashing })
  }
  details.sort(
    (a, b) =>
      a.mine.start.localeCompare(b.mine.start) ||
      a.mine.end.localeCompare(b.mine.end),
  )
  return {
    occurrences: mine.length,
    slots: details.length,
    otherCourses: otherKeys.size,
    details,
  }
}
