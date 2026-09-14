import { useEffect, useMemo, useState } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { courseColor, courseColorByKey } from '../lib/colors'
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
import LessonNote from './LessonNote'
import TruncatedNote from './TruncatedNote'

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
  const { t, lang } = useI18n()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

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
      ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
      : banner.tone === 'next'
        ? 'border-sky-500/60 bg-sky-500/10 text-sky-300'
        : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'

  const todayLabel = new Date(now).toLocaleDateString(
    lang === 'zh' ? 'zh-CN' : 'en-US',
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

  // Navigazione interna: raggruppa le lezioni di oggi per edificio
  const buildings = useMemo(() => {
    const map = new Map<string, { room: string; time: string; live: boolean }[]>()
    for (const l of today) {
      const b = buildingOf(l.location)
      if (!b) continue
      const arr = map.get(b) || []
      arr.push({
        room: roomOf(l.location as string),
        time: formatTime(l.start, lang === 'zh' ? 'zh-CN' : 'en-US'),
        live: new Date(l.start).getTime() <= now && now < new Date(l.end).getTime(),
      })
      map.set(b, arr)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [today, now, lang])

  return (
    <div className="flex-1 overflow-y-auto p-4 safe-bottom">
      <div className="mx-auto max-w-xl space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">{todayLabel}</h2>

        <div className={'rounded-lg border px-3 py-2.5 text-xs ' + bannerCls}>
          {banner.lesson ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {banner.tone === 'ongoing' ? '▶ ' : ''}
                  {banner.lesson.code ? `${banner.lesson.code} · ` : ''}
                  {banner.lesson.type && TYPE_META[banner.lesson.type] && (
                    <span title={t(TYPE_META[banner.lesson.type].key)}>
                      {TYPE_META[banner.lesson.type].icon}{' '}
                    </span>
                  )}
                  {displayTitle(banner.lesson)}
                </div>
                <div className="mt-0.5 text-[11px] opacity-80">
                  {formatTime(banner.lesson.start, lang === 'zh' ? 'zh-CN' : 'en-US')}
                  {' – '}
                  {formatTime(banner.lesson.end, lang === 'zh' ? 'zh-CN' : 'en-US')}
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
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              🧭 {t('indoorNav')}
            </div>
            <div className="space-y-1">
              {buildings.map(([building, items]) => (
                <div key={building} className="text-[11px]">
                  <span className="font-semibold text-zinc-200">🏢 {building}</span>
                  <span className="ml-2 text-zinc-400">
                    {items.map((i) => `${i.room} ${i.time}${i.live ? ' ▶' : ''}`).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---- 逾期任务红色横幅 ---- */}
        {overdueTasks.length > 0 && (
          <button
            onClick={onOpenAssignments}
            className="animate-modal-in w-full rounded-lg border border-rose-500/60 bg-rose-500/10 px-3 py-2.5 text-left transition hover:bg-rose-500/20"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-rose-300">
                ⚠ {t('dueOverdueBanner', { n: overdueTasks.length })}
              </span>
              <span className="shrink-0 text-[11px] text-rose-300/80">{t('dueGoAssign')} ›</span>
            </div>
            <div className="mt-1 space-y-0.5">
              {overdueTasks.slice(0, 3).map((task) => (
                <div key={task.id} className="truncate text-[11px] text-rose-200/90">
                  · {task.title}
                  {task.dueAt && ` · ${formatDueShort(task.dueAt, lang)}`}
                </div>
              ))}
              {overdueTasks.length > 3 && (
                <div className="text-[10px] text-rose-300/70">{t('dueMoreN', { n: overdueTasks.length - 3 })}</div>
              )}
            </div>
          </button>
        )}

        {/* ---- 今日截止任务 ---- */}
        {dueToday.length > 0 && (
          <section className="animate-modal-in rounded-xl border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-amber-200">
                ⏰ {t('dueTodayTitle', { n: dueToday.length })}
              </h3>
              <button
                onClick={onOpenAssignments}
                className="shrink-0 text-[11px] text-amber-300/80 hover:text-amber-200"
              >
                {t('dueGoAssign')} ›
              </button>
            </div>
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
                const c = cc ? courseColorByKey(cc) : null
                const leftMs = msUntilDue(task, new Date(now))
                const leftMin = leftMs != null ? Math.round(leftMs / 60000) : null
                return (
                  <li
                    key={task.id}
                    className="rounded-lg border px-3 py-2"
                    style={
                      c
                        ? { background: c.bg, borderColor: c.border }
                        : { background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.35)' }
                    }
                  >
                    <div>
                      {/* 标题行：标题 + 倒计时徽章 */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 truncate text-xs font-medium" style={{ color: c?.text ?? '#fde68a' }}>
                          {task.id.startsWith('moodle:') && <span className="mr-1" title="Moodle">🟠</span>}
                          {task.title}
                        </div>
                        {leftMin != null && (
                          <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-200 whitespace-nowrap">
                            ⏳ {leftMin >= 60 ? t('durationHM', { h: Math.floor(leftMin / 60), m: leftMin % 60 }) : t('durationM', { m: leftMin })}
                          </span>
                        )}
                      </div>
                      {/* 信息行：占满整卡宽度，按钮行尾对齐 */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-300/90">
                        {task.course && <span>📚 {task.course}</span>}
                        {task.startAt && (
                          <span className="whitespace-nowrap">▶ {formatDueFull(task.startAt, lang)}</span>
                        )}
                        {task.dueAt && (
                          <span className="whitespace-nowrap font-medium text-amber-200">
                            ⏰ {formatDueFull(task.dueAt, lang)}
                          </span>
                        )}
                        <span className="ml-auto flex items-center gap-1">
                          {task.url && (
                            <a
                              href={task.url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="rounded bg-orange-600/80 px-1.5 py-1 text-[10px] leading-none text-white hover:bg-orange-500"
                              title={t('dueOpenActivity')}
                            >
                              ↗
                            </a>
                          )}
                          {cc && onJumpToCourse && (
                            <button
                              onClick={() => onJumpToCourse(cc)}
                              className="rounded bg-zinc-700 px-1.5 py-1 text-[10px] leading-none hover:bg-zinc-600"
                              title={t('jumpToCourse')}
                            >
                              ↦
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
          </section>
        )}

        {today.length === 0 ? (
          <p className="py-10 text-center text-xs text-zinc-600">
            {t('noLessonsToday')}
          </p>
        ) : ended && nextDayLessons.length > 0 ? (
          <section className="animate-modal-in rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-sky-200">{t('nextDayPreview')}</h3>
                <p className="mt-0.5 text-[11px] text-sky-300/70">
                  {nextDay?.toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
                    weekday: 'long', day: 'numeric', month: 'long',
                  })}
                </p>
              </div>
              <span className="rounded-full bg-sky-500/15 px-2 py-1 text-[10px] text-sky-300">
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
                      className="w-full rounded-lg border px-3 py-2 text-left text-xs transition hover:-translate-y-0.5 hover:brightness-125"
                      style={{ background: c.bg, borderColor: c.border }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium" style={{ color: c.text }}>
                            {SOURCE_ICON[l.source]} {l.code ? `${l.code} · ` : ''}{displayTitle(l)}
                          </div>
                          <div className="mt-0.5 truncate text-[11px] text-zinc-400">
                            {l.location || '—'}
                          </div>
                          <LessonNote note={note} />
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-mono text-zinc-300">
                            {formatTime(l.start, lang === 'zh' ? 'zh-CN' : 'en-US')} – {formatTime(l.end, lang === 'zh' ? 'zh-CN' : 'en-US')}
                          </div>
                          {l.type && TYPE_META[l.type] && (
                            <span className="mt-0.5 inline-block rounded-full border border-zinc-600 bg-zinc-900/50 px-1.5 py-px text-[10px] text-zinc-300">
                              {TYPE_META[l.type].icon} {t(TYPE_META[l.type].key)}
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
                      'w-full rounded-lg border px-3 py-2 text-left text-xs transition hover:brightness-125 ' +
                      (past ? 'opacity-40 ' : '') +
                      (live ? 'ring-1 ring-emerald-400/70 ' : '')
                    }
                    style={{ background: c.bg, borderColor: c.border }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div
                          className="truncate font-medium"
                          style={{ color: c.text }}
                        >
                          {SOURCE_ICON[l.source]}{' '}
                          {l.code ? `${l.code} · ` : ''}
                          {displayTitle(l)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-zinc-400 truncate">
                          {l.location || '—'}
                          {l.mergedSources && l.mergedSources.length > 1
                            ? ' · 🔵+🟣'
                            : ''}
                        </div>
                        <LessonNote note={note} />
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-zinc-300">
                          {formatTime(l.start, lang === 'zh' ? 'zh-CN' : 'en-US')}
                          {' – '}
                          {formatTime(l.end, lang === 'zh' ? 'zh-CN' : 'en-US')}
                        </div>
                        <div className="mt-0.5 flex items-center justify-end gap-1.5">
                          {l.type && TYPE_META[l.type] && (
                            <span
                              className="rounded-full border border-zinc-600 bg-zinc-900/50 px-1.5 py-px text-[10px] text-zinc-300"
                              title={t(TYPE_META[l.type].key)}
                            >
                              {TYPE_META[l.type].icon} {t(TYPE_META[l.type].key)}
                            </span>
                          )}
                          {live && (
                            <span className="text-[10px] font-medium text-emerald-300">
                              ▶ {t('nowOngoing')}
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
function formatDueFull(iso: string, lang: 'zh' | 'en'): string {
  return new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
  })
}

/** 紧凑版（横幅用）: "9/13 16:00" */
function formatDueShort(iso: string, lang: 'zh' | 'en'): string {
  return new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
