import { useI18n } from '../../i18n'
import Icon from '../Icon'
import type { SubmissionStatus } from '../../lib/submissions'

/**
 * 提交状态徽标：已评分（绿色，带分数，title=反馈）/ 已提交（蓝色）。
 * 任务卡与内容树共用——同一活动两边信息量一致，样式只维护这一份。
 */
export default function SubmissionBadge({ st }: { st: SubmissionStatus }) {
  const { t } = useI18n()
  if (st.state === 'graded') {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--line-ok)] bg-[var(--tint-ok)] px-1.5 py-0 text-[9px] font-medium leading-[14px] text-[var(--ok)]"
        title={st.feedback || undefined}
      >
        <Icon name="check" size={9} /> {t('subGraded')}{st.grade ? ` ${st.grade}` : ''}
      </span>
    )
  }
  if (st.state === 'submitted') {
    return (
      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--line-info)] bg-[var(--tint-info)] px-1.5 py-0 text-[9px] font-medium leading-[14px] text-[var(--info)]">
        <Icon name="check" size={9} /> {t('subSubmitted')}
      </span>
    )
  }
  return null
}
