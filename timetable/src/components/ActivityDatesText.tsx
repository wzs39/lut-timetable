import { useI18n } from '../i18n'
import { formatDateTime, formatDateTimeShort } from '../lib/date'
import { deadlineLabelKey } from '../lib/tasks'
import Icon from './Icon'

/**
 * 「开放 → 截止/关闭 · 迟交截止」的唯一渲染件（内容树 / 成绩卡 / 其他窄行共用）。
 *
 * 数据来自 `useMoodleData().activityDatesByCmid`（活动自身声明的日期），
 * 所以同一 cmid 在任何界面看到的时间都一致。窄行用紧凑格式，title 里给
 * 完整时间；逾期着色沿用 `taskOverdue` 文案。
 *
 * `kind`（Moodle modname）只影响文案：测验关闭（Closes）不是作业截止（Due）。
 * `cutoffAt` 是 assign 的迟交宽限终点，与 due 分开展示——due 过了还能交，
 * 两者混成一个日期会让用户以为已经错过。`gradingDueAt` 是教师批改期限，
 * 再单独一条（不是学生还能交到那一刻）。
 */
export default function ActivityDatesText({
  startAt,
  dueAt,
  cutoffAt,
  gradingDueAt,
  kind,
  overdue = false,
  className = '',
}: {
  startAt?: string
  dueAt?: string
  cutoffAt?: string
  /** 评分截止（Moodle `gradingduedate`）：教师批改期限。 */
  gradingDueAt?: string
  /** Moodle 模块名（`quiz` / `assign` / …）；缺省按作业「截止」渲染。 */
  kind?: string
  overdue?: boolean
  className?: string
}) {
  const { t, locale } = useI18n()
  if (!startAt && !dueAt && !cutoffAt && !gradingDueAt) return null

  const showCutoff = !!cutoffAt && cutoffAt !== dueAt
  const showGrading = !!gradingDueAt && gradingDueAt !== dueAt && gradingDueAt !== cutoffAt
  const dueLabel = t(deadlineLabelKey(kind))
  const window = [
    startAt ? `${t('taskOpens')} ${formatDateTime(startAt, locale)}` : '',
    dueAt ? `${dueLabel} ${formatDateTime(dueAt, locale)}` : '',
  ]
    .filter(Boolean)
    .join(' → ')
  const full = [
    window,
    showCutoff ? `${t('taskCutoff')} ${formatDateTime(cutoffAt, locale)}` : '',
    showGrading ? `${t('taskGradingDue')} ${formatDateTime(gradingDueAt, locale)}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <span
      className={'inline-flex shrink-0 items-center gap-1 tabular-nums ' + className}
      title={full}
    >
      <Icon name="clock" size={10} />
      {startAt && <span>{formatDateTimeShort(startAt, locale)}</span>}
      {startAt && dueAt && <span aria-hidden="true">→</span>}
      {dueAt && (
        <span className={overdue ? 'text-[var(--danger)]' : undefined}>
          {formatDateTimeShort(dueAt, locale)}
          {overdue ? ` · ${t('taskOverdue')}` : ''}
        </span>
      )}
      {showCutoff && (
        <span>
          {dueAt ? '· ' : ''}
          {t('taskCutoffShort')} {formatDateTimeShort(cutoffAt, locale)}
        </span>
      )}
      {showGrading && (
        <span>
          {dueAt || showCutoff ? '· ' : ''}
          {t('taskGradingDueShort')} {formatDateTimeShort(gradingDueAt, locale)}
        </span>
      )}
    </span>
  )
}
