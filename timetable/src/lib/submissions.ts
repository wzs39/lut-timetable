import type { Task } from './tasks'
import { wsCall, validateGradesToken, loadGradesSource } from './grades'
import { fetchEnrolledCourses } from './courses'

/**
 * Status pengumpulan & penilaian tugas Moodle (mod_assign), via webservice
 * token yang sama dengan nilai. Bentuk respons (dokumentasi Moodle):
 *
 *   mod_assign_get_assignments → { courses: [ { assignments: [ { id, name, duedate } ] } ] }
 *   mod_assign_get_submissions → { assignments: [ { assignmentid, submissions: [ { userid, status, timemodified } ] } ] }
 *   mod_assign_get_grades      → { assignments: [ { assignmentid, grades: [ { userid, grade, timemodified, feedbacktext? } ] } ] }
 *
 * Pemetaan ke Task memakai kunci longgar judul+kursus+due(hari) karena ID
 * Moodle tidak disimpan di Task. Arsip otomatis hanya SEKALI: sinkron
 * pertama setelah submission muncul menandai note dengan `[Moodle] ✔`;
 * setelah itu completed pengguna selalu menang (un-complete dihormati).
 */

export type SubmissionState = 'submitted' | 'graded'

export interface SubmissionStatus {
  state: SubmissionState | 'new' | 'draft'
  /** Teks nilai (mis. "9/10") bila sudah dinilai. */
  grade?: string
  gradedAt?: string
  feedback?: string
  submittedAt?: string
}

interface RawAssignment {
  id?: number
  name?: string
  courseid?: number
  duedate?: number
  allowsubmissionsfromdate?: number
}

interface RawCourse {
  id?: number
  shortname?: string
  fullname?: string
  assignments?: RawAssignment[]
}

interface RawSubmissionEntry {
  userid?: number
  status?: string
  timemodified?: number
}

interface RawGradeEntry {
  userid?: number
  grade?: string | number
  timemodified?: number
  feedbacktext?: string
}

/** mod_assign_get_assignments → tugas rata per kursus. */
export function parseAssignments(response: unknown): Array<{
  id: number
  name: string
  course: string
  dueAt?: string
  startAt?: string
}> {
  const courses = (response as { courses?: RawCourse[] })?.courses
  if (!Array.isArray(courses)) return []
  const out: Array<{ id: number; name: string; course: string; dueAt?: string; startAt?: string }> = []
  for (const c of courses) {
    const courseName = c.shortname || c.fullname || ''
    for (const a of c.assignments ?? []) {
      if (a.id == null || !a.name) continue
      out.push({
        id: a.id,
        name: a.name.trim(),
        course: courseName,
        dueAt: a.duedate ? new Date(a.duedate * 1000).toISOString() : undefined,
        startAt: a.allowsubmissionsfromdate
          ? new Date(a.allowsubmissionsfromdate * 1000).toISOString()
          : undefined,
      })
    }
  }
  return out
}

/** mod_assign_get_submissions → Map<assignmentid, {status, submittedAt}> milik `userid`. */
export function parseSubmissions(
  response: unknown,
  userid: number,
): Map<number, { state: 'submitted' | 'draft' | 'new'; submittedAt?: string }> {
  const out = new Map<number, { state: 'submitted' | 'draft' | 'new'; submittedAt?: string }>()
  const arr = (response as { assignments?: Array<{ assignmentid?: number; submissions?: RawSubmissionEntry[] }> })
    ?.assignments
  if (!Array.isArray(arr)) return out
  for (const a of arr) {
    if (a.assignmentid == null) continue
    const mine = (a.submissions ?? []).find((s) => s.userid === userid)
    if (!mine?.status) continue
    out.set(a.assignmentid, {
      state:
        mine.status === 'submitted'
          ? 'submitted'
          : mine.status === 'draft'
            ? 'draft'
            : 'new',
      submittedAt: mine.timemodified
        ? new Date(mine.timemodified * 1000).toISOString()
        : undefined,
    })
  }
  return out
}

/** mod_assign_get_grades → Map<assignmentid, {grade, gradedAt, feedback}> milik `userid`. */
export function parseGrades(
  response: unknown,
  userid: number,
): Map<number, { grade: string; gradedAt?: string; feedback?: string }> {
  const out = new Map<number, { grade: string; gradedAt?: string; feedback?: string }>()
  const arr = (response as { assignments?: Array<{ assignmentid?: number; grades?: RawGradeEntry[] }> })
    ?.assignments
  if (!Array.isArray(arr)) return out
  for (const a of arr) {
    if (a.assignmentid == null) continue
    const mine = (a.grades ?? []).find((g) => g.userid === userid)
    if (!mine || mine.grade == null || mine.grade === '') continue
    out.set(a.assignmentid, {
      grade: String(mine.grade),
      gradedAt: mine.timemodified
        ? new Date(mine.timemodified * 1000).toISOString()
        : undefined,
      feedback: mine.feedbacktext?.trim() || undefined,
    })
  }
  return out
}

/** Gabungkan submission + grade jadi status akhir per assignmentid. */
export function combineStatus(
  subs: Map<number, { state: 'submitted' | 'draft' | 'new'; submittedAt?: string }>,
  grades: Map<number, { grade: string; gradedAt?: string; feedback?: string }>,
): Map<number, SubmissionStatus> {
  const out = new Map<number, SubmissionStatus>()
  const ids = new Set<number>([...subs.keys(), ...grades.keys()])
  for (const id of ids) {
    const g = grades.get(id)
    const s = subs.get(id)
    if (g) {
      out.set(id, { state: 'graded', grade: g.grade, gradedAt: g.gradedAt, feedback: g.feedback, submittedAt: s?.submittedAt })
    } else if (s) {
      out.set(id, s)
    }
  }
  return out
}

/** Kunci pencocokan longgar: judul normalisasi + due (hari). Kursus TIDAK
 *  ikut — kode kursus di Task berasal dari pencocokan heuristik dan sering
 *  beda bentuk dari shortname Moodle, memasukkannya membuat kunci tidak
 *  pernah cocok. Judul tugas Moodle sudah cukup spesifik (mis. "IHA1 submit"). */
export function taskMatchKey(task: {
  title: string
  course?: string
  dueAt?: string
}): string {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
  const due = task.dueAt ? task.dueAt.slice(0, 10) : ''
  return `${norm(task.title)}|${due}`
}

/**
 * Terapkan status ke Task: submitted/graded → completed otomatis SEKALI
 * (note ditandai `[Moodle] ✔`). Setelah tercatat, completed pengguna
 * selalu menang — un-complete manual tidak dibatalkan sinkron berikutnya.
 */
export function applySubmissionStatus(
  tasks: Task[],
  statusByKey: Map<string, SubmissionStatus>,
): { tasks: Task[]; archived: number } {
  let archived = 0
  const next = tasks.map((task) => {
    if (!task.id.startsWith('moodle:')) return task
    const st = statusByKey.get(taskMatchKey(task))
    if (!st) return task
    const badge =
      st.state === 'graded'
        ? `✔ ${st.grade ?? ''}`.trim()
        : st.state === 'submitted'
          ? '✔'
          : null
    if (!badge) return task
    const tag = `[Moodle] ${badge}`
    const already = task.note?.includes('[Moodle]') ?? false
    if (already) return task // pernah diarsip: keadaan sekarang final
    if (!task.completed) {
      archived++
      return {
        ...task,
        completed: true,
        note: [task.note, tag].filter(Boolean).join('\n'),
        updatedAt: new Date().toISOString(),
      }
    }
    // Sudah completed manual tapi belum ber-tag: tandai saja (tanpa mengubah apa pun yang lain).
    return {
      ...task,
      note: [task.note, tag].filter(Boolean).join('\n'),
      updatedAt: new Date().toISOString(),
    }
  })
  return { tasks: next, archived }
}

/**
 * Ambil status untuk seluruh kursus → Map<taskMatchKey, SubmissionStatus>.
 * Aman dipanggil tanpa token (null → map kosong).
 */
export async function fetchSubmissionStatus(
  src: { token: string; userid?: number } | null,
): Promise<Map<string, SubmissionStatus>> {
  if (!src?.token) return new Map()
  const userid = src.userid ?? (await validateGradesToken(src.token))
  // Pra-fetch daftar enrol resmi (cache 24 jam) — memperkuat pencocokan
  // kursus di merge sisi task list via matchCourseCode.
  await fetchEnrolledCourses({ ...src, userid }).catch(() => null)
  const assigns = await wsCall<{ courses?: RawCourse[] }>(src.token, 'mod_assign_get_assignments')
  const meta = parseAssignments(assigns)
  if (meta.length === 0) return new Map()

  const ids = meta.map((a) => a.id)
  const [subsRes, gradesRes] = await Promise.all([
    wsCall<unknown>(src.token, 'mod_assign_get_submissions', { assignmentids: JSON.stringify(ids) }),
    wsCall<unknown>(src.token, 'mod_assign_get_grades', { assignmentids: JSON.stringify(ids) }),
  ])

  const perAssignment = combineStatus(
    parseSubmissions(subsRes, userid),
    parseGrades(gradesRes, userid),
  )

  const byId = new Map(meta.map((a) => [a.id, a]))
  const status = new Map<string, SubmissionStatus>()
  for (const [id, st] of perAssignment) {
    const a = byId.get(id)
    if (!a) continue
    status.set(taskMatchKey({ title: a.name, course: a.course, dueAt: a.dueAt }), st)
  }
  return status
}

/** Sumber token saat ini (null bila belum terhubung). */
export function currentSubmissionSource(): { token: string; userid?: number } | null {
  return loadGradesSource()
}
