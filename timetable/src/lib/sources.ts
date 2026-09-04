import type { Lesson } from '../types'

/** Ikon sumber: satu-satunya definisi (dipakai TodayView, BatchFilter, ConflictCheck) */
export const SOURCE_ICON: Record<Lesson['source'], string> = {
  sisu: '🔵',
  timeedit: '🟣',
  manual: '🟢',
}
