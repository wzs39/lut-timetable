import type { Lesson } from '../types'
import { KEYS, readJson, writeJson, removeKey } from './storage'
import { fetchMoodleWebService, moodleCredsFromUrl } from './fetchIcs'
import { matchCourseCode, fetchEnrolledCourses } from './courses'

/**
 * Nilai Moodle (moodle.lut.fi) per mata kuliah, via Mobile web service:
 *
 *   /webservice/rest/server.php?wstoken=<token>&wsfunction=<fn>&moodlewsrestformat=json
 *
 * Token HARUS dibuat khusus di situs Moodle (token kalender TIDAK punya hak
 * webservice): my/ → Preferences → Security keys → "Create a new key".
 * Endpoint hanya menerima GET — jalur fetch yang sama dipakai kalender
 * (CapacitorHttp / Electron bridge / dev proxy / proxy publik) jadi bekerja
 * di semua platform tanpa pengaturan tambahan.
 *
 * Fungsi inti:
 *  - core_webservice_get_site_info → validasi token + userid
 *  - core_grades_get_grades  → rata-rata kelas + item penilaian
 *  - gradereport_user_get_grade_items → rata-rata yang terlihat user (α/β)
 */

const WS_URL = 'https://moodle.lut.fi/webservice/rest/server.php'

export interface MoodleGradesSource {
  /** Webservice token (dari Security keys), BUKAN token kalender. */
  token: string
  /** Disimpan setelah validasi pertama. */
  userid?: number
  lastSync?: string
}

export interface GradeItem {
  name: string
  /** Nilai sudah dinormalisasi 0–100 (Moodle memberi 0–1 untuk item bertipe real). */
  grade: number | null
  max: number | null
  /** rata-rata kelas bila tersedia (0–100). */
  classAvg: number | null
  /** 0–100, persen kontribusi item terhadap total. */
  weight: number | null
  feedback?: string
}

export interface CourseGrades {
  /** Kode kursus LUT bila cocok dengan jadwal, else nama kursus Moodle. */
  course: string
  /** true bila `course` adalah kode dari jadwal (bisa diklik/diwarnai). */
  matched: boolean
  items: GradeItem[]
  /** Rata-rata keseluruhan yang terlihat user (0–100) bila tersedia. */
  average: number | null
  /** ID kursus Moodle untuk deep-link /grade/report/user/index.php?id=<id>. */
  courseId?: number
}

export type GradesError =
  | { kind: 'badToken'; detail?: string }
  | { kind: 'http'; status: number }
  | { kind: 'network'; detail: string }
  | { kind: 'empty' }

/** Validasi + kembalikan sumber siap pakai (userid terisi) — dipakai lintas domain ws. */
export async function validateGradesSource(src: { token: string; userid?: number }): Promise<{ token: string; userid: number }> {
  const userid = src.userid ?? (await validateGradesToken(src.token))
  return { token: src.token, userid }
}

export function loadGradesSource(): MoodleGradesSource | null {
  const raw = readJson<Partial<MoodleGradesSource> | null>(KEYS.gradesSource, null)
  if (!raw || typeof raw.token !== 'string' || !raw.token.trim()) return null
  return { token: raw.token, userid: raw.userid, lastSync: raw.lastSync }
}

export function saveGradesSource(src: MoodleGradesSource | null): void {
  if (src) writeJson(KEYS.gradesSource, src)
  else removeKey(KEYS.gradesSource)
}

/* ----------------------------- ws plumbing ----------------------------- */

/** Panggil satu wsfunction dan parse JSON-nya; JSONException Moodle → badToken. */
export async function wsCall<T>(
  token: string,
  wsfunction: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const q = new URLSearchParams({
    wstoken: token,
    wsfunction,
    moodlewsrestformat: 'json',
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  })
  const text = await fetchMoodleWebService(`${WS_URL}?${q.toString()}`)
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw { kind: 'network', detail: `invalid JSON from ${wsfunction}` } as GradesError
  }
  // Moodle mengembalikan { exception, message } untuk token salah/hak kurang.
  if (data && typeof data === 'object' && 'exception' in data) {
    const ex = data as { exception?: string; message?: string }
    throw { kind: 'badToken', detail: ex.message || ex.exception } as GradesError
  }
  return data as T
}

/* ------------------------------ normalisasi ----------------------------- */

function toPercent(raw: unknown, grademax: unknown): number | null {
  const g = typeof raw === 'number' ? raw : Number(raw)
  const m = typeof grademax === 'number' ? grademax : Number(grademax)
  if (!Number.isFinite(g) || !Number.isFinite(m) || m <= 0) return null
  return Math.round((g / m) * 1000) / 10
}

/** Skala 0–1 (nilai real, mis. weighted total) → 0–100. */
function ratioToPercent(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return Math.round((n <= 1.0001 ? n * 100 : n) * 10) / 10
}

function buildItems(raw: RawGradeItem[]): GradeItem[] {
  return raw.map((it) => ({
    name: it.itemname?.trim() || '—',
    grade: toPercent(it.graderaw, it.grademax),
    max: typeof it.grademax === 'number' && it.grademax > 0 ? it.grademax : null,
    classAvg: toPercent(it.gradeaverage ?? it.average, it.grademax),
    weight:
      typeof it.weight === 'number' && it.weight > 0
        ? Math.round(it.weight * 1000) / 10
        : null,
    feedback: it.feedback?.trim() || undefined,
  }))
}

/* ------------------------------- parsing ------------------------------- */

interface RawGradeItem {
  itemname?: string
  graderaw?: number | string
  grademax?: number | string
  gradeaverage?: number | string
  average?: number | string
  weight?: number | string
  feedback?: string
}

interface RawCourseGrades {
  courseid?: number
  usergrade?: { grade?: number | string; rawgrade?: number | string }
  gradeitems?: RawGradeItem[]
}

/** gradereport_user_get_grade_items → CourseGrades[] (hanya kursus bernilai). */
export function parseGradeItems(response: unknown): CourseGrades[] {
  const byId = (response as { usergrades?: unknown[] })?.usergrades
  if (!Array.isArray(byId)) return []
  const out: CourseGrades[] = []
  for (const c of byId as RawCourseGrades[]) {
    const items = buildItems(c.gradeitems ?? [])
    if (items.length === 0) continue
    // Rata-rata keseluruhan: usergrade bisa berupa rasio 0–1 (weighted total).
    const avg = ratioToPercent(c.usergrade?.grade ?? c.usergrade?.rawgrade)
    out.push({
      course: '',
      matched: false,
      items,
      average: avg,
      courseId: c.courseid,
    })
  }
  return out
}

/* ------------------------------ fetch API ------------------------------ */

/**
 * Validasi token (sekaligus ambil userid) dengan site info.
 * Token kalender diberi exception "accessexception" — jelas ditolak di sini.
 */
export async function validateGradesToken(token: string): Promise<number> {
  const info = await wsCall<{
    userid?: number
    fullname?: string
  }>(token, 'core_webservice_get_site_info')
  if (!info?.userid) {
    throw { kind: 'badToken', detail: 'site info returned no userid' } as GradesError
  }
  return info.userid
}

/**
 * Ambil nilai seluruh kursus. Token dulu divalidasi (murah, 1 call) supaya
 * token kalender yang salah langsung menghasilkan `badToken`, bukan "empty".
 */
export async function fetchGrades(
  src: MoodleGradesSource,
  lessons: Lesson[],
): Promise<CourseGrades[]> {
  const userid =
    src.userid ?? (await validateGradesToken(src.token))
  // Pra-fetch daftar enrol resmi (cache 24 jam) — jangkar pencocokan kursus.
  await fetchEnrolledCourses({ token: src.token, userid }).catch(() => null)
  const report = await wsCall<{ usergrades?: unknown[] }>(
    src.token,
    'gradereport_user_get_grade_items',
    { userid },
  )
  const parsed = parseGradeItems(report)
  if (parsed.length === 0) throw { kind: 'empty' } as GradesError

  // Cocokkan ke jadwal lewat matcher tunggal (courses.ts): daftar enrol
  // resmi → kode-regex → judul. Semua domain sinkron memakai logika ini.
  for (const c of parsed) {
    const label = displayNameFor(c, report)
    c.course = label
    const code = matchCourseCode(label, lessons)
    if (code) {
      c.course = code
      c.matched = true
    }
  }
  const byCourse = new Map<string, CourseGrades>()
  for (const c of parsed) byCourse.set(c.course, c)
  return [...byCourse.values()].sort((a, b) => a.course.localeCompare(b.course))
}

function displayNameFor(c: CourseGrades, report: unknown): string {
  const rep = report as {
    usergrades?: Array<{
      courseid?: number
      usergrade?: { displaytext?: string }
      gradeitems?: Array<{ itemtype?: string; itemname?: string }>
    }>
  }
  const entry = rep.usergrades?.find((g) => g.courseid === c.courseId)
  // Nama kursus tidak dikirim langsung: gunakan displaytext (mis. "CT60A0250 …")
  // atau itemname item kategori ber-type 'course'.
  const courseItem = entry?.gradeitems?.find((i) => i.itemtype === 'course')
  return (
    entry?.usergrade?.displaytext?.trim() ||
    courseItem?.itemname?.trim() ||
    `Course ${c.courseId ?? '?'}`
  )
}

/** Pesan ramah untuk tiap jenis kegagalan — i18n memakai kind ini. */
export function gradesErrorKind(e: unknown): GradesError | null {
  if (e && typeof e === 'object' && 'kind' in e) return e as GradesError
  return null
}

/** Sumber kalender → kode kursus (dipakai UI untuk cek token kalender vs webservice). */
export function isCalendarTokenUrl(url: string): boolean {
  return !!moodleCredsFromUrl(url)
}
