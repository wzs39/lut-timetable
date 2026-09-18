import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { useMoodleData } from '../../hooks/useMoodleData'
import type { MoodleNotification } from '../../lib/notificationsFeed'
import { openExternal } from '../../lib/openExternal'
import Icon from '../Icon'

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
      <ul className="space-y-1.5">
        {notifications.map((n) => (
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
    </div>
  )
}
