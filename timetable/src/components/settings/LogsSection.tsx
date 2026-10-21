import { useState } from 'react'
import { useI18n } from '../../i18n'
import Icon from '../Icon'
import { TYPE_META } from '../../lib/lessonTypes'
import { parseNoteKey, scopeText, type NotesMap } from '../../lib/notes'
import type { Subscription } from '../../lib/subscriptions'
import PendingNotificationsPanel from '../PendingNotificationsPanel'
import { SectionTitle } from './shared'

/**
 * 日志与订阅：订阅式提醒列表 / 本地错误日志 / 已排期通知 / 课程备注。
 *
 * 这一组全是「本机数据」的只读或删除操作：不写服务器，不新建机制。
 * 真正的排期与存储分别在 lib/subscriptions、lib/errorLog、lib/notes。
 */
export default function LogsSection({
  subscriptions,
  onToggleSubscription,
  onRemoveSubscription,
  errorCount,
  onExportDiagnostics,
  onClearErrors,
  notes,
  onRemoveNote,
}: {
  subscriptions: Subscription[]
  onToggleSubscription: (id: string) => void
  onRemoveSubscription: (id: string) => void
  errorCount: number
  onExportDiagnostics: () => Promise<string>
  onClearErrors: () => void
  notes: NotesMap
  onRemoveNote: (key: string) => void
}) {
  const { t } = useI18n()
  const [diagMsg, setDiagMsg] = useState<string | null>(null)
  const entries = Object.entries(notes).sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <>
      {/* 订阅式提醒：本机判断、本机推送，这里只管列出与开关 */}
      <section>
        <SectionTitle>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="warn" size={12} /> {t('subsTitle')} ({subscriptions.length})
          </span>
        </SectionTitle>
        {subscriptions.length === 0 ? (
          <p className="text-[11px] text-[var(--text-3)]">{t('subsEmpty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {subscriptions.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px]"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={() => onToggleSubscription(s.id)}
                    className="accent-sky-500"
                  />
                  <span className="min-w-0 truncate text-[var(--text-1)]" title={s.label}>
                    {s.label}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--text-3)]">
                    {t(s.kind === 'course-change' ? 'subKindCourse' : 'subKindRoom')}
                  </span>
                </label>
                <button
                  onClick={() => onRemoveSubscription(s.id)}
                  className="shrink-0 text-[var(--text-3)] hover:text-[var(--danger)]"
                  title={t('subsRemove')}
                  aria-label={t('subsRemove')}
                >
                  <Icon name="trash" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 错误日志：本机最近几次异常 + 导出诊断（不能自动上报，用户手动发） */}
      <section>
        <SectionTitle>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="warn" size={12} /> {t('errorsTitle')} ({errorCount})
          </span>
        </SectionTitle>
        <p className="text-[11px] text-[var(--text-3)]">{t('errorsHint')}</p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={async () => {
              setDiagMsg(null)
              setDiagMsg(await onExportDiagnostics())
            }}
            className="flex-1 rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] px-2 py-1.5 text-xs"
          >
            {t('errorsExport')}
          </button>
          {errorCount > 0 && (
            <button
              onClick={() => {
                onClearErrors()
                setDiagMsg(t('errorsCleared'))
              }}
              className="shrink-0 rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] px-2 py-1.5 text-xs text-[var(--text-2)]"
            >
              {t('errorsClear')}
            </button>
          )}
        </div>
        {diagMsg && <p className="mt-1 text-[11px] text-[var(--text-2)]">{diagMsg}</p>}
      </section>

      {/* 已排期通知：从系统队列读回来的“真正排上的提醒”（只读诊断） */}
      <PendingNotificationsPanel />

      {/* 课程备注 */}
      <section>
        <SectionTitle>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="note" size={12} /> {t('notesTitle')} ({entries.length})
          </span>
        </SectionTitle>
        {entries.length === 0 ? (
          <p className="text-[11px] text-[var(--text-3)]">{t('notesEmpty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map(([key, n]) => {
              const parts = parseNoteKey(key)
              const typeLabel =
                parts.type && TYPE_META[parts.type]
                  ? t(TYPE_META[parts.type].key)
                  : t('noteScopeAny')
              return (
                <li
                  key={key}
                  className="flex items-start gap-2 rounded-md border border-[var(--line-due)] bg-[var(--tint-due)] px-2 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className="truncate text-[11px] font-medium text-[var(--due)]"
                      title={scopeText(parts.code, typeLabel)}
                    >
                      {scopeText(parts.code, typeLabel)}
                    </div>
                    <div
                      className="mt-0.5 line-clamp-2 text-[11px] text-[var(--due)]"
                      title={n.note}
                    >
                      {n.note}
                    </div>
                  </div>
                  <button
                    onClick={() => onRemoveNote(key)}
                    className="shrink-0 text-[var(--text-3)] hover:text-[var(--danger)]"
                    title={t('noteRemove')}
                  >
                    <Icon name="close" size={13} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-1.5 text-[10px] text-[var(--text-3)]">{t('notesHint')}</p>
      </section>
    </>
  )
}
