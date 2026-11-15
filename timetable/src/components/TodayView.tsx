import { useMemo, useState } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { useNow, useNowDate } from '../lib/useNow'
import { courseColor, courseStyle, courseTextStyle } from '../lib/colors'
import { formatTime, nextLessonDay, sameDay, formatDateTime, formatLongDay } from '../lib/date'
import { TYPE_META } from '../lib/lessonTypes'
import { SOURCE_ICON } from '../lib/sources'
import { displayTitle, buildingOf, roomOf } from '../lib/display'
import { roomHops } from '../lib/roomHop'
import { isSubscribed, type Subscription } from '../lib/subscriptions'
import { noteForLesson, type NotesMap } from '../lib/notes'
import {
  dueOn,
  isOverdue,
  type Task,
} from '../lib/tasks'
import TaskRow from './TaskRow'
import { upcomingExams } from '../lib/exams'
import { freeRoomsNow } from '../lib/freeRooms'
import LessonNote from './LessonNote'
import Icon from './Icon'
import CollapsiblePanel from './CollapsiblePanel'
import { KEYS } from '../lib/storage'
import { useCollapse } from '../lib/useCollapse'
import { loadCachedNotifications, notificationsAsAlertSources } from '../lib/notificationsFeed'
import { noticesForLessons, type LessonNotice } from '../lib/lessonAlerts'
import { studyBlocksOnDay, type StudyBlock } from '../lib/studyBlocks'
import { usePomodoro } from '../hooks/usePomodoro'
import SemesterStrip from './SemesterStrip'
import WeekInsights from './WeekInsights'
import PomodoroCard from './PomodoroCard'

interface Props {
  lessons: Lesson[]
  onSelect: (id: string) => void
  /** Catatan kursus: kode+jenis -> teks */
  notes?: NotesMap
  /** 保存课堂随手记笔记 */
  onSaveNote?: (lesson: Pick<Lesson, 'code' | 'type' | 'title'>, text: string) => void
  /** 打开课程全景档案 */
  onInspectCourse?: (code: string) => void
  /** Semua tugas/assignment — 今日截止 + 逾期 显示 */
  tasks?: Task[]
  /** 跳转到该课程的日历位置 */
  onJumpToCourse?: (code: string) => void
  /** 勾选/取消任务（持久化由 App 层处理）；不传则今日页任务行无复选框之外行为差异 */
  onToggleTask?: (task: Task, completed: boolean) => void
  /** 打开作业页面 */
  onOpenAssignments?: () => void
  /** 打开设置（空课表时的「添加课表源」入口） */
  onOpenSettings?: () => void
  /** 是否已有同步源；false 时空态横幅会给出「添加课表源」按钮 */
  hasSources?: boolean
  /** 订阅式提醒：空闲教室行上的「空出提醒我」开关 */
  subscriptions?: Subscription[]
  onWatchRoom?: (target: string, label: string, on: boolean) => void
  /** 已确认的学习时段（只读列出；不是课程、不可点、不参与课表） */
  studyBlocks?: StudyBlock[]
  /** 学期全景带点某一周 → App 切到那一周的周视图 */
  onOpenWeek?: (weekStart: Date) => void
}

/** "1 小时 25 分" / "45 分钟" */
function fmtDuration(min: number, t: (k: string, p?: any) => string): string {
  if (min < 60) return t('durationM', { m: min })
  return t('durationHM', { h: Math.floor(min / 60), m: min % 60 })
}

/** 课卡上的公告提示 chip：教室已变（含新教室号）/ 截止有变。 */
function LessonNoticeChip({ notice }: { notice?: LessonNotice }) {
  const { t } = useI18n()
  if (!notice) return null
  if (notice.kind === 'room-change') {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--line-due)] bg-[var(--tint-due)] px-1.5 py-px text-[10px] font-medium text-[var(--due)]"
        title={notice.room ? t('noticeRoomChangedTo', { room: notice.room }) : t('noticeRoomChanged')}
      >
        <Icon name="pin" size={10} />
        {notice.room
          ? t('noticeRoomChangedShortTo', { room: notice.room })
          : t('noticeRoomChangedShort')}
      </span>
    )
  }
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--line-info)] bg-[var(--tint-info)] px-1.5 py-px text-[10px] font-medium text-[var(--info)]"
      title={t('noticeDeadlineChanged')}
    >
      <Icon name="clock" size={10} /> {t('noticeDeadlineShort')}
    </span>
  )
}

/**
 * 今日视图: dua tab.
 *  - 课程: jadwal hari ini + pratinjau hari depan + navigasi gedung.
 *  - 动态: ruangan kosong, ujian, pengumuman, tugas jatuh tempo.
 * Tab terakhir dipakai kembali saat buka (persisten).
 */
export default function TodayView({
  lessons,
  onSelect,
  notes = {},
  onSaveNote,
  onInspectCourse,
  tasks = [],
  onJumpToCourse,
  onToggleTask,
  onOpenAssignments,
  onOpenSettings,
  hasSources = true,
  subscriptions = [],
  onWatchRoom,
  studyBlocks = [],
  onOpenWeek,
}: Props) {
  const { t, locale } = useI18n()
  const now = useNow()
  const nowDate = useNowDate()
  const pomodoro = usePomodoro()
  // 任务区折叠（逾期横幅 + 今日截止），持久化到 localStorage
  const [tasksOpen, toggleTasks] = useCollapse(KEYS.todayTasksOpen)
  const [roomHorizon, setRoomHorizon] = useState<60 | 120>(60)
  const [roomBuilding, setRoomBuilding] = useState<string>('all')
  const [quickNoteOpen, setQuickNoteOpen] = useState(false)
  const [quickNoteDraft, setQuickNoteDraft] = useState('')

  const today = useMemo(() => {
    const nowDate = new Date(now)
    return lessons
      .filter((l) => sameDay(new Date(l.start), nowDate))
      .sort((a, b) => a.start.localeCompare(b.start))
  }, [lessons, now])

  /** 今天已确认的学习时段（纯函数负责本地日界线比较） */
  const todayStudyBlocks = useMemo(
    () => studyBlocksOnDay(studyBlocks, nowDate),
    [studyBlocks, nowDate],
  )

  // 教室变更/截止延期通知 → 课卡提示（数据源 = 通知流缓存，15 分钟重读一次）
  const notices = useMemo(() => {
    return noticesForLessons(notificationsAsAlertSources(loadCachedNotifications()), lessons)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons, Math.floor(now / (15 * 60 * 1000))])

  const ongoing = today.find(
    (l) =>
      new Date(l.start).getTime() <= now && now < new Date(l.end).getTime(),
  )
  const next = today.find((l) => new Date(l.start).getTime() > now)
  const ended = today.length > 0 && !ongoing && !next
  const nextDay = useMemo(
    () => nextLessonDay(lessons, new Date(now)),
    [lessons, now],
  )
  const nextDayLessons = useMemo(
    () => nextDay
      ? lessons
          .filter((lesson) => sameDay(new Date(lesson.start), nextDay))
          .sort((a, b) => a.start.localeCompare(b.start))
      : [],
    [lessons, nextDay],
  )

  const banner = (() => {
    if (ongoing) {
      const left = Math.max(
        1,
        Math.round((new Date(ongoing.end).getTime() - now) / 60000),
      )
      return { tone: 'ongoing', text: `${t('nowOngoing')} · ${fmtDuration(left, t)}`, lesson: ongoing }
    }
    if (next) {
      const left = Math.max(
        1,
        Math.round((new Date(next.start).getTime() - now) / 60000),
      )
      return { tone: 'next', text: `${t('startsIn', { t: fmtDuration(left, t) })}`, lesson: next }
    }
    if (ended) return { tone: 'done', text: t('allDone'), lesson: null }
    return { tone: 'empty', text: t('noLessonsToday'), lesson: null }
  })()

  const todayLabel = formatLongDay(new Date(now), locale)

  // ---- 截止任务：今日截止 + 逾期汇总 ----
  const overdueTasks = useMemo(
    () => tasks.filter((task) => isOverdue(task, new Date(now))),
    [tasks, now],
  )
  const dueToday = useMemo(
    () => dueOn(tasks, new Date(now)),
    [tasks, now],
  )
  // 考试倒计时：未来 60 天内未结束的考试，按日期升序
  const exams = useMemo(
    () => upcomingExams(lessons, new Date(now)),
    [lessons, now],
  )
  // 空闲教室：根据已知教室占用推算，支持 1h / 2h 时长与楼栋筛选
  const freeRoomsAll = useMemo(
    () => freeRoomsNow(lessons, new Date(now), roomHorizon),
    [lessons, now, roomHorizon],
  )
  const freeRoomBuildings = useMemo(
    () => [...new Set(freeRoomsAll.map((r) => r.building))].sort((a, b) => a.localeCompare(b)),
    [freeRoomsAll],
  )
  const freeRooms = useMemo(
    () => (roomBuilding === 'all' ? freeRoomsAll : freeRoomsAll.filter((r) => r.building === roomBuilding)),
    [freeRoomsAll, roomBuilding],
  )
  const pomodoroCourses = useMemo(() => {
    const seen = new Map<string, string>()
    for (const l of lessons) {
      if (l.code && !seen.has(l.code)) {
        seen.set(l.code, displayTitle(l))
      }
    }
    return [...seen.entries()].map(([code, title]) => ({ code, title }))
  }, [lessons])

  const hasPastToday = useMemo(
    () => today.some((l) => new Date(l.end).getTime() <= now),
    [today, now],
  )
  const stageMode: 'in-class' | 'between-classes' | 'before-class' | 'after-hours' = ongoing
    ? 'in-class'
    : next
      ? hasPastToday
        ? 'between-classes'
        : 'before-class'
      : 'after-hours'
  const ongoingProgress = ongoing
    ? (() => {
        const s = new Date(ongoing.start).getTime()
        const e = new Date(ongoing.end).getTime()
        const total = Math.max(1, e - s)
        const pct = Math.max(0, Math.min(100, Math.round(((now - s) / total) * 100)))
        const left = Math.max(1, Math.round((e - now) / 60000))
        return { pct, left }
      })()
    : null
  const nextMinutesLeft = next
    ? Math.max(1, Math.round((new Date(next.start).getTime() - now) / 60000))
    : null

  // Navigasi internal: kelompokkan pelajaran hari ini per gedung.
  const buildings = useMemo(() => {
    const map = new Map<string, { room: string; time: string; live: boolean }[]>()
    for (const l of today) {
      const b = buildingOf(l.location)
      if (!b) continue
      const arr = map.get(b) || []
      arr.push({
        room: roomOf(l.location as string),
        time: formatTime(l.start, locale),
        live: new Date(l.start).getTime() <= now && now < new Date(l.end).getTime(),
      })
      map.set(b, arr)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [today, now, locale])

  // 明日预览卡片：今日课已全部结束，或空课日（today 为空但有下一节课日）时内嵌展示，
  // 取代空课日「只有横幅一句话」的空态。两处共用同一个 JSX，避免双份维护。
  const nextDayPreview = nextDayLessons.length > 0 && (
    <section className="animate-modal-in app-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h3 className="app-card-label">{t('nextDayPreview')}</h3>
          <p className="mt-0.5 text-[11px] text-[var(--text-2)]">
            {nextDay ? formatLongDay(nextDay, locale) : ''}
          </p>
        </div>
        <span className="app-badge">
          {t('nextDayLessonsN', { n: nextDayLessons.length })}
        </span>
      </div>
      <LessonList lessons={nextDayLessons} notices={notices} notes={notes} locale={locale} onSelect={onSelect} />
    </section>
  )

  return (
    <div className="flex-1 overflow-y-auto p-4 safe-bottom">
      {/* 非对称 Bento 布局：情境感知 Live Stage 置顶，下方 7:5 桌面不对称双栏 / 移动流式直出 */}
      <div className="mx-auto max-w-xl space-y-3 xl:grid xl:max-w-6xl xl:grid-cols-12 xl:items-start xl:gap-4 xl:space-y-0">
        {/* 情境感知 Live Stage（四态：课前准备 / 上课中 / 课间换场 / 收官夜览） */}
        <div className="xl:col-span-12">
          <section
            data-testid="today-live-stage"
            data-stage-mode={stageMode}
            className="app-hero p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      'led-dot ' +
                      (stageMode === 'in-class'
                        ? 'led-ok led-pulse'
                        : stageMode === 'between-classes' || stageMode === 'before-class'
                          ? 'led-info'
                          : '')
                    }
                    aria-hidden="true"
                  />
                  <p className="app-card-label">{todayLabel}</p>
                  <span className="text-[11px] font-mono text-[var(--text-3)]">
                    {stageMode === 'in-class' && ongoingProgress
                      ? t('todayStageInClass', { pct: ongoingProgress.pct, m: ongoingProgress.left })
                      : stageMode === 'between-classes' && next && nextMinutesLeft != null
                        ? t('todayStageBetween', { code: next.code || displayTitle(next), m: nextMinutesLeft })
                        : stageMode === 'before-class' && nextMinutesLeft != null
                          ? t('todayStageBefore', { m: nextMinutesLeft })
                          : t('todayStageAfterHours')}
                  </span>
                </div>

                <h2 className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold tracking-tight text-[var(--text-1)]">
                  {banner.lesson ? (
                    <>
                      {banner.tone === 'ongoing' && (
                        <span className="app-badge app-badge-live inline-flex items-center gap-1 text-[10px] font-medium">
                          <Icon name="live" size={11} /> {t('nowOngoing')}
                        </span>
                      )}
                      <span className="min-w-0 truncate">
                        {banner.lesson.code ? <span className="font-mono">{banner.lesson.code}</span> : null}
                        {banner.lesson.code ? ' · ' : ''}
                        {displayTitle(banner.lesson)}
                      </span>
                    </>
                  ) : (
                    <span>{banner.text}</span>
                  )}
                </h2>

                <p className="mt-1 text-[11px] text-[var(--text-2)]">
                  {banner.lesson ? (
                    <span className="tabular-nums font-mono">
                      {formatTime(banner.lesson.start, locale)} – {formatTime(banner.lesson.end, locale)}
                      {banner.lesson.location ? ` · ${banner.lesson.location}` : ''}
                      <span className="font-sans text-[var(--text-3)]"> · {banner.text}</span>
                    </span>
                  ) : nextDayLessons[0] ? (
                    <span className="tabular-nums font-mono text-[var(--text-3)]">
                      {t('nextDayPreview')}: {nextDayLessons[0].code ? `${nextDayLessons[0].code} ` : ''}
                      {formatTime(nextDayLessons[0].start, locale)}
                    </span>
                  ) : (
                    <span className="text-[var(--text-3)]">{t('todayBentoSchedule')} · {t('todayBentoPulse')}</span>
                  )}
                </p>

                {ongoingProgress && (
                  <div className="mt-2 max-w-md">
                    <div className="micro-scale">
                      <span className="micro-scale-fill" style={{ width: `${ongoingProgress.pct}%` }} />
                    </div>
                  </div>
                )}

                {ongoing && onSaveNote && quickNoteOpen && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!quickNoteDraft.trim()) return
                      onSaveNote(ongoing, quickNoteDraft.trim())
                      setQuickNoteDraft('')
                      setQuickNoteOpen(false)
                    }}
                    className="mt-2 flex max-w-md items-center gap-1.5"
                  >
                    <input
                      type="text"
                      value={quickNoteDraft}
                      onChange={(e) => setQuickNoteDraft(e.target.value)}
                      placeholder={t('todayStageNotePh')}
                      className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-1 text-xs text-[var(--text-1)] placeholder:text-[var(--text-3)] focus:border-[var(--focus-line)] focus:outline-none"
                    />
                    <button type="submit" className="app-btn-primary px-2.5 py-1 text-[11px]">
                      {t('save')}
                    </button>
                  </form>
                )}
              </div>

              {banner.lesson && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {banner.lesson.code && onInspectCourse && (
                    <button
                      type="button"
                      onClick={() => onInspectCourse(banner.lesson!.code!)}
                      className="app-btn px-2.5 py-1 text-[11px]"
                    >
                      {t('todayStageActionInspect')}
                    </button>
                  )}
                  {banner.lesson.code && (
                    <button
                      type="button"
                      onClick={() => pomodoro.startForCourse(banner.lesson!.code!, { label: displayTitle(banner.lesson!) })}
                      className="app-btn-primary px-2.5 py-1 text-[11px]"
                    >
                      {t('todayStageActionFocus')}
                    </button>
                  )}
                  {ongoing && onSaveNote && (
                    <button
                      type="button"
                      onClick={() => {
                        const existing = noteForLesson(notes, ongoing)
                        setQuickNoteDraft(existing ?? '')
                        setQuickNoteOpen((v) => !v)
                      }}
                      className="app-btn-ghost px-2 py-1 text-[11px]"
                    >
                      + {t('edit')}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <div data-tone="info" className="stat-tile px-2.5 py-1.5">
                <span className="stat-value font-mono text-base font-semibold tabular-nums">{today.length}</span>
                <span className="ml-1.5 text-[10px] text-[var(--text-3)]">{t('todayGlanceLessons')}</span>
              </div>
              {dueToday.length > 0 && (
                <div data-tone="due" className="stat-tile px-2.5 py-1.5">
                  <span className="stat-value font-mono text-base font-semibold tabular-nums">{dueToday.length}</span>
                  <span className="ml-1.5 text-[10px] text-[var(--text-3)]">{t('todayGlanceDue')}</span>
                </div>
              )}
              {overdueTasks.length > 0 && (
                <div data-tone="danger" className="stat-tile px-2.5 py-1.5">
                  <span className="stat-value font-mono text-base font-semibold tabular-nums">{overdueTasks.length}</span>
                  <span className="ml-1.5 text-[10px] text-[var(--text-3)]">{t('todayGlanceOverdue')}</span>
                </div>
              )}
              {banner.tone === 'empty' && !hasSources && onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="app-btn-primary ml-auto shrink-0 px-2.5 py-1 text-[11px]"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="plus" size={12} /> {t('addTimetableSource')}
                  </span>
                </button>
              )}
            </div>
          </section>
        </div>

        {/* Bento 主列：今日课序 + 已确认学习块 + 本周洞察 + 室内导航 */}
        <div className="space-y-3 xl:col-span-7">
            {/* 今日课程安排（置顶首位） */}
            {today.length === 0 ? (
              nextDayPreview || (banner.tone !== 'empty' ? (
                <p className="py-10 text-center text-xs text-[var(--text-3)]">{t('noLessonsToday')}</p>
              ) : null)
            ) : ended && nextDayPreview ? (
              nextDayPreview
            ) : (
              <LessonList lessons={today} notices={notices} notes={notes} locale={locale} onSelect={onSelect} now={now} />
            )}

            {/* 已确认学习时段：紧随课程之后 */}
            {todayStudyBlocks.length > 0 && (
              <section className="animate-modal-in app-card p-3">
                <h3 className="app-card-label inline-flex items-center gap-1.5">
                  <Icon name="clock" size={12} /> {t('studyBlockConfirmed')}
                </h3>
                <ul className="mt-2 space-y-1">
                  {todayStudyBlocks.map((block) => (
                    <li
                      key={block.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface-2)] px-2 py-1"
                    >
                      <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-3)]">
                        {formatTime(block.startAt, locale)}–{formatTime(block.endAt, locale)}
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-1)]"
                        title={block.title}
                      >
                        {block.title}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--text-3)]">
                        {t(block.sourceKind === 'task' ? 'studyBlockTaskSource' : 'studyBlockPlanSource')}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* 室内导航指南：折叠收纳在课程下方 */}
            {buildings.length > 0 && (
              <CollapsiblePanel
                storageKey={KEYS.todayIndoorOpen}
                label={
                  <span className="app-card-label inline-flex items-center gap-1.5">
                    <Icon name="compass" size={12} /> {t('indoorNav')}
                  </span>
                }
              >
                <div className="space-y-1">
                  {buildings.map(([building, items]) => (
                    <div key={building} className="text-[11px]">
                      <span className="font-semibold text-[var(--text-1)] inline-flex items-center gap-1"><Icon name="building" size={12} /> {building}</span>
                      <span className="ml-2 text-[var(--text-2)]">
                        {items.map((i) => `${i.room} ${i.time}${i.live ? ' ' : ''}`).join(' · ')}
                      </span>
                    </div>
                  ))}
                </div>
              </CollapsiblePanel>
            )}
            {/* 本周提示（空档 / 赶场 / 满课）置入主列形成非对称 Bento */}
            <WeekInsights lessons={lessons} onSelect={onSelect} />
        </div>

        {/* Bento 次列：逾期与今日截止 + 课程专注 + 互动空闲教室 + 考试倒计时（全视口直出，无 tab 折叠隐藏） */}
        <div className="space-y-3 xl:col-span-5">
            {/* 1. 紧急与截止：逾期任务警示横幅 */}
            {overdueTasks.length > 0 && (
              <section className="animate-modal-in app-card border border-[var(--danger)]/40 bg-[var(--tint-danger)]/10">
                <div className="flex items-center justify-between gap-2 px-3 py-2">
                  <button
                    onClick={toggleTasks}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    title={t('toggleHint')}
                  >
                    <span className="shrink-0 text-[var(--danger)]"><Icon name={tasksOpen ? 'chevron-down' : 'chevron-right'} size={12} /></span>
                    <span className="app-badge-overdue truncate text-xs font-bold inline-flex items-center gap-1.5 px-2 py-0.5">
                      <Icon name="warn" size={13} /> {t('dueOverdueBanner', { n: overdueTasks.length })}
                    </span>
                  </button>
                  <button
                    onClick={onOpenAssignments}
                    className="app-btn-overdue shrink-0 text-[11px] font-medium px-2.5 py-1"
                  >
                    {t('dueGoAssign')} ›
                  </button>
                </div>
                {tasksOpen && (
                  <div className="space-y-1.5 border-t border-[var(--danger)]/20 px-3 pb-3 pt-2">
                    {overdueTasks.slice(0, 5).map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center justify-between gap-2 rounded border border-[var(--danger)]/30 bg-[var(--surface-2)] p-2 text-xs"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <input
                            type="checkbox"
                            checked={task.completed}
                            onChange={(e) => onToggleTask?.(task, e.target.checked)}
                            className="h-3.5 w-3.5 shrink-0 accent-[var(--ok)]"
                            aria-label={task.title}
                          />
                          <span className="truncate font-medium text-[var(--danger)]">
                            · {task.title}
                          </span>
                        </div>
                        {task.dueAt && (
                          <span className="shrink-0 text-[10px] font-mono font-medium text-[var(--danger)]">
                            {formatDueShort(task.dueAt, locale)}
                          </span>
                        )}
                      </div>
                    ))}
                    {overdueTasks.length > 5 && (
                      <div className="text-center pt-0.5">
                        <button
                          onClick={onOpenAssignments}
                          className="app-btn-ghost text-[10px] font-medium text-[var(--danger)] hover:underline"
                        >
                          {t('dueMoreN', { n: overdueTasks.length - 5 })} ›
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* 2. 今日截止任务清单 */}
            {dueToday.length > 0 && (
              <section className="animate-modal-in app-card p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <button
                    onClick={toggleTasks}
                    className="flex min-w-0 items-center gap-1.5 text-left"
                    title={t('toggleHint')}
                  >
                    <span className="collapse-chevron shrink-0 text-[var(--text-3)]" aria-hidden>
                      <Icon name="chevron-down" size={12} />
                    </span>
                    <h3 className="app-badge-due truncate text-xs font-semibold inline-flex items-center gap-1.5">
                      <Icon name="clock" size={13} /> {t('dueTodayTitle', { n: dueToday.length })}
                    </h3>
                  </button>
                  <button
                    onClick={onOpenAssignments}
                    className="app-btn-due shrink-0 text-[11px]"
                  >
                    {t('dueGoAssign')} ›
                  </button>
                </div>
                <div className={`collapse-wrap${tasksOpen ? ' open' : ' is-closed'}`} inert={!tasksOpen}>
                  <div>
                  <ul className="space-y-2">
                  {dueToday.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      lessons={lessons}
                      onToggle={(t0, completed) => onToggleTask?.(t0, completed)}
                      onJumpToCourse={onJumpToCourse}
                      showCountdown
                    />
                  ))}
                  </ul>
                  </div>
                </div>
              </section>
            )}

            {/* 3. 考试倒计时 */}
            {exams.length > 0 && (
              <CollapsiblePanel
                storageKey={KEYS.todayExamsOpen}
                label={
                  <span className="app-card-label inline-flex items-center gap-1.5">
                    <Icon name="exam" size={12} /> {t('examCountdownTitle', { n: exams.length })}
                  </span>
                }
              >
                <ul className="space-y-1">
                  {exams.map(({ lesson, inDays, live }) => (
                    <li key={lesson.id}>
                      <button
                        onClick={() => onSelect(lesson.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-transparent px-2.5 py-1.5 text-left text-xs transition hover:border-[var(--line)] hover:bg-[var(--surface-2)]"
                      >
                        <span className="min-w-0 truncate text-[var(--text-1)]">
                          {lesson.code ? `${lesson.code} · ` : ''}
                          {displayTitle(lesson)}
                          {lesson.location && (
                            <span className="ml-1.5 text-[10px] font-normal text-[var(--text-3)]">@ {lesson.location}</span>
                          )}
                        </span>
                        {live ? (
                          <span className="app-badge app-badge-live">
                            <Icon name="live" size={11} /> {t('nowOngoing')}
                          </span>
                        ) : (
                          <span className="app-badge tabular-nums">
                            {inDays === 0
                              ? t('examToday')
                              : t('examInDays', { n: inDays })}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </CollapsiblePanel>
            )}

            {/* 4. 番茄钟课程联动专注舱 */}
            <PomodoroCard courses={pomodoroCourses} />

            {/* 5. 互动式空闲教室查询（支持楼栋与可用时长筛选） */}
            {(freeRoomsAll.length > 0 || lessons.some((l) => !!l.location)) && (
              <CollapsiblePanel
                storageKey={KEYS.todayRoomsOpen}
                label={
                  <span className="app-card-label inline-flex items-center gap-1.5">
                    <Icon name="chair" size={12} /> {t('freeRoomsTitle', { n: freeRooms.length })}
                  </span>
                }
              >
                <div className="space-y-2">
                  <div
                    data-testid="free-room-filters"
                    className="flex flex-wrap items-center justify-between gap-1.5"
                  >
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setRoomBuilding('all')}
                        aria-pressed={roomBuilding === 'all'}
                        className={
                          'rounded border px-1.5 py-0.5 text-[10px] transition ' +
                          (roomBuilding === 'all'
                            ? 'border-[var(--accent)] bg-[var(--surface-3)] text-[var(--text-1)] font-medium'
                            : 'border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)]')
                        }
                      >
                        {t('freeRoomsAllBuildings')}
                      </button>
                      {freeRoomBuildings.map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => setRoomBuilding(b)}
                          aria-pressed={roomBuilding === b}
                          className={
                            'rounded border px-1.5 py-0.5 text-[10px] font-mono transition ' +
                            (roomBuilding === b
                              ? 'border-[var(--accent)] bg-[var(--surface-3)] text-[var(--text-1)] font-medium'
                              : 'border-[var(--line)] text-[var(--text-3)] hover:text-[var(--text-1)]')
                          }
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                    <div className="app-seg" role="group">
                      {([60, 120] as const).map((h) => (
                        <button
                          key={h}
                          type="button"
                          aria-pressed={roomHorizon === h}
                          onClick={() => setRoomHorizon(h)}
                          className="px-1.5 py-0.5 text-[10px] font-mono"
                        >
                          {h === 60 ? '≥1h' : '≥2h'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {freeRooms.length === 0 ? (
                    <p className="py-1 text-[11px] text-[var(--text-3)]">
                      {t('freeRoomsNoneMatching')}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {freeRooms.map((r) => {
                        const key = `${r.building}_${r.room}`
                        const watched = isSubscribed(subscriptions, 'room-free', key)
                        return (
                          <div key={key} className="flex items-center gap-2 text-[11px]">
                            <span className="min-w-0 flex-1 truncate">
                              <span className="inline-flex items-center gap-1 font-semibold text-[var(--text-1)]">
                                <Icon name="building" size={12} /> {r.building}
                              </span>
                              <span className="ml-2 text-[var(--text-2)]">
                                {r.room}
                                {r.nextBusyAt && (
                                  <span className="ml-1.5 text-[var(--text-3)]">
                                    · {t('freeUntil', { time: formatBusyAt(r.nextBusyAt, locale) })}
                                  </span>
                                )}
                              </span>
                            </span>
                            {/* 订阅：这间教室空出来就推一条（再点取消） */}
                            <button
                              type="button"
                              onClick={() =>
                                onWatchRoom?.(
                                  key,
                                  // 展示用：楼号与房间号相同时（数据里常这么写）不重复一遍
                                  r.building === r.room ? r.room : `${r.building} ${r.room}`,
                                  !watched,
                                )
                              }
                              aria-pressed={watched}
                              className={
                                'shrink-0 rounded px-1.5 py-0.5 text-[10px] transition ' +
                                (watched
                                  ? 'bg-[var(--tint-info)] text-[var(--info)]'
                                  : 'text-[var(--text-3)] hover:bg-[var(--hover-1)]')
                              }
                              title={t('subRoomHint')}
                            >
                              {watched ? t('subOn') : t('subRoomWatch')}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </CollapsiblePanel>
            )}
        </div>

        {/* 宏观全景：学期进度全景带（横跨双列底置） */}
        <div className="xl:col-span-12 pt-1">
          <SemesterStrip lessons={lessons} tasks={tasks} onOpenWeek={onOpenWeek} />
        </div>
      </div>
    </div>
  )
}

/** Daftar kartu pelajaran (dipakai jadwal hari-ini & pratinjau hari depan). */
function LessonList({
  lessons,
  notices,
  notes,
  locale,
  onSelect,
  now,
}: {
  lessons: Lesson[]
  notices: Record<string, LessonNotice | undefined>
  notes: NotesMap
  locale: string
  onSelect: (id: string) => void
  /** Waktu kini — badge live/opacity untuk jadwal hari-ini; absent → pratinjau. */
  now?: number
}) {
  const { t } = useI18n()
  // 连堂赶课提示：挂在「上一节」下面（空档 + 步行估计）
  const hops = useMemo(() => roomHops(lessons), [lessons])
  return (
    <ul className="space-y-2">
      {lessons.map((l) => {
        const s = new Date(l.start).getTime()
        const e = new Date(l.end).getTime()
        const past = now != null && e <= now
        const live = now != null && s <= now && now < e
        const c = courseColor(l)
        const note = noteForLesson(notes, l)
        return (
          <li key={l.id}>
            <button
              onClick={() => onSelect(l.id)}
              className={
                'lesson-card w-full rounded-md border border-[var(--line)] px-3 py-2 text-left text-xs transition-colors hover:border-[var(--hover-line)] hover:bg-[var(--surface-2)]/40 ' +
                (past ? 'opacity-40 ' : '') +
                (live ? 'border-[var(--ok)]/50 bg-[var(--tint-ok)]/15 ' : 'bg-[var(--surface-1)] ')
              }
              style={courseStyle(c)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium" style={courseTextStyle(c)}>
                    {SOURCE_ICON[l.source]}{' '}
                    {l.code ? <span className="font-mono">{l.code}</span> : null}
                    {l.code ? ' · ' : ''}
                    {displayTitle(l)}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--text-2)]">
                    <span className="truncate font-mono">
                      {l.location || '—'}
                      {l.mergedSources && l.mergedSources.length > 1 ? ' · +' : ''}
                    </span>
                    <LessonNoticeChip notice={notices[l.id]} />
                  </div>
                  <LessonNote note={note} />
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[var(--text-2)]">
                    {formatTime(l.start, locale)}
                    {' – '}
                    {formatTime(l.end, locale)}
                  </div>
                  <div className="mt-0.5 flex items-center justify-end gap-1.5">
                    {l.type && TYPE_META[l.type] && (
                      <span
                        className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-px text-[10px] text-[var(--text-2)] font-mono"
                        title={t(TYPE_META[l.type].key)}
                      >
                        {<Icon name={TYPE_META[l.type].icon} size={11} />} {t(TYPE_META[l.type].key)}
                      </span>
                    )}
                    {live && (
                      <span className="app-badge app-badge-live inline-flex items-center gap-1 text-[10px] font-medium">
                        <Icon name="live" size={11} /> {t('nowOngoing')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
            {(() => {
              const hop = hops.get(l.id)
              if (!hop) return null
              return (
                <div
                  className={
                    'mt-1 flex flex-wrap items-center gap-1.5 px-1 text-[10px] ' +
                    (hop.tight ? 'text-[var(--due)]' : 'text-[var(--text-3)]')
                  }
                >
                  <Icon name="jump" size={11} />
                  <span>
                    {t('hopTo', { loc: hop.to })} · {t('hopGap', { n: hop.gapMin })} ·{' '}
                    {t(hop.crossBuilding ? 'hopWalkCross' : 'hopWalk', { n: hop.walkMin })}
                  </span>
                  {hop.tight && <span className="app-badge app-badge-due px-1.5">{t('hopTight')}</span>}
                </div>
              )
            })()}
          </li>
        )
      })}
    </ul>
  )
}

function formatDueShort(iso: string, locale: string): string {
  return formatDateTime(iso, locale)
}

/** 空闲教室 "直到" 标签：今天则只显示时间，非今天则带日期 "9/16 08:00" */
function formatBusyAt(iso: string, locale: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return formatTime(iso, locale)
  }
  return d.toLocaleString(locale, {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
