import { useI18n } from '../../i18n'
import type { Lesson } from '../../types'
import type { EnrolledCourse } from '../../lib/courses'
import HebutCard from './HebutCard'
import SisuStudyPlan from '../SisuStudyPlan'
import Icon from '../Icon'

/** Keadaan belum terhubung: kartu pengantar + CTA ke Settings. */
export default function NotConnectedCard({ onOpenSettings, lessons = [], enrolled = [], sisuPrefsRevision = 0 }: {
  onOpenSettings: () => void
  lessons?: Lesson[]
  enrolled?: EnrolledCourse[]
  sisuPrefsRevision?: number
}) {
  const { t } = useI18n()
  return (
    <div className="flex-1 overflow-y-auto p-4 safe-bottom">
      <div className="mx-auto max-w-xl space-y-3">
        <section className="app-card p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--surface-2)]">
            <Icon name="book" size={22} />
          </div>
          <h2 className="text-sm font-semibold">{t('moodleViewTitle')}</h2>
          <p className="mx-auto mt-1.5 max-w-xs text-[11px] leading-relaxed text-[var(--text-3)]">
            {t('moodleViewIntro')}
          </p>
          <button onClick={onOpenSettings} className="app-btn-primary mx-auto mt-4 px-4 min-h-9 text-xs">
            <span className="inline-flex items-center gap-1.5"><Icon name="settings" size={13} /> {t('openSettings')}</span>
          </button>
          <p className="mt-2 text-[10px] text-[var(--text-3)]">{t('moodleViewFeatures')}</p>
        </section>
        <HebutCard />
        <SisuStudyPlan key={sisuPrefsRevision} lessons={lessons} enrolled={enrolled} onOpenSettings={onOpenSettings} />
      </div>
    </div>
  )
}
