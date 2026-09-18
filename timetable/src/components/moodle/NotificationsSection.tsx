import { useCallback, useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../i18n'
import { useMoodleData } from '../../hooks/useMoodleData'
import type { MoodleNotification, NotificationKind } from '../../lib/notificationsFeed'
import { unreadByKind, notificationCourses } from '../../lib/notificationsFeed'
import { loadEnrolledCourses, extractCourseCode } from '../../lib/courses'
import { openExternal } from '../../lib/openExternal'
import Icon from '../Icon'

const KINDS: readonly (NotificationKind | 'all')[] = ['all', 'forum', 'submission', 'quiz', 'receipt', 'system']
const KIND_KEY: Record<NotificationKind, string> = {
  forum: 'notifKindForum',
  submission: 'notifKindSubmission',
  quiz: 'notifKindQuiz',
  receipt: 'notifKindReceipt',
  system: 'notifKindSystem',
}

export default function NotificationsSection() {
  const { t, locale } = useI18n()
  const { notifications, markNotificationRead, refreshNotifications, token } = useMoodleData()
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (f = false) => {
      if (busy) return
      setBusy(true)
      try {
        // Satu pemilik: hasil masuk state provider → badge navigasi ikut segar.
        await refreshNotifications(f)
      } catch {
        /* fetchNotifications swallows into cache */
      } finally {
        setBusy(false)
      }
    },
    [busy, refreshNotifications],
  )

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token?.token])

  const open = (n: MoodleNotification) => {
    if (!n.read) markNotificationRead(n.id)
  }

  const [filter, setFilter] = useState<NotificationKind | 'all'>('all')
  // 课程筛选：null = 全部课程。courseid 来自通知 payload/customdata。
  const [courseFilter, setCourseFilter] = useState<number | null>(null)
  // 回执默认隐藏：一条可展开的收纳条 + 计数（选择持久化到 storage）。
  const [showReceipts, setShowReceipts] = useState(false)
  const counts = useMemo(() => {
    const c: Record<NotificationKind | 'all', number> = { all: notifications?.length ?? 0, forum: 0, submission: 0, quiz: 0, receipt: 0, system: 0 }
    for (const n of notifications ?? []) c[n.kind]++
    return c
  }, [notifications])
  const shown = useMemo(
    () =>
      (filter === 'all' ? notifications : notifications?.filter((n) => n.kind === filter) ?? null)
        ?.filter((n) => showReceipts || n.kind !== 'receipt')
        ?.filter((n) => courseFilter == null || n.courseid === courseFilter) ?? null,
    [notifications, filter, showReceipts, courseFilter],
  )
  const receiptsHidden = (counts.receipt ?? 0) > 0 && !showReceipts && (filter === 'all' || filter === 'receipt')
  // 未读按分类细分：chip 上的蓝色徽标（回执 chip 也计，见 unreadByKind）。
  const unread = useMemo(() => unreadByKind(notifications), [notifications])
  const unreadTotal = useMemo(
    () => Object.values(unread).reduce((a, b) => a + b, 0),
    [unread],
  )
  // 按课程分组（有 courseid 的通知），课程名映射自 enrol 缓存。
  const courses = useMemo(() => notificationCourses(notifications), [notifications])
  const courseNames = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of loadEnrolledCourses() ?? []) m.set(c.courseid, c.shortname)
    return m
  }, [courses]) // eslint-disable-line react-hooks/exhaustive-deps

  if (notifications === null) {
    return <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('notifLoading')}</p>
  }
  if (notifications.length === 0) {
    return <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('notifEmpty')}</p>
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button onClick={() => void load(true)} disabled={busy} className="app-btn px-2 py-1 text-[11px] disabled:opacity-50">
          <span className="inline-flex items-center gap-1"><Icon name="restore" size={11} /> {t('notifRefresh')}</span>
        </button>
      </div>
      {counts.all > 1 && (
        <div className="app-seg flex flex-wrap" role="tablist">
          {KINDS.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={filter === k}
              onClick={() => setFilter(k)}
              className="px-2 py-1 text-[11px]"
            >
              {t(k === 'all' ? 'notifAll' : KIND_KEY[k])} {counts[k] > 0 && (
                <span className="tabular-nums text-[var(--text-3)]">{counts[k]}</span>
              )}
              {(k === 'all' ? unreadTotal : unread[k]) > 0 && (
                <span className="ml-0.5 rounded-full border border-[var(--line-info)] bg-[var(--tint-info)] px-1.5 py-px text-[9px] font-semibold leading-none tabular-nums text-[var(--info)]">
                  {k === 'all' ? unreadTotal : unread[k]}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
      {courses.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {courses.map(({ courseid, count, unread }) => {
            const name = courseNames.get(courseid)
            const label = (name && (extractCourseCode(name) ?? name)) || `Course ${courseid}`
            const active = courseFilter === courseid
            return (
              <button
                key={courseid}
                onClick={() => setCourseFilter(active ? null : courseid)}
                aria-pressed={active}
                className={
                  'inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition ' +
                  (active
                    ? 'border-[var(--info)] bg-[var(--tint-info)] text-[var(--info)]'
                    : 'border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-2)] hover:border-[var(--line-info)]')
                }
                title={name ?? String(courseid)}
              >
                <span className="truncate">{label}</span>
                <span className="tabular-nums text-[var(--text-3)]">{count}</span>
                {unread > 0 && (
                  <span className="rounded-full border border-[var(--line-info)] bg-[var(--tint-info)] px-1 text-[9px] font-semibold leading-none tabular-nums text-[var(--info)]">
                    {unread}
                  </span>
                )}
              </button>
            )
          })}
          {courseFilter != null && (
            <button
              onClick={() => setCourseFilter(null)}
              className="inline-flex items-center rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--text-3)] hover:text-[var(--text-1)]"
            >
              {t('notifAll')}
            </button>
          )}
        </div>
      )}
      <ul className="space-y-1.5">
        {(shown ?? []).map((n) => (
          <li
            key={n.id}
            className={
              'rounded-lg border p-2 ' +
              (n.read ? 'border-[var(--line)] bg-[var(--surface-2)]' : 'border-[var(--line-info)] bg-[var(--tint-info)]')
            }
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--info)]" aria-label={t('notifUnread')} />}
                  {n.url ? (
                    <span
                      className="block truncate text-xs font-medium text-[var(--info)] hover:underline"
                      title={n.subject}
                    >
                      <a
                        href={n.url}
                        className="block truncate"
                        rel="noreferrer"
                        onClick={(e) => {
                          e.preventDefault()
                          if (n.url) openExternal(n.url)
                          markNotificationRead(n.id)
                        }}
                      >
                        {n.subject}
                      </a>
                    </span>
                  ) : (
                    <button
                      onClick={() => open(n)}
                      className="block truncate text-xs font-medium"
                      title={n.subject}
                    >
                      {n.subject}
                    </button>
                  )}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--text-3)]">
                  <span className="rounded bg-[var(--surface-1)] px-1 py-px text-[9px] font-medium text-[var(--text-2)]">
                    {t(KIND_KEY[n.kind])}
                  </span>
                  {n.from && <span className="truncate">{n.from}</span>}
                  {n.time && (
                    <span className="tabular-nums">
                      {new Date(n.time).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
                {n.body && <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--text-2)]">{n.body}</p>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {receiptsHidden && (
        <button
          onClick={() => setShowReceipts(true)}
          className="app-btn w-full px-2 py-1 text-[11px] text-[var(--text-3)]"
        >
          {t('notifReceiptsHidden').replace('{n}', String(counts.receipt))}
        </button>
      )}
      {showReceipts && counts.receipt > 0 && (
        <button
          onClick={() => setShowReceipts(false)}
          className="app-btn w-full px-2 py-1 text-[11px] text-[var(--text-3)]"
        >
          {t('notifReceiptsShowLess')}
        </button>
      )}
    </div>
  )
}
