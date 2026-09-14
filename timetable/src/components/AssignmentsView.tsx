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
import { courseColorByKey } from '../lib/colors'
import { QUICK_LINKS } from '../lib/quickLinks'
import TruncatedNote from './TruncatedNote'

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
  const { t, lang } = useI18n()
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
    return new Date(due).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
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
    'w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs focus:outline-none focus:border-sky-500'

  return (
    <div className="flex-1 overflow-y-auto p-4 safe-bottom">
      <div className="mx-auto max-w-xl space-y-4">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">🎓 {t('assignTitle')}</h2>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {t('assignSubtitle', { n: pending })}
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              onClick={() => { setShowAddForm((o) => !o); setShowMoodleCard(false) }}
              className="rounded-md bg-sky-600 px-2.5 min-h-9 text-xs font-medium hover:bg-sky-500"
              title={t('taskAdd')}
            >
              ＋
            </button>
            {onClose && (
              <button onClick={onClose} className="rounded-md bg-zinc-800 px-2.5 min-h-9 hover:bg-zinc-700" title={t('closeHint')}>✕</button>
            )}
          </div>
        </div>

        {/* 搜索框：始终可见 */}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('assignSearchPh')}
          className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-xs focus:outline-none focus:border-sky-500"
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
                      ? 'border-rose-500 bg-rose-500/20 text-rose-200'
                      : 'border-sky-500 bg-sky-500/20 text-sky-200'
                    : 'border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200')
                }
              >
                {g === 'all' ? t('assignFilterAll') : groupLabel[g]} {n}
              </button>
            )
          })}
          <label className="ml-auto flex items-center gap-1.5 text-[11px] text-zinc-400">
            <input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} className="accent-sky-500" />
            {t('tasksShowCompleted')}
          </label>
        </div>

        {/* ---- 收纳抽屉：Moodle 同步 ---- */}
        <section className="rounded-xl border border-zinc-700/80 bg-zinc-900/60">
          <button
            onClick={() => { setShowMoodleCard((o) => !o); setShowAddForm(false) }}
            title={t('toggleHint')}
            className="flex w-full items-center justify-between px-3 py-2.5"
          >
            <span className="text-xs font-semibold text-zinc-200">
              🟠 {t('moodleTitle')}
              {moodle && <span className="ml-2 text-[10px] font-normal text-zinc-500">{moodle.count} · {moodle.lastSync ? new Date(moodle.lastSync).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' }) : ''}</span>}
            </span>
            <span className="text-[11px] text-zinc-500">{showMoodleCard ? '▾' : '›'}</span>
          </button>
          {showMoodleCard && (
            <div className="border-t border-zinc-700/60 p-3">
              {showMoodleForm ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-zinc-500">{t('moodleHint')}</p>
                  <input
                    value={moodleUrl}
                    onChange={(e) => setMoodleUrl(e.target.value)}
                    placeholder={t('moodleUrlPh')}
                    className={inputCls}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={addMoodle}
                      className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium hover:bg-orange-500"
                    >
                      {t('moodleConnect')}
                    </button>
                    {moodle && (
                      <button onClick={() => { setShowMoodleForm(false); setMoodleMsg(null) }} className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs">
                        {t('cancel')}
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                moodle && (
                  <div className="space-y-1.5">
                    <div className="truncate rounded-md border border-zinc-700 bg-zinc-800/60 px-2 py-1 text-[10px] text-zinc-500" title={moodle.url}>
                      {moodle.url}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => void syncMoodleNow()}
                        disabled={moodleBusy}
                        className="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-medium hover:bg-orange-500 disabled:opacity-50"
                      >
                        {moodleBusy ? t('moodleSyncing') : t('moodleSyncNow')}
                      </button>
                      <button onClick={removeMoodle} className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-600">
                        {t('moodleRemove')}
                      </button>
                    </div>
                  </div>
                )
              )}
              {moodleMsg && <p className="mt-1.5 text-[11px] text-zinc-400">{moodleMsg}</p>}
            </div>
          )}
        </section>

        {/* ---- 收纳抽屉：手动添加任务 ---- */}
        {showAddForm && (
          <section className="animate-modal-in rounded-lg border border-sky-500/30 bg-sky-500/10 p-3">
            <div className="mb-2 text-[11px] font-semibold text-sky-300">
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
            {error && <p className="mt-1 text-[11px] text-rose-400">{error}</p>}
            <div className="mt-2 flex justify-end gap-2">
              {editingId && <button onClick={reset} className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs">{t('cancel')}</button>}
              <button onClick={submit} className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium hover:bg-sky-500">
                {editingId ? t('save') : t('taskAddButton')}
              </button>
            </div>
          </section>
        )}

        {/* ---- 收纳抽屉：常用平台 ---- */}
        <section className="rounded-xl border border-zinc-700/80 bg-zinc-900/60">
          <button
            onClick={() => setShowLinks((o) => !o)}
            title={t('toggleHint')}
            className="flex w-full items-center justify-between px-3 py-2.5"
          >
            <span className="text-xs font-semibold text-zinc-200">🔗 {t('quickLinks')}</span>
            <span className="text-[11px] text-zinc-500">{showLinks ? '▾' : '›'}</span>
          </button>
          {showLinks && (
            <div className="animate-modal-in grid grid-cols-3 gap-1.5 border-t border-zinc-700/60 p-3">
              {QUICK_LINKS.map((l) => (
                <a
                  key={l.key}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-2 py-1.5 text-center text-[11px] text-zinc-300 truncate"
                  title={l.url}
                >
                  {l.icon} {l.name}
                </a>
              ))}
            </div>
          )}
        </section>

        {/* Grouped task list */}
        {GROUP_ORDER.every((g) => (groups.get(g) ?? []).length === 0) ? (
          <p className="py-10 text-center text-xs text-zinc-500">
            {q.trim() || groupFilter !== 'all' ? t('assignNoMatch') : t('tasksEmpty')}
          </p>
        ) : (
          <div className="space-y-4">
            {GROUP_ORDER.map((g) => {
              const items = groups.get(g) ?? []
              if (items.length === 0) return null
              return (
                <section key={g}>
                  <h3 className={'mb-1.5 text-[11px] font-semibold uppercase tracking-wider ' + (g === 'overdue' ? 'text-rose-400' : 'text-zinc-500')}>
                    {groupLabel[g]} · {items.length}
                  </h3>
                  <ul className="space-y-2">
                    {items.map((task) => {
                      const overdue = g === 'overdue'
                      const isMoodle = task.id.startsWith('moodle:')
                      const cc = courseCodeOf(task.course)
                      const c = cc ? courseColorByKey(cc) : null
                      return (
                        <li key={task.id} className={'task-row rounded-lg border p-2.5 ' + (task.completed ? 'border-zinc-800 bg-zinc-800/40 opacity-60' : overdue ? 'border-rose-500/50 bg-rose-500/10' : 'border-zinc-700 bg-zinc-800/60')}
                          style={task.completed || overdue ? undefined : c ? { background: c.bg, borderColor: c.border } : undefined}
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
                              <div className={'text-xs font-medium ' + (task.completed ? 'line-through text-zinc-500' : '')} style={task.completed || !c ? undefined : { color: c.text }}>
                                {isMoodle && <span className="mr-1" title="Moodle">🟠</span>}
                                {task.title}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-zinc-400">
                                {task.course && (
                                  cc && onJumpToCourse ? (
                                    <button
                                      onClick={() => onJumpToCourse(cc)}
                                      className="font-medium underline-offset-2 hover:underline"
                                      style={{ color: c!.text }}
                                      title={t('jumpToCourse')}
                                    >
                                      📚 {task.course} ↦
                                    </button>
                                  ) : (
                                    <span>📚 {task.course}</span>
                                  )
                                )}
                                {task.dueAt && <span>🕒 {formatDue(task.dueAt)}{overdue ? ` · ${t('taskOverdue')}` : ''}</span>}
                              </div>
                              {task.note && <TruncatedNote note={task.note} />}
                            </div>
                            <div className="flex shrink-0 gap-1">
                              {task.url && (
                                <a href={task.url} target="_blank" rel="noreferrer" className="rounded bg-orange-600/80 px-1.5 py-1 text-[10px] hover:bg-orange-500" title="Moodle">
                                  ↗
                                </a>
                              )}
                              {!isMoodle && (
                                <>
                                  <button onClick={() => edit(task)} className="rounded bg-zinc-700 px-1.5 py-1 text-[10px]" title={t('edit')}>✎</button>
                                  <button onClick={() => onChange(removeTask(tasks, task.id))} className="rounded bg-zinc-700 px-1.5 py-1 text-[10px] text-rose-300" title={t('delete')}>✕</button>
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

