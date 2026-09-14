import { useEffect } from 'react'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { refreshNotifications, cancelAllNotifications } from '../lib/notifications'
import { refreshDueNotifications } from '../lib/dueNotifications'
import type { Task } from '../lib/tasks'

interface Props {
  enabled: boolean
  lessons: Lesson[]
  /** Tugas/assignment — pengingat 24h + 1h sebelum tenggat */
  tasks?: Task[]
}

/**
 * Komponen tak terlihat: menjaga jadwal notifikasi tetap sinkron
 * dengan daftar pelajaran (saat data berubah + tiap 10 menit).
 */
export default function NotificationManager({ enabled, lessons, tasks = [] }: Props) {
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
    const dueTexts = {
      title: t('dueNotifTitle'),
      // beforeH: 24 = 提前一天, 1 = 提前 1 小时
      body: (task: Task, dueText: string, beforeH: number) =>
        t('dueNotifBody', { title: task.title, due: dueText, h: beforeH }),
    }
    const refresh = () => {
      refreshNotifications(lessons, texts, locale).catch(() => {})
      refreshDueNotifications(tasks, dueTexts, locale).catch(() => {})
    }
    refresh()
    const iv = setInterval(refresh, 10 * 60 * 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lessons, tasks, lang])

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
