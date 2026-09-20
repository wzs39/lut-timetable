import type { Lesson } from '../types'
import { KEYS, readJson, writeJson, removeKey } from './storage'
import { fetchMoodleWebService, moodleCredsFromUrl } from './fetchIcs'
import { matchCourseCode, extractCourseCode, extractCourseTitle } from './courses'
import { loadIdentityIndex } from './courseIdentity'
import { primeEnrolAnchor } from './moodleSync'
import { getFinalCourseGrade } from './gradeCalc'
import { htmlToText } from './html'

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
  /**
   * Teks nilai resmi Moodle untuk item SKALA (Fail–Pass, A–F) — persen
   * (1/2 = 50%) menyesatkan di sana. Null untuk item numerik.
   */
  gradeText?: string
  feedback?: string
}

/**
 * 成绩报告 → cmid 键控的提交/评分状态（内容树徽标数据源）。
 *
 * 为什么不用 mod_assign_get_submissions：那是教师视角 API，LUT 学生 token
 * 返回 "No access rights in module context"（applySubmissionStatus 的数据
 * 源因此在 LUT 上恒空）。gradereport 的 gradeitems 学生可读，且每活动行
 * 自带 cmid + submitted/graded 时间戳——这是学生视角唯一可靠的提交状态源。
 * 仅提取有提交记录的项：树里“未提交”保持勾选框语义，不新增第三种标记。
 */
export interface GradeCmidStatus {
  state: 'submitted' | 'graded'
  grade?: string
  submittedAt?: string
}

export function gradeStatusByCmid(response: unknown): Map<number, GradeCmidStatus> {
  const out = new Map<number, GradeCmidStatus>()
  const byId = (response as { usergrades?: unknown[] })?.usergrades
  if (!Array.isArray(byId)) return out
  for (const c of byId as { gradeitems?: unknown[] }[]) {
    if (!Array.isArray(c?.gradeitems)) continue
    for (const raw of c.gradeitems as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object') continue
      const cmid = typeof raw.cmid === 'number' ? raw.cmid : Number(raw.cmid)
      if (!Number.isFinite(cmid) || raw.itemtype !== 'mod') continue
      if (raw.gradedatesubmitted == null) continue // 从未提交 → 无徽标
      const graded = raw.gradedategraded != null
      // gradeformatted 可能是 HTML（pass 图标 + 数字）——剥标签留文本。
      const gradeText = typeof raw.gradeformatted === 'string'
        ? (htmlToText(raw.gradeformatted) ?? '').trim()
        : ''
      out.set(cmid, {
        state: graded ? 'graded' : 'submitted',
        grade: graded && gradeText ? gradeText : undefined,
        submittedAt: new Date((raw.gradedatesubmitted as number) * 1000).toISOString(),
      })
    }
  }
  return out
}

export interface CourseGrades {
  /** Kode kursus LUT bila cocok dengan jadwal, else kode pendek Moodle. */
  course: string
  /** Nama manusiawi dari fullname Moodle (mis. "Mathematics A"). */
  courseTitle?: string
  /** true bila `course` adalah kode dari jadwal (bisa diklik/diwarnai). */
  matched: boolean
  items: GradeItem[]
  /** Rata-rata keseluruhan yang terlihat user (0–100) bila tersedia. */
  average: number | null
  /**
   * Total resmi Moodle (0–100): usergrade rasio 0–1 atau baris itemtype
   * 'course' (item belum dinilai dihitung 0). Null bila server tak
   * mengirimnya — UI memprioritaskan angka resmi ini di atas hitungan lokal.
   */
  officialTotal?: number | null
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
  // graderaw null = item belum dinilai — BUKAN nol.
  if (raw == null || !Number.isFinite(g) || !Number.isFinite(m) || m <= 0) return null
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
    name: htmlToText(it.itemname) || '—',
    grade: toPercent(it.graderaw, it.grademax),
    max: typeof it.grademax === 'number' && it.grademax > 0 ? it.grademax : null,
    classAvg: toPercent(it.gradeaverage ?? it.average, it.grademax),
    // Bobot: weightraw (rasio 0–1, Moodle 4.x) > weight (persen). Baris
    // kategori/course tanpa nama tidak ikut sebagai item penilaian.
    weight:
      typeof it.weightraw === 'number' && it.weightraw > 0
        ? Math.round(it.weightraw * 1000) / 10
        : typeof it.weight === 'number' && it.weight > 0
          ? Math.round(it.weight * 10) / 10
          : null,
    // Teks nilai resmi Moodle ("Passed", "8.00") — UTAMAKAN di atas persen:
    // skala Fail–Pass 1/2 = 50% menyesatkan. Belum dinilai ('-')/tanpa field
    // → undefined (UI fallback ke persen, lalu —).
    gradeText:
      it.graderaw != null
        ? htmlToText(it.gradeformatted)?.trim() || undefined
        : undefined,
    feedback: it.feedback?.trim() || undefined,
  }))
}

/* ------------------------------- parsing ------------------------------- */

interface RawGradeItem {
  itemname?: string
  itemtype?: string
  graderaw?: number | string | null
  grademax?: number | string
  gradeaverage?: number | string
  average?: number | string
  /** Moodle 4.x: proporsi bobot 0–1 (mis. 0.07143 = 7.14%). */
  weightraw?: number | string
  /** Alternatif lama: bobot langsung dalam persen. */
  weight?: number | string
  gradeformatted?: string
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
  for (const c of byId as (RawCourseGrades & { gradeitems?: (RawGradeItem & { itemtype?: string })[] })[]) {
    const rawItems = c.gradeitems ?? []
    // Baris total resmi Moodle: itemtype 'course' (raw 24/112 = 21.43%,
    // item belum dinilai dihitung 0 dalam bobotnya). Baris 'category'
    // (subtotal kategori, itemname null) bukan item penilaian — dibuang.
    const courseRow = rawItems.find((it) => it.itemtype === 'course')
    const isMeta = (it: RawGradeItem) =>
      it === courseRow || (it as { itemtype?: string }).itemtype === 'category'
    const items = buildItems(rawItems.filter((it) => !isMeta(it)))
    if (items.length === 0) continue
    // Total resmi (usergrade rasio 0–1 > baris 'course') — ekstraksi bidang
    // mentah; SELURUH rantai prioritas nilai ada di gradeCalc.getFinalCourseGrade.
    const official =
      ratioToPercent(c.usergrade?.grade ?? c.usergrade?.rawgrade) ??
      (courseRow?.grademax != null ? toPercent(courseRow.graderaw, courseRow.grademax) : null)
    out.push({
      course: '',
      matched: false,
      items,
      // Satu-satunya tempat skor dihitung: fungsi murni di gradeCalc.
      average: getFinalCourseGrade(items, official),
      officialTotal: official,
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
): Promise<{ courses: CourseGrades[]; statusByCmid: Map<number, GradeCmidStatus> }> {
  const userid =
    src.userid ?? (await validateGradesToken(src.token))
  // Daftar enrol resmi: jangkar pencocokan DAN sumber courseid per-kursus.
  // Satu titik lewat moodleSync.primeEnrolAnchor (jadwal ikut → identitas
  // termutakhirkan). Enrol juga sudah dipanaskan backgroundRefresh — cache.
  const enrol = await primeEnrolAnchor({ token: src.token, userid }, lessons)
  // LUT (Moodle 4.x): gradereport_user_get_grade_items tanpa courseid
  // menjawab invalidparameter — panggil PER KURSUS dari daftar enrol.
  // Panggilan paralel terbatas agar tidak membanjiri server.
  const courseIds = (enrol ?? []).map((c) => c.courseid)
  const reports = await Promise.all(
    courseIds.map(async (courseid) => {
      try {
        return await wsCall<{ usergrades?: unknown[] }>(
          src.token,
          'gradereport_user_get_grade_items',
          { userid, courseid },
        )
      } catch {
        return null // satu kursus gagal tidak boleh mematikan semuanya
      }
    }),
  )
  const report = { usergrades: reports.flatMap((r) => (r as { usergrades?: unknown[] })?.usergrades ?? []) }
  const parsed = parseGradeItems(report)
  if (parsed.length === 0) throw { kind: 'empty' } as GradesError

  // Cocokkan ke jadwal lewat matcher tunggal (courses.ts): daftar enrol
  // resmi → kode-regex → judul. Semua domain sinkron memakai logika ini.
  // Nama kursus: payload LUT tidak mengirim displaytext — shortname enrol
  // adalah sumber otoritatif (token pertamanya memang kode kursus).
  // Identitas kursus: tabel persisten ditulis fetchEnrolledCourses di atas —
  // baca dari sini tanpa menghitung ulang heuristik per domain.
  const identity = loadIdentityIndex()
  const nameById = new Map((enrol ?? []).map((e) => [e.courseid, e]))
  for (const c of parsed) {
    const ec = nameById.get(c.courseId ?? -1)
    const label = ec?.shortname || ec?.fullname || displayNameFor(c, report)
    // Judul manusiawi dari fullname ("BM20A9200 Mathematics A - …" →
    // "Mathematics A"); shortname saja tidak punya judul.
    c.courseTitle = extractCourseTitle(ec?.fullname) ?? extractCourseTitle(label)
    // Kode: O(1) dari tabel identitas; fallback heuristik lama hanya bila
    // baris identitas belum ada (enrol pertama kali gagal, dsb.).
    const code = identity.codeFor(c.courseId) ?? matchCourseCode(label, lessons)
    if (code) {
      c.course = code
      c.matched = true
    } else {
      // Tanpa kecocokan jadwal: tampilkan kode pendek bila ada (judul penuh
      // di courseTitle), bukan "BH60A7201 Blended teaching 31.8.2026-30.7.2027".
      c.course = extractCourseCode(label) ?? label
    }
  }
  const byCourse = new Map<string, CourseGrades>()
  for (const c of parsed) byCourse.set(c.course, c)
  return {
    courses: [...byCourse.values()].sort((a, b) => a.course.localeCompare(b.course)),
    // 顺手产出：内容树的提交状态徽标数据（cmid 键控）。与成绩同源同请求，零额外开销。
    statusByCmid: gradeStatusByCmid(report),
  }
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
