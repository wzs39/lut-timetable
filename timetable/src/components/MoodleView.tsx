import { useEffect, useMemo, useState } from 'react'
import type { Lesson } from '../types'
import { timelineBuckets, type Task } from '../lib/tasks'
import { useI18n } from '../i18n'
import { useMoodleData } from '../hooks/useMoodleData'
import { fetchEnrolledCourses, loadEnrolledCourses, type EnrolledCourse } from '../lib/courses'
import { readString, writeString, KEYS } from '../lib/storage'
import Icon, { type IconName } from './Icon'
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

  // Hook 必须在提前返回之前：未连接时也要走同一条 hook 序列。
  // 「一眼概览」的四个数字只依赖已加载数据，与连接状态无关。
  const buckets = useMemo(() => timelineBuckets(tasks, Date.now()), [tasks])

  if (!md.connected) {
    return <NotConnectedCard onOpenSettings={onOpenSettings} lessons={lessons} enrolled={enrolled ?? []} sisuPrefsRevision={sisuPrefsRevision} />
  }

  // ---- 一眼概览：四个数字回答「现在该看什么」，点一下就到对应分区 ----
  const pendingCount = tasks.filter((task) => !task.completed).length
  const unreadCount = md.unread
  const gradedCourses = md.grades?.filter((c) => c.average != null) ?? []
  const averageOfAverages = gradedCourses.length > 0
    ? Math.round(gradedCourses.reduce((sum, c) => sum + (c.average ?? 0), 0) / gradedCourses.length)
    : null
  const glance: Array<{
    key: Section
    label: string
    value: string
    tone: 'info' | 'due' | 'danger' | 'ok'
    hint: string
  }> = [
    { key: 'timeline', label: t('moodleGlancePending'), value: String(pendingCount), tone: 'info', hint: t('moodleSectionTimeline') },
    { key: 'timeline', label: t('moodleGlanceOverdue'), value: String(buckets.overdue), tone: buckets.overdue > 0 ? 'danger' : 'ok', hint: t('assignOverdue') },
    { key: 'notif', label: t('moodleGlanceUnread'), value: String(unreadCount), tone: unreadCount > 0 ? 'due' : 'ok', hint: t('notifSection') },
    { key: 'grades', label: t('moodleGlanceAverage'), value: averageOfAverages != null ? `${averageOfAverages}%` : t('moodleGlanceNone'), tone: 'ok', hint: t('moodleSectionGrades') },
  ]
  // 分区导轨的单一声明（顺序 / 图标 / 可选计数）：手机横滑与桌面竖排共用。
  const sections: Array<{ key: Section; labelKey: string; icon: IconName; badge?: number }> = [
    { key: 'timeline', labelKey: 'moodleSectionTimeline', icon: 'clock' },
    { key: 'grades', labelKey: 'moodleSectionGrades', icon: 'graduation', badge: md.grades?.length },
    { key: 'courses', labelKey: 'moodleSectionCourses', icon: 'book' },
    { key: 'resources', labelKey: 'courseResourcesTitle', icon: 'note' },
    { key: 'studyplan', labelKey: 'sisuPlanShortTitle', icon: 'compass' },
    { key: 'notif', labelKey: 'notifSection', icon: 'megaphone', badge: unreadCount || undefined },
  ]
  const currentSectionLabel = t(
    sections.find((entry) => entry.key === section)?.labelKey ?? 'moodleSectionTimeline',
  )

  return (
    <div className="flex-1 overflow-y-auto p-4 safe-bottom">
      <div className="mx-auto max-w-xl space-y-3 md:max-w-3xl xl:max-w-6xl">
        <section className="app-hero p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="app-card-label inline-flex items-center gap-1.5">
                <Icon name="graduation" size={13} /> {t('moodleGlanceTitle')}
              </h2>
              <p className="mt-1 text-[11px] text-[var(--text-3)]">
                {t('moodleNav')} · {currentSectionLabel}
              </p>
            </div>
            <button
              onClick={() => void md.syncNow()}
              disabled={md.busy !== 'idle' || !md.token}
              className="app-btn shrink-0 px-2 py-1 text-[11px] disabled:opacity-50"
              title={t('syncNow')}
            >
              <span className="inline-flex items-center gap-1.5">
                <Icon name="sync" size={11} className={md.busy !== 'idle' ? 'animate-spin' : ''} />
                {t('syncNow')}
              </span>
            </button>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {glance.map((item, index) => (
              <button
                key={`${item.key}-${index}`}
                onClick={() => setSection(item.key)}
                data-tone={item.tone}
                data-interactive="true"
                title={item.hint}
                className="stat-tile px-2.5 py-2 text-left"
              >
                <div className="stat-value text-lg font-semibold leading-tight tabular-nums">{item.value}</div>
                <div className="mt-0.5 text-[10px] text-[var(--text-3)]">{item.label}</div>
              </button>
            ))}
          </div>
        </section>

        {/* 分区导轨：手机横滑 chip，≥768px 变左侧竖排（同一份按钮，不复制 DOM）。 */}
        <div className="grid gap-3 md:grid-cols-[168px_minmax(0,1fr)] md:items-start">
        <div role="tablist" aria-label={t('moodleNav')} className="app-rail md:sticky md:top-0">
          {sections.map((entry) => (
            <button
              key={entry.key}
              id={`moodle-tab-${entry.key}`}
              role="tab"
              aria-controls="moodle-panel"
              aria-selected={section === entry.key}
              onClick={() => setSection(entry.key)}
              className="app-rail-item"
              title={t(entry.labelKey)}
            >
              <Icon name={entry.icon} size={13} />
              <span className="min-w-0 flex-1 truncate">{t(entry.labelKey)}</span>
              {entry.badge ? (
                <span className="app-badge px-1.5 py-0 text-[9px] tabular-nums">{entry.badge}</span>
              ) : null}
            </button>
          ))}
        </div>

        <div id="moodle-panel" key={section} className="section-panel animate-view-in min-w-0 space-y-3" role="tabpanel" aria-labelledby={`moodle-tab-${section}`}>
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
    </div>
  )
}
