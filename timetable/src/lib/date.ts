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
