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
 * Estimasi "jika semua yang belum dinilai dapat x" (0–100).
 * Sudah dinilai memakai nilai aslinya; belum dinilai (termasuk yang tanpa
 * nilai tapi berbobot) memakai x.
 */
export function estimateWithAssumption(
  items: GradeItem[],
  assumption: number,
): number | null {
  const a = clamp(assumption)
  const eff = items.map((it) => {
    const w = it.weight
    if (w == null || w <= 0) return null
    const g = it.grade ?? a
    return { w, g }
  }).filter((x): x is { w: number; g: number } => x != null)
  const den = eff.reduce((s, x) => s + x.w, 0)
  if (den <= 0) return null
  return eff.reduce((s, x) => s + x.w * x.g, 0) / den
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

/** Proyeksi lengkap untuk kartu satu kursus. */
export function courseProjection(
  c: CourseGrades,
  overrides: Record<number, number> = {},
): {
  projected: number | null
  coveredWeight: number
  ungraded: number
  gradedWeight: number
} {
  const { value, coveredWeight } = weightedEstimate(c.items, overrides)
  return {
    projected: value,
    coveredWeight,
    ungraded: ungradedCount(c.items),
    gradedWeight: gradedWeight(c.items),
  }
}
