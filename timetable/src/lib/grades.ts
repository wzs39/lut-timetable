import type { Lesson } from '../types'
import { KEYS, readJson, writeJson, removeKey } from './storage'
import { fetchMoodleWebService, moodleCredsFromUrl } from './fetchIcs'
import { matchCourseCode, extractCourseCode, extractCourseTitle } from './courses'
import { loadIdentityIndex } from './courseIdentity'
import { normalizeCourseCode } from './ics'
import { primeEnrolAnchor } from './moodleSync'
import { getFinalCourseGrade } from './gradeCalc'
import { activeSchemeWeights, applySchemeWeights, loadGradeSchemes } from './gradeScheme'
import { COURSE_FACTS } from './sisuCourseFacts'
import { applySisuWeights, planSisuWeights, type SisuWeightComponent } from './sisuGradeWeights'
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
 *  - gradereport_user_get_grade_items → per-kursus, SATU-SATUNYA sumber nilai
 *    yang bisa dibaca token mahasiswa LUT (mod_assign_get_submissions/
 *    get_grades = API dosen, "No access rights"; core_grades_get_grades
 *    tidak terdaftar di situs ini). gradeitems TIDAK membawa rata-rata
 *    kelas — kolom classAvg ada untuk situs yang mengirimnya.
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
  /**
   * 活动 cmid（仅 `itemtype === 'mod'` 的行）：活动日期联接键。
   * 与内容树、任务列表用同一把键——三处显示同一组开始/截止。
   */
  cmid?: number
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

/**
 * 分类祖先链：categoryid → 直接父分类（课程根 = null）。
 * 来源 gradereport_user_get_grades_table 的 parentcategories（根在前，
 * 直接父分类是最后一项）；user_get_grade_items 不带这个字段。
 */
export type GradeCategoryParents = ReadonlyMap<number, number | null>

/**
 * gradereport_user_get_grades_table → { categoryid: 直接父分类 | null }。
 *
 * 只读 itemname.content 里的 data-categoryid 与 parentcategories；Moodle 把
 * 分类名包在 <a> 里（data-categoryid 也在那个 <a> 上），但标记可能变，所以
 * 同时接受裸文本与 HTML。解析失败（无 tables / 无 tabledata / 行不像分类）
 * 一律跳过——层级只是权重合成的增强信息，脏表不能把成绩整段弄崩。
 */
export function parseGradeCategoryParents(response: unknown): GradeCategoryParents {
  const out = new Map<number, number | null>()
  const tables = (response as { tables?: unknown })?.tables
  if (!Array.isArray(tables)) return out
  for (const table of tables) {
    const rows = (table as { tabledata?: unknown })?.tabledata
    if (!Array.isArray(rows)) continue
    for (const raw of rows as Record<string, unknown>[]) {
      if (!raw || typeof raw !== 'object') continue
      const itemname = raw.itemname as { content?: unknown } | undefined
      const content = typeof itemname?.content === 'string' ? itemname.content : ''
      const idMatch = /data-categoryid=["']?(\d+)/.exec(content)
      if (!idMatch) continue
      const id = Number(idMatch[1])
      if (!Number.isFinite(id) || id <= 0) continue
      // parentcategories = 从课程根到直接父分类的完整链；直接父 = 末项。
      const chain = Array.isArray(raw.parentcategories)
        ? raw.parentcategories.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
        : []
      out.set(id, chain.length > 0 ? chain[chain.length - 1] : null)
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
  /**
   * SISU 教师权重接管了 Moodle 成绩册权重时的证据。
   * 只在「SISU 描述里的比例合计 ≈100% 且每个分项都找到对应 Moodle 项目」时出现。
   */
  weighting?: {
    source: 'sisu'
    components: SisuWeightComponent[]
    /** 教师给的比例合计不是 100%，已按比例缩放。 */
    normalized: boolean
  }
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

/**
 * SISU 教师权重接管一门课的权重（纯函数，不落盘）。
 *
 * 返回同一个对象（未接管）或新对象（已接管）；`average` 按同一份
 * `getFinalCourseGrade` 重算，官方总评仍然优先——SISU 权重改变的是
 * 每个项目的权重/贡献/预估，不篡改 Moodle 的官方成绩。
 * 用户确认过的方案在外面判断，这里不碰。
 */
export function courseWithSisuWeights(c: CourseGrades, criteria: string | undefined | null): CourseGrades {
  if (!criteria) return c
  const plan = planSisuWeights(criteria, c.items)
  if (!plan.applied) return c
  const items = applySisuWeights(c.items, plan)
  return {
    ...c,
    items,
    weighting: { source: 'sisu', components: plan.components, normalized: plan.normalized },
    average: getFinalCourseGrade(items, c.officialTotal),
  }
}

/**
 * 给一批课程补上 SISU 教师权重。
 *
 * 快照是「上次抓到的成绩」，权重是课程的当前属性——旧快照（或离线启动）
 * 也应该显示教师权重，否则同一个项目会因网络状态而显示不同权重。
 * 用户确认过的方案仍然优先（那是用户的显式决定）。
 */
export function withSisuWeights(courses: CourseGrades[]): CourseGrades[] {
  return courses.map((course) => {
    if (activeSchemeWeights(course.courseId)) return course
    const criteria = COURSE_FACTS[normalizeCourseCode(course.course)]?.assessmentCriteria
    return courseWithSisuWeights(course, criteria?.en ?? criteria?.fi)
  })
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

function buildItems(raw: (RawGradeItem & { itemtype?: string })[]): GradeItem[] {
  return raw.map((it) => ({
    name: htmlToText(it.itemname) || '—',
    // cmid hanya bermakna untuk baris modul（category/course 行没这个东西）。
    cmid:
      it.itemtype === 'mod' && typeof it.cmid === 'number' && Number.isFinite(it.cmid)
        ? it.cmid
        : undefined,
    grade: toPercent(it.graderaw, it.grademax),
    max: typeof it.grademax === 'number' && it.grademax > 0 ? it.grademax : null,
    classAvg: toPercent(it.gradeaverage ?? it.average, it.grademax),
    // Bobot: weightraw (rasio 0–1, Moodle 4.x) > weight (persen); kategori
    // ditangani terpisah di spreadCategoryWeights (lihat observasi di atas).
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

/**
 * 【2026-09-26 真实载荷观察（11 门 LUT 课程全量 dump，146 行 gradeitems）】
 * 权重有三种形态：
 *  ① 扁平课：weightraw 挂在叶子项上（0–1，如 BM20A9200 每周作业 0.07143）；
 *  ② 分类课：weightraw 挂在 itemtype 'category' 行（如 KE00DA03 的两个
 *     25% 分类、CT60A4050 的 exam 0.25/exercise 0.1），叶子项 weightraw
 *     字段整个缺失——把 category 行当垃圾行丢掉而不做继承 = 这些课的
 *     权重全部丢失，what-if 与未评提示退化成简单平均；
 *  ③ 显式零权重：weightraw:0 的行（如 K200DJ96 两门不计分作业）与无权重
 *     的 'course' 总分行都不是可评项，但零权重是「老师的有效决定」，保留展示。
 * 做法：有 parentcategories（gradereport_user_get_grades_table）时用
 * composeHierarchicalWeights 按整棵树逐层归一，合计正好 100%；拿不到
 * 层级时退回 spreadCategoryWeights（只看直属成员）。两者都丢掉 category
 * 行——GradeItem 形状不变，下游计算零改动。
 * 【2026-10-21】旧均摊法在嵌套分类上会重复计权（真实 CT60A4050 合计
 * 843.6%）；层级法按 root→leaf 的相对权归一修掉。
 */
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
  /** iteminstance baris kategori = id kategori yang dirujuk categoryid item. */
  iteminstance?: number
  gradeformatted?: string
  feedback?: string
  /** ID kategori induk (baris item) — untuk mewarisi bobot kategori. */
  categoryid?: number
  /** Course-module id (baris item bertipe 'mod') — kunci tanggal aktivitas. */
  cmid?: number
}

interface RawCourseGrades {
  courseid?: number
  usergrade?: { grade?: number | string; rawgrade?: number | string }
  gradeitems?: RawGradeItem[]
}

/** gradereport_user_get_grade_items → CourseGrades[] (hanya kursus bernilai). */
export function parseGradeItems(
  response: unknown,
  confirmedSchemes: Record<number, import('./gradeScheme').SchemeWeight[]> = {},
  categoryParentsByCourse?: ReadonlyMap<number, GradeCategoryParents>,
): CourseGrades[] {
  const byId = (response as { usergrades?: unknown[] })?.usergrades
  if (!Array.isArray(byId)) return []
  const out: CourseGrades[] = []
  for (const c of byId as (RawCourseGrades & { gradeitems?: (RawGradeItem & { itemtype?: string })[] })[]) {
    const rawItems = c.gradeitems ?? []
    const courseRow = rawItems.find((it) => it.itemtype === 'course')
    // 'course' 总分行与 'category' 行都不进 items；category 的权重先经
    // spreadCategoryWeights 均摊给成员项（见上方真实载荷观察）。
    const nonCat = rawItems.filter((it) => it.itemtype !== 'course' && it.itemtype !== 'category')
    const parsedItems = buildItems(nonCat)
    // 平行数组传 categoryid，GradeItem 本身不加字段（形状零改动）。
    const catIds = nonCat.map((it) =>
      typeof it.categoryid === 'number' && it.categoryid > 0 ? it.categoryid : null,
    )
    // parentcategories 可用时按整棵分类树合成 100% 总权重；拿不到表（旧
    // 快照、API 失败）就退回旧的「分类权重均摊到直属成员」。
    const parents = categoryParentsByCourse?.get(c.courseid ?? -1)
    if (parents && parents.size > 0) {
      composeHierarchicalWeights(rawItems, nonCat, parsedItems, catIds, parents)
    } else {
      spreadCategoryWeights(rawItems, parsedItems, catIds)
    }
    const scheme = confirmedSchemes[c.courseid ?? -1] ?? activeSchemeWeights(c.courseid)
    const items = applySchemeWeights(parsedItems, scheme)
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

/**
 * Ratakan bobot kategori ke item anggota yang tidak berbobot sendiri.
 *
 * 【Aturan dari payload nyata LUT】kategori berbobot (mis. 25%) MERATA-
 * RATAKAN item anggotanya → bobot efektif tiap anggota = w_kategori / n
 * anggota. Karena itu: item DENGAN weightraw sendiri tidak disentuh (dosen
 * yang menentukan); item tanpa bobot yang jadi anggota kategori berbobot
 * mendapat share kategori; anggota kategori TANPA bobot (mis. "Assignments"
 * di KE00DA03) tidak diberi bobot fiktif — sumber tak berbobot tetap null.
 * Kunci penghubung: categoryid item (categoryIds, paralel dengan items)
 * ↔ iteminstance baris kategori (raw). Murni kecuali mutasi weight di items.
 */
function spreadCategoryWeights(
  raw: RawGradeItem[],
  items: GradeItem[],
  categoryIds: Array<number | null>,
): void {
  const catWeightByInstanceId = new Map<number, number>()
  for (const r of raw) {
    if (r.itemtype === 'category' && r.iteminstance != null) {
      const w =
        typeof r.weightraw === 'number' && r.weightraw > 0
          ? Math.round(r.weightraw * 1000) / 10
          : typeof r.weight === 'number' && r.weight > 0
            ? Math.round(r.weight * 10) / 10
            : null
      if (w != null) catWeightByInstanceId.set(r.iteminstance, w)
    }
  }
  if (catWeightByInstanceId.size === 0) return
  const memberCountByCid = new Map<number, number>()
  for (let i = 0; i < items.length; i++) {
    const cid = categoryIds[i]
    if (cid == null || items[i].weight != null) continue
    if (!catWeightByInstanceId.has(cid)) continue
    memberCountByCid.set(cid, (memberCountByCid.get(cid) ?? 0) + 1)
  }
  for (let i = 0; i < items.length; i++) {
    const cid = categoryIds[i]
    if (cid == null || items[i].weight != null) continue
    const w = catWeightByInstanceId.get(cid)
    const n = memberCountByCid.get(cid) ?? 0
    if (w == null || n <= 0) continue
    items[i].weight = Math.round((w / n) * 100) / 100
  }
}

type GradeWeightParticipant =
  | { kind: 'item'; index: number; weight: number | null }
  | { kind: 'category'; id: number; weight: number | null }

/**
 * 同级相对权：weightraw 原样（0.1 = 10%）；旧 weight 是百分数 → ÷100。
 * 缺字段 = 无权重（null，不参与）；显式 0 也排除。不要在这里取整——
 * 取整会累积到「权重合计 99.4%」，百分比只在最终写回时取 2 位。
 */
function weightRatioOf(row: RawGradeItem): number | null {
  if (typeof row.weightraw === 'number' && Number.isFinite(row.weightraw)) return row.weightraw
  if (typeof row.weight === 'number' && Number.isFinite(row.weight)) return row.weight / 100
  return null
}

/**
 * 用 parentcategories 链按层合成成绩权重（Moodle weighted mean）。
 *
 * 旧 spreadCategoryWeights 只看「分类 → 直属成员」，两个真实场景会算错：
 *  ① 加权分类里还有子分类（KE00DA03 的 exam/exercise 与实际活动之间隔层），
 *     旧法把父分类权重摊给直属子分类成员，兄弟子分类被忽略；
 *  ② 子分类与成员同层时，旧法不按兄弟权重归一（1.5 份 → 成员合计超 100）。
 * 本函数在根节点调用 assign(pool, 100)：
 *  - 无 weightraw 的分类是透明分组，直接下钻（CT60A4050 的 "total"）；
 *  - 分类/成员显式权重按兄弟权重归一（Moodle 的 Weighted mean of grades）；
 *  - 同一池里有显式权重时，未设置权重的成员不参与（"-" = 无权重）；
 *  - 全组都无显式权重 → 平均分（分数权重以 100% 出现时，如
 *    CT60A4050 的 10 次 Exercise Attendance 平分 10%）。
 * 只在能拿到层级时调用；纯函数（仅写 items[i].weight），GradeItem 形状不变。
 */
function composeHierarchicalWeights(
  raw: RawGradeItem[],
  itemRows: RawGradeItem[],
  items: GradeItem[],
  categoryIds: Array<number | null>,
  parents: GradeCategoryParents,
): void {
  const categoryWeight = new Map<number, number | null>()
  for (const row of raw) {
    if (row.itemtype !== 'category' || typeof row.iteminstance !== 'number') continue
    categoryWeight.set(row.iteminstance, weightRatioOf(row))
  }
  // 分类行 + 祖先都要有节点：课程根 / 中间分组层通常没有成绩行。
  const parentOf = new Map<number, number | null>()
  const ensureNode = (id: number): void => {
    if (parentOf.has(id)) return
    parentOf.set(id, parents.get(id) ?? null)
  }
  for (const id of categoryWeight.keys()) ensureNode(id)
  for (const [id, parent] of parents) {
    ensureNode(id)
    if (parent != null) ensureNode(parent)
  }
  // 内容行引用的分类即使没有分类行也当顶层节点（不能让成员凭空消失）。
  for (const cid of categoryIds) if (cid != null) ensureNode(cid)

  const childrenOf = new Map<number | null, number[]>()
  for (const id of parentOf.keys()) {
    const parent = parentOf.get(id) ?? null
    const list = childrenOf.get(parent)
    if (list) list.push(id)
    else childrenOf.set(parent, [id])
  }
  const membersOf = new Map<number | null, number[]>()
  categoryIds.forEach((cid, index) => {
    const key = cid != null && parentOf.has(cid) ? cid : null
    const list = membersOf.get(key)
    if (list) list.push(index)
    else membersOf.set(key, [index])
  })

  const composed = new Array<number | null>(items.length).fill(null)
  const hasMembers = new Map<number, boolean>()
  function filled(id: number, path: Set<number>): boolean {
    const cached = hasMembers.get(id)
    if (cached != null) return cached
    if (path.has(id)) return false
    path.add(id)
    const result =
      (membersOf.get(id)?.length ?? 0) > 0 ||
      (childrenOf.get(id) ?? []).some((child) => filled(child, path))
    path.delete(id)
    hasMembers.set(id, result)
    return result
  }

  function collect(node: number | null, pool: GradeWeightParticipant[], path: Set<number>): void {
    for (const child of childrenOf.get(node) ?? []) {
      if (!filled(child, new Set())) continue
      if (path.has(child)) continue
      const weight = categoryWeight.get(child) ?? null
      if (weight === 0) continue // 显式 0 = 老师排除，不参与
      if (weight == null) {
        path.add(child)
        collect(child, pool, path)
        path.delete(child)
      } else {
        pool.push({ kind: 'category', id: child, weight })
      }
    }
    for (const index of membersOf.get(node) ?? []) {
      const weight = weightRatioOf(itemRows[index])
      if (weight === 0) continue
      pool.push({ kind: 'item', index, weight })
    }
  }

  function distribute(participant: GradeWeightParticipant, weight: number): void {
    if (participant.kind === 'item') {
      composed[participant.index] = weight
      return
    }
    const pool: GradeWeightParticipant[] = []
    collect(participant.id, pool, new Set([participant.id]))
    assign(pool, weight, true)
  }

  function assign(pool: GradeWeightParticipant[], total: number, allowEqualShare: boolean): void {
    if (pool.length === 0) return
    const weighted = pool.filter((p) => p.weight != null)
    if (weighted.length === 0) {
      if (!allowEqualShare) return
      const share = total / pool.length
      for (const p of pool) distribute(p, share)
      return
    }
    // 有显式权重的池里，未设置权重的项不参与（Moodle 的 "-" = 无权重；
    // 真实 CT60A4050 根分类的 7 个 pass/fail 项就是这种情况）。
    const sum = weighted.reduce((acc, p) => acc + (p.weight ?? 0), 0)
    if (sum <= 0) return
    for (const p of weighted) distribute(p, total * ((p.weight ?? 0) / sum))
  }

  const rootPool: GradeWeightParticipant[] = []
  collect(null, rootPool, new Set())
  const rootHasWeights = rootPool.some((p) => p.weight != null)
  // 根层只在「有显式权重」时归一；全无权重 → 保持 null，不造假 100/n。
  assign(rootPool, 100, false)

  const rounded = composed.map((w) => (w == null ? null : Math.round(w * 100) / 100))
  if (rootHasWeights) {
    // 逐项取整会留下 ±0.0x 尾差（真实 CT60A4050 = 100.01）；记到最大
    // 权重上，UI 的「权重共 {w}%」才正好是 100，且不假装多一位精度。
    const total = rounded.reduce<number>((s, w) => s + (w ?? 0), 0)
    let largest = -1
    for (let i = 0; i < rounded.length; i++) {
      if (rounded[i] == null) continue
      if (largest < 0 || rounded[i]! > rounded[largest]!) largest = i
    }
    if (largest >= 0) rounded[largest] = Math.round((rounded[largest]! + (100 - total)) * 100) / 100
  }

  for (let i = 0; i < items.length; i++) {
    if (rounded[i] != null) items[i].weight = rounded[i]
  }
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
  // 层级只为「分类行带权重」的课程补齐：LUT 的 CT60A4050 / KE00DA03 这类
  // 课，user_get_grade_items 只给直属 categoryid，父分类链只有
  // gradereport_user_get_grades_table 的 parentcategories 才有。扁平课
  // （权重挂在叶子项）不需要，别为全校每门课多打一趟。
  const categoryParentsByCourse = new Map<number, GradeCategoryParents>()
  await Promise.all(
    courseIds.map(async (courseid, index) => {
      const raw = reports[index] as
        | { usergrades?: Array<{ gradeitems?: Record<string, unknown>[] }> }
        | null
      const needsHierarchy = (raw?.usergrades ?? []).some((u) =>
        (u?.gradeitems ?? []).some(
          (item) =>
            item?.itemtype === 'category' &&
            (Number(item.weightraw) > 0 || Number(item.weight) > 0),
        ),
      )
      if (!needsHierarchy) return
      try {
        categoryParentsByCourse.set(
          courseid,
          parseGradeCategoryParents(
            await wsCall(src.token, 'gradereport_user_get_grades_table', { userid, courseid }),
          ),
        )
      } catch {
        // 表格 API 不可用（站点关闭 / 权限）→ 该课退回旧均摊，成绩照常。
      }
    }),
  )
  const report = { usergrades: reports.flatMap((r) => (r as { usergrades?: unknown[] })?.usergrades ?? []) }
  const confirmedSchemes = Object.fromEntries(
    Object.entries(loadGradeSchemes()).flatMap(([id, record]) =>
      record.confirmedWeights ? [[Number(id), record.confirmedWeights]] : [],
    ),
  )
  const parsed = parseGradeItems(report, confirmedSchemes, categoryParentsByCourse)
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
  // 权重来源优先级：用户确认过的方案 > SISU 教师权重（描述里的比例）> Moodle 成绩册。
  // 只在 parseSisuWeights 得到 ≈100% 且每个分项都对到项目时接管，否则保留
  // Moodle 权重（半套映射会把别的分项权重悄悄挪走）。
  for (let i = 0; i < parsed.length; i++) {
    if (activeSchemeWeights(parsed[i].courseId)) continue
    const criteria = COURSE_FACTS[normalizeCourseCode(parsed[i].course)]?.assessmentCriteria
    parsed[i] = courseWithSisuWeights(parsed[i], criteria?.en ?? criteria?.fi)
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

/* --------------------------- cold-start snapshot ---------------------------
 * 【2026-09-26】成绩此前只活在内存里：重启/断网时成绩段只剩空提示，要等
 * 网络刷新成功才有内容（11 门课 × 每课 1 请求，30 分钟后台节拍也救不了
 * 刚打开的那几秒）。快照 = 每次 fetchGrades 成功后写入的 CourseGrades[]
 * + 时间戳；启动时立即读出展示，网络回来再覆盖。断网时 refreshGrades 失败
 * 不清快照 —— 数据与上次一致，仅静默。
 */

export interface GradesSnapshot {
  fetchedAt: string
  courses: CourseGrades[]
}

export function loadGradesSnapshot(): GradesSnapshot | null {
  const raw = readJson<GradesSnapshot | null>(KEYS.gradesCache, null)
  if (!raw || typeof raw.fetchedAt !== 'string') return null
  if (!Array.isArray(raw.courses) || raw.courses.length === 0) return null
  return raw
}

export function saveGradesSnapshot(courses: CourseGrades[]): void {
  try {
    writeJson(KEYS.gradesCache, { fetchedAt: new Date().toISOString(), courses } satisfies GradesSnapshot)
  } catch {
    /* kuota penuh: 快照是优化，不是必需 */
  }
}

export function clearGradesSnapshot(): void {
  removeKey(KEYS.gradesCache)
}
