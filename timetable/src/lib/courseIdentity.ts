import { KEYS, readJson, writeJson } from './storage'
import { normalizeCourseCode } from './ics'
// Fungsi deklarasi (hoisted) — penukaran import dengan courses.ts aman saat runtime.
import { extractCourseCode } from './courses'
import type { EnrolledCourse } from './courses'
import type { Lesson } from '../types'

/**
 * Identitas kursus persisten: courseid Moodle ↔ kode SISU ↔ nama tampil.
 *
 * Masalah yang diselesaikan: grades/tasks/announcements/notifications tiap
 * domain menghitung ulang heuristik pencocokan (matchCourseCode butuh daftar
 * `lessons` sebagai pembanding) dan sesi tanpa jadwal (unit test, first-run)
 * tidak punya jangkar. Tabel ini DITULIS sekali saat daftar enrol tersinkron
 * — memotong kode dari LESSONS yang cocok — lalu dibaca oleh semua domain
 * tanpa lessons sama sekali.
 *
 * Satu pemilik data: courses.ts memanggil saveIdentityFromEnrol() setiap
 * kali enrol di-fetch; pembaca lain hanya resolve via CourseIdentityIndex.
 */

/** Baris identitas satu kursus. */
export interface CourseIdentity {
  courseid: number
  /** Kode jadwal SISU yang cocok (mis. "BM20A9200") — null bila tak ada di jadwal. */
  code: string | null
  shortname: string
  fullname: string
}

interface IdentityShape {
  updatedAt: number
  courses: CourseIdentity[]
}

/** Indeks baca-telusur di atas tabel — dibangun sekali, dipakai banyak. */
export class CourseIdentityIndex {
  private byId: Map<number, CourseIdentity>
  private byCode: Map<string, CourseIdentity>
  private byShort: Map<string, CourseIdentity>

  constructor(courses: CourseIdentity[]) {
    this.byId = new Map()
    this.byCode = new Map()
    this.byShort = new Map()
    for (const c of courses) {
      this.byId.set(c.courseid, c)
      if (c.code) this.byCode.set(normalizeCourseCode(c.code), c)
      if (c.shortname) this.byShort.set(c.shortname.toLowerCase(), c)
    }
  }

  /** courseid Moodle → kode jadwal (null bila kursus tak dipetakan ke jadwal). */
  codeFor(courseid: number | null | undefined): string | null {
    if (courseid == null) return null
    return this.byId.get(courseid)?.code ?? null
  }

  /** courseid Moodle → shortname (label pendek resmi). */
  shortnameFor(courseid: number | null | undefined): string | null {
    if (courseid == null) return null
    return this.byId.get(courseid)?.shortname ?? null
  }

  /** courseid Moodle → judul manusiawi dari fullname ("BM20A9200 Math A - …" → "Math A"). */
  titleFor(courseid: number | null | undefined): string | null {
    if (courseid == null) return null
    return this.byId.get(courseid)?.fullname ?? null
  }

  /** Kode jadwal → courseid (arah SISU → Moodle, untuk jadwal/lesson-detail). */
  idForCode(code: string | undefined | null): number | null {
    if (!code) return null
    return this.byCode.get(normalizeCourseCode(code))?.courseid ?? null
  }

  /** Nama/shortname Moodle apa pun → baris identitas (fallback lookup). */
  forName(name: string | undefined | null): CourseIdentity | null {
    if (!name) return null
    const n = name.trim().toLowerCase()
    if (!n) return null
    const exact = this.byShort.get(n)
    if (exact) return exact
    // fullname/shortname terkandung dalam nama (mis. label panjang) — terpanjang dulu.
    let best: CourseIdentity | null = null
    for (const c of this.byShort.values()) {
      if (n.includes(c.shortname.toLowerCase())) {
        if (!best || c.shortname.length > best.shortname.length) best = c
      }
    }
    return best
  }

  get size(): number {
    return this.byId.size
  }
}

/* ------------------------------ persistence ------------------------------ */

export function loadIdentities(): CourseIdentity[] {
  try {
    const raw = readJson<IdentityShape | null>(KEYS.courseIdentity, null)
    if (raw && Array.isArray(raw.courses)) return raw.courses
  } catch {
    /* non-fatal */
  }
  return []
}

/** Tulis/pbarui tabel dari daftar enrol + jadwal. Dipanggil courses.ts. */
export function saveIdentityFromEnrol(
  enrolled: EnrolledCourse[],
  lessons: Lesson[],
): CourseIdentity[] {
  // Kode unik dari jadwal, dinormalisasi → tampilan apa adanya.
  const lessonCodes = new Map(
    lessons.filter((l) => l.code).map((l) => [normalizeCourseCode(l.code!), l.code!]),
  )
  const courses: CourseIdentity[] = enrolled.map((e) => ({
    courseid: e.courseid,
    // Kode dari EKSTRAKSI shortname ("BM20A9200 Contact teaching, …" →
    // "BM20A9200"), bukan normalizeCourseCode — itu hanya membersihkan kode
    // murni, jadi dulu SEMUA baris ber-code null dan idForCode selalu kosong.
    code:
      lessonCodes.get(extractCourseCode(e.shortname) ?? '') ??
      lessonCodes.get(extractCourseCode(e.fullname) ?? '') ??
      null,
    shortname: e.shortname,
    fullname: e.fullname,
  }))
  try {
    writeJson(KEYS.courseIdentity, { updatedAt: Date.now(), courses } satisfies IdentityShape)
  } catch {
    /* kuota penuh: pemanggil tetap dapat nilai balik untuk sesi ini */
  }
  return courses
}

/** Indeks dari tabel tersimpan — sudah dimuat, tanpa network/lessons. */
export function loadIdentityIndex(): CourseIdentityIndex {
  return new CourseIdentityIndex(loadIdentities())
}
