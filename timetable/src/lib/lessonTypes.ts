import type { LessonType } from '../types'
import type { IconName } from '../components/Icon'

/** Ikon + kunci i18n + label singkat per jenis sesi */
export const TYPE_META: Record<
  LessonType,
  { icon: IconName; key: string; short: string }
> = {
  lecture: { icon: 'book', key: 'typeLecture', short: 'Lec' },
  exercise: { icon: 'pencil', key: 'typeExercise', short: 'Ex' },
  tutorial: { icon: 'compass', key: 'typeTutorial', short: 'Tut' },
  seminar: { icon: 'assignment', key: 'typeSeminar', short: 'Sem' },
  lab: { icon: 'puzzle', key: 'typeLab', short: 'Lab' },
  exam: { icon: 'exam', key: 'typeExam', short: 'Exam' },
  workshop: { icon: 'settings', key: 'typeWorkshop', short: 'Wsh' },
  other: { icon: 'pin', key: 'typeOther', short: '—' },
}
