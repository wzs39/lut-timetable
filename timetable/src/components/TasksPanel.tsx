import { useMemo, useState } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { addTask, courseOptions, isOverdue, removeTask, sortTasks, updateTask, type Task } from '../lib/tasks'

interface Props {
  tasks: Task[]
  lessons: Lesson[]
  onChange: (tasks: Task[]) => void
  onClose: () => void
}

export default function TasksPanel({ tasks, lessons, onChange, onClose }: Props) {
  const { t, lang } = useI18n()
  const [title, setTitle] = useState('')
  const [course, setCourse] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [note, setNote] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const courses = useMemo(() => courseOptions(lessons), [lessons])
  const visible = useMemo(
    () => sortTasks(tasks).filter((task) => showCompleted || !task.completed),
    [tasks, showCompleted],
  )
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

  const formatDue = (due?: string) => {
    if (!due) return t('taskNoDue')
    return new Date(due).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
      tabIndex={-1}
    >
      <div className="animate-modal-in flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">✅ {t('tasksTitle')}</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">{t('tasksPending', { n: pending })}</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" title={t('closeHint')}>✕</button>
        </div>

        <div className="mb-4 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3">
          <div className="mb-2 text-[11px] font-semibold text-sky-300">
            {editingId ? t('taskEdit') : t('taskAdd')}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('taskTitlePh')}
              className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs sm:col-span-2"
            />
            <input
              list="task-course-options"
              value={course}
              onChange={(event) => setCourse(event.target.value)}
              placeholder={t('taskCoursePh')}
              className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs"
            />
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs"
              aria-label={t('taskDue')}
            />
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t('taskNotePh')}
              rows={2}
              className="resize-none rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-xs sm:col-span-2"
            />
          </div>
          <datalist id="task-course-options">
            {courses.map((value) => <option key={value} value={value} />)}
          </datalist>
          {error && <p className="mt-1 text-[11px] text-rose-400">{error}</p>}
          <div className="mt-2 flex justify-end gap-2">
            {editingId && <button onClick={reset} className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs">{t('cancel')}</button>}
            <button onClick={submit} className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium hover:bg-sky-500">
              {editingId ? t('save') : t('taskAddButton')}
            </button>
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{t('tasksList')}</span>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <input type="checkbox" checked={showCompleted} onChange={(event) => setShowCompleted(event.target.checked)} className="accent-sky-500" />
            {t('tasksShowCompleted')}
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-500">{t('tasksEmpty')}</p>
          ) : (
            <ul className="space-y-2">
              {visible.map((task) => {
                const overdue = isOverdue(task)
                return (
                  <li key={task.id} className={'task-row rounded-lg border p-2.5 ' + (task.completed ? 'border-zinc-800 bg-zinc-800/40 opacity-60' : overdue ? 'border-rose-500/50 bg-rose-500/10' : 'border-zinc-700 bg-zinc-800/60')}>
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={task.completed}
                        onChange={(event) => onChange(updateTask(tasks, task.id, { completed: event.target.checked }))}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
                        aria-label={task.title}
                      />
                      <div className="min-w-0 flex-1">
                        <div className={'text-xs font-medium ' + (task.completed ? 'line-through text-zinc-500' : 'text-zinc-100')}>
                          {task.title}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-zinc-400">
                          {task.course && <span>📚 {task.course}</span>}
                          <span className={overdue ? 'font-medium text-rose-300' : ''}>🕒 {formatDue(task.dueAt)}{overdue ? ` · ${t('taskOverdue')}` : ''}</span>
                        </div>
                        {task.note && <p className="mt-1 whitespace-pre-wrap text-[11px] text-zinc-500">{task.note}</p>}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button onClick={() => edit(task)} className="rounded bg-zinc-700 px-1.5 py-1 text-[10px]" title={t('edit')}>✎</button>
                        <button onClick={() => onChange(removeTask(tasks, task.id))} className="rounded bg-zinc-700 px-1.5 py-1 text-[10px] text-rose-300" title={t('delete')}>✕</button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
