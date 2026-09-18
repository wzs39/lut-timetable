import { wsCall, validateGradesSource } from './grades'
import { readJson, writeJson, TRANSIENT_KEYS } from './storage'

/**
 * Konten kursus (core_course_get_contents) + status penyelesaian aktivitas
 * (core_completion_get_activities_completion_status) — pembacaan saja.
 *
 * Struktur: sections[] → modules[] (modname, url, visible, completion).
 * Completion state Moodle: 0 belum, 1 selesai, 2 lulus, 3 gagal.
 * Cache per kursus 6 jam (konten jarang berubah dalam sehari).
 */

export interface CourseModule {
  id: number
  name: string
  /** assign | quiz | forum | resource | url | folder | page | book | ... */
  modname: string
  url?: string
  description?: string
  visible: boolean
  /** 0 belum / 1 selesai / 2 lulus / 3 gagal / undefined tanpa pelacakan */
  completion?: number
}

export interface CourseSection {
  id: number
  name: string
  /** Bagian tersembunyi (mis. belum dirilis dosen) tidak ditampilkan. */
  visible: boolean
  modules: CourseModule[]
}

interface RawModule {
  id?: number
  name?: string
  modname?: string
  url?: string
  description?: string | Array<{ name?: string; value?: string }>
  visible?: number | boolean
  completion?: number
}

interface RawSection {
  id?: number
  name?: string
  visible?: number | boolean
  modules?: RawModule[]
}

/** Description Moodle bisa string ATAU array field html — ratakan jadi teks. */
export function flattenDescription(d: RawModule['description']): string | undefined {
  if (!d) return undefined
  if (typeof d === 'string') return d.replace(/<[^>]+>/g, '').trim() || undefined
  const text = d
    .map((f) => (typeof f?.value === 'string' ? f.value : ''))
    .join(' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || undefined
}

/** core_course_get_contents → CourseSection[] (bagian tersembunyi dibuang). */
export function parseCourseContents(response: unknown): CourseSection[] {
  if (!Array.isArray(response)) return []
  const out: CourseSection[] = []
  for (const s of response as RawSection[]) {
    if (s.id == null || !s.name) continue
    const visible = s.visible === undefined ? true : Boolean(s.visible)
    if (!visible) continue
    const modules: CourseModule[] = []
    for (const m of s.modules ?? []) {
      if (m.id == null || !m.name || !m.modname) continue
      const mv = m.visible === undefined ? true : Boolean(m.visible)
      if (!mv) continue
      modules.push({
        id: m.id,
        name: m.name.trim(),
        modname: m.modname,
        url: m.url,
        description: flattenDescription(m.description),
        visible: mv,
        completion: typeof m.completion === 'number' ? m.completion : undefined,
      })
    }
    out.push({ id: s.id, name: s.name, visible, modules })
  }
  return out
}

interface RawCompletionStatus {
  cmid?: number
  state?: number
}

/**
 * completion status → Map<cmid, state>. State 0 tetap dimasukkan agar modul
 * tanpa tanda bisa dibedakan dari "belum dinilai pelacakan".
 */
export function parseCompletionStatus(response: unknown): Map<number, number> {
  const list = (response as { statuslist?: RawCompletionStatus[] })?.statuslist
  const map = new Map<number, number>()
  if (!Array.isArray(list)) return map
  for (const s of list) {
    if (s.cmid == null || typeof s.state !== 'number') continue
    map.set(s.cmid, s.state)
  }
  return map
}

/** Gabungkan completion ke pohon konten (salinan baru, bukan mutasi respons). */
export function mergeCompletion(
  sections: CourseSection[],
  completion: Map<number, number>,
): CourseSection[] {
  return sections.map((s) => ({
    ...s,
    modules: s.modules.map((m) => ({
      ...m,
      completion: completion.get(m.id) ?? m.completion,
    })),
  }))
}

/* ----------------------------- cache + fetch ----------------------------- */

interface CacheShape {
  fetchedAt: number
  sections: CourseSection[]
}

const CACHE_TTL = 6 * 3600 * 1000

function cacheKey(courseId: number): string {
  return TRANSIENT_KEYS.icsCachePrefix + `contents_${courseId}`
}

export function loadCachedContents(courseId: number): CourseSection[] | null {
  try {
    const raw = readJson<CacheShape | null>(cacheKey(courseId), null)
    if (raw && Array.isArray(raw.sections) && Date.now() - raw.fetchedAt <= CACHE_TTL) {
      return raw.sections
    }
  } catch {
    /* non-fatal */
  }
  return null
}

function saveCachedContents(courseId: number, sections: CourseSection[]): void {
  try {
    writeJson(cacheKey(courseId), { fetchedAt: Date.now(), sections } satisfies CacheShape)
  } catch {
    /* kuota penuh: abaikan */
  }
}

export function clearContentsCache(courseId: number): void {
  try {
    localStorage.removeItem(cacheKey(courseId))
  } catch {
    /* non-fatal */
  }
}

/**
 * Ambil konten kursus + completion, cache 6 jam. Token null → cache / null.
 * Completion gagal tidak fatal: konten tetap tampil tanpa tanda selesai.
 */
export async function fetchCourseContents(
  src: { token: string; userid?: number } | null,
  courseId: number,
  opts: { force?: boolean } = {},
): Promise<CourseSection[] | null> {
  if (!opts.force) {
    const cached = loadCachedContents(courseId)
    if (cached) return cached
  }
  if (!src?.token) return loadCachedContents(courseId)
  const { token, userid } = await validateGradesSource(src)
  const res = await wsCall<unknown>(token, 'core_course_get_contents', { courseid: courseId })
  let sections = parseCourseContents(res)
  try {
    const comp = await wsCall<unknown>(
      token,
      'core_completion_get_activities_completion_status',
      { courseid: courseId, userid },
    )
    sections = mergeCompletion(sections, parseCompletionStatus(comp))
  } catch {
    /* completion opsional */
  }
  saveCachedContents(courseId, sections)
  return sections
}
