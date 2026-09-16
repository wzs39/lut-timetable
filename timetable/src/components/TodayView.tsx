import { useMemo } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { useNow } from '../lib/useNow'
import { courseColor, courseStyle, courseTextStyle } from '../lib/colors'
import { formatTime, nextLessonDay, sameDay } from '../lib/date'
import { TYPE_META } from '../lib/lessonTypes'
import { SOURCE_ICON } from '../lib/sources'
import { displayTitle, buildingOf, roomOf } from '../lib/display'
import { noteForLesson, type NotesMap } from '../lib/notes'
import {
  dueOn,
  isOverdue,
  msUntilDue,
  type Task,
} from '../lib/tasks'
import { normalizeCourseCode } from '../lib/ics'
import { upcomingExams } from '../lib/exams'
import { freeRoomsNow } from '../lib/freeRooms'
import LessonNote from './LessonNote'
import ExternalLink from './ExternalLink'
import TruncatedNote from './TruncatedNote'
import Icon from './Icon'
import CollapsiblePanel from './CollapsiblePanel'
import { KEYS } from '../lib/storage'
import { useCollapse } from '../lib/useCollapse'

interface Props {
  lessons: Lesson[]
  onSelect: (id: string) => void
  /** Catatan kursus: kode+jenis -> teks */
  notes?: NotesMap
  /** Semua tugas/assignment — 今日截止 + 逾期 显示 */
  tasks?: Task[]
  /** 跳转到该课程的日历位置 */
  onJumpToCourse?: (code: string) => void
  /** 打开作业页面 */
  onOpenAssignments?: () => void
}


/** "1 小时 25 分" / "45 分钟" */
function fmtDuration(min: number, t: (k: string, p?: any) => string): string {
  if (min < 60) return t('durationM', { m: min })
  return t('durationHM', { h: Math.floor(min / 60), m: min % 60 })
}

/**
 * 今日视图: 按时间聚合今天的课程 + "下一节课"倒计时。
 * 每 30 秒刷新状态（即将上课 / 正在进行 / 已结束）。
 */
export default function TodayView({ lessons, onSelect, notes = {}, tasks = [], onJumpToCourse, onOpenAssignments }: Props) {
  const { t, locale } = useI18n()
  const now = useNow()
  // 任务区折叠（逾期横幅 + 今日截止），持久化到 localStorage
  const [tasksOpen, toggleTasks] = useCollapse(KEYS.todayTasksOpen)

  const today = useMemo(() => {
    const nowDate = new Date(now)
    return lessons
      .filter((l) => sameDay(new Date(l.start), nowDate))
      .sort((a, b) => a.start.localeCompare(b.start))
  }, [lessons, now])

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

  const todayLabel = new Date(now).toLocaleDateString(
    locale,
    { weekday: 'long', day: 'numeric', month: 'long' },
  )

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

  // Navigazione interna: raggruppa le lezioni di oggi per edificio
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

  return (
    <div className="flex-1 overflow-y-auto p-4 safe-bottom">
      <div className="mx-auto max-w-xl space-y-3">
        <h2 className="text-sm font-semibold text-[var(--text-2)]">{todayLabel}</h2>

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
                title={tasksOpen ? t('toggleHint') : t('toggleHint')}
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
                <span className="shrink-0 text-[var(--text-3)]"><Icon name={tasksOpen ? 'chevron-down' : 'chevron-right'} size={12} /></span>
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
            {tasksOpen && (
              <ul className="space-y-2">
              {dueToday.map((task) => {
                const cc = task.course
                  ? (() => {
                      const code = normalizeCourseCode(task.course)
                      return lessons.some((l) => l.code && normalizeCourseCode(l.code) === code)
                        ? code
                        : null
                    })()
                  : null
                const leftMs = msUntilDue(task, new Date(now))
                const leftMin = leftMs != null ? Math.round(leftMs / 60000) : null
                return (
                  <li
                    key={task.id}
                    className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2"
                  >
                    <div>
                      {/* 标题行：标题 + 倒计时徽章 */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 truncate text-xs font-medium text-[var(--text-1)]">
                          {task.id.startsWith('moodle:') && <span className="mr-1 inline-flex align-[-2px]" title="Moodle"><Icon name="assignment" size={11} /></span>}
                          {task.title}
                        </div>
                        {leftMin != null && (
                          <span className="app-badge app-badge-due">
                            <Icon name="hourglass" size={11} /> {leftMin >= 60 ? t('durationHM', { h: Math.floor(leftMin / 60), m: leftMin % 60 }) : t('durationM', { m: leftMin })}
                          </span>
                        )}
                      </div>
                      {/* 信息行：占满整卡宽度，按钮行尾对齐 */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-2)]">
                        {task.course && <span className="inline-flex items-center gap-1"><Icon name="book" size={11} /> {task.course}</span>}
                        {task.startAt && (
                          <span className="whitespace-nowrap inline-flex items-center gap-1"><Icon name="live" size={10} /> {formatDueFull(task.startAt, locale)}</span>
                        )}
                        {task.dueAt && (
                          <span className="whitespace-nowrap font-medium text-[var(--text-1)]">
                            <span className="inline-flex items-center gap-1"><Icon name="clock" size={11} /> {formatDueFull(task.dueAt, locale)}</span>
                          </span>
                        )}
                        <span className="ml-auto flex items-center gap-1">
                          {task.url && (
                            <ExternalLink
                              href={String(task.url)}
                              className="app-btn-ghost px-1.5 py-1 text-[10px] leading-none"
                              title={t('dueOpenActivity')}
                              stopPropagation
                            >
                              <Icon name="external" size={11} />
                            </ExternalLink>
                          )}
                          {cc && onJumpToCourse && (
                            <button
                              onClick={() => onJumpToCourse(cc)}
                              className="app-btn-ghost px-1.5 py-1 text-[10px] leading-none"
                              title={t('jumpToCourse')}
                            >
                              <Icon name="jump" size={11} />
                            </button>
                          )}
                        </span>
                      </div>
                      {task.note && <TruncatedNote note={task.note} />}
                    </div>
                  </li>
                )
              })}
              </ul>
            )}
          </section>
        )}

        {today.length === 0 ? (
          <p className="py-10 text-center text-xs text-[var(--text-3)]">
            {t('noLessonsToday')}
          </p>
        ) : ended && nextDayLessons.length > 0 ? (
          <section className="animate-modal-in app-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h3 className="app-card-label">{t('nextDayPreview')}</h3>
                <p className="mt-0.5 text-[11px] text-[var(--text-2)]">
                  {nextDay?.toLocaleDateString(locale, {
                    weekday: 'long', day: 'numeric', month: 'long',
                  })}
                </p>
              </div>
              <span className="app-badge">
                {t('nextDayLessonsN', { n: nextDayLessons.length })}
              </span>
            </div>
            <ul className="space-y-2">
              {nextDayLessons.map((l) => {
                const c = courseColor(l)
                const note = noteForLesson(notes, l)
                return (
                  <li key={l.id}>
                    <button
                      onClick={() => onSelect(l.id)}
                      className="lesson-card w-full rounded-lg border px-3 py-2 text-left text-xs transition hover:-translate-y-0.5"
                      style={courseStyle(c)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium" style={courseTextStyle(c)}>
                            {SOURCE_ICON[l.source]} {l.code ? `${l.code} · ` : ''}{displayTitle(l)}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-[var(--text-2)]">
                            {l.location || '—'}
                          </div>
                          <LessonNote note={note} />
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-[var(--text-2)]">
                            {formatTime(l.start, locale)} – {formatTime(l.end, locale)}
                          </div>
                          {l.type && TYPE_META[l.type] && (
                            <span className="mt-0.5 inline-block rounded-full border border-[var(--line)] bg-[var(--surface-1)] px-1.5 py-px text-[10px] text-[var(--text-2)]">
                              {<Icon name={TYPE_META[l.type].icon} size={11} />} {t(TYPE_META[l.type].key)}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : (
          <ul className="space-y-2">
            {today.map((l) => {
              const s = new Date(l.start).getTime()
              const e = new Date(l.end).getTime()
              const past = e <= now
              const live = s <= now && now < e
              const c = courseColor(l)
              const note = noteForLesson(notes, l)
              return (
                <li key={l.id}>
                  <button
                    onClick={() => onSelect(l.id)}
                    className={
                      'lesson-card w-full rounded-lg border px-3 py-2 text-left text-xs transition ' +
                      (past ? 'opacity-40 ' : '') +
                      (live ? 'ring-1 ring-[var(--ok)] ' : '')
                    }
                    style={courseStyle(c)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div
                          className="truncate font-medium"
                          style={courseTextStyle(c)}
                        >
                          {SOURCE_ICON[l.source]}{' '}
                          {l.code ? `${l.code} · ` : ''}
                          {displayTitle(l)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--text-2)] truncate">
                          {l.location || '—'}
                          {l.mergedSources && l.mergedSources.length > 1
                            ? ' · +'
                            : ''}
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
        )}
      </div>
    </div>
  )
}

/** "9月16日周三 16:00" / "Wed, Sep 16 4:00 PM" */
function formatDueFull(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** 紧凑版（横幅用）: "9/13 16:00" */
function formatDueShort(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale, {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
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
