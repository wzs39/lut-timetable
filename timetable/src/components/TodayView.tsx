import { useMemo, useState } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { useNow } from '../lib/useNow'
import { courseColor, courseStyle, courseTextStyle } from '../lib/colors'
import { formatTime, nextLessonDay, sameDay, formatDateTime, formatLongDay } from '../lib/date'
import { TYPE_META } from '../lib/lessonTypes'
import { SOURCE_ICON } from '../lib/sources'
import { displayTitle, buildingOf, roomOf } from '../lib/display'
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
import { KEYS, readString, writeString } from '../lib/storage'
import { useCollapse } from '../lib/useCollapse'
import { loadCachedNotifications, notificationsAsAlertSources } from '../lib/notificationsFeed'
import { noticesForLessons, type LessonNotice } from '../lib/lessonAlerts'

interface Props {
  lessons: Lesson[]
  onSelect: (id: string) => void
  /** Catatan kursus: kode+jenis -> teks */
  notes?: NotesMap
  /** Semua tugas/assignment — 今日截止 + 逾期 显示 */
  tasks?: Task[]
  /** 跳转到该课程的日历位置 */
  onJumpToCourse?: (code: string) => void
  /** 勾选/取消任务（持久化由 App 层处理）；不传则今日页任务行无复选框之外行为差异 */
  onToggleTask?: (task: Task, completed: boolean) => void
  /** 打开作业页面 */
  onOpenAssignments?: () => void
}

/** Dua tab 今日视图: 课程 (jadwal + navigasi) / 动态 (tugas, ujian, ruangan). */
type TodayTab = 'lessons' | 'feed'

const TAB_KEY = KEYS.todayTab

function loadTab(): TodayTab {
  return readString(TAB_KEY) === 'feed' ? 'feed' : 'lessons'
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
export default function TodayView({ lessons, onSelect, notes = {}, tasks = [], onJumpToCourse, onToggleTask, onOpenAssignments }: Props) {
  const { t, locale } = useI18n()
  const now = useNow()
  const [tab, setTab] = useState<TodayTab>(loadTab)
  // 任务区折叠（逾期横幅 + 今日截止），持久化到 localStorage
  const [tasksOpen, toggleTasks] = useCollapse(KEYS.todayTasksOpen)

  const switchTab = (next: TodayTab) => {
    setTab(next)
    writeString(TAB_KEY, next)
  }

  const today = useMemo(() => {
    const nowDate = new Date(now)
    return lessons
      .filter((l) => sameDay(new Date(l.start), nowDate))
      .sort((a, b) => a.start.localeCompare(b.start))
  }, [lessons, now])

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

  const bannerCls =
    banner.tone === 'ongoing'
      ? 'app-card border-[var(--line-ok)] text-[var(--text-1)]'
      : banner.tone === 'next'
        ? 'app-card text-[var(--text-1)]'
        : 'app-card text-[var(--text-3)]'

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
  // 空闲教室：根据已知教室占用推算，未来 1 小时内无课
  const freeRooms = useMemo(
    () => freeRoomsNow(lessons, new Date(now)),
    [lessons, now],
  )

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

  // Feed tab badge: ada sesuatu yang perlu dilihat?
  const feedCount = freeRooms.length + exams.length + overdueTasks.length + dueToday.length

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
      <div className="mx-auto max-w-xl space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--text-2)]">{todayLabel}</h2>
          <div className="app-seg" role="tablist">
            <button role="tab" aria-selected={tab === 'lessons'} onClick={() => switchTab('lessons')} className="px-2.5 py-1 text-[11px]">
              {t('todayTabLessons')}
            </button>
            <button role="tab" aria-selected={tab === 'feed'} onClick={() => switchTab('feed')} className="px-2.5 py-1 text-[11px]">
              {t('todayTabFeed')}
              {feedCount > 0 && <span className="ml-1 tabular-nums text-[var(--text-3)]">{feedCount}</span>}
            </button>
          </div>
        </div>

        {tab === 'lessons' ? (
          <>
            <div className={'px-3 py-2.5 text-xs ' + bannerCls}>
              {banner.lesson ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {banner.tone === 'ongoing' && <Icon name="live" size={11} className="mr-1" />} 
                      {banner.lesson.code ? `${banner.lesson.code} · ` : ''}
                      {banner.lesson.type && TYPE_META[banner.lesson.type] && (
                        <span title={t(TYPE_META[banner.lesson.type].key)}>
                          {<Icon name={TYPE_META[banner.lesson.type].icon} size={11} />}{' '}
                        </span>
                      )}
                      {displayTitle(banner.lesson)}
                    </div>
                    <div className="mt-0.5 text-[11px] opacity-80">
                      {formatTime(banner.lesson.start, locale)}
                      {' – '}
                      {formatTime(banner.lesson.end, locale)}
                      {banner.lesson.location ? ` · ${banner.lesson.location}` : ''}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] font-medium whitespace-nowrap">
                    {banner.text}
                  </span>
                </div>
              ) : (
                <span>{banner.text}</span>
              )}
            </div>

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

            {/* 空态处理：空课日或已结束时优先内嵌明日预览；<p> 兜底只在横幅
                未表达空态时出现（避免同屏两句「今天没有课程」）。 */}
            {today.length === 0 ? (
              nextDayPreview || (banner.tone !== 'empty' ? (
                <p className="py-10 text-center text-xs text-[var(--text-3)]">{t('noLessonsToday')}</p>
              ) : null)
            ) : ended && nextDayPreview ? (
              nextDayPreview
            ) : (
              <LessonList lessons={today} notices={notices} notes={notes} locale={locale} onSelect={onSelect} now={now} />
            )}
          </>
        ) : (
          <>
            {/* ---- 空闲教室 ---- */}
            {freeRooms.length > 0 && (
              <CollapsiblePanel
                storageKey={KEYS.todayRoomsOpen}
                label={
                  <span className="app-card-label inline-flex items-center gap-1.5">
                    <Icon name="chair" size={12} /> {t('freeRoomsTitle', { n: freeRooms.length })}
                  </span>
                }
              >
                <div className="space-y-1">
                  {freeRooms.map((r) => (
                    <div key={`${r.building}_${r.room}`} className="text-[11px]">
                      <span className="font-semibold text-[var(--text-1)] inline-flex items-center gap-1"><Icon name="building" size={12} /> {r.building}</span>
                      <span className="ml-2 text-[var(--text-2)]">
                        {r.room}
                        {r.nextBusyAt && (
                          <span className="ml-1.5 text-[var(--text-3)]">
                            · {t('freeUntil', { time: formatBusyAt(r.nextBusyAt, locale) })}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </CollapsiblePanel>
            )}

            {/* ---- 逾期任务红色横幅 ---- */}
            {overdueTasks.length > 0 && (
              <section className="animate-modal-in app-card">
                <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <button
                    onClick={toggleTasks}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    title={t('toggleHint')}
                  >
                    <span className="shrink-0 text-[var(--text-3)]"><Icon name={tasksOpen ? 'chevron-down' : 'chevron-right'} size={12} /></span>
                    <span className="app-badge-overdue truncate text-xs font-semibold inline-flex items-center gap-1.5">
                      <Icon name="warn" size={13} /> {t('dueOverdueBanner', { n: overdueTasks.length })}
                    </span>
                  </button>
                  <button
                    onClick={onOpenAssignments}
                    className="app-btn-overdue shrink-0 text-[11px]"
                  >
                    {t('dueGoAssign')} ›
                  </button>
                </div>
                {tasksOpen && (
                  <div className="mt-1 space-y-0.5 border-t border-[var(--danger)] px-3 pb-2.5 pt-2">
                    {overdueTasks.slice(0, 3).map((task) => (
                      <div key={task.id} className="app-badge-overdue truncate text-[11px]">
                        · {task.title}
                        {task.dueAt && ` · ${formatDueShort(task.dueAt, locale)}`}
                      </div>
                    ))}
                    {overdueTasks.length > 3 && (
                      <div className="text-[10px] text-[var(--text-3)]">{t('dueMoreN', { n: overdueTasks.length - 3 })}</div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* ---- 考试倒计时 ---- */}
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

            {/* ---- 今日截止任务 ---- */}
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
          </>
        )}
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
                'lesson-card w-full rounded-lg border px-3 py-2 text-left text-xs transition hover:-translate-y-0.5 ' +
                (past ? 'opacity-40 ' : '') +
                (live ? 'ring-1 ring-[var(--ok)] ' : '')
              }
              style={courseStyle(c)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium" style={courseTextStyle(c)}>
                    {SOURCE_ICON[l.source]}{' '}
                    {l.code ? `${l.code} · ` : ''}
                    {displayTitle(l)}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--text-2)]">
                    <span className="truncate">
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
                        className="rounded-full border border-[var(--line)] bg-[var(--surface-1)] px-1.5 py-px text-[10px] text-[var(--text-2)]"
                        title={t(TYPE_META[l.type].key)}
                      >
                        {<Icon name={TYPE_META[l.type].icon} size={11} />} {t(TYPE_META[l.type].key)}
                      </span>
                    )}
                    {live && (
                      <span className="app-badge-live inline-flex items-center gap-1 text-[10px] font-medium">
                        <Icon name="live" size={11} /> {t('nowOngoing')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
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
