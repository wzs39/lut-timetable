import { LocalNotifications } from '@capacitor/local-notifications'
import type { Task } from './tasks'
import { isOverdue } from './tasks'
import { ensurePermission, exactAlarmsEnabled } from './notifications'
import { formatDateTime as formatDueTime } from './date'

/** Remind this long before the deadline (two reminders per task). */
export const DUE_REMIND_BEFORE_H = [24, 1] as const
/** Only schedule reminders for deadlines within this window. */
const SCHEDULE_WINDOW_H = 7 * 24

/** Stable positive int32 notification id from task id + reminder offset. */
export function dueNotifId(taskId: string, beforeH: number): number {
  let h = 0x811c9dc5
  const key = taskId + '|' + beforeH
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 2147483647
}

export interface DueNotifTexts {
  title: string
  body: (task: Task, dueText: string, beforeH: number) => string
}

export interface DueReminder {
  id: number
  at: Date
  task: Task
  beforeH: number
}

/**
 * 选出需要排期的截止提醒（纯函数，便于测试）：
 * - 只提醒未完成、未逾期、有截止时间的任务
 * - 每个任务在截止前 24h 和 1h 各提醒一次（已过去的时点跳过）
 * - 只排期 7 天窗口内的截止
 */
export function wantedReminders(tasks: Task[], now: number): Map<number, DueReminder> {
  const windowMs = SCHEDULE_WINDOW_H * 3600 * 1000
  const wanted = new Map<number, DueReminder>()
  for (const task of tasks) {
    if (task.completed || isOverdue(task, new Date(now)) || !task.dueAt) continue
    const due = new Date(task.dueAt).getTime()
    if (due <= now || due > now + windowMs) continue
    for (const beforeH of DUE_REMIND_BEFORE_H) {
      const at = due - beforeH * 3600 * 1000
      if (at <= now) continue
      wanted.set(dueNotifId(task.id, beforeH), { id: dueNotifId(task.id, beforeH), at: new Date(at), task, beforeH })
    }
  }
  return wanted
}

/**
 * Sinkronkan pengingat tenggat dengan daftar tugas:
 * - jadwalkan pengingat 24h + 1h sebelum deadline (yang belum selesai saja)
 * - batalkan pengingat lama yang sudah tidak relevan (selesai/dihapus)
 * - id pengingat tenggat bisa dikenali dari set tugas saat ini, sehingga
 *   notifikasi pelajaran (ruang id berbeda) tidak pernah dibatalkan.
 */
export async function refreshDueNotifications(
  tasks: Task[],
  texts: DueNotifTexts,
  locale?: string,
): Promise<void> {
  // Gerbang izin yang sama dengan refreshNotifications: schedule() plugin
  // NPE-fatal di thread native bila izin belum diberikan (Android 13+).
  const granted = await ensurePermission()
  if (!granted) return
  const now = Date.now()
  const wanted = wantedReminders(tasks, now)

  const pending = await LocalNotifications.getPending()
  const stale = pending.notifications.filter(
    (n) => !wanted.has(n.id) && isDueNotifId(n.id, tasks),
  )
  if (stale.length > 0) {
    await LocalNotifications.cancel({
      notifications: stale.map((n) => ({ id: n.id })),
    })
  }

  const scheduledIds = new Set(pending.notifications.map((n) => n.id))
  const exact = await exactAlarmsEnabled()
  const toSchedule = [...wanted.values()]
    .filter(({ id }) => !scheduledIds.has(id))
    .map(({ id, at, task, beforeH }) => ({
      id,
      title: texts.title,
      body: texts.body(task, formatDueTime(task.dueAt!, locale), beforeH),
      schedule: { at, allowWhileIdle: true, exact },
      smallIcon: undefined,
    }))

  if (toSchedule.length > 0) {
    await LocalNotifications.schedule({ notifications: toSchedule })
  }
}

/** Apakah id notifikasi ini milik pengingat tenggat tugas? */
function isDueNotifId(id: number, tasks: Task[]): boolean {
  for (const task of tasks) {
    if (!task.dueAt) continue
    for (const beforeH of DUE_REMIND_BEFORE_H) {
      if (dueNotifId(task.id, beforeH) === id) return true
    }
  }
  return false
}
