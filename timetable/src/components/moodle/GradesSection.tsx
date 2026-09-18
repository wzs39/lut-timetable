import { useI18n } from '../../i18n'
import { useMoodleData } from '../../hooks/useMoodleData'
import GradeCourseCard from '../GradeCourseCard'
import Icon from '../Icon'

export default function GradesSection({
  onJumpToCourse,
  onOpenAssignments,
}: {
  onJumpToCourse?: (code: string) => void
  onOpenAssignments: (filter: 'overdue' | 'due7' | 'later') => void
}) {
  const { t } = useI18n()
  const md = useMoodleData()

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void md.refreshGrades()}
          disabled={md.busy !== 'idle' || !md.token}
          className="app-btn px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {md.busy === 'grades' ? t('gradesFetching') : t('gradesRefresh')}
        </button>
        <button
          onClick={() => void md.syncSubmissions()}
          disabled={md.busy !== 'idle' || !md.token}
          className="app-btn px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {md.busy === 'subs' ? t('subSyncing') : t('subSyncNow')}
        </button>
        <button
          onClick={() => onOpenAssignments('overdue')}
          className="app-btn-ghost ml-auto inline-flex items-center gap-1 px-2 py-1.5 text-xs"
        >
          {t('moodleTimelineLink')} <Icon name="chevron-right" size={12} />
        </button>
      </div>
      {md.message && <p className="text-[11px] text-[var(--text-2)]">{md.message}</p>}
      {md.token && md.grades && md.grades.length > 0 ? (
        <ul className="space-y-2">
          {md.grades.map((c) => (
            <GradeCourseCard key={c.courseId ?? c.course} c={c} onJumpToCourse={onJumpToCourse} />
          ))}
        </ul>
      ) : md.token ? (
        <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('gradesEmptyHint')}</p>
      ) : (
        <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('moodleIcsOnlyHint')}</p>
      )}
    </section>
  )
}
