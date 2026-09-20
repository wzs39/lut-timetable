import { useEffect, useState } from 'react'
import type { Lesson } from '../types'
import type { Task } from '../lib/tasks'
import { useI18n } from '../i18n'
import { useMoodleData } from '../hooks/useMoodleData'
import { fetchEnrolledCourses, loadEnrolledCourses, type EnrolledCourse } from '../lib/courses'
import { readString, writeString, KEYS } from '../lib/storage'
import Icon from './Icon'
import {
  TimelineSection,
  GradesSection,
  CoursesSection,
  NotificationsSection,
  NotConnectedCard,
} from './moodle'

/**
 * Halaman Moodle — CANGKANG ORKESTRASI SAJA: tab section + pengambilan data
 * lazy per tab. Setiap seksi tinggal di filenya sendiri (components/moodle/);
 * state koneksi/nilai/notifikasi dimiliki MoodleProvider, bukan di sini.
 */
type Section = 'timeline' | 'grades' | 'courses' | 'notif'

const SECTION_KEY = KEYS.moodleSection

/** Baca section tersimpan; nilai tak dikenal → 'timeline'. */
function loadSection(): Section {
  const raw = readString(SECTION_KEY)
  const valid: Section[] = ['timeline', 'grades', 'courses', 'notif']
  return (valid as string[]).includes(raw ?? '') ? (raw as Section) : 'timeline'
}

export default function MoodleView({
  tasks,
  lessons,
  onJumpToCourse,
  onOpenAssignments,
  onOpenSettings,
}: {
  tasks: Task[]
  lessons: Lesson[]
  onJumpToCourse?: (code: string) => void
  onOpenAssignments: (filter: 'overdue' | 'due7' | 'later' | null, query?: string) => void
  onOpenSettings: () => void
}) {
  const { t } = useI18n()
  const md = useMoodleData()
  // Section dipertahankan antar kunjungan/reload (pola useCollapse yang sama:
  // baca saat mount, tulis saat berubah).
  const [section, setSectionState] = useState<Section>(loadSection)
  const setSection = (s: Section) => {
    setSectionState(s)
    writeString(SECTION_KEY, s)
  }
  const [enrolled, setEnrolled] = useState<EnrolledCourse[] | null>(() => loadEnrolledCourses())
  const [enrolledLoading, setEnrolledLoading] = useState(false)

  // Pasang tab Kursus: daftar enrol di-cache 24 jam; bila cache kosong ambil.
  useEffect(() => {
    if (section !== 'courses' || enrolled || !md.token || enrolledLoading) return
    setEnrolledLoading(true)
    fetchEnrolledCourses(md.token)
      .then((c) => setEnrolled(c))
      .catch(() => setEnrolled(null))
      .finally(() => setEnrolledLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, enrolled, md.token])

  if (!md.connected) {
    return <NotConnectedCard onOpenSettings={onOpenSettings} />
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 safe-bottom">
      <div className="mx-auto max-w-xl space-y-3">
        {/* Section switch: 官方 App 的分段控件样式 */}
        <div className="app-seg" role="tablist">
          <button role="tab" aria-selected={section === 'timeline'} onClick={() => setSection('timeline')}>
            {t('moodleSectionTimeline')}
          </button>
          <button role="tab" aria-selected={section === 'grades'} onClick={() => setSection('grades')}>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="graduation" size={14} /> {t('moodleSectionGrades')}
              {(md.grades?.length ?? 0) > 0 && (
                <span className="app-badge px-1.5 py-0.5 text-[10px] tabular-nums">{md.grades!.length}</span>
              )}
            </span>
          </button>
          <button role="tab" aria-selected={section === 'courses'} onClick={() => setSection('courses')}>
            {t('moodleSectionCourses')}
          </button>
          <button role="tab" aria-selected={section === 'notif'} onClick={() => setSection('notif')}>
            {t('notifSection')}
          </button>
        </div>

        {section === 'timeline' && <TimelineSection tasks={tasks} onOpenAssignments={onOpenAssignments} />}
        {section === 'grades' && <GradesSection onJumpToCourse={onJumpToCourse} onOpenAssignments={onOpenAssignments} />}
        {section === 'courses' && (
          <CoursesSection
            enrolled={enrolled}
            loading={enrolledLoading && !enrolled}
            lessons={lessons}
            tasks={tasks}
            grades={md.grades}
            onJumpToCourse={onJumpToCourse}
            token={md.token}
          />
        )}
        {section === 'notif' && <NotificationsSection />}
      </div>
    </div>
  )
}
