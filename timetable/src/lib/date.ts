import type { Lesson } from '../types'

/** Senin sebagai awal minggu */
export function startOfWeek(d: Date): Date {
  const date = new Date(d)
  const day = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - day)
  date.setHours(0, 0, 0, 0)
  return date
}

export function addDays(d: Date, n: number): Date {
  const date = new Date(d)
  date.setDate(date.getDate() + n)
  return date
}

export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Cari pelajaran berikutnya untuk kode kursus (pembanding awalan, tidak
 * peka huruf besar/kecil): sesi yang belum selesai paling awal, else sesi
 * terakhir yang sudah lewat. Dipakai satu pemilik lompatan-to-jadwal di App.
 */
export function findCourseTarget(lessons: Lesson[], code: string): Lesson | undefined {
  const prefix = code.toUpperCase()
  const matches = lessons.filter((l) => l.code && l.code.toUpperCase().startsWith(prefix))
  return (
    matches
      .slice()
      .sort((a, b) => a.start.localeCompare(b.start))
      .find((l) => new Date(l.end).getTime() >= Date.now()) ??
    matches.slice().sort((a, b) => b.start.localeCompare(a.start))[0]
  )
}

export function lessonsInRange(lessons: Lesson[], from: Date, to: Date): Lesson[] {
  const fromMs = from.getTime()
  const toMs = to.getTime()
  return lessons.filter((l) => {
    const t = new Date(l.start).getTime()
    return t >= fromMs && t < toMs
  })
}

/** Find the next calendar day after `from` that has at least one lesson. */
export function nextLessonDay(lessons: Lesson[], from: Date): Date | null {
  const dayStart = new Date(from)
  dayStart.setHours(0, 0, 0, 0)
  const nextDayStart = addDays(dayStart, 1)
  const next = lessons
    .map((lesson) => new Date(lesson.start))
    .filter((date) => date.getTime() >= nextDayStart.getTime())
    .sort((a, b) => a.getTime() - b.getTime())[0]
  if (!next) return null
  next.setHours(0, 0, 0, 0)
  return next
}

export function formatTime(iso: string, locale?: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(locale ?? undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

/** 长日期 "9月21日星期一" / "Monday, September 21"（今日页标题、明日预览标题共用）。 */
export function formatLongDay(d: Date, locale?: string): string {
  return d.toLocaleDateString(locale ?? undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function formatDay(d: Date, locale?: string): string {
  return d.toLocaleDateString(locale ?? undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

/** 截止时刻紧凑格式：同任务卡的 formatDue（短星期 + 日 + 时:分），共用一处。 */
export function formatDateTime(iso: string, locale?: string): string {
  return new Date(iso).toLocaleString(locale ?? undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}


/** ISO-8601 week number (1-53). */
export function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const firstThursday = date.getTime()
  date.setUTCMonth(0, 1)
  if (date.getUTCDay() !== 4) {
    date.setUTCMonth(0, 1 + ((4 - date.getUTCDay()) + 7) % 7)
  }
  return 1 + Math.ceil((firstThursday - date.getTime()) / (7 * 24 * 3600 * 1000))
}

/** Readable week range with year, e.g. "2026年9月1日周一 – 9月7日周日" / "Mon, Sep 1, 2026 – Sun, Sep 7". */
export function formatWeekRange(start: Date, locale?: string): string {
  const end = addDays(start, 6)
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString(locale ?? undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    })
  return `${fmt(start, true)} – ${fmt(end, false)}`
}
