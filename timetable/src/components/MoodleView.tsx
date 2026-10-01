import { useEffect, useState } from 'react'
import type { Lesson } from '../types'
import type { Task } from '../lib/tasks'
import { useI18n } from '../i18n'
import { useMoodleData } from '../hooks/useMoodleData'
import { fetchEnrolledCourses, loadEnrolledCourses, type EnrolledCourse } from '../lib/courses'
import { readString, writeString, KEYS } from '../lib/storage'
import Icon from './Icon'
import SisuStudyPlan from './SisuStudyPlan'
import CourseResourcesSection from './moodle/CourseResourcesSection'
import HebutCard from './moodle/HebutCard'
import TimelineSection from './moodle/TimelineSection'
import {
  GradesSection,
  CoursesSection,
  NotificationsSection,
  NotConnectedCard,
} from './moodle'

/**
 * Halaman Moodle — CANGKANG ORKESTRASI SAJA: tab section + pengambilan data
 * lazy per tab. Setiap seksi tinggal di filenya sendiri (components/moodle/);
 * state koneksi/nilai/notifikasi dimiliki MoodleProvider, bukan di sini.
 *
 * 【2026-09-26】作业模块并入时间线分区：独立的 assign 视图已删除，
 * TimelineSection（官方时间线的四桶卡片）下面直接内嵌 AssignmentsView。
 * 跳转点（成绩卡未评项/今日页横幅/课程详情）带预置筛选导航到这里。
 */
type Section = 'timeline' | 'grades' | 'courses' | 'resources' | 'studyplan' | 'notif'
const SECTION_ORDER: Section[] = ['timeline', 'grades', 'courses', 'resources', 'studyplan', 'notif']
const SECTION_KEY = KEYS.moodleSection

/** Baca section tersimpan; nilai tak dikenal → 'timeline'. */
function loadSection(): Section {
  const raw = readString(SECTION_KEY)
  const valid: Section[] = ['timeline', 'grades', 'courses', 'resources', 'studyplan', 'notif']
  return (valid as string[]).includes(raw ?? '') ? (raw as Section) : 'timeline'
}

export type AssignPreset = { filter: 'overdue' | 'due7' | 'later' | null; query?: string } | null

export default function MoodleView({
  tasks,
  lessons,
  onTasks,
  onJumpToCourse,
  assignPreset,
  onOpenAssignments,
  onClearAssignPreset,
  onOpenSettings,
  sisuPrefsRevision,
}: {
  tasks: Task[]
  lessons: Lesson[]
  /** 作业模块的写操作（带删除撤销），由 App 的 applyTasks 提供 */
  onTasks: (tasks: Task[]) => void
  onJumpToCourse?: (code: string) => void
  /** 跳转点预置的筛选/搜索词（App 级 state，按值 memo：空 = null）。
   *  非空 = 有真实跳转（成绩卡未评项、命令面板任务项等），effect 切到时间线。 */
  assignPreset?: AssignPreset
  /** 成绩分区等跳转点的统一出口：写 App 级预置并导航（含 setView('moodle')）。 */
  onOpenAssignments: (filter: 'overdue' | 'due7' | 'later' | null, query?: string) => void
  /** 时间线卡片点击时清掉 App 级预置，让卡片本地筛选接管列表。 */
  onClearAssignPreset?: () => void
  onOpenSettings: () => void
  /** 设置里的学习偏好/目标修订号：透传给计划页，触发重新读取 */
  sisuPrefsRevision?: number
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
  const goSection = (delta: number) => {
    const index = SECTION_ORDER.indexOf(section)
    const next = SECTION_ORDER[(index + delta + SECTION_ORDER.length) % SECTION_ORDER.length]
    setSection(next)
  }
  // 跳转点带预置进入时强制切到时间线（成绩卡未评项、命令面板任务项等）。
  // assignPreset 由 App 按值 memo（空 = null），只在真实跳转时变引用——
  // 不能收内联对象，否则每次 App 重渲染这里都会把用户拽回时间线。
  useEffect(() => {
    if (assignPreset != null) setSection('timeline')
  }, [assignPreset])
  const [enrolled, setEnrolled] = useState<EnrolledCourse[] | null>(() => loadEnrolledCourses())
  const [enrolledLoading, setEnrolledLoading] = useState(false)

  // Load enrolments on any section that displays course planning/resources.
  useEffect(() => {
    if (!['courses', 'resources', 'studyplan'].includes(section) || enrolled || !md.token || enrolledLoading) return
    setEnrolledLoading(true)
    fetchEnrolledCourses(md.token, lessons)
      .then((c) => setEnrolled(c))
      .catch(() => setEnrolled(null))
      .finally(() => setEnrolledLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, enrolled, md.token, lessons])

  if (!md.connected) {
    return <NotConnectedCard onOpenSettings={onOpenSettings} lessons={lessons} enrolled={enrolled ?? []} sisuPrefsRevision={sisuPrefsRevision} />
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 safe-bottom">
      <div className="mx-auto max-w-xl space-y-3">
        {/* Compact, scrollable section switch: six tools remain reachable on mobile. */}
        <div className="section-nav flex items-center gap-1" role="tablist" aria-label={t('moodleNav')}>
          <button className="section-arrow app-btn-ghost hidden shrink-0 p-1.5 sm:inline-flex" onClick={() => goSection(-1)} aria-label={t('prevSection')} title={t('prevSection')}><Icon name="chevron-left" size={12} /></button>
          <div className="app-seg min-w-0 flex-1 overflow-x-auto" role="presentation">
            <button id="moodle-tab-timeline" className="section-tab shrink-0 px-2" role="tab" aria-controls="moodle-panel" aria-selected={section === 'timeline'} onClick={() => setSection('timeline')}>
              {t('moodleSectionTimeline')}
            </button>
            <button id="moodle-tab-grades" className="section-tab shrink-0 px-2" role="tab" aria-controls="moodle-panel" aria-selected={section === 'grades'} onClick={() => setSection('grades')}>
              <span className="inline-flex items-center gap-1.5">
              <Icon name="graduation" size={14} /> {t('moodleSectionGrades')}
              {(md.grades?.length ?? 0) > 0 && (
                <span className="app-badge px-1.5 py-0.5 text-[10px] tabular-nums">{md.grades!.length}</span>
              )}
              </span>
            </button>
            <button id="moodle-tab-courses" className="section-tab shrink-0 px-2" role="tab" aria-controls="moodle-panel" aria-selected={section === 'courses'} onClick={() => setSection('courses')}>
              {t('moodleSectionCourses')}
            </button>
            <button id="moodle-tab-resources" className="section-tab shrink-0 px-2" role="tab" aria-controls="moodle-panel" aria-selected={section === 'resources'} onClick={() => setSection('resources')}>
              {t('courseResourcesTitle')}
            </button>
            <button id="moodle-tab-studyplan" className="section-tab shrink-0 px-2" role="tab" aria-controls="moodle-panel" aria-selected={section === 'studyplan'} onClick={() => setSection('studyplan')}>
              {t('sisuPlanShortTitle')}
            </button>
            <button id="moodle-tab-notif" className="section-tab shrink-0 px-2" role="tab" aria-controls="moodle-panel" aria-selected={section === 'notif'} onClick={() => setSection('notif')}>
              {t('notifSection')}
            </button>
          </div>
          <button className="section-arrow app-btn-ghost hidden shrink-0 p-1.5 sm:inline-flex" onClick={() => goSection(1)} aria-label={t('nextSection')} title={t('nextSection')}><Icon name="chevron-right" size={12} /></button>
        </div>

        <div id="moodle-panel" key={section} className="section-panel animate-view-in" role="tabpanel" aria-labelledby={`moodle-tab-${section}`}>
          {section === 'timeline' && (
            <TimelineSection
              tasks={tasks}
              lessons={lessons}
              onTasks={onTasks}
              onJumpToCourse={onJumpToCourse}
              assignPreset={assignPreset}
              onClearAssignPreset={onClearAssignPreset}
            />
          )}
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
          {section === 'resources' && (enrolledLoading && !enrolled
            ? <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('coursesLoading')}</p>
            : <CourseResourcesSection enrolled={enrolled} token={md.token} />)}
          {section === 'studyplan' && <SisuStudyPlan key={sisuPrefsRevision} lessons={lessons} enrolled={enrolled ?? []} onOpenSettings={onOpenSettings} />}
          {section === 'notif' && <NotificationsSection />}
          {(section === 'courses' || section === 'resources') && <HebutCard />}
        </div>
      </div>
    </div>
  )
}
