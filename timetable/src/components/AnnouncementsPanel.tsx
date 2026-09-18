import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n'
import Icon from './Icon'
import ExternalLink from './ExternalLink'
import CollapsiblePanel from './CollapsiblePanel'

/**
 * Daftar pengumuman polos (kartu per posting). Dipakai AnnouncementsPanel
 * (TodayView) dan MoodleView — satu pemilik tampilan daftar pengumuman.
 */
export function AnnouncementsList({ items }: { items: Announcement[] }) {
  const { locale } = useI18n()
  return (
    <ul className="space-y-1.5">
      {items.map((a) => (
        <li
          key={a.id}
          className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {a.url ? (
                <ExternalLink
                  href={a.url}
                  className="block truncate text-xs font-medium text-[var(--info)] hover:underline"
                  title={a.subject}
                >
                  {a.subject}
                </ExternalLink>
              ) : (
                <span className="block truncate text-xs font-medium">{a.subject}</span>
              )}
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-[var(--text-3)]">
                {a.course && <span className="font-mono">{a.course}</span>}
                {a.postedAt && (
                  <span className="tabular-nums">
                    {new Date(a.postedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}
                  </span>
                )}
                {a.author && <span className="truncate">{a.author}</span>}
              </div>
              {a.excerpt && (
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-[var(--text-2)]">
                  {a.excerpt}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
import { KEYS } from '../lib/storage'
import {
  currentAnnouncementSource,
  fetchAnnouncements,
  loadCachedAnnouncements,
  type Announcement,
} from '../lib/announcements'

/**
 * Panel pengumuman kursus (forum News) di TodayView. Mandiri: memuat cache
 * saat mount, mengambil data baru hanya saat panel dibuka pertama kali.
 * Tanpa token → panel tidak dirender (fitur opsional, tidak mengganggu).
 */
export default function AnnouncementsPanel() {
  const { t } = useI18n()
  const src = currentAnnouncementSource()
  const [items, setItems] = useState<Announcement[] | null>(() => loadCachedAnnouncements())
  const [busy, setBusy] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)

  const refresh = useCallback(async () => {
    if (busy) return
    setBusy(true)
    try {
      const list = await fetchAnnouncements(currentAnnouncementSource())
      setItems(list)
    } catch {
      // fetchAnnouncements already swallows errors into cache fallback
    } finally {
      setBusy(false)
    }
  }, [busy])

  // Muat sekali per sesi saat panel pertama terlihat di pohon (TodayView selalu
  // merender panel; fetch pertama ditunda setelah paint agar tidak menahan render).
  useEffect(() => {
    if (loadedOnce || !src?.token) return
    setLoadedOnce(true)
    const id = window.setTimeout(() => void refresh(), 800)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src?.token])

  if (!src?.token) return null

  return (
    <CollapsiblePanel
      storageKey={KEYS.todayAnnouncementsOpen}
      label={
        <span className="app-card-label inline-flex items-center gap-1.5">
          <Icon name="megaphone" size={12} /> {t('announcementsTitle')}
          {items && items.length > 0 && (
            <span className="app-badge px-1.5 py-0.5 text-[10px]">{items.length}</span>
          )}
        </span>
      }
      right={
        <button
          onClick={(e) => {
            e.stopPropagation()
            void refresh()
          }}
          disabled={busy}
          className="app-btn-ghost px-1.5 py-1 disabled:opacity-50"
          title={t('announcementsRefresh')}
        >
          <Icon name="restore" size={12} />
        </button>
      }
    >
      {items === null && <p className="text-[11px] text-[var(--text-3)]">{t('announcementsLoading')}</p>}
      {items !== null && items.length === 0 && (
        <p className="text-[11px] text-[var(--text-3)]">{t('announcementsEmpty')}</p>
      )}
      {items !== null && items.length > 0 && <AnnouncementsList items={items} />}
    </CollapsiblePanel>
  )
}
