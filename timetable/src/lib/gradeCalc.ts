import type { CourseGrades, GradeItem } from './grades'

/**
 * Kalkulator proyeksi nilai murni (tanpa React, tanpa I/O).
 *
 * Model: setiap item punya bobot w (0–100, dari Moodle) dan nilai g (0–100,
 * atau null bila belum dinilai). Proyeksi = Σ w·g / Σ w atas item yang ikut
 * dihitung. Item tanpa bobot dikecualikan dari pembagi (perilaku umum Moodle).
 *
 * Skenario what-if: pengguna mengganti nilai harapan sebuah item lewat
 * `overrides` (key = indeks item). Nilai override TIDAK mengubah data Moodle
 * — hanya proyeksi.
 */

/** Nilai efektif sebuah item: override what-if > nilai Moodle > null. */
export function effectiveGrade(
  item: GradeItem,
  override: number | undefined,
): number | null {
  if (override != null) return clamp(override)
  return item.grade
}

/** Rata-rata tertimbang (0–100) dari item + override; null bila tak bisa dihitung. */
export function weightedEstimate(
  items: GradeItem[],
  overrides: Record<number, number> = {},
): { value: number | null; coveredWeight: number } {
  let num = 0
  let den = 0
  for (let i = 0; i < items.length; i++) {
    const w = items[i].weight
    if (w == null || w <= 0) continue
    const g = effectiveGrade(items[i], overrides[i])
    if (g == null) continue
    num += w * g
    den += w
  }
  return { value: den > 0 ? num / den : null, coveredWeight: den }
}

/**
 * Kontribusi satu item ke total kursus (poin persen): w·g/100 — persis
 * kolom "Contribution to course total" Moodle. Null bila item tak berbobot
 * atau belum dinilai (tanpa override).
 */
export function contributionOf(
  item: GradeItem,
  override?: number,
): number | null {
  const w = item.weight
  const g = effectiveGrade(item, override)
  if (w == null || w <= 0 || g == null) return null
  return (w * g) / 100
}

/**
 * Total berjalan berbobot: Σ w·g atas SEMUA item — item belum dinilai
 * terhitung 0, bukan dikecualikan. Inilah cara Moodle menghitung total
 * kursus berjalan (mis. 3 pekan dinilai dari 14 → 3×7.14% = 21.4%),
 * berbeda dari `weightedEstimate` yang merenormalisasi atas bobot
 * tercover (menjawab "seberapa bagus pekerjaan yang sudah dinilai",
 * bukan "berapa poin yang sudah dikumpulkan").
 */
export function weightedRunningTotal(
  items: GradeItem[],
  overrides: Record<number, number> = {},
): number {
  let sum = 0
  for (let i = 0; i < items.length; i++) {
    const c = contributionOf(items[i], overrides[i])
    if (c != null) sum += c
  }
  return sum
}

/**
 * Ada berapa item yang belum dinilai DAN ikut dihitung (berbobot).
 * Item tanpa bobot tidak masuk proyeksi, jadi tidak dihitung.
 */
export function ungradedCount(items: GradeItem[]): number {
  return items.filter((it) => it.weight != null && it.weight > 0 && it.grade == null)
    .length
}

/** Bobot total item yang sudah dinilai (0–100). */
export function gradedWeight(items: GradeItem[]): number {
  return items.reduce(
    (s, it) => s + (it.weight != null && it.grade != null ? it.weight : 0),
    0,
  )
}

export function clamp(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(100, v))
}

/**
 * SATU rantai prioritas nilai akhir kursus — dipakai headline kartu nilai
 * DAN `average` hasil parse (dulu rantai ini di-hardcode dua tempat dan
 * bisa saling berbeda). Prioritas:
 *   1. total resmi Moodle (officialTotal) — diabaikan saat what-if override
 *      (angka resmi sudah basi terhadap nilai harapan)
 *   2. total berjalan berbobot Σ w·g, belum dinilai = 0 — kolom
 *      "Contribution to course total"; hanya bila ada item berbobot dan > 0
 *   3. rata-rata sederhana item yang sudah dinilai (kursus tanpa bobot)
 *   4. null — Moodle juga menampilkan "-"
 */
export function getFinalCourseGrade(
  items: GradeItem[],
  officialTotal?: number | null,
  overrides: Record<number, number> = {},
): number | null {
  const hasOverrides = Object.keys(overrides).length > 0
  if (!hasOverrides && officialTotal != null) return officialTotal
  if (items.some((it) => it.weight != null && it.weight > 0)) {
    const running = weightedRunningTotal(items, overrides)
    return running > 0 ? running : null
  }
  let num = 0
  let n = 0
  for (let i = 0; i < items.length; i++) {
    const g = effectiveGrade(items[i], overrides[i])
    if (g == null) continue
    num += g
    n++
  }
  return n > 0 ? num / n : null
}

/**
 * Proyeksi lengkap untuk kartu satu kursus.
 *
 * `current` = angka utama — SELURUH rantai prioritas ada di
 * `getFinalCourseGrade` (satu pemilik, tanpa duplikasi).
 * `coveredAvg` = rata-rata berbobot item tercover saja (kualitas pekerjaan
 * yang sudah dinilai) — ditampilkan sekunder.
 */
export function courseProjection(
  c: CourseGrades,
  overrides: Record<number, number> = {},
): {
  current: number | null
  coveredAvg: number | null
  coveredWeight: number
  ungraded: number
  gradedWeight: number
} {
  const { value: coveredAvg, coveredWeight } = weightedEstimate(c.items, overrides)
  return {
    current: getFinalCourseGrade(c.items, c.officialTotal, overrides),
    coveredAvg,
    coveredWeight,
    ungraded: ungradedCount(c.items),
    gradedWeight: gradedWeight(c.items),
  }
}

/**
 * 目标模式：「想拿 T 分，剩下没评分的部分平均要多少」。
 *
 * 与 what-if 互补——what-if 是「如果我这项考 X 分，最终是多少」，
 * 这里是反解：「要想到 T，剩下的平均得考多少」。
 *
 * 口径：
 * - `remainingWeight` = 既没有 Moodle 分数、也没有 what-if 覆盖的项的权重和
 *   （被覆盖的项已经按期望分计入 earned，不再是“未知”）；
 * - `earned` = Σ w·g/100（未评分计 0）——同 Moodle 的进行中总分；
 * - `requiredAvg` = (T − earned) / remainingWeight × 100，可能 <0（已达标）
 *   或 >100（不可能）。
 */
export interface GradeTargetPlan {
  target: number
  /** 目前已得点数（0–100） */
  earned: number
  /** 已定分（含 what-if 覆盖）的权重和 */
  settledWeight: number
  /** 尚未确定的权重和（占课程总分的百分比） */
  remainingWeight: number
  /** 剩余部分需要的平均分；null = 没有剩余项 */
  requiredAvg: number | null
  /** 剩余全满分能达到的上限（0–100），便于解释“不可能” */
  maxFinal: number
  status: 'done' | 'reached' | 'possible' | 'unreachable'
}

export function gradeTargetPlan(
  items: GradeItem[],
  overrides: Record<number, number>,
  target: number,
): GradeTargetPlan {
  let remainingWeight = 0
  let settledWeight = 0
  for (let i = 0; i < items.length; i++) {
    const w = items[i].weight
    if (w == null || w <= 0) continue
    const known = items[i].grade != null || overrides[i] != null
    if (known) settledWeight += w
    else remainingWeight += w
  }
  const earned = weightedRunningTotal(items, overrides)
  const requiredAvg = remainingWeight > 0 ? ((target - earned) / remainingWeight) * 100 : null
  const status: GradeTargetPlan['status'] =
    remainingWeight <= 0
      ? 'done'
      : (requiredAvg as number) <= 0
        ? 'reached'
        : (requiredAvg as number) > 100
          ? 'unreachable'
          : 'possible'
  return {
    target,
    earned,
    settledWeight,
    remainingWeight,
    requiredAvg,
    // 剩余项全满分（含 what-if 覆盖）时能拿到的总分上限
    maxFinal: Math.min(100, earned + remainingWeight),
    status,
  }
}

/* ------------------------- sorting & filtering ------------------------- */

/** Urutan daftar kursus di segmen nilai. */
export type GradeSort = 'code' | 'grade-asc' | 'grade-desc' | 'ungraded' | 'matched'

/** Banyak item belum dinilai (berbobot ATAU tanpa bobot) pada satu kursus. */
export function ungradedTotal(c: CourseGrades): number {
  return c.items.filter((it) => it.grade == null).length
}

/**
 * Urutkan daftar CourseGrades. Stabil: kunci sekunder selalu kode kursus,
 * sehingga urutan tidak lompat-lompat antar render.
 */
export function sortGrades(
  list: readonly CourseGrades[],
  sort: GradeSort,
): CourseGrades[] {
  const byCode = (a: CourseGrades, b: CourseGrades) =>
    a.course.localeCompare(b.course)
  const arr = [...list]
  switch (sort) {
    case 'grade-asc':
      // null (belum ada nilai) paling akhir
      arr.sort((a, b) => {
        const av = a.average
        const bv = b.average
        if (av == null && bv == null) return byCode(a, b)
        if (av == null) return 1
        if (bv == null) return -1
        return av - bv || byCode(a, b)
      })
      break
    case 'grade-desc':
      arr.sort((a, b) => {
        const av = a.average
        const bv = b.average
        if (av == null && bv == null) return byCode(a, b)
        if (av == null) return 1
        if (bv == null) return -1
        return bv - av || byCode(a, b)
      })
      break
    case 'ungraded':
      // paling banyak item belum dinilai dulu — fokus ke mana harus berusaha
      arr.sort((a, b) => ungradedTotal(b) - ungradedTotal(a) || byCode(a, b))
      break
    case 'matched':
      // yang cocok jadwal dulu (bisa lompat ke kalender), lalu kode
      arr.sort((a, b) => Number(b.matched) - Number(a.matched) || byCode(a, b))
      break
    default:
      arr.sort(byCode)
  }
  return arr
}

/** Filter daftar kursus (kata kunci nama/kode, ATAU status kecocokan). */
export function filterGrades(
  list: readonly CourseGrades[],
  opts: { q?: string; only?: 'matched' | 'unmatched' | null },
): CourseGrades[] {
  const kw = opts.q?.trim().toLowerCase()
  return list.filter((c) => {
    if (opts.only === 'matched' && !c.matched) return false
    if (opts.only === 'unmatched' && c.matched) return false
    if (kw) {
      const hay = `${c.course} ${c.courseTitle ?? ''}`.toLowerCase()
      if (!hay.includes(kw)) return false
    }
    return true
  })
}
