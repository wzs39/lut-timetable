import { useI18n } from '../i18n'
import { moduleTypeOf } from '../lib/tasks'
import type { Task } from '../lib/tasks'
import Icon from './Icon'

/**
 * 模块类型徽标（quiz/workshop/attendance/assign/通用），取自 moduleTypeOf 单一判定。
 * 今日页任务行与作业页任务卡共用——此前 TodayView 只认 `modtype === 'quiz'`
 * 且用手写 app-badge 文本（与作业页图标样式不一致），这里统一成图标 + title。
 */
export function ModBadge({ task }: { task: Task }) {
  const { t } = useI18n()
  const mod = moduleTypeOf(task)
  const isMoodle = task.id.startsWith('moodle:') || task.id.startsWith('moodle-act:')
  const badge =
    mod === 'quiz' ? { icon: 'quiz' as const, key: 'moduleQuiz' } :
    mod === 'workshop' ? { icon: 'workshop' as const, key: 'moduleWorkshop' } :
    mod === 'attendance' ? { icon: 'attendance' as const, key: 'moduleAttendance' } :
    mod && mod !== 'assign' ? { icon: 'assignment' as const, key: 'moduleGeneric' } :
    mod === 'assign' ? { icon: 'assignment' as const, key: 'moduleAssign' } : null
  if (badge) {
    return (
      <span className="ml-1.5 inline-flex translate-y-[-1px] items-center" title={t(badge.key)}>
        <Icon name={badge.icon} size={12} />
      </span>
    )
  }
  return isMoodle ? (
    <span className="mr-1 inline-flex align-[-2px]" title="Moodle">
      <Icon name="assignment" size={11} />
    </span>
  ) : null
}
