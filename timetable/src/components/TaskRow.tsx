import { useI18n } from '../i18n'
import { useNow } from '../lib/useNow'
import { isOverdue, msUntilDue, type Task } from '../lib/tasks'
import type { Lesson } from '../types'
import { matchCourseCode } from '../lib/moodle'
import { taskCmidOf, taskMatchKey } from '../lib/submissions'
import { formatDateTime } from '../lib/date'
import { normalizeCourseCode } from '../lib/ics'
import { courseColorByKey, courseStyle, courseTextStyle, type CourseColor } from '../lib/colors'
import { ModBadge } from './TaskBadges'
import ExternalLink from './ExternalLink'
import TruncatedNote from './TruncatedNote'
import Icon from './Icon'
import SubmissionBadge from './moodle/SubmissionBadge'
import { useMoodleData } from '../hooks/useMoodleData'

interface Props {
  task: Task
  lessons: Lesson[]
  /** 勾选切换：父级负责任务列表状态；Moodle 活动的服务器反向同步由本组件内部处理。 */
  onToggle: (task: Task, completed: boolean) => void
  /** 非 Moodle 手动任务的编辑/删除按钮（不传则不渲染）。 */
  onEdit?: (task: Task) => void
  onDelete?: (task: Task) => void
  /** 课程名点击 → 跳转该课程的课表/日历位置。 */
  onJumpToCourse?: (code: string) => void
  /** 标题行右侧显示截止倒计时徽章（今日页）。 */
  showCountdown?: boolean
  /** 影响分排序下的「建议先做」提示（含原因，作为 title 展示）。 */
  priorityHint?: string
}

/**
 * 任务行共享组件：今日页「今日截止」与作业页任务卡同一份实现。
 *
 * 此前两处各自维护一份相似但不完整的行：今日页没有复选框/提交徽标/课程
 * 着色/编辑按钮，作业页没有倒计时徽章/开课时间——信息量不对齐。本组件
 * 汇总全部要素：复选框（含 Moodle 服务器反向同步）、标题+模块类型徽标、
 * 截止倒计时、课程名（可跳转）、截止/开课时间、提交状态徽标、备注、
 * 外链与手动任务的编辑/删除按钮。
 */
export default function TaskRow({
  task,
  lessons,
  onToggle,
  onEdit,
  onDelete,
  onJumpToCourse,
  showCountdown,
  priorityHint,
}: Props) {
  const { t, locale } = useI18n()
  const md = useMoodleData()
  const now = useNow()

  const overdue = isOverdue(task, new Date(now))
  const isMoodle = task.id.startsWith('moodle:') || task.id.startsWith('moodle-act:')
  const cc = courseCodeOf(task.course, lessons)
  const c: CourseColor | null = cc ? courseColorByKey(cc) : null

  const leftMs = showCountdown && !task.completed ? msUntilDue(task, new Date(now)) : null
  const leftMin = leftMs != null ? Math.round(leftMs / 60000) : null

  const st = md.subStatus.get(taskMatchKey(task))

  return (
    <li
      className={'task-row rounded-lg border p-2.5 ' + (task.completed ? 'border-[var(--line)] bg-[var(--surface-2)] opacity-50' : overdue ? 'border-[var(--danger)] bg-[var(--surface-2)]' : 'border-[var(--line)] bg-[var(--surface-2)]')}
      style={task.completed || overdue ? undefined : c ? courseStyle(c) : undefined}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={task.completed}
          onChange={(event) => {
            onToggle(task, event.target.checked)
            // 反向同步：Moodle 活动任务 → 服务器完成状态 + 内容树缓存。
            // fire-and-forget：列表更新不等网络；失败时树下次同步自愈。
            const cmid = taskCmidOf(task)
            if (cmid !== undefined) md.pushTaskCompletion(cmid, event.target.checked)
          }}
          className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
          aria-label={task.title}
        />
        <div className="min-w-0 flex-1">
          {/* 标题行：模块徽标 + 标题（未完成带课程色），右侧倒计时徽章 */}
          <div className="flex items-center justify-between gap-2">
            <div
              className={'min-w-0 truncate text-xs font-medium ' + (task.completed ? 'line-through text-[var(--text-3)]' : 'text-[var(--text-1)]')}
              style={task.completed || !c ? undefined : { color: c.text }}
            >
              <ModBadge task={task} />
              {task.title}
            </div>
            {priorityHint && !task.completed && (
              <span
                className="app-badge shrink-0 px-1.5 text-[var(--info)]"
                title={priorityHint}
              >
                <Icon name="jump" size={10} /> {t('taskDoFirst')}
              </span>
            )}
            {leftMin != null && (
              <span className="app-badge app-badge-due shrink-0">
                <Icon name="hourglass" size={11} /> {leftMin >= 60 ? t('durationHM', { h: Math.floor(leftMin / 60), m: leftMin % 60 }) : t('durationM', { m: leftMin })}
              </span>
            )}
          </div>
          {/* 信息行：课程（可跳转）/ 截止 / 开课 / 提交状态 */}
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
            {task.dueAt && (
              <span className={'inline-flex items-center gap-1' + (overdue ? ' font-medium text-[var(--danger)]' : '')}>
                <Icon name="clock" size={11} /> {formatDateTime(task.dueAt, locale)}{overdue ? ` · ${t('taskOverdue')}` : ''}
              </span>
            )}
            {task.startAt && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <Icon name="live" size={10} /> {formatDateTime(task.startAt, locale)}
              </span>
            )}
            {st && (st.state === 'graded' || st.state === 'submitted') && <SubmissionBadge st={st} />}
          </div>
          {task.note && <TruncatedNote note={task.note} />}
        </div>
        <div className="flex shrink-0 gap-1">
          {task.url && (
            <ExternalLink
              href={String(task.url)}
              className="app-btn-ghost px-1.5 py-1 text-[10px]"
              title={t('dueOpenActivity')}
              stopPropagation
            >
              <Icon name="external" size={11} />
            </ExternalLink>
          )}
          {!isMoodle && onEdit && (
            <button onClick={() => onEdit(task)} className="app-btn-ghost px-1.5 py-1" title={t('edit')}><Icon name="pencil" size={11} /></button>
          )}
          {!isMoodle && onDelete && (
            <button onClick={() => onDelete(task)} className="app-btn-ghost px-1.5 py-1 text-[var(--danger)]" title={t('delete')}><Icon name="close" size={11} /></button>
          )}
        </div>
      </div>
    </li>
  )
}

/** 任务课程对应的日历内代码（着色与跳转用）；无匹配返回 null。 */
function courseCodeOf(course: string | undefined, lessons: Lesson[]): string | null {
  if (!course) return null
  const matched = matchCourseCode(course, lessons)
  if (matched) return matched
  const norm = normalizeCourseCode(course)
  if (lessons.some((l) => l.code && normalizeCourseCode(l.code) === norm)) return norm
  return null
}
