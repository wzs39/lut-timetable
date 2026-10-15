/** Pure parsing and persistence for course-description grading schemes. */
import { KEYS, readJson, writeJson } from './storage'
import type { GradeItem } from './grades'

export interface SchemeWeight {
  label: string
  weight: number
}

export interface SchemeThreshold {
  kind: 'attendance' | 'pass'
  percent: number
}

export interface ParsedScheme {
  weights: SchemeWeight[]
  thresholds: SchemeThreshold[]
  total: number
}

export interface GradeSchemeRecord extends ParsedScheme {
  courseId: number
  courseCode: string
  /** Proposed parser/manual values; never used by grade calculations. */
  confirmedWeights?: SchemeWeight[]
  confirmedAt?: string
  updatedAt: string
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ', '&amp;': '&', '&ndash;': '–', '&mdash;': '—',
  '&#8211;': '–', '&#8212;': '—', '&lt;': '<', '&gt;': '>',
}

/** Convert description HTML to text while preserving block and sentence boundaries. */
export function htmlToPlainText(html: string): string {
  let text = html.replace(/<\/?(?:p|div|li|h[1-6]|section|br|ul|ol|table|tr)[^>]*>/gi, '\n')
  text = text.replace(/<[^>]+>/g, ' ')
  for (const [entity, value] of Object.entries(ENTITIES)) {
    text = text.replace(new RegExp(entity, 'gi'), value)
  }
  return text.replace(/[ \t\r]+/g, ' ').replace(/\n\s*/g, '\n').trim()
}

const DASH_WEIGHT_RE = /([^–:%=\n]{2,90}?)\s*(?:–|\s-\s)\s*(\d{1,3}(?:\.\d+)?)\s*%(?!\s*-?\s*\d)/g
const OF_GRADE_RE = /\b((?:home\s+)?assignment(?:\s+[a-z0-9-]+){0,2}|quiz(?:\s+[a-z0-9-]+){0,2}|exam|project|exercise|attendance|learning\s+diary)\s*\(\s*(\d{1,3}(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?grade\s*\)/gi
const SUB_ITEM_RE = /([A-Za-z][A-Za-z ]{1,40}?)\s*\(\s*(\d{1,3})\s*\)/g
const cleanLabel = (s: string) =>
  s.replace(/\s+/g, ' ').replace(/^[\s:;,.()–-]+|[\s:;,.–-]+$/g, '').trim()

function addUniqueThreshold(
  out: SchemeThreshold[], seen: Set<string>, kind: SchemeThreshold['kind'], percent: number,
): void {
  if (!(percent > 0 && percent <= 100)) return
  const key = `${kind}:${percent}`
  if (seen.has(key)) return
  seen.add(key)
  out.push({ kind, percent })
}

/** Course-specific adjustments stay separate from generic text parsing. */
const COURSE_SCHEME_POLICIES: Record<string, { excludeLabels: readonly string[] }> = {
  CT60A4050: { excludeLabels: ['final exam'] },
}

function applyCourseSchemePolicy(scheme: ParsedScheme, courseCode?: string): ParsedScheme {
  const policy = courseCode ? COURSE_SCHEME_POLICIES[courseCode.trim().toUpperCase()] : undefined
  if (!policy) return scheme
  const excluded = new Set(policy.excludeLabels.map((label) => label.toLowerCase()))
  const weights = scheme.weights.filter((item) => !excluded.has(item.label.toLowerCase()))
  return { ...scheme, weights, total: weights.reduce((sum, item) => sum + item.weight, 0) }
}

export function parseGradeScheme(texts: string[], courseCode?: string): ParsedScheme {
  const weights: SchemeWeight[] = []
  const thresholds: SchemeThreshold[] = []
  const seenWeights = new Set<string>()
  const seenThresholds = new Set<string>()
  const normalizedTexts = texts.map(htmlToPlainText)

  const addWeight = (rawLabel: string, value: number) => {
    const label = cleanLabel(rawLabel)
    const key = label.toLowerCase()
    if (!label || seenWeights.has(key) || !(value > 0 && value <= 100)) return
    seenWeights.add(key)
    weights.push({ label, weight: value })
  }

  for (const text of normalizedTexts) {
    for (const sentence of text.split(/[.!?;\n]+/)) {
      if (/\b(?:attendance|lectures|meetings)\b/i.test(sentence) &&
          /\b(?:requires?|required|mandatory|minimum|must)\b/i.test(sentence)) {
        const match = sentence.match(/\b(\d{1,3}(?:\.\d+)?)\s*%(?!\s*-\s*\d)/)
        if (match) addUniqueThreshold(thresholds, seenThresholds, 'attendance', Number(match[1]))
      }
      const pass = sentence.match(/\bpass(?:ing)?(?:\s+(?:grade|mark|threshold))?\s*(?:is|of|:)?\s*(\d{1,3}(?:\.\d+)?)\s*%(?!\s*-\s*\d)/i)
      if (pass) addUniqueThreshold(thresholds, seenThresholds, 'pass', Number(pass[1]))
    }

    for (const match of text.matchAll(OF_GRADE_RE)) addWeight(match[1], Number(match[2]))

    for (const match of text.matchAll(DASH_WEIGHT_RE)) {
      const prefix = match[1]
      const rawLabel = prefix.split(/[:;.!?]/).at(-1)?.trim() ?? prefix
      const percent = Number(match[2])
      const children = [...rawLabel.matchAll(SUB_ITEM_RE)]
      if (children.length > 0) {
        for (const child of children) addWeight(child[1], Number(child[2]))
        continue
      }
      addWeight(rawLabel, percent)
    }
  }

  const parsed = { weights, thresholds, total: weights.reduce((sum, item) => sum + item.weight, 0) }
  return applyCourseSchemePolicy(parsed, courseCode)
}

function isSchemeRecord(value: unknown): value is GradeSchemeRecord {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<GradeSchemeRecord>
  const proposedWeights = item.weights
  return Number.isSafeInteger(item.courseId) && item.courseId! > 0 &&
    typeof item.courseCode === 'string' && Array.isArray(proposedWeights) &&
    proposedWeights.every((w) => typeof w.label === 'string' && Number.isFinite(w.weight)) &&
    Array.isArray(item.thresholds) &&
    (item.confirmedWeights === undefined || (Array.isArray(item.confirmedWeights) && item.confirmedWeights.every((w) => typeof w.label === 'string' && Number.isFinite(w.weight)))) &&
    typeof item.updatedAt === 'string'
}

let cachedSchemes: Record<number, GradeSchemeRecord> | null = null

export function clearGradeSchemeMemoryCacheForTest(): void {
  cachedSchemes = null
}

export function loadGradeSchemes(): Record<number, GradeSchemeRecord> {
  if (cachedSchemes) return cachedSchemes
  const raw = readJson<Record<string, unknown>>(KEYS.gradeSchemes, {})
  const records: Record<number, GradeSchemeRecord> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (isSchemeRecord(value) && String(value.courseId) === id) records[value.courseId] = value
  }
  cachedSchemes = records
  return records
}

export function saveGradeScheme(record: GradeSchemeRecord): void {
  const schemes = { ...loadGradeSchemes() }
  schemes[record.courseId] = { ...record, updatedAt: new Date().toISOString() }
  cachedSchemes = schemes
  writeJson(KEYS.gradeSchemes, schemes)
}

/** Save a proposal, but never activate it until the user confirms. */
export function saveGradeSchemePreview(
  courseId: number,
  courseCode: string,
  parsed: ParsedScheme,
): void {
  const current = loadGradeSchemes()[courseId]
  saveGradeScheme({ ...parsed, courseId, courseCode, confirmedWeights: current?.confirmedWeights, confirmedAt: current?.confirmedAt, updatedAt: new Date().toISOString() })
}

export function confirmGradeScheme(courseId: number): GradeSchemeRecord | null {
  const record = loadGradeSchemes()[courseId]
  if (!record) return null
  const confirmed = { ...record, confirmedWeights: record.weights, confirmedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  saveGradeScheme(confirmed)
  return confirmed
}

export function updateGradeSchemeOverride(
  courseId: number,
  courseCode: string,
  weights: SchemeWeight[],
  confirmed: boolean,
): GradeSchemeRecord {
  const total = weights.reduce((sum, item) => sum + item.weight, 0)
  const previous = loadGradeSchemes()[courseId]
  const record: GradeSchemeRecord = {
    ...(previous ?? { courseId, courseCode, thresholds: [], total: 0, weights: [] }),
    courseId, courseCode, weights, total,
    confirmedWeights: confirmed ? weights : previous?.confirmedWeights,
    confirmedAt: confirmed ? new Date().toISOString() : previous?.confirmedAt,
    updatedAt: new Date().toISOString(),
  }
  saveGradeScheme(record)
  return record
}

/** Only explicitly confirmed records may affect grade calculations. */
export function activeSchemeWeights(courseId: number | undefined): SchemeWeight[] | null {
  if (courseId == null) return null
  const record = loadGradeSchemes()[courseId]
  return record?.confirmedWeights ?? null
}

const MATCH_STOP_WORDS = new Set(['weekly', 'individual', 'course', 'the', 'and', 'of', 'reports', 'presentation'])
function matchTokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g)?.map((token) => token.endsWith('s') && token.length > 3 ? token.slice(0, -1) : token).filter((token) => !MATCH_STOP_WORDS.has(token)) ?? []
}

/** Apply one course's confirmed scheme to its own grade items only. */
export function applySchemeWeights(items: GradeItem[], schemeWeights: SchemeWeight[] | null): GradeItem[] {
  if (!schemeWeights || schemeWeights.length === 0) return items
  const assignments = new Map<number, number>()
  for (const entry of schemeWeights) {
    const tokens = matchTokens(entry.label)
    if (tokens.length === 0) continue
    const matches = items.flatMap((item, index) => {
      const itemTokens = matchTokens(item.name)
      const hit = tokens.every((token) => itemTokens.includes(token))
      return hit ? [index] : []
    })
    if (matches.length === 0) continue // unmatched keeps Moodle's existing weight
    const share = entry.weight / matches.length
    for (const index of matches) assignments.set(index, share)
  }
  if (assignments.size === 0) return items
  return items.map((item, index) => assignments.has(index)
    ? { ...item, weight: assignments.get(index)! }
    : item)
}
