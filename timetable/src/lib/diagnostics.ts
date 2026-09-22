import type { Lesson, SyncSource } from '../types'
import { loadLessons } from './store'
import { loadIdentityMeta } from './courseIdentity'
import { normalizeCourseCode } from './ics'

/**
 * Diagnostik data identitas untuk halaman Settings — read-only, tanpa tulis.
 *
 * Tiga metrik yang diminta:
 *   1. per-source lesson count (dari props sources + gabungan lessons)
 *   2. coverage tabel identitas: berapa baris berkode, dan berapa pelajaran
 *      berkode yang benar-benar resolve ke courseid Moodle (join via idForCode)
 *   3. last-sync per rantai (kalender / Moodle token / Moodle ICS) + updatedAt
 *      tabel identitas.
 *
 * Fungsi murni `buildIdentityDiagnostics` menerima semua input agar mudah
 * diuji; wrapper `loadIdentityDiagnostics` mengambil snapshot dari storage.
 */

export interface SourceDiag {
  id: string
  type: 'sisu' | 'timeedit' | 'moodle-ics' | 'manual'
  label: string
  /** Pelajaran sumber ini yang ada di daftar gabungan saat ini. */
  count: number
  lastSync: string | null
}

export interface IdentityDiagnostics {
  sources: SourceDiag[]
  /** Baris identitas dengan code !== null. */
  identityCoded: number
  identityTotal: number
  /** Pelajaran berkode yang resolve ke courseid (idForCode hit). */
  lessonResolved: number
  /** Pelajaran dengan code terisi (penyebut coverage pelajaran). */
  lessonCoded: number
  /** ISO timestamp tabel identitas terakhir ditulis (null bila kosong). */
  identityUpdatedAt: string | null
  moodleLastSync: string | null
  moodleIcsLastSync: string | null
}

/** Hitung diagnostik dari input mentah — murni, tanpa akses storage. */
export function buildIdentityDiagnostics(
  sources: SyncSource[],
  lessons: Lesson[],
  identities: Array<{ code: string | null }>,
  identityUpdatedAt: number | null,
  moodleLastSync: string | null,
  moodleIcsLastSync: string | null,
): IdentityDiagnostics {
  const manualCount = lessons.filter((l) => l.source === 'manual').length
  const perSource: SourceDiag[] = [
    ...sources.map((s) => ({
      id: s.id,
      type: s.type,
      label: s.label,
      // Jendela geser mengikuti daftar gabungan (semantik sama dengan
      // s.count di settings) — hitung ulang agar selalu fresh.
      count: lessons.filter((l) => l.syncId === s.id && l.source !== 'manual').length,
      lastSync: s.lastSync ?? null,
    })),
    ...(manualCount > 0
      ? [
          {
            id: 'manual',
            type: 'manual' as const,
            label: 'manual',
            count: manualCount,
            lastSync: null,
          },
        ]
      : []),
  ]

  // Coverage dua arah: baris tabel berkode, dan pelajaran berkode yang
  // benar-benar resolve ke courseid (itulah nilai fungsional tabel).
  // Pencocokan memakai SEMANTIK resolver asli (normalizeCourseCode: trim,
  // buang sufiks -dddd, uppercase) — diagnostik harus setuju dengan
  // idForCode yang dipakai widget/LessonDetail saat memberi mid.
  const codedSet = new Set<string>()
  for (const row of identities) {
    if (row.code) codedSet.add(normalizeCourseCode(row.code))
  }
  const codedLessons = lessons.filter((l) => l.source !== 'manual' && l.code)
  const lessonResolved = codedLessons.filter((l) =>
    codedSet.has(normalizeCourseCode(l.code as string)),
  ).length

  return {
    sources: perSource,
    identityCoded: identities.filter((r) => r.code).length,
    identityTotal: identities.length,
    lessonResolved,
    lessonCoded: codedLessons.length,
    identityUpdatedAt: identityUpdatedAt == null ? null : new Date(identityUpdatedAt).toISOString(),
    moodleLastSync,
    moodleIcsLastSync,
  }
}

/** Snapshot dari storage — dipakai komponen UI. */
export function loadIdentityDiagnostics(
  sources: SyncSource[],
  moodleLastSync: string | null,
  moodleIcsLastSync: string | null,
): IdentityDiagnostics {
  const lessons = loadLessons()
  const { courses, updatedAt } = loadIdentityMeta()
  return buildIdentityDiagnostics(sources, lessons, courses, updatedAt, moodleLastSync, moodleIcsLastSync)
}
