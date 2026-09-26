import { useEffect } from 'react'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import {
  cancelLessonReminders,
  refreshNotifications,
  cancelAllNotifications,
} from '../lib/notifications'
import { cancelDueReminders, refreshDueNotifications } from '../lib/dueNotifications'
import { cancelExamReminders, refreshExamReminders } from '../lib/examReminders'
import { cancelDigestNotifications, refreshDigestNotifications } from '../lib/dailyDigest'
import { dueSubscriptions, type Subscription } from '../lib/subscriptions'
import { loadAudits, CHANGE_KIND_KEY } from '../lib/syncAudit'
import { freeRoomsNow } from '../lib/freeRooms'
import { notifyNow } from '../lib/notifications'
import type { Task } from '../lib/tasks'

interface Props {
  enabled: boolean
  /** Ringkasan harian (07:30) — saklar terpisah, izin notifikasi tetap sama */
  digestEnabled?: boolean
  lessons: Lesson[]
  /** Tugas/assignment — pengingat 24h + 1h sebelum tenggat */
  tasks?: Task[]
  /** 订阅式提醒（课程变动 / 教室空出）——判定在 lib/subscriptions */
  subscriptions?: Subscription[]
  /** 已触发的订阅 → App 写回 lastFiredAt（单一拥有者仍然是 App） */
  onSubscriptionsFired?: (ids: string[], atIso: string) => void
}

/**
 * Komponen tak terlihat: menjaga jadwal notifikasi tetap sinkron
 * dengan daftar pelajaran (saat data berubah + tiap 10 menit).
 */
export default function NotificationManager({
  enabled,
  digestEnabled = false,
  lessons,
  tasks = [],
  subscriptions = [],
  onSubscriptionsFired,
}: Props) {
  const { t, lang, locale } = useI18n()

  useEffect(() => {
    // 两个开关都关：清空所有通知（含残留）
    if (!enabled && !digestEnabled) {
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
    const examTexts = {
      title: t('examRemindTitle'),
      body: (l: Lesson, days: number, time: string, loc: string) =>
        t('examRemindBody', {
          d: days,
          name: l.code ? `${l.code} ${l.title}` : l.title,
          time,
          loc,
        }),
    }
    const digestTexts = {
      title: t('digestTitle'),
      empty: t('digestEmpty'),
      body: (n: number, time: string, loc: string) => t('digestBody', { n, time, loc }),
    }
    /**
     * 订阅提醒：与课程/任务提醒同一条推送路径，但判定在纯函数里。
     * - course-change 只看「刚刚发生的同步」（1 小时内的审计），否则一次旧变动
     *   会在冷却期结束后反复被报出来；
     * - room-free 用当前空闲教室推算（10 分钟一次，足够及时）。
     */
    const fireSubscriptions = async () => {
      if (subscriptions.length === 0) return
      const now = Date.now()
      const latest = loadAudits()[0]
      const auditAt = latest ? new Date(latest.at).getTime() : 0
      const fresh = latest && now - auditAt <= 60 * 60 * 1000 ? latest.changes : []
      const due = dueSubscriptions(subscriptions, {
        changes: fresh,
        freeRooms: freeRoomsNow(lessons, new Date(now)),
        now,
      })
      if (due.length === 0) return
      for (const sub of due) {
        if (sub.kind === 'course-change') {
          const change = fresh.find((c) => c.label.toLowerCase().includes(sub.target.toLowerCase()))
          void notifyNow(
            t('subNotifCourseTitle'),
            t('subNotifCourseBody', {
              label: sub.label,
              detail: change ? t(CHANGE_KIND_KEY[change.kind]) : t('subKindCourse'),
            }),
            `sub:${sub.id}:${latest?.at ?? ''}`,
          )
        } else {
          void notifyNow(
            t('subNotifRoomTitle'),
            t('subNotifRoomBody', { label: sub.label }),
            `sub:${sub.id}:${new Date(now).toISOString().slice(0, 10)}`,
          )
        }
      }
      onSubscriptionsFired?.(
        due.map((s) => s.id),
        new Date(now).toISOString(),
      )
    }

    const refresh = () => {
      // 各自独立的开关：关掉的那一类只清自己的条目，不误伤另一类
      if (enabled) {
        void fireSubscriptions()
        refreshNotifications(lessons, texts, locale).catch(() => {})
        refreshDueNotifications(tasks, dueTexts, locale).catch(() => {})
        refreshExamReminders(lessons, examTexts, locale).catch(() => {})
      } else {
        cancelLessonReminders(lessons).catch(() => {})
        cancelDueReminders(tasks).catch(() => {})
        cancelExamReminders(lessons).catch(() => {})
      }
      if (digestEnabled) refreshDigestNotifications(lessons, digestTexts, locale).catch(() => {})
      else cancelDigestNotifications().catch(() => {})
    }
    refresh()
    const iv = setInterval(refresh, 10 * 60 * 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, digestEnabled, lessons, tasks, lang, subscriptions, onSubscriptionsFired, t])

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
