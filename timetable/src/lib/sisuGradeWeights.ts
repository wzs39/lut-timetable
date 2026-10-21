import type { GradeItem } from './grades'

/**
 * Teacher-published assessment weights from SISU.
 *
 * SISU stores the weighting as free text on the completion method
 * (`evaluationCriteria`), e.g. "Exam 50 %, project 30 %, weekly tasks 20 %".
 * This module turns that text into structured components and maps them onto the
 * Moodle grade items of the same course.
 *
 * Two rules keep it honest:
 *  1. Only text that parses to ~100 % is accepted (nested breakdowns such as
 *     "Group work 80 %, including … 35 %" are cut before the "including").
 *  2. Weights are applied only when *every* component finds at least one Moodle
 *     item. A partial match would silently redistribute someone else's weight,
 *     so it falls back to Moodle's own gradebook weights instead.
 */

export type SisuWeightKind = 'exam' | 'exercises' | 'project' | 'attendance'

export interface SisuWeightComponent {
  /** Label as written in SISU ("weekly tasks", "Final Exam"). */
  label: string
  /** Percentage after normalization to 100. */
  weight: number
  kind: SisuWeightKind
}

export interface SisuWeightParse {
  components: SisuWeightComponent[]
  /** Sum before normalization (95–105 expected). */
  total: number
  /** Percentages did not add up to exactly 100 and were rescaled. */
  normalized: boolean
}

export interface SisuWeightPlan {
  /** True only when weights cover 100 % and every component maps to items. */
  applied: boolean
  components: SisuWeightComponent[]
  /** Per-item weights, index-aligned with `items` (null = no SISU weight). */
  itemWeights: Array<number | null>
  /** Components that found no Moodle item (only when `applied` is false). */
  unmapped: string[]
  /** True when the teacher's percentages did not add up to 100. */
  normalized: boolean
}

const KIND_PATTERNS: Array<[SisuWeightKind, RegExp]> = [
  // Moodle names exam rows "Final Exam1/2/3", so the digit suffix must count.
  ['exam', /\b(exam|exams|examination|exam\d+|midterm|tentti|loppukoe)\b/i],
  ['attendance', /\b(attendance|participation|classroom performance|lectures|osallistuminen)\b/i],
  ['exercises', /\b(exercise|exercises|assignment|assignments|homework|home work|task|tasks|quiz|quizzes|harjoitus|harjoitukset|tehtävä)\b/i],
  ['project', /\b(project|projects|group work|workshop|portfolio|report|reports|essay|thesis|presentation|presentations|pitch|pitching|diary|peer review|modelling|modeling|hands-on|seminar|maturity)\b/i],
]

/** Words that mark a percentage as a threshold, not a weight. */
const THRESHOLD_RE = /\b(at least|minimum|at the minimum|maximum points|max(?:imum)? points|needs? to (?:receive|get)|pass(?:ing)? (?:requires|threshold)|linear between|of the maximum)\b/i
const RANGE_RE = /\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*%/

function kindOf(label: string): SisuWeightKind | null {
  for (const [kind, pattern] of KIND_PATTERNS) if (pattern.test(label)) return kind
  return null
}

function cleanLabel(raw: string): string {
  let label = raw
    .replace(/^\s*\d+\.\s*/, '')
    // Drop the grade-scale prefix the teacher writes in front of the weights
    // ("0 - 5. Exam", "Graded 0-5,", "Grading: 0 - 5:", "0-5 (report").
    .replace(/^.{0,24}?0\s*-\s*5\b\s*[.):;,(–-]*\s*/i, '')
    .replace(/^.{0,24}?\b(?:grade|grading|graded|evaluation)\b\s*[:,-]?\s*/i, '')
  // Keep the tail segment: "continuous evaluation.Compulsory weekly exercises"
  // and "… distribution: weekly exercises" both end on the real component.
  const tail = label.split(/[.:]\s*/).filter((part) => part.trim().length > 0).at(-1)
  if (tail) label = tail
  return label
    .replace(/^(?:(?:and|the|including|with|compulsory|mandatory)\s+)+/i, '')
    .replace(/[\s:;,.(–-]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parse one SISU evaluation-criteria string. Returns null when the text carries
 * no usable weighting (thresholds only, ranges, "Pass / fail", …).
 */
export function parseSisuWeights(raw: string | undefined | null): SisuWeightParse | null {
  if (!raw) return null
  const text = raw
    .replace(/\u00a0/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\|/g, ',')
    .replace(/(\d),(\d)/g, '$1.$2')

  const parse = (source: string): { components: SisuWeightComponent[]; total: number } | null => {
    const components: SisuWeightComponent[] = []
    let lastLabel = ''
    for (const clause of source.split(/[,;\n]/)) {
      if (!clause.includes('%')) {
        // "0-5, exam, 100 %" splits the label away from its number; remember it.
        const label = cleanLabel(clause)
        if (label.length >= 2 && label.length <= 30 && /[a-z]/i.test(label)) lastLabel = label
        continue
      }
      if (THRESHOLD_RE.test(clause) || RANGE_RE.test(clause)) continue
      const matches = [...clause.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)]
      let cursor = 0
      for (const match of matches) {
        const before = clause.slice(cursor, match.index)
        const label = cleanLabel(before)
        cursor = (match.index ?? 0) + match[0].length
        const value = Number(match[1])
        if (!label && !lastLabel) continue
        const chosen = label || lastLabel
        const kind = kindOf(chosen)
        if (!kind || !(value > 0 && value <= 100)) continue
        components.push({ label: chosen, weight: value, kind })
        lastLabel = chosen
      }
    }
    if (components.length === 0) return null
    const total = components.reduce((sum, component) => sum + component.weight, 0)
    return { components, total }
  }

  let parsed = parse(text)
  // "Group work 80 %, including Business plan 35 %, Portfolio 25 %" lists a
  // nested breakdown; the part before "including" is the real weighting.
  if (parsed && parsed.total > 105 && /including/i.test(text)) {
    const prefix = text.split(/including/i)[0]
    const head = parse(prefix)
    if (head && head.total >= 95 && head.total <= 105) parsed = head
  }
  if (!parsed) return null
  if (parsed.total < 90 || parsed.total > 110) return null

  const normalized = Math.abs(parsed.total - 100) > 0.5
  const factor = 100 / parsed.total
  // One bucket per Moodle-mappable kind: "midterm test 20 %" and "final exam
  // 40 %" both live on the exam items, and keeping them apart would make the
  // second one fight the first for the same rows.
  const merged = new Map<SisuWeightKind, { labels: string[]; weight: number }>()
  for (const component of parsed.components) {
    const entry = merged.get(component.kind) ?? { labels: [], weight: 0 }
    entry.labels.push(component.label)
    entry.weight += component.weight
    merged.set(component.kind, entry)
  }
  const components = [...merged.entries()].map(([kind, entry]) => ({
    kind,
    label: [...new Set(entry.labels)].join(' + '),
    weight: Math.round(entry.weight * factor * 10) / 10,
  }))
  const roundedTotal = Math.round(components.reduce((sum, component) => sum + component.weight, 0) * 10) / 10
  if (components.length > 0 && Math.abs(roundedTotal - 100) > 0.6) {
    // Rounding drift after merging (e.g. 33.4 + 33.3 + 33.3); nudge the largest
    // bucket so the applied weights always sum to 100.
    const largest = components.reduce((best, item) => (item.weight > best.weight ? item : best), components[0])
    largest.weight = Math.round((largest.weight + (100 - roundedTotal)) * 10) / 10
  }
  return { components, total: Math.round(parsed.total * 10) / 10, normalized }
}

function itemKind(name: string): SisuWeightKind | null {
  return kindOf(name)
}

/**
 * Map SISU components onto this course's Moodle items. Components claim items
 * in descending weight order; every component must claim at least one item or
 * the whole plan is rejected (`applied: false`).
 */
export function planSisuWeights(
  criteria: string | undefined | null,
  items: readonly GradeItem[],
): SisuWeightPlan {
  const parsed = parseSisuWeights(criteria)
  const empty: SisuWeightPlan = {
    applied: false,
    components: parsed?.components ?? [],
    itemWeights: items.map(() => null),
    unmapped: parsed?.components.map((component) => component.label) ?? [],
    normalized: parsed?.normalized ?? false,
  }
  if (!parsed) return empty

  const claimed = new Set<number>()
  const weights: Array<number | null> = items.map(() => null)
  const unmapped: string[] = []
  for (const component of [...parsed.components].sort((a, b) => b.weight - a.weight)) {
    const matches = items.flatMap((item, index) => {
      if (claimed.has(index)) return []
      return itemKind(item.name) === component.kind ? [index] : []
    })
    if (matches.length === 0) {
      unmapped.push(component.label)
      continue
    }
    const share = Math.round((component.weight / matches.length) * 10) / 10
    for (const [position, index] of matches.entries()) {
      claimed.add(index)
      // Last item absorbs the rounding remainder so the component adds up exactly.
      weights[index] = position === matches.length - 1
        ? Math.round((component.weight - share * (matches.length - 1)) * 10) / 10
        : share
    }
  }

  if (unmapped.length > 0) return { ...empty, unmapped }
  return {
    applied: true,
    components: parsed.components,
    itemWeights: weights,
    unmapped: [],
    normalized: parsed.normalized,
  }
}

/** Apply a plan to the items; items without a SISU weight keep Moodle's weight. */
export function applySisuWeights(items: readonly GradeItem[], plan: SisuWeightPlan): GradeItem[] {
  if (!plan.applied) return [...items]
  return items.map((item, index) => plan.itemWeights[index] == null
    ? item
    : { ...item, weight: plan.itemWeights[index] as number })
}
