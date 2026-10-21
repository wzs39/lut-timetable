#!/usr/bin/env node
/**
 * Fetch public SISU course facts used by the study-plan scenario engine.
 * Run manually when SISU publishes new teaching periods:
 *
 *   node scripts/fetch-sisu-facts.mjs
 *
 * The output is committed; the app never performs 80 per-course requests.
 */
import { writeFileSync } from 'node:fs'

const PLAN_CODES = `CT60A5550 BM20A9200 CT60A4050 BM20A9301 CT10A9900 CT60A0250 CT60A2700 HDD4100 HDD4110 HDD4130 KE00BX35 KE00DA03 K200DJ96 K200DJ99 CT60A2450 CT30A2850 BM20A8801 CT60A9602 CT30A3401 CT60A4500 CT60A4700 CT30A3350 CT60A5540 CT30A2910 CT60A4800 CT60A5511 CT60A5522 CT60A4350 CT60A7660 CT60A9800 HDD5010 HDD5020 HDD5030 HDD5040 CT10A5000 LUTKYPSAT HDD5000 BH60A6200 BH60A6802 BH60A7201 MOOC0002A MOOC0002B MOOC0002C MOOC0002D MOOC0001A MOOC0001B MOOC0001C MOOC0001D MOOC0003A MOOC0003B MOOC0003C MOOC0003D BH60A7400 BH60A7410 BH60A7500 MOOC0005A MOOC0006B MOOC0006D MOOC0006A MOOC0004A HDD4020 HDD4030 MOOC0006C HDD4010 HDD4040 MOOC0006E MOOC0005B`.split(/\s+/)

// Linux / cloud / DevOps: found via course_unit_search(fullTextQuery: "linux"|"devops"|"cloud").
// Kept in the snapshot so the optional-study engine can price them without a request.
const OPTIONAL_CODES = `CT30A1500 CT30A8912 CT60A5103 CT30A3204 CT80A0301 CT70A9300 CT10A7052 CT30A1400 CT30A3370 CT30A1600 BM20A6100 BM40A0702 BM40A1900 BM20A7102 HDD7010 HDD7020 HDD7030 HDD7040 HDD4120 CT10A0013 CT60A0203 CT60A2412 CT60A4002 CT60A4304 BM20A6600 CT60A5500 CT60A4160 CT60A5532 CT70A9700 CT30A3232 CT10A0030 CT70A9150`.split(/\s+/)

const CODES = [...new Set([...PLAN_CODES, ...OPTIONAL_CODES])]

const MONTH = (date) => Number(date.slice(5, 7))
const DAY = (date) => Number(date.slice(8, 10))
const YEAR = (date) => Number(date.slice(0, 4))

function periodsFromDates(start, end) {
  if (!start || !end) return []
  const startYear = YEAR(start)
  const endYear = YEAR(end)
  const out = new Set()
  // Overlap the teaching window with LUT's period boundaries. String comparison
  // is safe because all dates are ISO YYYY-MM-DD.
  for (let year = startYear - 1; year <= endYear; year++) {
    const windows = [
      [1, `${year}-08-20`, `${year}-10-25`],
      [2, `${year}-10-26`, `${year}-12-20`],
      [3, `${year + 1}-01-05`, `${year + 1}-03-07`],
      [4, `${year + 1}-03-08`, `${year + 1}-05-31`],
      [5, `${year + 1}-06-01`, `${year + 1}-08-19`],
    ]
    for (const [period, periodStart, periodEnd] of windows) {
      if (start <= periodEnd && end >= periodStart) out.add(period)
    }
  }
  return [...out].sort((a, b) => a - b)
}

async function gql(query) {
  const response = await fetch('https://sisu.lut.fi/api/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const json = await response.json()
  if (!response.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? response.status))
  return json.data
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function searchIds() {
  const ids = {}
  for (let index = 0; index < CODES.length; index += 15) {
    const chunk = CODES.slice(index, index + 15)
    const fields = chunk.map((code, offset) =>
      `c${offset}: course_unit_search(codeQuery:${JSON.stringify(code)}, universityOrgIds:["lut-university-root-id"], validity:"ONGOING_AND_FUTURE", resultLimit:1){id code}`,
    ).join('\n')
    const data = await gql(`{ ${fields} }`)
    chunk.forEach((code, offset) => {
      const row = data[`c${offset}`]?.[0]
      // Never attach an unrelated first hit: the public search can return fuzzy matches.
      if (row?.id && String(row.code ?? '').toUpperCase().replace(/-\d{4}$/, '') === code) ids[code] = row.id
    })
    await sleep(150)
  }
  return ids
}

function parseHours(description, credits) {
  const match = description.match(/Total(?:\s+amount(?:\s+of\s+work)?|\s+workload)?\s*(\d+)\s*h/i)
  const sisuHours = match ? Number(match[1]) : null
  if (sisuHours !== null) {
    // 1 ECTS = 27 h. A stated workload below ~20 h/credit means at least a quarter
    // of the work is missing from the free-text breakdown (real case: a 12 cr
    // course whose description totals 162 h). Trusting it halves that course's
    // weekly load and makes the overload alert under-report. Estimate from credits
    // instead and flag the row so the UI can show "verify this course".
    const anomaly = credits > 0 && (sisuHours / credits < 20 || sisuHours / credits > 40)
    return { totalHours: anomaly ? Math.round(credits * 27) : sisuHours, hoursSource: anomaly ? 'ects-estimate' : 'sisu', workloadAnomaly: anomaly }
  }
  return { totalHours: credits > 0 ? Math.round(credits * 27) : 0, hoursSource: 'ects-estimate', workloadAnomaly: false }
}

function assessmentMethods(methods, description) {
  const names = [...new Set(methods.flatMap((method) => (method.assessmentItems ?? []).map((item) => item.name?.en)).filter(Boolean))]
  if (names.length > 0) return names
  const found = []
  if (/exam/i.test(description)) found.push('Exam')
  if (/project/i.test(description)) found.push('Project')
  if (/assignment/i.test(description)) found.push('Assignments')
  return found.length > 0 ? found : ['Course completion']
}

// Courses that are in the personal plan but not in the public catalogue.
// Credits come from the plan; zero would silently flag a false mismatch.
const FALLBACK_CREDITS = { K200DJ96: 3, K200DJ99: 3, HDD5000: 0, LUTKYPSAT: 0 }

async function fetchFact(code, id) {
  if (!id) {
    const credits = FALLBACK_CREDITS[code] ?? 0
    return {
      code, sisuId: undefined, credits, gradeScale: 'unknown',
      totalHours: credits > 0 ? Math.round(credits * 27) : 0, hoursSource: 'ects-estimate',
      assessmentMethods: [], formalPrerequisites: [], offerings: [], offeringPattern: [], examSittings: [],
      offeringConfidence: 'unknown', selfPaced: code.startsWith('MOOC'),
    }
  }
  const query = `{
    course_unit(id:${JSON.stringify(id)}){
      code name{en} credits{min max}
      gradeScale{ abbreviation{en} }
      compulsoryFormalPrerequisites{ prerequisites{ courseUnits(universityOrgId:"lut-university-root-id"){ code } } }
      completionMethods{ studyType description{en} evaluationCriteria{en fi} assessmentItems{ name{en} } }
      courseUnitRealisations{ id name{en} activityPeriod{startDate endDate} }
    }
  }`
  const data = await gql(query)
  const unit = data.course_unit
  const credits = unit.credits?.min ?? 0
  const methods = unit.completionMethods ?? []
  const degree = methods.find((method) => method.studyType === 'DEGREE_STUDIES') ?? methods[0] ?? {}
  const description = degree.description?.en ?? ''
  const criteria = degree.evaluationCriteria ?? {}
  const hours = parseHours(description, credits)
  const prerequisites = [...new Set((unit.compulsoryFormalPrerequisites ?? [])
    .flatMap((group) => group.prerequisites ?? [])
    .flatMap((prerequisite) => (prerequisite.courseUnits ?? []).map((course) => course.code)))]
  // Exam sittings are realisations too, but they are deliberately kept out of
  // `offerings`: folding them in would stretch a course's teaching window and
  // inflate its teaching periods. They are stored separately so callers can
  // still warn about an exam cluster — a course whose exam is 2 weeks after
  // teaching ends is not "free" in that gap.
  const examSittings = (unit.courseUnitRealisations ?? [])
    .filter((realisation) => /exam|tentti|kuulustelu/i.test(realisation.name?.en ?? ''))
    .map((realisation) => ({
      name: realisation.name?.en ?? '',
      startDate: realisation.activityPeriod?.startDate ?? '',
      endDate: realisation.activityPeriod?.endDate ?? '',
    }))
    .filter((sitting) => sitting.startDate && sitting.endDate)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  const teaching = (unit.courseUnitRealisations ?? []).filter((realisation) => !/exam/i.test(realisation.name?.en ?? ''))
  const offerings = teaching
    .map((realisation) => ({
      id: realisation.id,
      name: realisation.name?.en ?? '',
      startDate: realisation.activityPeriod?.startDate ?? '',
      endDate: realisation.activityPeriod?.endDate ?? '',
      periods: periodsFromDates(realisation.activityPeriod?.startDate, realisation.activityPeriod?.endDate),
    }))
    .filter((offering) => offering.startDate && offering.endDate)
  const offeringPattern = [...new Set(offerings.flatMap((offering) => offering.periods))].sort((a, b) => a - b)
  const years = offerings.map((offering) => YEAR(offering.startDate)).filter(Boolean)
  const offeringConfidence = years.some((year) => year >= 2026) ? 'sisu-2026-27' : years.length > 0 ? 'stale' : 'unknown'
  return {
    code,
    name: unit.name?.en || undefined,
    sisuId: id,
    credits,
    creditRange: unit.credits ? { min: unit.credits.min, max: unit.credits.max } : undefined,
    gradeScale: /pass/i.test(unit.gradeScale?.abbreviation?.en ?? '') ? 'pass-fail' : unit.gradeScale?.abbreviation?.en === '0-5' ? '0-5' : 'unknown',
    totalHours: hours.totalHours,
    hoursSource: hours.hoursSource,
    workloadAnomaly: hours.workloadAnomaly,
    workloadNote: description || undefined,
    // Teacher-published weighting lives in evaluationCriteria ("Exam 50 %, project 30 %").
    assessmentCriteria: criteria.en || criteria.fi ? { en: criteria.en || undefined, fi: criteria.fi || undefined } : undefined,
    assessmentMethods: assessmentMethods(methods, description),
    formalPrerequisites: prerequisites,
    offerings,
    offeringPattern,
    offeringConfidence,
    examSittings,
    selfPaced: code.startsWith('MOOC'),
  }
}

const ids = await searchIds()
const facts = {}
for (const code of CODES) {
  try {
    facts[code] = await fetchFact(code, ids[code])
  } catch (error) {
    console.error(`failed ${code}:`, error.message)
    facts[code] = await fetchFact(code, undefined)
  }
  await sleep(100)
}

const header = `/**
 * Generated by scripts/fetch-sisu-facts.mjs — do not edit by hand.
 *
 * Public SISU facts (2026–27 teaching periods, workload, formal prerequisites,
 * grade scales). The snapshot is committed so the app performs no per-course
 * requests; refresh it when SISU publishes a new academic year.
 */
export type GradeScale = '0-5' | 'pass-fail' | 'unknown'
export type OfferingConfidence = 'sisu-2026-27' | 'stale' | 'unknown'

export interface CourseOffering {
  id: string
  name: string
  startDate: string
  endDate: string
  periods: number[]
}

/** A separate exam sitting. Kept out of the teaching offerings on purpose — see the fetch script. */
export interface ExamSitting {
  name: string
  startDate: string
  endDate: string
}

export interface CourseFact {
  code: string
  /** Public SISU name (English); absent for catalogue-less plan courses. */
  name?: string
  sisuId?: string
  credits: number
  creditRange?: { min: number; max: number }
  gradeScale: GradeScale
  totalHours: number
  hoursSource: 'sisu' | 'ects-estimate'
  workloadAnomaly?: boolean
  workloadNote?: string
  /** Teacher-published assessment weighting (SISU evaluation criteria, free text). */
  assessmentCriteria?: { en?: string; fi?: string }
  assessmentMethods: string[]
  formalPrerequisites: string[]
  offerings: CourseOffering[]
  offeringPattern: number[]
  offeringConfidence: OfferingConfidence
  examSittings: ExamSitting[]
  selfPaced?: boolean
}

export const SISU_FACTS_GENERATED_AT = ${JSON.stringify(new Date().toISOString())}

export const COURSE_FACTS: Record<string, CourseFact> = `

writeFileSync(new URL('../src/lib/sisuCourseFacts.ts', import.meta.url), `${header}${JSON.stringify(facts, null, 2)}\n`)
console.log(`wrote ${Object.keys(facts).length} facts`)
