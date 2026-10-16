import { LocalNotifications } from './localNotifications'
import type { Task } from './tasks'
import { isOverdue } from './tasks'
import { NOTIF_LEDGER_KEYS, loadNotifLedger, ownedStaleIds, saveNotifLedger } from './notifLedger'
import { ensurePermission, exactAlarmsEnabled } from './notifications'
import { formatDateTime as formatDueTime } from './date'
import { normalizeMoodleLink } from './moodleUrl'
import { notificationDrifted } from './pendingNotifications'

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
  /** Safe HTTPS link to the Moodle activity, used by the tap handler. */
  url?: string
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
      wanted.set(dueNotifId(task.id, beforeH), {
        id: dueNotifId(task.id, beforeH),
        at: new Date(at),
        task,
        url: normalizeMoodleLink(task.url) ?? undefined,
        beforeH,
      })
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
  const queuedIds = pending.notifications.map((n) => n.id)
  const wantedIds = [...wanted.keys()]
  // 清扫陈旧条目：只动**记账里自己排过的**。从当前任务反推 id 有个天花板——
  // 任务一旦被删，它的提醒 id 就再也算不出来，残留通知会躺在队列里到点还响一声。
  // 记账把「我排过谁」变成一等数据，于是删任务也能清，且永远不碰别家的 id。
  const stale = ownedStaleIds(loadNotifLedger(NOTIF_LEDGER_KEYS.due), queuedIds, wantedIds)
  if (stale.length > 0) {
    await LocalNotifications.cancel({ notifications: stale.map((id) => ({ id })) })
  }

  const pendingById = new Map(pending.notifications.map((notification) => [notification.id, notification]))
  const exact = await exactAlarmsEnabled()
  const desired = [...wanted.values()].map(({ id, at, task, url, beforeH }) => ({
    id,
    title: texts.title,
    body: texts.body(task, formatDueTime(task.dueAt!, locale), beforeH),
    schedule: { at, allowWhileIdle: true, exact },
    extra: { url },
    smallIcon: 'ic_stat_lesson',
    iconColor: '#e7e5e4',
  }))
  const toSchedule = desired.filter(({ id }) => !pendingById.has(id))
  // 已排期的那些不一定还是**对**的：id 稳定但时刻/链接/正文跟着数据走。改了截止时间后
  // 不更新，提醒就会停在旧时刻（看起来是好的，只是响在错的点上）——那比没提醒更坏。
  const toUpdate = desired.filter(({ id }) => {
    const previous = pendingById.get(id)
    const target = wanted.get(id)
    return (
      previous !== undefined &&
      target !== undefined &&
      notificationDrifted(previous, { id, at: target.at, title: texts.title, url: target.url })
    )
  })

  if (toUpdate.length > 0) await LocalNotifications.update({ notifications: toUpdate })
  if (toSchedule.length > 0) await LocalNotifications.schedule({ notifications: toSchedule })
  // 记账 = 这一轮想要的集合（排期失败也会记，下一轮缺哪个补哪个）
  saveNotifLedger(NOTIF_LEDGER_KEYS.due, wantedIds)
}

/**
 * Batalkan pengingat tenggat tugas (tanpa menyentuh pengingat pelajaran /
 * ringkasan harian) — dipakai saat saklar tugas dimatikan.
 */
export async function cancelDueReminders(tasks: Task[]): Promise<void> {
  try {
    // 「当前任务」+「记账里剩的」两条来源都要清：只按当前数据反推会漏掉已删任务的 id
    const ids = new Set([
      ...tasks.flatMap((t) => (t.dueAt ? DUE_REMIND_BEFORE_H.map((h) => dueNotifId(t.id, h)) : [])),
      ...loadNotifLedger(NOTIF_LEDGER_KEYS.due),
    ])
    const pending = await LocalNotifications.getPending()
    const mine = pending.notifications.filter((n) => ids.has(n.id))
    if (mine.length > 0) {
      await LocalNotifications.cancel({ notifications: mine.map((n) => ({ id: n.id })) })
    }
    // 家族关掉 = 它排过的全不算了，记账一并清空（否则下一轮开启时拿旧 id 扫黑）
    saveNotifLedger(NOTIF_LEDGER_KEYS.due, [])
  } catch {
    /* diam: pembersihan notifikasi gagal bukan hal fatal */
  }
}
