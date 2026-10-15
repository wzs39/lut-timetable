import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import Icon from './Icon'
import { formatDateTime } from '../lib/date'
import { PENDING_LIST_LIMIT } from '../lib/pendingNotifications'
import { loadReminderHealth, type ReminderHealth } from '../lib/reminderHealth'
import type { NotifFamily } from '../lib/notifLedger'

/**
 * 家族 → 面板标签键。刻意**不复用**各家族的「通知标题」（那些是通知正文里的措辞，
 * 如「即将上课」「今日课表」）：诊断列表要的是「哪一家」，不是那句通知读起来像什么。
 */
const FAMILY_LABEL_KEY: Record<NotifFamily, string> = {
  lesson: 'pendingNotifFamilyLesson',
  due: 'pendingNotifFamilyDue',
  exam: 'pendingNotifFamilyExam',
  digest: 'pendingNotifFamilyDigest',
  studyBlock: 'pendingNotifFamilyStudyBlock',
  sisuPlan: 'pendingNotifFamilySisuPlan',
}

/**
 * 诊断面板：既列出**系统队列里真正排上的提醒**，也把「应该有、却没有」摆出来
 * （Settings → 日志与订阅）。
 *
 * 为什么值得放在设置里：提醒是「排期成功才算功能可用」的功能，而排期失败在各平台上
 * 都是**静默**的（权限被拒、精确闹钟被拒、插件缺失、提醒点落在过去、WebView 重载
 * 把内存队列清掉）。用户勾了开关却什么都没发生，此前只能靠描述现象猜；现在他能看到
 * 队列内容，也能看到**记账与队列不一致**——那正是「本该响却没响」的直接证据。
 *
 * 只读：读一次队列并展示，不排期、不取消、不改任何存储。数据装配在
 * `lib/reminderHealth`（各家期望用**各自的纯粹函数**推导）、对账在三集合运算的
 * 唯一实现 `notifLedger.auditFamily` 里，这里只渲染。逐家列出的意义：一个家族静默
 * 失败时，用户看到的是**哪一家**缺条目，而不是一个说不清归属的总数。
 *
 * 刻意**不挂** revision/自动刷新信号：诊断要的是「点一下看此刻的状态」，后台同步来回
 * 触发重读只会让用户正在看的那一屏自己变掉。
 */
export default function PendingNotificationsPanel() {
  const { t, locale } = useI18n()
  const [health, setHealth] = useState<ReminderHealth | null>(null)
  const [reading, setReading] = useState(true)
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)

  const read = useCallback(() => {
    // 两个加载器都不会 reject（失败会包进结果里），所以状态一律在回调里落，
    // effect 本身不同步 setState（那是多余的一轮渲染）。
    return loadReminderHealth().then((next) => {
      setHealth(next)
      setCheckedAt(new Date())
      setReading(false)
      return next
    })
  }, [])

  useEffect(() => {
    void read()
  }, [read])

  const report = health?.report ?? null
  const audit = health?.audit ?? null
  const items = report ? report.items.slice(0, PENDING_LIST_LIMIT) : []
  const hidden = report ? Math.max(0, report.items.length - items.length) : 0
  const nextItem = report?.next ?? null
  const nextAt = nextItem?.at ?? null
  // 队列读不到时 audit 为 null：这时既不能报「已就位」也不能报「缺失」（假警报比没有诊断更坏）
  const totalMissing = (audit ?? []).reduce((sum, entry) => sum + entry.missing.length, 0)
  const totalStale = (audit ?? []).reduce((sum, entry) => sum + entry.stale.length, 0)

  return (
    <section>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
        <span className="inline-flex items-center gap-1.5">
          <Icon name="clock" size={12} /> {t('pendingNotifTitle')}
          {report?.ok ? ` (${report.items.length})` : ''}
        </span>
      </h4>
      <p className="text-[11px] text-[var(--text-3)]">{t('pendingNotifHint')}</p>

      {/* 记账 ↔ 队列对账：先说「该响的到底排上没有」（逐家），再看队列明细 */}
      {audit && totalMissing > 0 && (
        <p className="mt-2 rounded-md border border-[var(--line-due)] bg-[var(--tint-due)] px-2 py-1.5 text-[11px] text-[var(--due)]">
          {t('pendingNotifMissingAny', { n: totalMissing })}
        </p>
      )}
      {audit && audit.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2 text-[11px]">
          {audit.map((entry) => (
            <li key={entry.family} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[var(--text-2)]" title={t(FAMILY_LABEL_KEY[entry.family])}>
                {t(FAMILY_LABEL_KEY[entry.family])}
              </span>
              <span className="shrink-0 tabular-nums">
                {entry.missing.length > 0 ? (
                  <span className="text-[var(--due)]">
                    {t('pendingNotifFamilyMissing', { n: entry.missing.length })}
                  </span>
                ) : entry.expected.length > 0 ? (
                  <span className="text-[var(--ok)]">
                    {t('pendingNotifFamilyOk', { n: entry.expected.length })}
                  </span>
                ) : (
                  <span className="text-[var(--text-3)]">{t('pendingNotifFamilyNone')}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {audit && totalStale > 0 && (
        <p className="mt-1 text-[10px] text-[var(--text-3)]">
          {t('pendingNotifFamilyStale', { n: totalStale })}
        </p>
      )}

      {report && !report.ok && (
        <p className="mt-2 rounded-md border border-[var(--line-due)] bg-[var(--tint-due)] px-2 py-1.5 text-[11px] text-[var(--due)]">
          {t('pendingNotifError', { msg: report.error ?? '' })}
        </p>
      )}

      {report?.ok && report.items.length === 0 && (
        <p className="mt-2 text-[11px] text-[var(--text-3)]">{t('pendingNotifEmpty')}</p>
      )}

      {report?.ok && report.items.length > 0 && (
        <div className="mt-2 space-y-1 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2 text-[11px]">
          {nextItem && nextAt && (
            <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-1.5">
              <span className="min-w-0 truncate text-[var(--text-2)]">
                {t('pendingNotifNext', { time: formatDateTime(nextAt, locale), title: nextItem.title })}
              </span>
            </div>
          )}
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                <span
                  className="shrink-0 tabular-nums text-[var(--text-3)]"
                  title={item.at ? formatDateTime(item.at, locale) : undefined}
                >
                  {item.at ? formatDateTime(item.at, locale) : t('pendingNotifNoTime')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[var(--text-1)]" title={item.title}>
                    {item.title || t('pendingNotifUntitled')}
                  </span>
                  {item.body && (
                    <span className="block truncate text-[10px] text-[var(--text-3)]" title={item.body}>
                      {item.body}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {hidden > 0 && <p className="text-[10px] text-[var(--text-3)]">{t('pendingNotifMore', { n: hidden })}</p>}
          {report.overdue > 0 && (
            <p className="text-[10px] text-[var(--due)]">{t('pendingNotifOverdue', { n: report.overdue })}</p>
          )}
        </div>
      )}

      <button
        onClick={() => {
          setReading(true)
          void read()
        }}
        disabled={reading}
        className="mt-1.5 w-full rounded-md bg-[var(--surface-2)] px-2 py-1.5 text-[11px] hover:bg-[var(--hover-1)] disabled:opacity-50"
      >
        {reading ? t('pendingNotifRefreshing') : t('pendingNotifRefresh')}
      </button>
      {checkedAt && (
        <p className="mt-1 text-[10px] text-[var(--text-3)]">
          {t('pendingNotifCheckedAt', { time: formatDateTime(checkedAt.toISOString(), locale) })}
        </p>
      )}
    </section>
  )
}
