import { useState } from 'react'
import { useI18n } from '../i18n'
import Icon from './Icon'
import { formatDateTime, formatTime } from '../lib/date'
import {
  CHANGE_KIND_KEY,
  summarizeChanges,
  type SyncAudit,
  type SyncChange,
} from '../lib/syncAudit'

/**
 * 同步变更记录：把每次同步的「新增 / 时间变动 / 换教室 / 标题变动 / 取消」
 * 列出来，点一行展开明细。
 *
 * 数据来自 lib/syncAudit（同步时 diff 落盘），这里只负责展示——
 * 概览一眼能看完，明细按需展开，不把设置页塞满。
 */
export default function SyncAuditPanel({
  audits,
  onClear,
}: {
  audits: SyncAudit[]
  onClear: () => void
}) {
  const { t, locale } = useI18n()
  const [openAt, setOpenAt] = useState<string | null>(null)

  if (audits.length === 0) {
    return <p className="text-[11px] text-[var(--text-3)]">{t('syncAuditEmpty')}</p>
  }

  return (
    <div className="space-y-1.5">
      {audits.map((a) => {
        const s = summarizeChanges(a.changes)
        const open = openAt === a.at
        return (
          <div key={a.at} className="rounded-md border border-[var(--line)] bg-[var(--surface-2)]">
            <button
              onClick={() => setOpenAt(open ? null : a.at)}
              aria-expanded={open}
              className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 text-left text-[11px]"
            >
              <span
                className={'collapse-chevron shrink-0 text-[var(--text-3)]' + (open ? ' open' : '')}
                aria-hidden
              >
                <Icon name="chevron-down" size={11} />
              </span>
              {/* 窄屏：日期留最小宽度，角标组挤不下就整体换行，
                  而不是把日期截成「9月26日周六…」 */}
              <span className="min-w-[8.5rem] flex-1 truncate">
                <span className="text-[var(--text-2)]">{formatDateTime(a.at, locale)}</span>{' '}
                <span className="text-[var(--text-3)]">· {a.sourceLabel}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {(['added', 'moved', 'room', 'title', 'cancelled'] as const).map((kind) =>
                  s[kind] > 0 ? (
                    <span
                      key={kind}
                      className={
                        'app-badge px-1.5 text-[9px] tabular-nums ' +
                        (kind === 'cancelled' || kind === 'moved' ? 'app-badge-due' : '')
                      }
                    >
                      {t(CHANGE_KIND_KEY[kind])} {s[kind]}
                    </span>
                  ) : null,
                )}
              </span>
            </button>
            <div className={`collapse-wrap${open ? ' open' : ' is-closed'}`} inert={!open}>
              <div>
                <ul className="space-y-1 px-2 pb-2">
                  {a.changes.map((c, i) => (
                    <li key={`${c.key}-${c.kind}-${i}`} className="text-[11px] leading-snug">
                      <span className="text-[var(--text-3)]">{t(CHANGE_KIND_KEY[c.kind])}</span>{' '}
                      <span className="text-[var(--text-1)]">{c.label}</span>{' '}
                      <span className="text-[var(--text-2)]">{detailOf(c, locale, t)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )
      })}
      <button
        onClick={onClear}
        className="w-full rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] px-2 py-1 text-[11px] text-[var(--text-3)]"
      >
        {t('syncAuditClear')}
      </button>
    </div>
  )
}

/** 单条明细的文字：时间类给前后时刻，字段类给「旧 → 新」 */
function detailOf(
  c: SyncChange,
  locale: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (c.kind === 'moved' && c.from && c.to) {
    return `${formatTime(c.from, locale)} → ${formatTime(c.to, locale)}`
  }
  if (c.kind === 'room' || c.kind === 'title') {
    return t('syncAuditFieldChange', { before: c.before ?? '—', after: c.after ?? '—' })
  }
  if (c.kind === 'added' && c.to) return formatTime(c.to, locale)
  if (c.kind === 'cancelled' && c.from) return formatTime(c.from, locale)
  return ''
}
