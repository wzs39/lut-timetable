import { useEffect, useMemo, useState } from 'react'
import type { Lesson } from '../types'
import type { StudyBlock } from '../lib/studyBlocks'
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
} from './moodle'

/**
 * 学术驾驶舱（MoodleView）— 三大扁平工作区（任务与雷达 / 成绩与培养 / 课程与资料）：
 * - 未连接 Moodle 时不再整页阻塞，展示紧凑横幅并开放本地 SISU 培养方案、DDL 雷达、三源课程图谱与排程；
 * - 删除原 6 个碎片分区，避免 `MoodleView -> SisuStudyPlan` 三层嵌套标签。
 */
type Workspace = 'tasks' | 'grades' | 'courses'
const SECTION_KEY = KEYS.moodleSection

/** 读取已保存的工作区；兼容旧 6 分区 key 映射到三大扁平工作区。 */
function loadWorkspace(): Workspace {
  const raw = readString(SECTION_KEY)
  if (raw === 'grades' || raw === 'studyplan') return 'grades'
  if (raw === 'courses' || raw === 'resources') return 'courses'
  return 'tasks'
}

export type AssignPreset = { filter: 'overdue' | 'due7' | 'later' | null; query?: string } | null

export default function MoodleView({
  tasks,
  lessons,
  studyBlocks,
  onTasks,
  onJumpToCourse,
  onInspectCourse,
  assignPreset,
  onOpenAssignments,
  onClearAssignPreset,
  onOpenSettings,
  sisuPrefsRevision,
}: {
  tasks: Task[]
  lessons: Lesson[]
  studyBlocks?: StudyBlock[]
  /** 作业模块的写操作（带删除撤销），由 App 的 applyTasks 提供 */
  onTasks: (tasks: Task[]) => void
  onJumpToCourse?: (code: string) => void
  onInspectCourse?: (code: string) => void
  /** 跳转点预置的筛选/搜索词（App 级 state，按值 memo：空 = null）。 */
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
  const [workspace, setWorkspaceState] = useState<Workspace>(loadWorkspace)
  const setWorkspace = (w: Workspace) => {
    setWorkspaceState(w)
    writeString(SECTION_KEY, w)
  }

  useEffect(() => {
    if (assignPreset != null) setWorkspace('tasks')
  }, [assignPreset])

  const [enrolled, setEnrolled] = useState<EnrolledCourse[] | null>(() => loadEnrolledCourses())
  const [enrolledLoading, setEnrolledLoading] = useState(false)

  useEffect(() => {
    if ((workspace !== 'courses' && workspace !== 'grades') || enrolled || !md.token || enrolledLoading) return
    setEnrolledLoading(true)
    fetchEnrolledCourses(md.token, lessons)
      .then((c) => setEnrolled(c))
      .catch(() => setEnrolled(null))
      .finally(() => setEnrolledLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, enrolled, md.token, lessons])

  const buckets = useMemo(() => timelineBuckets(tasks, Date.now()), [tasks])

  const pendingCount = tasks.filter((task) => !task.completed).length
  const unreadCount = md.unread ?? 0
  const gradedCourses = md.grades?.filter((c) => c.average != null) ?? []
  const averageOfAverages = gradedCourses.length > 0
    ? Math.round(gradedCourses.reduce((sum, c) => sum + (c.average ?? 0), 0) / gradedCourses.length)
    : null

  const glance: Array<{
    key: Workspace
    label: string
    value: string
    tone: 'info' | 'due' | 'danger' | 'ok'
    hint: string
  }> = [
    { key: 'tasks', label: t('moodleGlancePending'), value: String(pendingCount), tone: 'info', hint: t('moodleWorkspaceTasks') },
    { key: 'tasks', label: t('moodleGlanceOverdue'), value: String(buckets.overdue), tone: buckets.overdue > 0 ? 'danger' : 'ok', hint: t('assignOverdue') },
    { key: 'tasks', label: t('moodleGlanceUnread'), value: String(unreadCount), tone: unreadCount > 0 ? 'due' : 'ok', hint: t('notifSection') },
    { key: 'grades', label: t('moodleGlanceAverage'), value: averageOfAverages != null ? `${averageOfAverages}%` : t('moodleGlanceNone'), tone: 'ok', hint: t('moodleWorkspaceGrades') },
  ]

  const workspaces: Array<{ key: Workspace; labelKey: string; icon: IconName; badge?: number }> = [
    { key: 'tasks', labelKey: 'moodleWorkspaceTasks', icon: 'clock', badge: (pendingCount + (md.unread ?? 0)) || undefined },
    { key: 'grades', labelKey: 'moodleWorkspaceGrades', icon: 'graduation', badge: md.grades?.length },
    { key: 'courses', labelKey: 'moodleWorkspaceCourses', icon: 'book' },
  ]
  const currentLabel = t(
    workspaces.find((entry) => entry.key === workspace)?.labelKey ?? 'moodleWorkspaceTasks',
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
                {t('moodleNav')} · {currentLabel}
              </p>
            </div>
            {md.connected ? (
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
            ) : (
              <button
                type="button"
                onClick={onOpenSettings}
                className="app-btn-primary shrink-0 px-2.5 py-1 text-[11px]"
              >
                {t('openSettings')}
              </button>
            )}
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {glance.map((item, index) => (
              <button
                key={`${item.key}-${index}`}
                onClick={() => setWorkspace(item.key)}
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

        {!md.connected && (
          <div
            data-testid="moodle-disconnected-banner"
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-1)]/90 px-3 py-2 text-[11px]"
          >
            <div className="flex items-center gap-2 text-[var(--text-2)]">
              <span className="led-dot" data-tone="due" />
              <span>{t('moodleDisconnectedHint')}</span>
            </div>
            <button
              type="button"
              onClick={onOpenSettings}
              className="app-btn-ghost shrink-0 px-2 py-1 text-[11px] text-[var(--info)]"
            >
              {t('openSettings')}
            </button>
          </div>
        )}

        {/* 三大扁平工作区导轨：手机横滑，≥768px 左侧吸顶竖排 */}
        <div className="grid gap-3 md:grid-cols-[176px_minmax(0,1fr)] md:items-start">
          <div role="tablist" aria-label={t('moodleNav')} className="app-rail md:sticky md:top-0">
            {workspaces.map((entry) => (
              <button
                key={entry.key}
                id={`moodle-tab-${entry.key}`}
                role="tab"
                aria-controls="moodle-panel"
                aria-selected={workspace === entry.key}
                onClick={() => setWorkspace(entry.key)}
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

          <div
            id="moodle-panel"
            key={workspace}
            className="section-panel animate-view-in min-w-0 space-y-3"
            role="tabpanel"
            aria-labelledby={`moodle-tab-${workspace}`}
          >
            {workspace === 'tasks' && (
              <>
                <TimelineSection
                  tasks={tasks}
                  lessons={lessons}
                  studyBlocks={studyBlocks}
                  grades={md.grades ?? undefined}
                  onTasks={onTasks}
                  onJumpToCourse={onJumpToCourse}
                  onInspectCourse={onInspectCourse}
                  assignPreset={assignPreset}
                  onClearAssignPreset={onClearAssignPreset}
                />
                {md.connected && <NotificationsSection />}
              </>
            )}

            {workspace === 'grades' && (
              <>
                <GradesSection onJumpToCourse={onJumpToCourse} onOpenAssignments={onOpenAssignments} />
                <SisuStudyPlan
                  key={sisuPrefsRevision}
                  lessons={lessons}
                  enrolled={enrolled ?? []}
                  onOpenSettings={onOpenSettings}
                  onInspectCourse={onInspectCourse}
                  embedded
                />
              </>
            )}

            {workspace === 'courses' && (
              <>
                <CoursesSection
                  enrolled={enrolled}
                  loading={enrolledLoading && !enrolled}
                  lessons={lessons}
                  tasks={tasks}
                  grades={md.grades}
                  studyBlocks={studyBlocks}
                  onJumpToCourse={onJumpToCourse}
                  onInspectCourse={onInspectCourse}
                  token={md.token}
                />
                {(md.connected || (enrolled && enrolled.length > 0)) && (
                  <CourseResourcesSection enrolled={enrolled} token={md.token} />
                )}
                <HebutCard />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
