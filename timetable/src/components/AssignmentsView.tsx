import { useMemo, useState } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import {
  addTask,
  courseOptions,
  isOverdue,
  removeTask,
  sortTasks,
  updateTask,
  type Task,
} from '../lib/tasks'
import {
  loadMoodleSource,
  matchCourseCode,
  normalizeMoodleUrl,
  saveMoodleSource,
  syncMoodle,
  type MoodleSource,
} from '../lib/moodle'
import { normalizeCourseCode } from '../lib/ics'
import { courseColorByKey, courseStyle, courseTextStyle } from '../lib/colors'
import { QUICK_LINKS } from '../lib/quickLinks'
import ExternalLink from './ExternalLink'
import TruncatedNote from './TruncatedNote'
import Icon from './Icon'

interface Props {
  tasks: Task[]
  lessons: Lesson[]
  onChange: (tasks: Task[]) => void
  /** 跳转到该课程的日历位置（点击课程代码时） */
  onJumpToCourse?: (code: string) => void
  onClose?: () => void
}

type Group = 'overdue' | 'due7' | 'later' | 'nodue' | 'done'

const GROUP_ORDER: Group[] = ['overdue', 'due7', 'later', 'nodue', 'done']

export default function AssignmentsView({ tasks, lessons, onChange, onJumpToCourse, onClose }: Props) {
  const { t, locale } = useI18n()
  const [title, setTitle] = useState('')
  const [course, setCourse] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [note, setNote] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 搜索 + 分组筛选
  const [q, setQ] = useState('')
  const [groupFilter, setGroupFilter] = useState<Group | 'all'>('all')

  // 折叠抽屉（默认收起，避免堆满一屏）
  const [showMoodleCard, setShowMoodleCard] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [showLinks, setShowLinks] = useState(false)

  // Moodle source state
  const [moodle, setMoodle] = useState(() => loadMoodleSource())
  const [moodleUrl, setMoodleUrl] = useState('')
  const [moodleMsg, setMoodleMsg] = useState<string | null>(null)
  const [moodleBusy, setMoodleBusy] = useState(false)
  const [showMoodleForm, setShowMoodleForm] = useState(() => !loadMoodleSource())

  const courses = useMemo(() => courseOptions(lessons), [lessons])
  const pending = tasks.filter((task) => !task.completed).length

  const reset = () => {
    setTitle('')
    setCourse('')
    setDueAt('')
    setNote('')
    setEditingId(null)
    setError(null)
  }

  const submit = () => {
    if (!title.trim()) {
      setError(t('taskTitleRequired'))
      return
    }
    if (editingId) {
      onChange(updateTask(tasks, editingId, { title, course, dueAt, note }))
    } else {
      onChange(addTask(tasks, { title, course, dueAt, note }))
    }
    reset()
  }

  const edit = (task: Task) => {
    setEditingId(task.id)
    setTitle(task.title)
    setCourse(task.course || '')
    setDueAt(task.dueAt ? task.dueAt.slice(0, 16) : '')
    setNote(task.note || '')
    setError(null)
  }

  const addMoodle = () => {
    const icsUrl = normalizeMoodleUrl(moodleUrl.trim())
    if (!icsUrl) {
      setMoodleMsg(t('moodleBadUrl'))
      return
    }
    setMoodleMsg(null)
    const next: MoodleSource = { url: icsUrl, count: 0 }
    setMoodle(next)
    saveMoodleSource(next)
    setMoodleUrl('')
    setShowMoodleForm(false)
    void syncMoodleNow(next)
  }

  const syncMoodleNow = async (src?: MoodleSource) => {
    const s = src ?? moodle
    if (!s || moodleBusy) return
    setMoodleBusy(true)
    setMoodleMsg(t('moodleSyncing'))
    try {
      const r = await syncMoodle(s, tasks, lessons)
      onChange(r.tasks)
      setMoodle(loadMoodleSource())
      setMoodleMsg(t('moodleSyncOk', { a: r.added, u: r.updated }))
    } catch (e) {
      setMoodleMsg(t('moodleSyncFail', { e: String(e).replace('Error: ', '') }))
    } finally {
      setMoodleBusy(false)
    }
  }

  const removeMoodle = () => {
    // Remove the source and every task it created.
    onChange(tasks.filter((task) => !task.id.startsWith('moodle:')))
    setMoodle(null)
    saveMoodleSource(null)
    setShowMoodleForm(true)
    setMoodleMsg(null)
  }

  const formatDue = (due?: string) => {
    if (!due) return t('taskNoDue')
    return new Date(due).toLocaleString(locale, {
      weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  const groups = useMemo(() => {
    const now = Date.now()
    const week = now + 7 * 24 * 3600 * 1000
    const kw = q.trim().toLowerCase()
    const map = new Map<Group, Task[]>()
    for (const task of sortTasks(tasks)) {
      if (kw) {
        const hay = `${task.title} ${task.course || ''} ${task.note || ''}`.toLowerCase()
        if (!hay.includes(kw)) continue
      }
      let g: Group
      if (task.completed) g = 'done'
      else if (isOverdue(task)) g = 'overdue'
      else if (task.dueAt && new Date(task.dueAt).getTime() <= week) g = 'due7'
      else if (task.dueAt) g = 'later'
      else g = 'nodue'
      if (groupFilter !== 'all' && groupFilter !== g) continue
      if (g === 'done' && !showCompleted) continue
      push(map, g, task)
    }
    return map
  }, [tasks, showCompleted, q, groupFilter])

  const groupLabel: Record<Group, string> = {
    overdue: t('assignOverdue'),
    due7: t('assignDue7'),
    later: t('assignLater'),
    nodue: t('assignNoDue'),
    done: t('assignDone'),
  }

  /** 该任务课程的日历内代码（用于着色与跳转）；无匹配则 null */
  const courseCodeOf = (course?: string): string | null => {
    if (!course) return null
    const matched = matchCourseCode(course, lessons)
    if (matched) return matched
    // 已是 LUT 代码或与某节课代码前缀一致时直接用
    const norm = normalizeCourseCode(course)
    if (lessons.some((l) => l.code && normalizeCourseCode(l.code) === norm)) return norm
    return null
  }

  const inputCls =
    'w-full rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-xs focus:outline-none focus:border-[var(--info)]'

  return (
    <div className="flex-1 overflow-y-auto p-4 safe-bottom">
      <div className="mx-auto max-w-xl space-y-4">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold"><Icon name="graduation" size={16} /> {t('assignTitle')}</h2>
            <p className="mt-0.5 text-[11px] text-[var(--text-3)]">
              {t('assignSubtitle', { n: pending })}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              onClick={() => { setShowAddForm((o) => !o); setShowMoodleCard(false) }}
              className="app-btn-primary px-2.5 min-h-9 text-xs"
              title={t('taskAdd')}
            >
              ＋
            </button>
            {onClose && (
              <button onClick={onClose} className="app-btn px-2.5 min-h-9" title={t('closeHint')}><Icon name="close" size={14} /></button>
            )}
          </div>
        </div>

        {/* 搜索框：始终可见 */}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('assignSearchPh')}
          className="app-input"
        />

        {/* 分组筛选 chips */}
        <div className="flex flex-wrap gap-1.5">
          {(['all', 'overdue', 'due7', 'later', 'nodue', ...(showCompleted ? ['done' as const] : [])] as const).map((g) => {
            const n = g === 'all'
              ? tasks.filter((task) => showCompleted || !task.completed).length
              : (groups.get(g) ?? []).length
            const active = groupFilter === g
            return (
              <button
                key={g}
                onClick={() => setGroupFilter(g)}
                className={
                  'rounded-full border px-2.5 py-1 text-[11px] transition ' +
                  (active
                    ? g === 'overdue'
                      ? 'border-[var(--danger)] bg-[var(--tint-danger)] text-[var(--danger)]'
                      : 'border-[var(--info)] bg-[var(--tint-info)] text-[var(--info)]'
                    : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-2)] hover:text-[var(--text-1)]')
                }
              >
                {g === 'all' ? t('assignFilterAll') : groupLabel[g]} {n}
              </button>
            )
          })}
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-[var(--text-2)]">
            <input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} className="accent-sky-500" />
            {t('tasksShowCompleted')}
          </label>
        </div>

        {/* ---- 收纳抽屉：Moodle 同步 ---- */}
        <section className="app-card">
          <button
            onClick={() => { setShowMoodleCard((o) => !o); setShowAddForm(false) }}
            title={t('toggleHint')}
            className="flex w-full items-center justify-between px-3 py-2.5"
          >
            <span className="text-xs font-semibold text-[var(--text-1)]">
              <Icon name="assignment" size={13} /> {t('moodleTitle')}
              {moodle && <span className="ml-2 text-[10px] font-normal text-[var(--text-3)]">{moodle.count} · {moodle.lastSync ? new Date(moodle.lastSync).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : ''}</span>}
            </span>
            <span className="text-[var(--text-3)] inline-flex"><Icon name={showMoodleCard ? 'chevron-down' : 'chevron-right'} size={12} /></span>
          </button>
          {showMoodleCard && (
            <div className="border-t border-[var(--line)] p-3">
              {showMoodleForm ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-[var(--text-3)]">{t('moodleHint')}</p>
                  <input
                    value={moodleUrl}
                    onChange={(e) => setMoodleUrl(e.target.value)}
                    placeholder={t('moodleUrlPh')}
                    className={inputCls}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={addMoodle}
                      className="app-btn-primary px-3 py-1.5 text-xs"
                    >
                      {t('moodleConnect')}
                    </button>
                    {moodle && (
                      <button onClick={() => { setShowMoodleForm(false); setMoodleMsg(null) }} className="rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs">
                        {t('cancel')}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                moodle && (
                  <div className="space-y-1.5">
                    <div className="truncate rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1 text-[10px] text-[var(--text-3)]" title={moodle.url}>
                      {moodle.url}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => void syncMoodleNow()}
                        disabled={moodleBusy}
                        className="app-btn-primary px-3 py-1.5 text-xs disabled:opacity-50"
                      >
                        {moodleBusy ? t('moodleSyncing') : t('moodleSyncNow')}
                      </button>
                      <button onClick={removeMoodle} className="rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs hover:bg-[var(--hover-1)]">
                        {t('moodleRemove')}
                      </button>
                    </div>
                  </div>
                )
              )}
              {moodleMsg && <p className="mt-1.5 text-[11px] text-[var(--text-2)]">{moodleMsg}</p>}
            </div>
          )}
        </section>

        {/* ---- 收纳抽屉：手动添加任务 ---- */}
        {showAddForm && (
          <section className="animate-modal-in rounded-lg border border-[var(--line-info)] bg-[var(--tint-info)] p-3">
            <div className="mb-2 text-[11px] font-semibold text-[var(--info)]">
              {editingId ? t('taskEdit') : t('taskAdd')}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('taskTitlePh')}
                className={inputCls + ' sm:col-span-2'}
              />
              <input
                list="assign-course-options"
                value={course}
                onChange={(event) => setCourse(event.target.value)}
                placeholder={t('taskCoursePh')}
                className={inputCls}
              />
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className={inputCls}
                aria-label={t('taskDue')}
              />
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t('taskNotePh')}
                rows={2}
                className={'resize-none ' + inputCls + ' sm:col-span-2'}
              />
            </div>
            <datalist id="assign-course-options">
              {courses.map((value) => <option key={value} value={value} />)}
            </datalist>
            {error && <p className="mt-1 text-[11px] text-[var(--danger)]">{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              {editingId && <button onClick={reset} className="rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs">{t('cancel')}</button>}
              <button onClick={submit} className="app-btn-primary px-3 py-1.5 text-xs">
                {editingId ? t('save') : t('taskAddButton')}
              </button>
            </div>
          </section>
        )}

        {/* ---- 收纳抽屉：常用平台 ---- */}
        <section className="app-card">
          <button
            onClick={() => setShowLinks((o) => !o)}
            title={t('toggleHint')}
            className="flex w-full items-center justify-between px-3 py-2.5"
          >
            <span className="text-xs font-semibold text-[var(--text-1)] inline-flex items-center gap-1.5"><Icon name="link" size={12} /> {t('quickLinks')}</span>
            <span className="text-[var(--text-3)] inline-flex"><Icon name={showLinks ? 'chevron-down' : 'chevron-right'} size={12} /></span>
          </button>
          {showLinks && (
            <div className="animate-modal-in grid grid-cols-3 gap-1.5 border-t border-[var(--line)] p-3">
              {QUICK_LINKS.map((l) => (
                <ExternalLink
                  key={l.key}
                  href={l.url}
                  className="app-btn px-2 py-1.5 text-center text-[11px] truncate"
                  title={l.url}
                >
                  {<Icon name={l.icon} size={12} />} {l.name}
                </ExternalLink>
              ))}
            </div>
          )}
        </section>

        {/* Grouped task list */}
        {GROUP_ORDER.every((g) => (groups.get(g) ?? []).length === 0) ? (
          <p className="py-10 text-center text-xs text-[var(--text-3)]">
            {q.trim() || groupFilter !== 'all' ? t('assignNoMatch') : t('tasksEmpty')}
          </p>
        ) : (
          <div className="space-y-4">
            {GROUP_ORDER.map((g) => {
              const items = groups.get(g) ?? []
              if (items.length === 0) return null
              return (
                <section key={g}>
                  <h3 className={'mb-1.5 text-[11px] font-semibold uppercase tracking-wider ' + (g === 'overdue' ? 'text-[var(--danger)]' : 'text-[var(--text-3)]')}>
                    {groupLabel[g]} · {items.length}
                  </h3>
                  <ul className="space-y-2">
                    {items.map((task) => {
                      const overdue = g === 'overdue'
                      const isMoodle = task.id.startsWith('moodle:')
                      const cc = courseCodeOf(task.course)
                      const c = cc ? courseColorByKey(cc) : null
                      return (
                        <li key={task.id} className={'task-row rounded-lg border p-2.5 ' + (task.completed ? 'border-[var(--line)] bg-[var(--surface-2)] opacity-50' : overdue ? 'border-[var(--danger)] bg-[var(--surface-2)]' : 'border-[var(--line)] bg-[var(--surface-2)]')}
                          style={task.completed || overdue ? undefined : c ? courseStyle(c) : undefined}
                        >
                          <div className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={task.completed}
                              onChange={(event) => onChange(updateTask(tasks, task.id, { completed: event.target.checked }))}
                              className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
                              aria-label={task.title}
                            />
                            <div className="min-w-0 flex-1">
                              <div className={'text-xs font-medium ' + (task.completed ? 'line-through text-[var(--text-3)]' : '')} style={task.completed || !c ? undefined : { color: c.text }}>
                                {isMoodle && <span className="mr-1 inline-flex" title="Moodle"><Icon name="assignment" size={11} /></span>}
                                {task.title}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-[var(--text-2)]">
                                {task.course && (
                                  cc && onJumpToCourse ? (
                                    <button
                                      onClick={() => onJumpToCourse(cc)}
                                      className="font-medium underline-offset-2 hover:underline"
                                      style={courseTextStyle(c!)}
                                      title={t('jumpToCourse')}
                                    >
                                      <span className="inline-flex items-center gap-1"><Icon name="book" size={11} /> {task.course} <Icon name="jump" size={10} /></span>
                                    </button>
                                  ) : (
                                    <span className="inline-flex items-center gap-1"><Icon name="book" size={11} /> {task.course}</span>
                                  )
                                )}
                                {task.dueAt && <span className="inline-flex items-center gap-1"><Icon name="clock" size={11} /> {formatDue(task.dueAt)}{overdue ? ` · ${t('taskOverdue')}` : ''}</span>}
                              </div>
                              {task.note && <TruncatedNote note={task.note} />}
                            </div>
                            <div className="flex shrink-0 gap-1">
                              {task.url && (
                                <ExternalLink
                                  href={String(task.url)}
                                  className="app-btn-ghost px-1.5 py-1 text-[10px]"
                                  title="Moodle"
                                >
                                  <Icon name="external" size={11} />
                                </ExternalLink>
                              )}
                              {!isMoodle && (
                                <>
                                  <button onClick={() => edit(task)} className="app-btn-ghost px-1.5 py-1" title={t('edit')}><Icon name="pencil" size={11} /></button>
                                  <button onClick={() => onChange(removeTask(tasks, task.id))} className="app-btn-ghost px-1.5 py-1 text-[var(--danger)]" title={t('delete')}><Icon name="close" size={11} /></button>
                                </>
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function push(map: Map<Group, Task[]>, g: Group, task: Task) {
  const arr = map.get(g) || []
  arr.push(task)
  map.set(g, arr)
}

