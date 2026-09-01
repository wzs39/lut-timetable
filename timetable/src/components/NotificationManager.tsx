import { useEffect } from 'react'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { refreshNotifications, cancelAllNotifications } from '../lib/notifications'

interface Props {
  enabled: boolean
  lessons: Lesson[]
}

/**
 * Komponen tak terlihat: menjaga jadwal notifikasi tetap sinkron
 * dengan daftar pelajaran (saat data berubah + tiap 10 menit).
 */
export default function NotificationManager({ enabled, lessons }: Props) {
  const { t, lang } = useI18n()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'

  useEffect(() => {
    if (!enabled) {
      cancelAllNotifications().catch(() => {})
      return
    }
    const texts = {
      title: t('notifTitle'),
      body: (l: Lesson, startTime: string) =>
        t('notifBody', {
          title: l.code ? `${l.code} ${l.title}` : l.title,
          time: startTime,
          loc: l.location ? ` · ${l.location}` : '',
        }),
    }
    const refresh = () =>
      refreshNotifications(lessons, texts, locale).catch(() => {})
    refresh()
    const iv = setInterval(refresh, 10 * 60 * 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lessons, lang])

  // Tampilkan notifikasi yang dikirim saat aplikasi berjalan di foreground
  useEffect(() => {
    if (!enabled) return
    const listener = LocalNotifications.addListener(
      'localNotificationReceived',
      () => {},
    )
    return () => {
      listener.then((h) => h.remove()).catch(() => {})
    }
  }, [enabled])

  return null
}
