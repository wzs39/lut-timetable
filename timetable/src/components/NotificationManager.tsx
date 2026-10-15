import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '../lib/localNotifications'
import type { ActionPerformed } from '@capacitor/local-notifications'
import { openExternal } from '../lib/openExternal'
import { normalizeMoodleLink } from '../lib/moodleUrl'
import { normalizeSisuStudyPlanUrl } from '../lib/sisuStudyPlanReminders'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { useMoodleData } from '../hooks/useMoodleData'
import {
  cancelLessonReminders,
  refreshNotifications,
  cancelAllNotifications,
  wantedLessonReminders,
} from '../lib/notifications'
import { cancelDueReminders, refreshDueNotifications, wantedReminders } from '../lib/dueNotifications'
import { cancelExamReminders, refreshExamReminders, wantedExamReminders } from '../lib/examReminders'
import {
  cancelDigestNotifications,
  digestIdFor,
  plannedDigestDays,
  refreshDigestNotifications,
} from '../lib/dailyDigest'
import {
  cancelStudyBlockReminders,
  refreshStudyBlockReminders,
  wantedStudyBlockReminders,
} from '../lib/studyBlockReminders'
import { healMissingReminders, type FamilyRepair } from '../lib/reminderHealth'
import { logError } from '../lib/errorLog'
import type { StudyBlock } from '../lib/studyBlocks'
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
  /** 已确认的学习块：开始前 10 分钟提醒（唯一开关是偏好里的 remindEnabled） */
  studyBlocks?: StudyBlock[]
  studyBlockRemindEnabled?: boolean
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
  studyBlocks = [],
  studyBlockRemindEnabled = false,
  subscriptions = [],
  onSubscriptionsFired,
}: Props) {
  const { t, lang, locale } = useI18n()
  const { refreshFromNotification } = useMoodleData()

  useEffect(() => {
    // 两个开关都关：清空所有通知（含残留）。学习块提醒另清一次自己的记账清单，
    // 否则“已排期 id”会与实际排期漂移，下次开启时对账就是基于脏数据。
    if (!enabled && !digestEnabled) {
      cancelAllNotifications().catch(() => {})
      cancelStudyBlockReminders().catch(() => {})
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
    const studyBlockTexts = {
      title: t('studyBlockReminderTitle'),
      body: (block: StudyBlock, time: string) =>
        t('studyBlockReminderBody', {
          title: block.courseCode ? `${block.courseCode} ${block.title}` : block.title,
          time,
        }),
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
        const cycle: Promise<unknown>[] = [
          refreshNotifications(lessons, texts, locale),
          refreshDueNotifications(tasks, dueTexts, locale),
          refreshExamReminders(lessons, examTexts, locale),
        ]
        // 每个家族声明两件事：**本应排上什么**（纯函数，与它自己的排期口径同源，别在这里
        // 重算窗口/阈值）与**怎么重排**。自愈只重排缺条目的那几家——不猜、不越权、不并发。
        const families: FamilyRepair[] = [
          {
            family: 'lesson',
            expected: (at) => [...wantedLessonReminders(lessons, at).keys()],
            refresh: () => refreshNotifications(lessons, texts, locale),
          },
          {
            family: 'due',
            expected: (at) => [...wantedReminders(tasks, at).keys()],
            refresh: () => refreshDueNotifications(tasks, dueTexts, locale),
          },
          {
            family: 'exam',
            expected: (at) => [...wantedExamReminders(lessons, at).keys()],
            refresh: () => refreshExamReminders(lessons, examTexts, locale),
          },
        ]
        // 学习块提醒有自己的偏好开关：关掉只清自己的条目
        if (studyBlockRemindEnabled) {
          cycle.push(refreshStudyBlockReminders(studyBlocks, studyBlockTexts, { enabled: true, locale }))
          families.push({
            family: 'studyBlock',
            expected: (at) => [...wantedStudyBlockReminders(studyBlocks, at).keys()],
            refresh: () => refreshStudyBlockReminders(studyBlocks, studyBlockTexts, { enabled: true, locale }),
          })
        } else {
          cancelStudyBlockReminders().catch(() => {})
        }
        if (digestEnabled) {
          cycle.push(refreshDigestNotifications(lessons, digestTexts, locale))
          families.push({
            family: 'digest',
            expected: (at) => plannedDigestDays(new Date(at)).map((d) => digestIdFor(d)),
            refresh: () => refreshDigestNotifications(lessons, digestTexts, locale),
          })
        } else {
          cancelDigestNotifications().catch(() => {})
        }
        // 排完立刻自愈对账：队列会被应用之外的力量清掉（WebView 重载丢内存队列、系统清理、
        // 厂商 ROM 省电策略、插件静默失败），而这类失败**都不报错**，用户看到的只有
        // 「到点没响」。缺了就当场补一次，别等下一个 10 分钟周期，也别把「去开关一次提醒」
        // 推给用户。（有界：一趟最多重排一次，且只修缺的那几家。）
        void Promise.allSettled(cycle)
          .then(() => healMissingReminders(families, { enabled: true }))
          .then((outcome) => {
            if (outcome.attempted && !outcome.healed) {
              logError(
                'other',
                'reminder heal did not restore queue',
                `notif missing ${outcome.before} -> ${outcome.after} (${outcome.families.join(',')})`,
              )
            }
          })
          .catch(() => {})
      } else {
        cancelLessonReminders(lessons).catch(() => {})
        cancelDueReminders(tasks).catch(() => {})
        cancelExamReminders(lessons).catch(() => {})
        cancelStudyBlockReminders().catch(() => {})
        cancelDigestNotifications().catch(() => {})
      }
    }
    refresh()
    const iv = setInterval(refresh, 10 * 60 * 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, digestEnabled, lessons, tasks, studyBlocks, studyBlockRemindEnabled, lang, subscriptions, onSubscriptionsFired, t])

  // Notifikasi tenggat Moodle menyimpan URL aktivitas di extra; buka tautan
  // yang aman saat pengguna mengetuknya, termasuk saat app kembali dari background.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const listener = LocalNotifications.addListener(
      'localNotificationActionPerformed',
      (action: ActionPerformed) => {
        const extra = action.notification.extra as { url?: unknown } | undefined
        const url = typeof extra?.url === 'string'
          ? normalizeMoodleLink(extra.url) ?? normalizeSisuStudyPlanUrl(extra.url)
          : null
        if (url) openExternal(url)
      },
    )
    return () => {
      listener.then((h) => h.remove()).catch(() => {})
    }
  }, [])

  // Tampilkan notifikasi yang dikirim saat aplikasi berjalan di foreground
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const listener = LocalNotifications.addListener('localNotificationReceived', () => {
      void refreshFromNotification().catch(() => {})
    })
    return () => {
      listener.then((h) => h.remove()).catch(() => {})
    }
  }, [refreshFromNotification])

  return null
}
