import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { Lesson } from '../types'
import { formatTime } from './date'

/** Remind this many minutes before a lesson starts */
export const REMIND_MINUTES = 10
/** Only schedule notifications for lessons starting within this window */
const SCHEDULE_WINDOW_H = 48

export async function ensurePermission(): Promise<boolean> {
  const cur = await LocalNotifications.checkPermissions()
  if (cur.display === 'granted') return true
  if (cur.display === 'denied') return false
  const req = await LocalNotifications.requestPermissions()
  return req.display === 'granted'
}

/**
 * Android 14+ gates SCHEDULE_EXACT_ALARM behind a settings toggle. If the
 * user has revoked it, fall back to inexact scheduling so reminders still
 * fire (possibly a few minutes late) instead of erroring.
 */
export async function exactAlarmsEnabled(): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') return true
  try {
    const s = await LocalNotifications.checkExactNotificationSetting()
    return s.exact_alarm === 'granted'
  } catch {
    return true
  }
}

/** Lesson.id (uuid) -> stable positive int32 for notification id */
function notifId(lessonId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < lessonId.length; i++) {
    h ^= lessonId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 2147483647
}

export interface NotifTexts {
  title: string
  body: (l: Lesson, startTime: string) => string
}

/**
 * Sinkronkan notifikasi terjadwal dengan daftar pelajaran:
 * - jadwalkan pelajaran yang dimulai dalam window SCHEDULE_WINDOW_H
 * - batalkan notifikasi lama yang tidak lagi relevan
 *
 * GERBANG IZIN: bila izin notifikasi belum diberikan, kembalilah SEBELUM
 * menyentuh plugin. LocalNotifications.schedule plugin v8 memanggil
 * getPermissionState() di thread CapacitorPlugins dan NPE di sana mematikan
 * SELURUH proses (FATAL EXCEPTION, tidak tertangkap .catch JS) — terjadi
 * nyata saat impor backup dengan notif=true di Android 13+ yang belum
 * memberi izin POST_NOTIFICATIONS.
 */
export async function refreshNotifications(
  lessons: Lesson[],
  texts: NotifTexts,
  locale?: string,
): Promise<void> {
  const granted = await ensurePermission()
  if (!granted) return
  const now = Date.now()
  const windowMs = SCHEDULE_WINDOW_H * 3600 * 1000

  const upcoming = lessons.filter((l) => {
    const at = new Date(l.start).getTime() - REMIND_MINUTES * 60 * 1000
    return at > now && at < now + windowMs
  })

  const wanted = new Map<number, { at: Date; lesson: Lesson }>()
  for (const l of upcoming) {
    wanted.set(notifId(l.id), {
      at: new Date(new Date(l.start).getTime() - REMIND_MINUTES * 60 * 1000),
      lesson: l,
    })
  }

  // Batalkan notifikasi lama yang tidak ada dalam daftar terkini
  const pending = await LocalNotifications.getPending()
  const stale = pending.notifications.filter((n) => !wanted.has(n.id))
  if (stale.length > 0) {
    await LocalNotifications.cancel({
      notifications: stale.map((n) => ({ id: n.id })),
    })
  }

  // Jadwalkan yang belum terjadwal
  const scheduledIds = new Set(pending.notifications.map((n) => n.id))
  const exact = await exactAlarmsEnabled()

  const toSchedule = [...wanted.entries()]
    .filter(([id]) => !scheduledIds.has(id))
    .map(([id, { at, lesson }]) => ({
      id,
      title: texts.title,
      body: texts.body(lesson, formatTime(lesson.start, locale)),
      schedule: { at, allowWhileIdle: true, exact },
      // 专用状态栏图标（纯白线条、透明底）：MIUI 等厂商 ROM 对彩色/自适应
      // 图标的通知在展开或点击时抛 RemoteServiceException 直接杀进程 ——
      // "点通知就退出应用" 的已知根因。ic_stat_lesson 专用资源杜绝该路径。
      smallIcon: 'ic_stat_lesson',
      iconColor: '#e7e5e4',
    }))

  if (toSchedule.length > 0) {
    await LocalNotifications.schedule({ notifications: toSchedule })
  }
}

/**
 * 立即弹一条通知（不是预约，而是「同步时发现了改动」这类事后提示）。
 *
 * 与 refreshNotifications 同一条路径：先过权限闸门再碰插件（否则 Android 13+
 * 未授权时插件在原生线程 NPE 直接杀进程），失败一律静默——审计日志已经落盘，
 * 通知只是锦上添花。
 */
export async function notifyNow(
  title: string,
  body: string,
  seed = body,
): Promise<boolean> {
  try {
    const granted = await ensurePermission()
    if (!granted) return false
    await LocalNotifications.schedule({
      notifications: [
        {
          id: notifId('sync-change:' + seed),
          title,
          body,
          schedule: { at: new Date(Date.now() + 500) },
          smallIcon: 'ic_stat_lesson',
          iconColor: '#e7e5e4',
        },
      ],
    })
    return true
  } catch {
    return false
  }
}

/**
 * 只取消「课程提醒」，不动任务提醒与每日摘要——内容开关关掉时用，
 * 比 cancelAllNotifications 精准（否则会把用户开着的其它通知一起清掉）。
 */
export async function cancelLessonReminders(lessons: Lesson[]): Promise<void> {
  try {
    const ids = new Set(lessons.map((l) => notifId(l.id)))
    const pending = await LocalNotifications.getPending()
    const mine = pending.notifications.filter((n) => ids.has(n.id))
    if (mine.length > 0) {
      await LocalNotifications.cancel({ notifications: mine.map((n) => ({ id: n.id })) })
    }
  } catch {
    /* 静默：通知清理失败不影响应用 */
  }
}

export async function cancelAllNotifications(): Promise<void> {
  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map((n) => ({ id: n.id })),
    })
  }
}
