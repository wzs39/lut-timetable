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

export function lessonsInRange(lessons: Lesson[], from: Date, to: Date): Lesson[] {
  const fromMs = from.getTime()
  const toMs = to.getTime()
  return lessons.filter((l) => {
    const t = new Date(l.start).getTime()
    return t >= fromMs && t < toMs
  })
}

export function formatTime(iso: string, locale?: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(locale ?? undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export function formatDay(d: Date, locale?: string): string {
  return d.toLocaleDateString(locale ?? undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
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
