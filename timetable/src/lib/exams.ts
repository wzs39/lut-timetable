import type { Lesson } from '../types'

export interface ExamInfo {
  lesson: Lesson
  /** Days until the exam starts (ceil; exam today = 0) */
  inDays: number
  /** True once the exam has started and not yet ended */
  live: boolean
}

/** Milliseconds per day */
const DAY_MS = 24 * 3600 * 1000

/**
 * Exams that have not fully ended, sorted by start date.
 * Includes exams happening today (live or still ahead today).
 */
export function upcomingExams(lessons: Lesson[], now: Date): ExamInfo[] {
  const t = now.getTime()
  return lessons
    .filter((l) => l.type === 'exam' && new Date(l.end).getTime() > t)
    .map((l) => {
      const start = new Date(l.start).getTime()
      const live = start <= t && t < new Date(l.end).getTime()
      // Days until start, measured from local midnight so "today" = 0
      const midnight = new Date(t)
      midnight.setHours(0, 0, 0, 0)
      const startMidnight = new Date(start)
      startMidnight.setHours(0, 0, 0, 0)
      const inDays = Math.max(
        0,
        Math.round((startMidnight.getTime() - midnight.getTime()) / DAY_MS),
      )
      return { lesson: l, inDays, live }
    })
    .sort((a, b) => a.lesson.start.localeCompare(b.lesson.start))
}
