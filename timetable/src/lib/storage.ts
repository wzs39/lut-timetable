/**
 * Satu-satunya pemilik key `localStorage` aplikasi.
 *
 * Sebelumnya setiap modul mendeklarasikan `const LS_*` sendiri dan `backup.ts`
 * menyalin ulang daftar key secara manual — sehingga key baru mudah terlupa
 * (`tt_hidden`, `tt_filter_presets`, `tt_translator_*`, `tt_today_tasks_open`
 * memang tidak pernah ikut ter-backup). Sekarang semua key hidup di sini dan
 * export/import dibangun dari daftar yang sama, jadi tidak mungkin lagi
 * menyimpang.
 */

/** Key data pengguna — semuanya ikut export/import backup. */
export const KEYS = {
  lessons: 'tt_lessons_v1',
  sources: 'tt_sources_v1',
  tombstones: 'tt_tombstones',
  overrides: 'tt_overrides',
  hidden: 'tt_hidden',
  courseNotes: 'tt_course_notes',
  sisuCourseIds: 'tt_sisu_course_ids',
  conflictDismissed: 'tt_conflict_dismissed',
  tasks: 'tt_tasks_v1',
  moodleSource: 'tt_moodle_source_v1',
  filterPresets: 'tt_filter_presets',
  translatorUrl: 'tt_translator_url',
  translatorSessions: 'tt_translator_sessions_v1',
  todayTasksOpen: 'tt_today_tasks_open',
  todayIndoorOpen: 'tt_today_indoor_open',
  todayRoomsOpen: 'tt_today_rooms_open',
  todayExamsOpen: 'tt_today_exams_open',
  lang: 'tt_lang',
  theme: 'tt_theme',
  autosync: 'tt_autosync',
  notif: 'tt_notif',
} as const

export type StorageKey = (typeof KEYS)[keyof typeof KEYS]

/** Key sementara/derivatif yang TIDAK ikut backup (cache ICS kedaluwarsa 2 jam). */
export const TRANSIENT_KEYS = {
  icsCachePrefix: 'tt_ics_cache_v1:',
} as const

/** Daftar key backup — diturunkan dari KEYS agar tidak bisa menyimpang. */
export const BACKUP_KEYS: readonly StorageKey[] = Object.values(KEYS)

/* ----------------------------- akses mentah ----------------------------- */

export function readString(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // kuota penuh / private mode: kegagalan tidak boleh menghentikan alur
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* tidak fatal */
  }
}

/* --------------------------- helper JSON/string --------------------------- */

/** Baca + parse JSON; nilai rusak atau tidak ada → `fallback`. */
export function readJson<T>(key: string, fallback: T): T {
  const raw = readString(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown): void {
  writeString(key, JSON.stringify(value))
}
