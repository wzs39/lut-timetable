import { useState } from 'react'
import { useI18n } from '../../i18n'
import { useMoodleData } from '../../hooks/useMoodleData'
import type { CourseModule, CourseSection } from '../../lib/contents'
import { markActivityCompletion } from '../../lib/contents'
import { formatDateTime } from '../../lib/date'
import { useNowDate } from '../../lib/useNow'
import type { IconName } from '../Icon'
import ExternalLink from '../ExternalLink'
import Icon from '../Icon'
import SubmissionBadge from './SubmissionBadge'

const MOD_ICON: Record<string, IconName> = {
  assign: 'pencil',
  quiz: 'exam',
  forum: 'megaphone',
  resource: 'book',
  book: 'book',
  url: 'link',
  page: 'note',
  folder: 'book',
  label: 'pin',
  choice: 'check',
  feedback: 'check',
  glossary: 'book',
  wiki: 'book',
  scorm: 'live',
  h5pactivity: 'live',
  bigbluebuttonbn: 'live',
  lesson: 'book',
  workshop: 'pencil',
  imscp: 'book',
  survey: 'check',
  data: 'book',
  chat: 'megaphone',
}

/** Completion state Moodle: 0 belum, 1 selesai, 2 lulus (dihitung selesai), 3 gagal. */
function isComplete(state: number | undefined): boolean {
  return state === 1 || state === 2
}

export default function CourseContentsTree({
  sections,
  onRefresh,
  busy,
  onToggleComplete,
}: {
  sections: CourseSection[]
  onRefresh: () => void
  busy: boolean
  onToggleComplete?: () => void
}) {
  const { t, locale } = useI18n()
  const now = useNowDate()
  const { subByCmid, applyCompletion } = useMoodleData()
  const [pendingCmid, setPendingCmid] = useState<number | null>(null)

  const toggle = async (m: CourseModule) => {
    if (!m.url || pendingCmid != null) return
    const cmid = Number(new URL(m.url, 'https://moodle.lut.fi').searchParams.get('id'))
    if (!Number.isFinite(cmid)) return
    const completing = !isComplete(m.completion)
    setPendingCmid(cmid)
    const ok = await markActivityCompletion(tokenHolder.src, cmid, completing)
    setPendingCmid(null)
    if (!ok) return
    // 同步任务列表：勾选完成 → 归档同活动（cmid 联接）的任务；取消 → 恢复。
    applyCompletion(cmid, completing)
    if (onToggleComplete) onToggleComplete()
  }

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          {t('contentsTitle')}
        </span>
        <button onClick={onRefresh} disabled={busy} className="app-btn-ghost px-1.5 py-0.5 disabled:opacity-50" title={t('contentsRefresh')}>
          <Icon name="restore" size={11} />
        </button>
      </div>
      <ul className="space-y-1.5">
        {sections.map((s) => (
          <li key={s.id}>
            <div className="text-[10px] font-semibold text-[var(--text-2)]">{s.name}</div>
            <ul className="mt-0.5 space-y-0.5">
              {s.modules.map((m) => {
                const done = isComplete(m.completion)
                const failed = m.completion === 3
                // 自动跟踪模块：完成对号语义是"服务器判定完成"，用户真正关心的是
                // 提交状态（已提交/已评分）——有提交/评分数据时用徽标替代对号。
                // 数据源 gradeitems 覆盖所有可评分模块（assign/quiz/workshop/…），
                // 不按 modname 过滤：map 里有的 cmid 就显示。
                const cmid = m.url ? Number(new URL(m.url, 'https://moodle.lut.fi').searchParams.get('id')) : NaN
                const sub = Number.isFinite(cmid) ? subByCmid.get(cmid) : undefined
                const hasSubBadge = sub?.state === 'submitted' || sub?.state === 'graded'
                const overdue = !!sub?.dueAt && new Date(sub.dueAt).getTime() < now.getTime()
                // 有提交/评分徽标时复选框仍然显示（与任务卡信息量一致：
                // 服务器完成态 + 提交态并存，互不替代）。
                const canToggle = Boolean(m.url) && !failed
                return (
                  <li key={m.id} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-[var(--surface-2)]">
                    <Icon name={MOD_ICON[m.modname] ?? 'book'} size={11} className="shrink-0 text-[var(--text-3)]" />
                    {m.url ? (
                      <ExternalLink href={m.url} className="min-w-0 flex-1 truncate text-[var(--info)] hover:underline" title={m.description || m.name}>
                        {m.name}
                      </ExternalLink>
                    ) : (
                      <span className="min-w-0 flex-1 truncate" title={m.description || m.name}>{m.name}</span>
                    )}
                    {/* 截止时间：与任务卡同一数据源（SubmissionStatus.dueAt，cmid 联接）
                        + 同一格式（formatDateTime）。逾期红字提示，同任务卡语义。 */}
                    {sub?.dueAt && (
                      <span
                        className={'inline-flex shrink-0 items-center gap-0.5 text-[10px] tabular-nums ' + (overdue ? 'text-[var(--danger)]' : 'text-[var(--text-3)]')}
                      >
                        <Icon name="clock" size={10} />
                        {formatDateTime(sub.dueAt, locale)}
                        {overdue && ` · ${t('taskOverdue')}`}
                      </span>
                    )}
                    {hasSubBadge && sub && <SubmissionBadge st={sub} />}
                    {canToggle ? (
                      <button
                        onClick={() => void toggle(m)}
                        disabled={pendingCmid != null}
                        className="shrink-0 disabled:opacity-50"
                        title={done ? t('contentsMarkIncomplete') : t('contentsMarkComplete')}
                      >
                        {done ? (
                          <Icon name="check" size={11} className="text-[var(--ok)]" />
                        ) : (
                          <span className="inline-block h-[11px] w-[11px] rounded-[3px] border border-[var(--line)]" aria-hidden="true" />
                        )}
                      </button>
                    ) : failed ? (
                      <Icon name="close" size={11} className="shrink-0 text-[var(--danger)]" />
                    ) : null}
                  </li>
                )
              })}
              {s.modules.length === 0 && <li className="py-0.5 text-[10px] text-[var(--text-3)]">{t('contentsSectionEmpty')}</li>}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}

// Token holder: CourseContentsToggle memasang src sebelum render tree, agar
// tree tetap presentational (tanpa prop drilling token di tiap node).
const tokenHolder: { src: { token: string; userid?: number } | null } = { src: null }
export function setContentsTokenSource(src: { token: string; userid?: number } | null): void {
  tokenHolder.src = src
}
