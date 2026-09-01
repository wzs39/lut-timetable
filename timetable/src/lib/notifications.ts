import { LocalNotifications } from '@capacitor/local-notifications'
import type { Lesson } from '../types'

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
 */
export async function refreshNotifications(
  lessons: Lesson[],
  texts: NotifTexts,
  locale?: string,
): Promise<void> {
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
  const toSchedule = [...wanted.entries()]
    .filter(([id]) => !scheduledIds.has(id))
    .map(([id, { at, lesson }]) => ({
      id,
      title: texts.title,
      body: texts.body(lesson, formatTime(lesson.start, locale)),
      schedule: { at, allowWhileIdle: true },
      smallIcon: undefined,
    }))

  if (toSchedule.length > 0) {
    await LocalNotifications.schedule({ notifications: toSchedule })
  }
}

function formatTime(iso: string, locale?: string): string {
  return new Date(iso).toLocaleTimeString(locale ?? undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

export async function cancelAllNotifications(): Promise<void> {
  const pending = await LocalNotifications.getPending()
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map((n) => ({ id: n.id })),
    })
  }
}
