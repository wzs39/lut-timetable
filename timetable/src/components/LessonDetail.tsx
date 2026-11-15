import { useEffect, useMemo, useState } from 'react'
import { useExitAnimation } from '../lib/useExitAnimation'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import Icon from './Icon'
import { resolveSisuCourseUrl } from '../lib/sisuCourse'
import { loadIdentityIndex } from '../lib/courseIdentity'
import { TYPE_META } from '../lib/lessonTypes'
import { displayTitle, buildingOf, roomOf } from '../lib/display'
import { formatDay, formatTime } from '../lib/date'
import { normalizeCourseCode } from '../lib/ics'
import { loadNotes, scopeText, type NotesMap } from '../lib/notes'
import { isOverdue, pendingTasks, type Task } from '../lib/tasks'
import { openExternal } from '../lib/openExternal'
import ExternalLink from './ExternalLink'
import AttendanceControl from './AttendanceControl'
import { loadAttendance } from '../lib/attendance'
import {
  buildCourseGraph,
  findUnifiedCourse,
  type CourseGraph,
  type UnifiedCourseNode,
} from '../lib/courseGraph'
import { buildCourseDossier } from '../lib/courseDossier'
import { loadGradesSnapshot, type CourseGrades } from '../lib/grades'
import type { CourseSection } from '../lib/contents'
import type { LutGradeLevel } from '../lib/gradeCalc'
import { usePomodoro } from '../hooks/usePomodoro'

/** 同一天内的翻课导航（App 用 date.sameDayQueue 算出位置后传入） */
export interface LessonNav {
  /** 该天内的序号，0 起 */
  index: number
  total: number
  onPrev?: () => void
  onNext?: () => void
}

interface Props {
  lesson?: Lesson | null
  /** 支持无课表 Lesson 对象时直接按课程代码或 UnifiedCourseNode 打开右侧全景档案 */
  courseCode?: string | null
  courseNode?: UnifiedCourseNode | null
  courseGraph?: CourseGraph
  grades?: CourseGrades[] | null
  sections?: CourseSection[]
  notesMap?: NotesMap
  onToggleTask?: (task: Task, completed: boolean) => void
  onSave?: (id: string, patch: Partial<Lesson>) => void
  onDelete?: (id: string) => void
  /** 同一天的上一节/下一节（不传则不显示翻课按钮） */
  nav?: LessonNav
  /** URL halaman TimeEdit sumber lesson ini (bila ada) */
  timeEditUrl?: string
  /** Sembunyikan tanpa menghapus (tanpa tombstone) */
  onHide?: (id: string) => void
  onClose: () => void
  /** Catatan kursus (berlaku untuk semua pelajaran dengan kode+jenis yang sama) */
  note?: string
  onSaveNote?: (text: string) => void
  onRemoveNote?: () => void
  /** Semua tugas/assignment — untuk menampilkan yang terkait kode kursus ini */
  assignments?: Task[]
  /** Buka panel Tugas (from lesson detail) */
  onOpenAssignments?: () => void
  /** 已订阅「这门课有变动就提醒我」 */
  watched?: boolean
  /** 切换订阅（不传则不显示该按钮） */
  onWatch?: (on: boolean) => void
  /** 全部可见课时：出勤控制用它算课程级出勤率 */
  allLessons?: Lesson[]
}

function toTimeInput(iso: string): string {
  const d = new Date(iso)
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}`
}

export default function LessonDetail({
  lesson,
  courseCode,
  courseNode,
  courseGraph,
  grades,
  sections,
  notesMap,
  onToggleTask,
  onSave,
  onDelete,
  nav,
  timeEditUrl,
  onHide,
  watched,
  onWatch,
  onClose,
  note,
  onSaveNote,
  onRemoveNote,
  assignments,
  onOpenAssignments,
  allLessons,
}: Props) {
  const { t, locale } = useI18n()
  const pomodoro = usePomodoro()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(lesson?.title ?? courseNode?.title ?? courseCode ?? '')
  const [code, setCode] = useState(lesson?.code || courseNode?.code || courseCode || '')
  const [location, setLocation] = useState(lesson?.location || '')
  const [date, setDate] = useState(lesson ? lesson.start.slice(0, 10) : '')
  const [start, setStart] = useState(lesson ? toTimeInput(lesson.start) : '08:00')
  const [end, setEnd] = useState(lesson ? toTimeInput(lesson.end) : '10:00')
  const [error, setError] = useState<string | null>(null)
  const [sisuState, setSisuState] = useState<'idle' | 'loading' | 'notfound'>('idle')
  const [noteEdit, setNoteEdit] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [targetGrade, setTargetGrade] = useState<LutGradeLevel>(4)

  // 解析统一课程节点（支持传入 courseNode、courseGraph 或自动从当前上下文构建）
  const resolvedNode = useMemo<UnifiedCourseNode>(() => {
    if (courseNode) return courseNode
    const targetCode = lesson?.code || courseCode || ''
    const targetTitle = lesson ? displayTitle(lesson) : courseCode || ''
    if (courseGraph) {
      const found = findUnifiedCourse(courseGraph, {
        code: targetCode || undefined,
        title: targetTitle || undefined,
      })
      if (found) return found
    }
    const effectiveLessons = allLessons && allLessons.length > 0 ? allLessons : lesson ? [lesson] : []
    const effectiveGrades = grades ?? loadGradesSnapshot()?.courses ?? []
    const g = buildCourseGraph({
      lessons: effectiveLessons,
      tasks: assignments ?? [],
      grades: effectiveGrades,
    })
    const matched = findUnifiedCourse(g, {
      code: targetCode || undefined,
      title: targetTitle || undefined,
    })
    if (matched) return matched
    const normCode = targetCode ? normalizeCourseCode(targetCode) : ''
    return {
      key: normCode || targetTitle || 'course',
      code: normCode,
      title: targetTitle || normCode || 'Course',
      sources: lesson ? [lesson.source] : ['sisu'],
      periods: [],
      lessons: lesson ? [lesson] : [],
      teachers: [],
      locations: lesson?.location ? [lesson.location] : [],
      tasks: [],
      pendingTaskCount: 0,
      studyBlocks: [],
      discrepancies: [],
    }
  }, [courseNode, courseGraph, lesson, courseCode, allLessons, assignments, grades])

  const dossier = useMemo(
    () =>
      buildCourseDossier(resolvedNode, {
        attendanceLog: loadAttendance(),
        notesMap: notesMap ?? loadNotes(),
        sections,
        targetGradeLevel: targetGrade,
        focusMinutesByCourse: pomodoro.focusMinutesByCourse,
      }),
    [resolvedNode, notesMap, sections, targetGrade, pomodoro.focusMinutesByCourse],
  )

  const effectiveCode = lesson?.code || resolvedNode.code || courseCode || ''

  // Tabel identitas: kode jadwal → courseid Moodle (tulis saat enrol sync).
  const moodleCourseId = useMemo(
    () =>
      resolvedNode.moodleCourseId ??
      (effectiveCode ? loadIdentityIndex().idForCode(effectiveCode) : null),
    [resolvedNode.moodleCourseId, effectiveCode],
  )

  const isMerged = (lesson?.mergedSources?.length ?? 0) > 1
  const sourceNote = lesson
    ? isMerged
      ? t('mergedNote')
      : lesson.source === 'sisu'
        ? t('sisuNote')
        : lesson.source === 'timeedit'
          ? t('timeeditNote')
          : t('manualNote')
    : t('dossierTriSource')

  // Buka lesson/course lain: kembali ke mode lihat + reset form
  useEffect(() => {
    setEditing(false)
    setTitle(lesson?.title ?? resolvedNode.title)
    setCode(lesson?.code || resolvedNode.code || '')
    setLocation(lesson?.location || '')
    setDate(lesson ? lesson.start.slice(0, 10) : '')
    setStart(lesson ? toTimeInput(lesson.start) : '08:00')
    setEnd(lesson ? toTimeInput(lesson.end) : '10:00')
    setError(null)
    setSisuState('idle')
    setNoteEdit(false)
    setNoteText(note || '')
  }, [lesson, resolvedNode.title, resolvedNode.code, note])

  const startEdit = () => {
    if (!lesson) return
    setTitle(lesson.title)
    setEditing(true)
    setError(null)
  }

  const handleSave = () => {
    if (!lesson || !onSave) return
    const startDt = new Date(`${date}T${start}:00`)
    const endDt = new Date(`${date}T${end}:00`)
    if (!title.trim()) return setError(t('errNameRequired'))
    if (isNaN(startDt.getTime()) || isNaN(endDt.getTime()))
      return setError(t('errInvalidDate'))
    if (endDt <= startDt) return setError(t('errEndBeforeStart'))
    onSave(lesson.id, {
      title: title.trim(),
      code: code.trim() || undefined,
      location: location.trim() || undefined,
      start: startDt.toISOString(),
      end: endDt.toISOString(),
    })
    requestClose()
  }

  const handleDelete = () => {
    if (!lesson || !onDelete) return
    if (confirm(t('deleteConfirm', { t: lesson.title }))) {
      onDelete(lesson.id)
      requestClose()
    }
  }

  const openSisu = async () => {
    if (!effectiveCode) return
    setSisuState('loading')
    try {
      const url = await resolveSisuCourseUrl(effectiveCode)
      openExternal(url)
      setSisuState('idle')
    } catch {
      setSisuState('notfound')
    }
  }

  // Semua jalur tutup (✕ / ESC / klik luar) lewat satu frame keluar.
  const [closing, requestClose] = useExitAnimation(onClose)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const inField =
      e.target instanceof HTMLElement &&
      (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)
    if (!inField && !editing && nav && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const go = e.key === 'ArrowLeft' ? nav.onPrev : nav.onNext
      if (go) {
        e.preventDefault()
        go()
        return
      }
    }
    if (e.key === 'Escape') {
      if (editing) setEditing(false)
      else requestClose()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && editing) handleSave()
  }

  const inputCls = 'mt-0.5 app-input'

  const startD = lesson ? new Date(lesson.start) : null
  const endD = lesson ? new Date(lesson.end) : null
  const durMin =
    startD && endD ? Math.max(0, Math.round((endD.getTime() - startD.getTime()) / 60000)) : 0
  const durText =
    durMin < 60
      ? t('durationM', { m: durMin })
      : t('durationHM', { h: Math.floor(durMin / 60), m: durMin % 60 })

  const noteScope = scopeText(
    effectiveCode ? normalizeCourseCode(effectiveCode) : lesson ? displayTitle(lesson) : resolvedNode.title,
    lesson?.type && TYPE_META[lesson.type]
      ? t(TYPE_META[lesson.type].key)
      : t('noteScopeAny'),
  )

  return (
    <div
      className={
        (closing ? 'animate-fade-out ' : 'animate-fade-in ') +
        // 自适应：窄屏底部面板（从下浮入），≥768px 右侧侧栏（从右滑入）——
        // master-detail：详情贴着网格打开，不再遮住整张课表。
        'fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-stretch md:justify-end'
      }
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div
        data-testid="course-dossier-drawer"
        className={
          (closing ? 'animate-sheet-out ' : 'animate-sheet-in ') +
          'dossier-drawer w-full max-h-[86vh] overflow-y-auto rounded-t-2xl border border-[var(--line)] bg-[var(--surface-1)] p-4 shadow-2xl ' +
          'md:h-full md:max-h-none md:max-w-[440px] md:rounded-none md:rounded-l-2xl'
        }
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="led-dot led-info" aria-hidden="true" />
            <h3 className="text-sm font-semibold">
              {editing ? t('editTitle') : lesson ? t('detailTitle') : t('dossierTitle')}
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            {!editing && nav && nav.total > 1 && (
              <>
                <button
                  onClick={nav.onPrev}
                  disabled={!nav.onPrev}
                  className="app-btn px-1.5 py-0.5 disabled:opacity-40"
                  title={t('prevLesson')}
                >
                  <Icon name="chevron-left" size={12} />
                </button>
                <span className="text-[10px] tabular-nums text-[var(--text-3)]">
                  {t('lessonPosition', { i: nav.index + 1, n: nav.total })}
                </span>
                <button
                  onClick={nav.onNext}
                  disabled={!nav.onNext}
                  className="app-btn px-1.5 py-0.5 disabled:opacity-40"
                  title={t('nextLesson')}
                >
                  <Icon name="chevron-right" size={12} />
                </button>
              </>
            )}
            <button
              onClick={requestClose}
              className="text-[var(--text-3)] hover:text-[var(--text-1)]"
              title={t('closeHint')}
            >
              <Icon name="close" size={13} />
            </button>
          </div>
        </div>

        {editing ? (
          <>
            <div className="space-y-2 text-xs">
              <div className="text-[11px] text-[var(--text-3)]">{sourceNote}</div>

              <label className="block">
                <span className="text-[var(--text-3)]">{t('name')}</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  autoFocus
                  className={inputCls}
                />
              </label>

              <div className="flex gap-2">
                <label className="block w-1/2">
                  <span className="text-[var(--text-3)]">{t('code')}</span>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block w-1/2">
                  <span className="text-[var(--text-3)]">{t('location')}</span>
                  <input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className={inputCls}
                  />
                </label>
              </div>

              <div className="flex gap-2">
                <label className="block w-2/4">
                  <span className="text-[var(--text-3)]">{t('date')}</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block w-1/4">
                  <span className="text-[var(--text-3)]">{t('start')}</span>
                  <input
                    type="time"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className={inputCls}
                  />
                </label>
                <label className="block w-1/4">
                  <span className="text-[var(--text-3)]">{t('end')}</span>
                  <input
                    type="time"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className={inputCls}
                  />
                </label>
              </div>

              {error && <p className="text-[11px] text-[var(--danger)]">{error}</p>}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setEditing(false)}
                className="flex-1 rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--hover-1)]"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleSave}
                className="app-fill-info flex-[2] rounded-md px-3 py-1.5 text-xs"
              >
                {t('save')}
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] text-[var(--text-3)]">
              {t('shortcuts')}
            </p>
          </>
        ) : (
          <>
            {/* --- Mode lihat: Unified Course Dossier + Lesson Detail --- */}
            <div className="space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-[var(--text-3)]">
                <div>
                  {sourceNote}
                  {lesson?.type && TYPE_META[lesson.type] && (
                    <span className="ml-1">
                      · {<Icon name={TYPE_META[lesson.type].icon} size={11} />} {t(TYPE_META[lesson.type].key)}
                    </span>
                  )}
                </div>
                {/* 1. Tri-source identity badges (SISU · TimeEdit · Moodle) */}
                <div className="flex items-center gap-1" data-testid="dossier-source-badges">
                  {(
                    [
                      ['sisu', 'SISU'],
                      ['timeedit', 'TimeEdit'],
                      ['moodle', 'Moodle'],
                    ] as const
                  ).map(([src, label]) => {
                    const active = resolvedNode.sources.includes(src)
                    return (
                      <span
                        key={src}
                        className={
                          'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ' +
                          (active
                            ? 'border-[var(--line-info)] bg-[var(--tint-info)] text-[var(--text-1)]'
                            : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-3)] opacity-60')
                        }
                      >
                        <span className={'led-dot ' + (active ? 'led-ok' : '')} />
                        {label}
                      </span>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2">
                <div className="text-sm font-medium leading-snug text-[var(--text-1)]">
                  {lesson ? displayTitle(lesson) : resolvedNode.title}
                </div>
                {resolvedNode.nameFi && (
                  <div className="mt-0.5 text-[11px] text-[var(--text-3)]">{resolvedNode.nameFi}</div>
                )}
                {(resolvedNode.credits != null || resolvedNode.periods.length > 0) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-2)]">
                    {resolvedNode.credits != null && (
                      <span className="num font-mono tabular-nums">
                        {t('dossierCreditsHours', {
                          credits: resolvedNode.credits,
                          hours: resolvedNode.totalStudyHours ?? Math.round(resolvedNode.credits * 27),
                        })}
                      </span>
                    )}
                    {resolvedNode.periods.length > 0 && (
                      <span className="rounded border border-[var(--line)] bg-[var(--surface-1)] px-1.5 py-0.5 font-mono text-[10px]">
                        {t('dossierPeriods', { periods: resolvedNode.periods.join(' · ') })}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Cross-source discrepancy alerts */}
              {resolvedNode.discrepancies.length > 0 && (
                <div
                  data-testid="dossier-discrepancies"
                  className="rounded-md border border-[var(--line-due)] bg-[var(--tint-due)] px-2.5 py-2 space-y-1"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--due)]">
                    {t('dossierDiscrepancyTitle')}
                  </div>
                  {resolvedNode.discrepancies.map((d, idx) => (
                    <div key={`${d.kind}-${idx}`} className="flex items-center gap-1.5 text-[11px] text-[var(--due)]">
                      <span className="led-dot led-warn" />
                      <span>{t(d.messageKey as Parameters<typeof t>[0], d.meta)}</span>
                    </div>
                  ))}
                </div>
              )}

              <dl className="space-y-1.5">
                {effectiveCode && (
                  <div className="flex gap-2">
                    <dt className="w-14 shrink-0 text-[var(--text-3)]">{t('code')}</dt>
                    <dd className="num font-mono tabular-nums">{effectiveCode}</dd>
                  </div>
                )}
                {lesson && startD && (
                  <>
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-[var(--text-3)]">{t('date')}</dt>
                      <dd>{formatDay(startD, locale)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-[var(--text-3)]">{t('time')}</dt>
                      <dd className="num tabular-nums">
                        {formatTime(lesson.start, locale)} –{' '}
                        {formatTime(lesson.end, locale)}
                        <span className="ml-1 text-[var(--text-3)]">({durText})</span>
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-14 shrink-0 text-[var(--text-3)]">
                        {t('location')}
                      </dt>
                      <dd className={lesson.location ? '' : 'text-[var(--text-3)]'}>
                        {lesson.location || '—'}
                      </dd>
                    </div>
                    {buildingOf(lesson.location) && (
                      <div className="flex gap-2">
                        <dt className="w-14 shrink-0 text-[var(--text-3)] inline-flex"><Icon name="compass" size={12} className="mt-0.5" /></dt>
                        <dd>
                          <span className="font-medium inline-flex items-center gap-1"><Icon name="building" size={12} /> {buildingOf(lesson.location)}</span>
                          <span className="ml-2 text-[var(--text-2)]">
                            {t('room')}: {roomOf(lesson.location as string)}
                          </span>
                        </dd>
                      </div>
                    )}
                  </>
                )}
              </dl>

              {/* 2. Attendance rate & AttendanceControl + upcoming/past sessions */}
              {lesson && <AttendanceControl lesson={lesson} lessons={allLessons} />}
              {(dossier.recentAndUpcomingLessons.upcoming.length > 0 ||
                dossier.recentAndUpcomingLessons.past.length > 0) && (
                <div className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2">
                  <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                    <span>{t('dossierScheduleTitle')}</span>
                    <span className="num font-mono tabular-nums text-[var(--text-2)]">
                      {t('dossierUpcomingSessions', { n: dossier.recentAndUpcomingLessons.upcoming.length })} ·{' '}
                      {t('dossierPastSessions', { n: dossier.recentAndUpcomingLessons.past.length })}
                    </span>
                  </div>
                  {dossier.recentAndUpcomingLessons.upcoming.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      {dossier.recentAndUpcomingLessons.upcoming.slice(0, 3).map((s) => (
                        <div key={s.id} className="flex items-center justify-between text-[11px] text-[var(--text-2)]">
                          <span className="num font-mono tabular-nums">
                            {formatDay(new Date(s.start), locale)} {formatTime(s.start, locale)}
                          </span>
                          <span className="truncate text-[var(--text-3)]">{s.location || '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {moodleCourseId && (
                <>
                  <ExternalLink
                    href={`https://moodle.lut.fi/course/view.php?id=${moodleCourseId}`}
                    className="block text-[11px] text-[var(--info)] hover:text-[var(--info)] hover:underline"
                  >
                    {t('viewMoodleCourse')}
                  </ExternalLink>
                  <ExternalLink
                    href={`https://moodle.lut.fi/grade/report/user/index.php?id=${moodleCourseId}`}
                    className="block text-[11px] text-[var(--info)] hover:text-[var(--info)] hover:underline"
                  >
                    {t('viewMoodleGrades')}
                  </ExternalLink>
                </>
              )}
              {effectiveCode && (
                <button
                  onClick={openSisu}
                  className="text-[11px] text-[var(--info)] hover:text-[var(--info)] hover:underline"
                >
                  {sisuState === 'loading'
                    ? t('sisuLookingUp')
                    : sisuState === 'notfound'
                      ? t('sisuNotFound')
                      : t('viewSisu')}
                </button>
              )}
              {timeEditUrl && (
                <ExternalLink
                  href={timeEditUrl}
                  className="block text-[11px] text-[var(--violet)] hover:text-[var(--violet)] hover:underline"
                >
                  {t('viewTimeEdit')}
                </ExternalLink>
              )}

              {/* 3. Pending assignments with inline completion checkboxes */}
              {(assignments || dossier.tasks.pending.length > 0) && (() => {
                const codeNorm = effectiveCode ? normalizeCourseCode(effectiveCode) : null
                const related =
                  dossier.tasks.pending.length > 0
                    ? dossier.tasks.pending
                    : codeNorm && assignments
                      ? pendingTasks(assignments).filter(
                          (task) =>
                            task.course &&
                            (task.course.toUpperCase().includes(codeNorm) ||
                              normalizeCourseCode(task.course) === codeNorm),
                        )
                      : []
                if (!onOpenAssignments && related.length === 0) return null
                return (
                  <div className="rounded-md border border-[var(--line-ok)] bg-[var(--tint-ok)] px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={onOpenAssignments}
                        className="text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--ok)] hover:underline"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Icon name="graduation" size={12} />{' '}
                          {related.length > 0
                            ? t('lessonAssignments', { n: related.length })
                            : t('lessonAssignmentsEmpty')}
                        </span>
                      </button>
                    </div>
                    {related.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {related.slice(0, 5).map((task) => (
                          <li key={task.id} className="flex items-center gap-2 text-[11px] text-[var(--ok)]">
                            {onToggleTask ? (
                              <input
                                type="checkbox"
                                data-testid={`dossier-task-checkbox-${task.id}`}
                                checked={!!task.completed}
                                aria-label={task.title}
                                onChange={(e) => onToggleTask(task, e.target.checked)}
                                className="accent-[var(--ok)]"
                              />
                            ) : (
                              <span>·</span>
                            )}
                            <span className="min-w-0 flex-1 truncate">
                              {task.title}
                              {isOverdue(task) && (
                                <span className="ml-1 text-[var(--danger)]">· {t('taskOverdue')}</span>
                              )}
                            </span>
                          </li>
                        ))}
                        {related.length > 5 && (
                          <li className="text-[10px] text-[var(--ok)]">…</li>
                        )}
                      </ul>
                    )}
                  </div>
                )
              })()}

              {/* 4. Direct courseware & resource links */}
              {dossier.resources.flatFiles.length > 0 && (
                <div
                  data-testid="dossier-resources"
                  className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                    {t('dossierResourcesTitle', { n: dossier.resources.flatFiles.length })}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {dossier.resources.flatFiles.slice(0, 6).map((res) => (
                      <ExternalLink
                        key={`${res.courseId}:${res.id}`}
                        href={res.url ?? '#'}
                        className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-[11px] text-[var(--info)] hover:bg-[var(--hover-1)] hover:underline"
                      >
                        <span className="truncate">{res.name}</span>
                        <span className="shrink-0 font-mono text-[10px] text-[var(--text-3)]">↗</span>
                      </ExternalLink>
                    ))}
                  </div>
                </div>
              )}

              {/* 5. Real-time weighted grade projection & LUT 1–5 Grade Target Reverse Solver */}
              {dossier.gradeAnalysis.projection && (
                <div
                  data-testid="dossier-grade-solver"
                  className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                      {t('dossierGradesTitle')}
                    </span>
                    <span className="num font-mono text-[11px] font-semibold tabular-nums text-[var(--text-1)]">
                      {t('dossierCurrentProjected', {
                        cur: Math.round(dossier.gradeAnalysis.projection.current ?? 0),
                        proj: Math.round(
                          dossier.gradeAnalysis.projection.coveredAvg ??
                            dossier.gradeAnalysis.projection.current ??
                            0,
                        ),
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {([1, 2, 3, 4, 5] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setTargetGrade(lvl)}
                        className={
                          'num flex-1 rounded border py-0.5 font-mono text-[10px] tabular-nums ' +
                          (targetGrade === lvl
                            ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-text)] font-semibold'
                            : 'border-[var(--line)] bg-[var(--surface-1)] text-[var(--text-2)]')
                        }
                      >
                        G{lvl}
                      </button>
                    ))}
                  </div>
                  {dossier.gradeAnalysis.itemMinimumsForTarget.length > 0 && (
                    <div className="space-y-1">
                      {dossier.gradeAnalysis.itemMinimumsForTarget.slice(0, 4).map((req) => (
                        <div
                          key={req.itemIndex}
                          className="flex items-center justify-between text-[11px] text-[var(--text-2)]"
                        >
                          <span className="truncate">{req.itemName}</span>
                          <span
                            className={
                              'num font-mono text-[10px] tabular-nums ' +
                              (req.feasible ? 'text-[var(--ok)]' : 'text-[var(--danger)]')
                            }
                          >
                            ≥{Math.round(req.minPercentBalanced)}%
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 6. Course-linked Focus Cockpit progress bar */}
              <div
                data-testid="dossier-focus-cockpit"
                className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                    {t('dossierFocusTitle')}
                  </span>
                  <button
                    type="button"
                    data-testid="dossier-start-focus-btn"
                    onClick={() =>
                      pomodoro.startForCourse(effectiveCode || resolvedNode.title, {
                        label: effectiveCode || resolvedNode.title,
                      })
                    }
                    className="app-btn px-2 py-0.5 text-[10px]"
                  >
                    {t('dossierStartCourseFocus')}
                  </button>
                </div>
                <div className="num text-[11px] tabular-nums text-[var(--text-2)]">
                  {dossier.focus.sisuTotalHours
                    ? t('dossierFocusProgress', {
                        focus: dossier.focus.focusHours,
                        attended: dossier.focus.attendedLectureHours,
                        total: dossier.focus.sisuTotalHours,
                        pct: Math.round((dossier.focus.completionRatio ?? 0) * 100),
                      })
                    : t('dossierFocusNoTarget', {
                        focus: dossier.focus.focusHours,
                        attended: dossier.focus.attendedLectureHours,
                      })}
                </div>
                {dossier.focus.sisuTotalHours && (
                  <div className="micro-scale">
                    <span
                      className="micro-scale-fill"
                      style={{
                        width: `${Math.min(100, Math.round((dossier.focus.completionRatio ?? 0) * 100))}%`,
                      }}
                    />
                  </div>
                )}
              </div>

              {/* 订阅式提醒：这门课一有变动（时间/教室/取消）就推一条 */}
              {onWatch && (
                <button
                  onClick={() => onWatch(!watched)}
                  aria-pressed={!!watched}
                  className={
                    'flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-[11px] transition ' +
                    (watched
                      ? 'border-[var(--line-info)] bg-[var(--tint-info)] text-[var(--info)]'
                      : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-2)] hover:bg-[var(--hover-1)]')
                  }
                  title={t('subCourseHint')}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="warn" size={12} /> {t('subCourseWatch')}
                  </span>
                  <span className="shrink-0">{watched ? t('subOn') : t('subOff')}</span>
                </button>
              )}

              {/* 7. Class quick notes */}
              {onSaveNote && (
                <div className="rounded-md border border-[var(--line-due)] bg-[var(--tint-due)] px-2.5 py-2">
                  {noteEdit ? (
                    <>
                      <div className="text-[10px] font-medium text-[var(--due)]">
                        <span className="inline-flex items-center gap-1.5"><Icon name="note" size={12} /> {t('noteTitle')} · {noteScope}</span>
                      </div>
                      <textarea
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder={t('notePlaceholder')}
                        rows={2}
                        autoFocus
                        className="mt-1 w-full resize-none app-input"
                      />
                      <div className="mt-1.5 flex gap-2">
                        <button
                          onClick={() => setNoteEdit(false)}
                          className="flex-1 rounded-md bg-[var(--surface-2)] px-2 py-1 text-[11px] font-medium hover:bg-[var(--hover-1)]"
                        >
                          {t('cancel')}
                        </button>
                        <button
                          onClick={() => {
                            onSaveNote(noteText)
                            setNoteEdit(false)
                          }}
                          className="app-fill-due flex-[2] rounded-md px-2 py-1 text-[11px]"
                        >
                          {t('noteSave')}
                        </button>
                      </div>
                    </>
                  ) : note ? (
                    <>
                      <div className="text-[10px] font-medium text-[var(--due)]">
                        <span className="inline-flex items-center gap-1.5"><Icon name="note" size={12} /> {t('noteTitle')} · {noteScope}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-[var(--due)]">
                        {note}
                      </p>
                      <div className="mt-1.5 flex gap-2">
                        <button
                          onClick={() => {
                            setNoteText(note)
                            setNoteEdit(true)
                          }}
                          className="rounded bg-[var(--tint-due)] px-2 py-0.5 text-[10px] text-[var(--due)] hover:bg-[var(--tint-due)]"
                        >
                          {t('noteEdit')}
                        </button>
                        <button
                          onClick={onRemoveNote}
                          className="rounded bg-[var(--surface-2)] px-2 py-0.5 text-[10px] text-[var(--text-2)] hover:bg-[var(--hover-1)]"
                        >
                          {t('noteRemove')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-[10px] text-[var(--due)]">
                        {t('noteApplies', { scope: noteScope })}
                      </div>
                      <button
                        onClick={() => setNoteEdit(true)}
                        className="mt-1 rounded bg-[var(--tint-due)] px-2 py-1 text-[11px] font-medium text-[var(--due)] hover:bg-[var(--tint-due)]"
                      >
                        {t('noteAdd')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {lesson && onSave && onDelete && onHide && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={startEdit}
                  className="app-fill-info flex-[2] rounded-md px-3 py-1.5 text-xs"
                >
                  <span className="inline-flex items-center gap-1.5"><Icon name="pencil" size={12} /> {t('edit')}</span>
                </button>
                <button
                  onClick={() => {
                    onHide(lesson.id)
                    requestClose()
                  }}
                  title={t('batchHideHint')}
                  className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text-1)]"
                >
                  <Icon name="eye-off" size={13} />
                </button>
                <button
                  onClick={handleDelete}
                  className="flex-1 rounded-md border border-[var(--danger)] px-3 py-1.5 text-xs font-medium text-[var(--danger)] hover:bg-[var(--tint-danger)] hover:text-[var(--danger)]"
                >
                  {t('delete')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
