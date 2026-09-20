import type { Task } from './tasks'
import { wsCall, validateGradesToken, loadGradesSource } from './grades'

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
  /**
   * Deadline tugas (dari duedate assignment). Ditampilkan di pohon konten
   * agar info sejajar dengan kartu tugas (sumber tunggal: meta fetch ini,
   * tanpa panggilan jaringan tambahan).
   */
  dueAt?: string
}

interface RawAssignment {
  id?: number
  name?: string
  courseid?: number
  duedate?: number
  allowsubmissionsfromdate?: number
  /** course module id — mod/assign/view.php 深链的规范参数。 */
  cmid?: number
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
  cmid?: number
}> {
  const courses = (response as { courses?: RawCourse[] })?.courses
  if (!Array.isArray(courses)) return []
  const out: Array<{ id: number; name: string; course: string; dueAt?: string; startAt?: string; cmid?: number }> = []
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
        cmid: typeof a.cmid === 'number' ? a.cmid : undefined,
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

/** task.url → 活动 cmid；非 mod 活动页（日历回退）返回 undefined。 */
export function taskCmidOf(task: Pick<Task, 'url'>): number | undefined {
  const n = Number(task.url?.match(/\/mod\/[a-z0-9_]+\/view\.php\?(?:.*&)?id=(\d+)/i)?.[1])
  return Number.isFinite(n) ? n : undefined
}

/**
 * 内容树勾选 → 任务列表同步：cmid 精确联接（task.url = mod/*.php?id=<cmid>）。
 * 完成 → 归档（补 [Moodle] ✔ 标签）；取消完成 → 恢复为未完成（同源标签清除，
 * 用户自己的笔记保留）。URL 缺失或非 mod 活动页的任务不匹配——无法确定 cmid。
 * 只动同步来源的任务（moodle: 前缀），手动任务永不触碰。
 */
export function applyCompletionToTasks(
  tasks: Task[],
  cmid: number,
  completed: boolean,
  grade?: string,
): { tasks: Task[]; changed: number } {
  const tag = `[Moodle] ✔ ${grade ?? ''}`.trim()
  let changed = 0
  const next = tasks.map((task) => {
    if (!/^moodle(-act)?:/.test(task.id)) return task // 手动任务永不触碰
    const taskCmid = taskCmidOf(task)
    if (taskCmid === undefined || taskCmid !== cmid) return task
    if (task.completed === completed) return task
    changed++
    if (completed) {
      const already = task.note?.includes('[Moodle]') ?? false
      return {
        ...task,
        completed: true,
        note: already ? task.note : [task.note, tag].filter(Boolean).join('\n'),
        updatedAt: new Date().toISOString(),
      }
    }
    // 恢复：清除同源标签行，保留用户手写内容；[Moodle] 标签若与用户内容
    // 混在同一行（applySubmissionStatus 只在行首拼接），整段含标签的行删去。
    const note = (task.note ?? '')
      .split('\n')
      .filter((line) => !line.startsWith('[Moodle]'))
      .join('\n')
    return {
      ...task,
      completed: false,
      note: note || undefined,
      updatedAt: new Date().toISOString(),
    }
  })
  return { tasks: next, changed }
}

/**
 * Terapkan status ke Task: submitted/graded → completed otomatis SEKALI
 * (note ditandai `[Moodle] ✔`). Setelah tercatat, completed pengguna
 * selalu menang — un-complete manual tidak dibatalkan sinkron berikutnya.
 */
export function applySubmissionStatus(
  tasks: Task[],
  statusByKey: Map<string, SubmissionStatus>,
  urlByKey?: Map<string, string>,
): { tasks: Task[]; archived: number } {
  let archived = 0
  const next = tasks.map((task) => {
    if (!task.id.startsWith('moodle:')) return task
    const key = taskMatchKey(task)
    const st = statusByKey.get(key)
    if (!st) return task
    // URL 回填：ICS 来源的任务只有 /calendar/view.php 回退（不是任务页）。
    // mod_assign 的 cmid 深链更直接——覆盖日历回退，但不动真实存在的 mod 页。
    const assignUrl = urlByKey?.get(key)
    if (assignUrl && (!task.url || task.url.includes('/calendar/view.php?event='))) {
      task = { ...task, url: assignUrl }
    }
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
 * Ambil status untuk seluruh kursus → status per taskMatchKey + URL tugas
 * (mod/assign/view.php) per kunci yang sama. Aman dipanggil tanpa token.
 */
export async function fetchSubmissionStatus(
  src: { token: string; userid?: number } | null,
): Promise<{ status: Map<string, SubmissionStatus>; urlByKey: Map<string, string>; statusByCmid: Map<number, SubmissionStatus> }> {
  if (!src?.token) return { status: new Map(), urlByKey: new Map(), statusByCmid: new Map() }
  const userid = src.userid ?? (await validateGradesToken(src.token))
  // Enrol-anchor kini dijawab moodleSync.primeEnrolAnchor dari pemanggil
  // backgroundRefresh — tidak lagi di sini (dulu duplikat 6 salinan).
  const assigns = await wsCall<{ courses?: RawCourse[] }>(src.token, 'mod_assign_get_assignments')
  const meta = parseAssignments(assigns)
  if (meta.length === 0) return { status: new Map(), urlByKey: new Map(), statusByCmid: new Map() }

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
  const urlByKey = new Map<string, string>()
  const statusByCmid = new Map<number, SubmissionStatus>()
  for (const [id, st] of perAssignment) {
    const a = byId.get(id)
    if (!a) continue
    const key = taskMatchKey({ title: a.name, course: a.course, dueAt: a.dueAt })
    // 截止时间随 status 一起下发：内容树按 cmid 联接后与任务卡信息对齐。
    const withDue: SubmissionStatus = a.dueAt ? { ...st, dueAt: a.dueAt } : st
    status.set(key, withDue)
    // cmid → 课程内任务页（mod/assign/view.php?id=<cmid>）是官方深链。
    // ICS/timeline 来源的任务没有这个 URL（ICS 无 URL 属性）——归档时回填。
    if (a.cmid) {
      urlByKey.set(key, `https://moodle.lut.fi/mod/assign/view.php?id=${a.cmid}`)
      // cmid 键控副本：内容树按模块 cmid 精确联接（标题匹配对跨语言/重名任务不可靠）。
      statusByCmid.set(a.cmid, withDue)
    }
  }
  return { status, urlByKey, statusByCmid }
}

/** Sumber token saat ini (null bila belum terhubung). */
export function currentSubmissionSource(): { token: string; userid?: number } | null {
  return loadGradesSource()
}
