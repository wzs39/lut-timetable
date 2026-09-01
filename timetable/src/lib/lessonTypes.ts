import type { LessonType } from '../types'

/** Ikon + kunci i18n + label singkat per jenis sesi */
export const TYPE_META: Record<
  LessonType,
  { icon: string; key: string; short: string }
> = {
  lecture: { icon: '📖', key: 'typeLecture', short: 'Lec' },
  exercise: { icon: '✏️', key: 'typeExercise', short: 'Ex' },
  tutorial: { icon: '🧭', key: 'typeTutorial', short: 'Tut' },
  seminar: { icon: '🗣️', key: 'typeSeminar', short: 'Sem' },
  lab: { icon: '🧪', key: 'typeLab', short: 'Lab' },
  exam: { icon: '📝', key: 'typeExam', short: 'Exam' },
  workshop: { icon: '🔧', key: 'typeWorkshop', short: 'Wsh' },
  other: { icon: '📌', key: 'typeOther', short: '—' },
}
