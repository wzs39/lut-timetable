import { Capacitor } from '@capacitor/core'
import { LocalNotifications, pluginReady } from './localNotifications'
import type { Lesson } from '../types'
import { formatTime } from './date'
import { NOTIF_LEDGER_KEYS, loadNotifLedger, ownedStaleIds, saveNotifLedger } from './notifLedger'

/** 课程提醒家族的记账键（唯一所有者在 notifLedger；这里保留具名导出给既有调用方）。 */
export const LESSON_LEDGER_KEY = NOTIF_LEDGER_KEYS.lesson

/** Remind this many minutes before a lesson starts */
export const REMIND_MINUTES = 10
/** Only schedule notifications for lessons starting within this window */
const SCHEDULE_WINDOW_H = 48

/**
 * 权限闸门：所有排期家族的第一步。
 *
 * 先 `await pluginReady()`（唯一所有者是 `lib/localNotifications`）——第一次碰插件必须
 * 单点串行，否则 `@capacitor/core` 的懒加载会让并发首次调用各造一个实现实例（实测挂载
 * 周期一次 5 个），排期写进孤儿实例就等于没排。注释的详细实证在 `localNotifications.ts`。
 */
export async function ensurePermission(): Promise<boolean> {
  await pluginReady()
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

/** Lesson.id (uuid) -> stable positive int32 for notification id。导出给记账/诊断复用。 */
export function lessonNotifId(lessonId: string): number {
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
/**
 * 本应排上的课程提醒（纯函数）：只排尚未开始、且提醒时点落在 48 小时窗口内的课。
 * 诊断/审计复用同一个口径——在别处重算窗口常量迟早与这里漂移。
 */
export function wantedLessonReminders(
  lessons: Lesson[],
  now: number,
): Map<number, { at: Date; lesson: Lesson }> {
  const windowMs = SCHEDULE_WINDOW_H * 3600 * 1000
  const wanted = new Map<number, { at: Date; lesson: Lesson }>()
  for (const l of lessons) {
    const at = new Date(l.start).getTime() - REMIND_MINUTES * 60 * 1000
    if (at > now && at < now + windowMs) {
      wanted.set(lessonNotifId(l.id), { at: new Date(at), lesson: l })
    }
  }
  return wanted
}

export async function refreshNotifications(
  lessons: Lesson[],
  texts: NotifTexts,
  locale?: string,
): Promise<void> {
  const granted = await ensurePermission()
  if (!granted) return
  const now = Date.now()
  const wanted = wantedLessonReminders(lessons, now)

  // 清扫陈旧课程提醒：**只动记账里自己排过的那些**。
  // 曾经这里是「取消一切不在当前 wanted 里的条目」——wanted 为空（没课/周末夜里/新装）
  // 时等于**清空整个通知队列**，把任务、考试、学习时段、摘要提醒一起删掉；而
  // NotificationManager 的四个家族是并发调用的，所以学习时段提醒会出现「记账里还记着
  // id、队列里已经没了」（实测：到点不会响）。
  const pending = await LocalNotifications.getPending()
  const recorded = loadNotifLedger(LESSON_LEDGER_KEY)
  const queuedIds = pending.notifications.map((n) => n.id)
  const stale = ownedStaleIds(recorded, queuedIds, [...wanted.keys()])
  if (stale.length > 0) {
    await LocalNotifications.cancel({ notifications: stale.map((id) => ({ id })) })
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
  // 记账 = 这一轮想要的集合（排期失败也会记，下一轮缺哪个补哪个）
  saveNotifLedger(LESSON_LEDGER_KEY, [...wanted.keys()])
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
          id: lessonNotifId('sync-change:' + seed),
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
    // 「当前课程」+「记账里剩的」两条来源都要清：只按当前数据反推会漏掉已删课程的 id
    // （那些提醒会一直留在队列里、到点还会响一声）。
    const ids = new Set([...lessons.map((l) => lessonNotifId(l.id)), ...loadNotifLedger(LESSON_LEDGER_KEY)])
    const pending = await LocalNotifications.getPending()
    const mine = pending.notifications.filter((n) => ids.has(n.id))
    if (mine.length > 0) {
      await LocalNotifications.cancel({ notifications: mine.map((n) => ({ id: n.id })) })
    }
    // 家族关掉 = 它排过的全不算了，记账一并清空（否则下一轮开启时拿旧 id 扫黑）
    saveNotifLedger(LESSON_LEDGER_KEY, [])
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
  // 队列清空 = 所有家族的记账都成了旧账（本模块只管自己这份；别家的在自己入口清）
  saveNotifLedger(LESSON_LEDGER_KEY, [])
}
