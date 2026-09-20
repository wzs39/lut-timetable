import type { Lesson } from '../types'
import { wsCall } from './grades'
import { normalizeCourseCode } from './ics'
import { readJson, writeJson, TRANSIENT_KEYS } from './storage'
import { htmlToText } from './html'
import { saveIdentityFromEnrol } from './courseIdentity'

/**
 * Daftar kursus resmi pengguna (core_enrol_get_users_courses) — sumber
 * kebenaran untuk memetakan nama/shortname Moodle → kode kursus LUT yang
 * ada di jadwal. Menggantikan pencocokan tebakan-judul di tiga tempat
 * (grades, actions, moodle ICS) dengan satu pemilik logika.
 *
 * Shape respons: [{ id, shortname, fullname, displayname, ... }]
 *   shortname LUT umumnya SUDAH berupa kode kursus (mis. "CT60A4050").
 *
 * Matcher (urutan prioritas, keduanya butuh jadwal sebagai pembanding):
 *   1. Resmi: shortname/fullname Moodle ≡ kode di jadwal (normalisasi sama)
 *   2. Kode-regex: ekstrak pola kode LUT dari nama, validasi terhadap jadwal
 *   3. Judul (fallback lama): containment dua arah — paling lemah
 *
 * Cache: 24 jam di localStorage (daftar enrol jarang berubah) + in-memory
 * per sesi; kegagalan jaringan memakai cache basi bila ada, bukan error.
 */

export interface EnrolledCourse {
  courseid: number
  shortname: string
  fullname: string
}

interface CacheShape {
  fetchedAt: number
  courses: EnrolledCourse[]
}

const CACHE_TTL = 24 * 3600 * 1000
let memCache: EnrolledCourse[] | null = null

function cacheKey(): string {
  return TRANSIENT_KEYS.icsCachePrefix + 'enrolled_courses'
}

export function loadEnrolledCourses(): EnrolledCourse[] | null {
  if (memCache) return memCache
  try {
    const raw = readJson<CacheShape | null>(cacheKey(), null)
    if (raw && Array.isArray(raw.courses) && Date.now() - raw.fetchedAt <= CACHE_TTL) {
      memCache = raw.courses
      return memCache
    }
  } catch {
    /* non-fatal */
  }
  return null
}

export function clearEnrolledCoursesCache(): void {
  memCache = null
  try {
    localStorage.removeItem(cacheKey())
  } catch {
    /* non-fatal */
  }
}

/** Parse respons enrol; hanya field yang dipakai matcher. */
export function parseEnrolledCourses(response: unknown): EnrolledCourse[] {
  if (!Array.isArray(response)) return []
  const out: EnrolledCourse[] = []
  for (const c of response as Array<Record<string, unknown>>) {
    const courseid = Number(c.id)
    const shortname = typeof c.shortname === 'string' ? c.shortname.trim() : ''
    const fullname = typeof c.fullname === 'string' ? c.fullname.trim() : ''
    if (!Number.isFinite(courseid) || (!shortname && !fullname)) continue
    out.push({ courseid, shortname: shortname || fullname, fullname: fullname || shortname })
  }
  return out
}

/** Ambil daftar kursus resmi (cache → jaringan). Tanpa token → null.
 *  lessons opsional: bila diberikan, tabel identitas ikut ditulis dari
 *  jadwal (courseid ↔ kode); tanpa itu baris identitas tidak berkode. */
export async function fetchEnrolledCourses(
  src: { token: string; userid?: number } | null,
  lessons?: Lesson[],
): Promise<EnrolledCourse[] | null> {
  if (!src?.token) return null
  const cached = loadEnrolledCourses()
  if (cached) {
    // Cache pun ikut menulis identitas: penulisan lokal murah, dan lesson
    // bisa saja baru dimuat (dulu cache-hit = baris identitas tak berkode
    // sampai cache enrol kedaluwarsa 24 jam).
    saveIdentityFromEnrol(cached, lessons ?? [])
    return cached
  }
  const res = await wsCall<unknown>(src.token, 'core_enrol_get_users_courses', {
    userid: src.userid ?? 0,
  })
  const courses = parseEnrolledCourses(res)
  if (courses.length === 0) return cached ?? null
  memCache = courses
  try {
    writeJson(cacheKey(), { fetchedAt: Date.now(), courses } satisfies CacheShape)
  } catch {
    /* kuota penuh: biarkan cache memori saja */
  }
  // Satu titik tulis tabel identitas: courseid ↔ kode jadwal ↔ nama.
  saveIdentityFromEnrol(courses, lessons ?? [])
  return courses
}

/* ------------------------------- matcher ------------------------------- */

const COURSE_CODE_RE = /\b([A-Z]{1,4}\d{1,3}[A-Z]{0,3}\d{0,4}(?:-\d{4})?)\b/

/**
 * Pemetaan nama Moodle → kode kursus LUT di jadwal, dengan daftar enrol
 * resmi sebagai jangkar bila tersedia. Ini SATU pemilik logika pencocokan:
 * grades.ts / actions.ts / moodle.ts semuanya memakai ini.
 */
export function matchCourseCode(
  name: string | undefined,
  lessons: Lesson[],
  enrolled: EnrolledCourse[] | null = loadEnrolledCourses(),
): string | undefined {
  if (!name) return undefined
  const n = name.trim().toLowerCase()
  if (!n) return undefined
  const normLessons = new Map(
    lessons.filter((l) => l.code).map((l) => [normalizeCourseCode(l.code!), l.code!]),
  )

  // 1. Resmi: nama itu sendiri ATAU nama mengandung shortname/fullname resmi.
  if (enrolled && enrolled.length > 0) {
    for (const c of enrolled) {
      const sn = c.shortname.toLowerCase()
      const fn = c.fullname.toLowerCase()
      // shortname persis (atau nama berakhir/prefix dengannya) → cek jadwal
      if (n === sn || n === fn) {
        const code = normLessons.get(normalizeCourseCode(c.shortname))
        if (code) return code
      }
    }
    // nama mengandung salah satu shortname resmi (mis. "CT60A4050 SWE1")
    for (const c of enrolled) {
      const sn = c.shortname.toLowerCase()
      if (sn && n.includes(sn)) {
        const code = normLessons.get(normalizeCourseCode(c.shortname))
        if (code) return code
      }
    }
  }

  // 2. Kode-regex dari nama itu sendiri, validasi terhadap jadwal.
  const m = name.match(COURSE_CODE_RE)
  if (m && normLessons.has(normalizeCourseCode(m[1]))) {
    return m[1]
  }

  // 3. Fallback lama: containment judul dua arah (paling lemah).
  const byTitle = lessons.find(
    (l) => l.title.toLowerCase().includes(n) || n.includes(l.title.toLowerCase()),
  )
  return byTitle?.code
}

/**
 * Kode kursus dari sebuah nama TANPA validasi jadwal — untuk label pendek
 * di UI (mis. "BH60A7201 Blended teaching …" → "BH60A7201").
 */
export function extractCourseCode(name: string | undefined): string | undefined {
  const m = name?.match(COURSE_CODE_RE)
  return m?.[1]
}

/**
 * Nama kursus manusiawi dari fullname Moodle. Format LUT:
 * "BM20A9200 Mathematics A - Contact teaching, Lahti 31.8.2026-11.12.2026"
 * → "Mathematics A" (potongan antara kode dan " - ").
 */
export function extractCourseTitle(fullname: string | undefined): string | undefined {
  if (!fullname) return undefined
  const name = htmlToText(fullname)
  if (!name) return undefined
  const noDate = name.replace(/\s*\d{1,2}\.\d{1,2}\.\d{4}\s*-\s*[\d.]+\s*$/, '')
  const parts = noDate.split(/\s+-\s+/)
  const head = (parts[0] ?? '').trim()
  const code = extractCourseCode(head)
  const title = code ? head.slice(code.length).trim() : head
  return title || undefined
}
