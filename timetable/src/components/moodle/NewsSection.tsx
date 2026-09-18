import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { useMoodleData } from '../../hooks/useMoodleData'
import {
  currentAnnouncementSource,
  fetchAnnouncements,
  loadCachedAnnouncements,
  type Announcement,
} from '../../lib/announcements'
import Icon from '../Icon'
import CollapsiblePanel from '../CollapsiblePanel'
import { AnnouncementsList } from '../AnnouncementsPanel'
import { KEYS } from '../../lib/storage'

/** Tab Berita: forum pengumuman per kursus (panel collapsible + refresh). */
export default function NewsSection() {
  const { t } = useI18n()
  const { token } = useMoodleData()
  const [news, setNews] = useState<Announcement[] | null>(() => loadCachedAnnouncements())
  const [newsBusy, setNewsBusy] = useState(false)
  const [newsLoadedOnce, setNewsLoadedOnce] = useState(false)

  const refreshNews = useCallback(async () => {
    if (newsBusy) return
    setNewsBusy(true)
    try {
      setNews(await fetchAnnouncements(currentAnnouncementSource()))
    } catch {
      /* fetchAnnouncements swallows errors into cache fallback */
    } finally {
      setNewsBusy(false)
    }
  }, [newsBusy])

  // Pasang tab Berita: muat cache dulu, ambil data baru di belakang layar.
  useEffect(() => {
    if (newsLoadedOnce || !token) return
    setNewsLoadedOnce(true)
    const id = window.setTimeout(() => void refreshNews(), 400)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <CollapsiblePanel
      storageKey={KEYS.moodleNewsOpen}
      label={
        <span className="app-card-label inline-flex items-center gap-1.5">
          <Icon name="megaphone" size={12} /> {t('announcementsTitle')}
          {news && news.length > 0 && (
            <span className="app-badge px-1.5 py-0.5 text-[10px]">{news.length}</span>
          )}
        </span>
      }
      right={
        <button
          onClick={(e) => {
            e.stopPropagation()
            void refreshNews()
          }}
          disabled={newsBusy}
          className="app-btn-ghost px-1.5 py-1 disabled:opacity-50"
          title={t('announcementsRefresh')}
        >
          <Icon name="restore" size={12} />
        </button>
      }
    >
      {news === null && <p className="text-[11px] text-[var(--text-3)]">{t('announcementsLoading')}</p>}
      {news !== null && news.length === 0 && (
        <p className="text-[11px] text-[var(--text-3)]">{t('announcementsEmpty')}</p>
      )}
      {news !== null && news.length > 0 && <AnnouncementsList items={news} />}
    </CollapsiblePanel>
  )
}
