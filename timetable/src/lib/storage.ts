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
  courseIdentity: 'tt_course_identity_v1',
  eventCmidCache: 'tt_event_cmid_v1',
  moodleSource: 'tt_moodle_source_v1',
  gradesSource: 'tt_grades_source_v1',
  gradesSort: 'tt_grades_sort',
  /** 成绩冷启动快照：重启/断网时先展示上次数据，刷新成功后覆盖 */
  gradesCache: 'tt_grades_cache_v1',
  filterPresets: 'tt_filter_presets',
  translatorUrl: 'tt_translator_url',
  translatorSessions: 'tt_translator_sessions_v1',
  todayTasksOpen: 'tt_today_tasks_open',
  todayIndoorOpen: 'tt_today_indoor_open',
  todayRoomsOpen: 'tt_today_rooms_open',
  todayExamsOpen: 'tt_today_exams_open',
  todayAnnouncementsOpen: 'tt_today_announcements_open',
  todayTab: 'tt_today_tab',
  moodleSection: 'tt_moodle_section',
  moodleNewsOpen: 'tt_moodle_news_open',
  lang: 'tt_lang',
  theme: 'tt_theme',
  themePreset: 'tt_theme_preset',
  autosync: 'tt_autosync',
  notif: 'tt_notif',
  /** 每日摘要通知（早上推送当天课程） */
  digest: 'tt_daily_digest',
  /** 成绩目标模式：想在课程总分里达到的百分比 */
  gradeTarget: 'tt_grade_target_v1',
  /** 作业页：按影响分（课程剩余权重 × 紧迫度）排序 */
  assignImpact: 'tt_assign_impact',
  /** 本地错误环形缓冲（最近 N 条，导出诊断用） */
  errorLog: 'tt_error_log_v1',
  /** 订阅式提醒（课程变动 / 教室空出） */
  subscriptions: 'tt_subscriptions_v1',
  onboardingDone: 'tt_onboarding_done',
  uiPrefs: 'tt_ui_prefs_v1',
  sidebarManualOpen: 'tt_sidebar_manual_open',
  sidebarLinksOpen: 'tt_sidebar_links_open',
  /** 同步变更审计：最近几次同步的差异明细（新增/时间变动/换教室/取消） */
  syncAudit: 'tt_sync_audit_v1',
  /** 移动端「更多」抽屉的分区折叠状态（与侧栏各记各的） */
  sheetSourcesOpen: 'tt_sheet_sources_open',
  sheetManualOpen: 'tt_sheet_manual_open',
  sheetSearchOpen: 'tt_sheet_search_open',
  sheetLinksOpen: 'tt_sheet_links_open',
  ntfRead: 'tt_ntf_read_v1',
  ntfCache: 'tt_ntf_cache_v1',
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
