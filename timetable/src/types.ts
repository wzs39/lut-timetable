export type LessonSource = 'sisu' | 'timeedit' | 'manual'

/** 学时类型（从 ICS SUMMARY 关键词识别，英文/芬兰语） */
export type LessonType =
  | 'lecture'
  | 'exercise'
  | 'tutorial'
  | 'seminar'
  | 'lab'
  | 'exam'
  | 'workshop'
  | 'other'

export interface Lesson {
  id: string
  source: LessonSource
  /** Nama kursus / mata kuliah */
  title: string
  /** Kode kursus, misal BM20A9200 */
  code?: string
  /** Jenis sesi: kuliah/latihan/tutorial/seminar/lab/ujian... */
  type?: LessonType
  location?: string
  /** ISO datetime string */
  start: string
  /** ISO datetime string */
  end: string
  /** UID asli dari ICS (untuk dedup saat re-sync) */
  uid?: string
  /** ID sumber sync (untuk hapus/re-sync per sumber) */
  syncId?: string
  /** Sumber yang sudah digabung ke pelajaran ini (cross-source dedup) */
  mergedSources?: LessonSource[]
}

export interface SyncSource {
  id: string
  type: 'sisu' | 'timeedit'
  /** URL asli yang dimasukkan user */
  url: string
  /** URL ICS final yang difetch */
  icsUrl: string
  label: string
  lastSync?: string
  count: number
}
