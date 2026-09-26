import { LocalNotifications } from '@capacitor/local-notifications'
import type { Lesson } from '../types'
import { formatTime } from './date'
import { ensurePermission, exactAlarmsEnabled } from './notifications'

/**
 * 考试提醒：考试前 7 天和 1 天各推一条。
 *
 * 为什么按「天」而不是「小时」：考试不像作业截止，真正要的是"该开始复习了"，
 * 提前 1 小时提醒没有意义。时刻沿用考试本身的钟点（8:15 的考试 → 前一天和
 * 前七天都是 8:15），不会在深夜弹通知。
 *
 * 与 dueNotifications 同一套模式：id 可由当前课表反推，所以取消陈旧条目
 * 不需要额外存储，也不会误伤课程/任务提醒（id 空间不同）。
 */

/** 提前几天提醒（升序 = 离考试由远到近） */
export const EXAM_REMIND_BEFORE_D = [7, 1] as const
/** 只排期窗口内的考试（再远的考试，课表还可能变） */
const SCHEDULE_WINDOW_D = 45

/** Stable positive int32 notification id from lesson id + reminder offset. */
export function examNotifId(lessonId: string, beforeD: number): number {
  let h = 0x811c9dc5
  const key = 'exam|' + lessonId + '|' + beforeD
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % 2147483647
}

export interface ExamNotifTexts {
  title: string
  body: (lesson: Lesson, days: number, time: string, loc: string) => string
}

export interface ExamReminder {
  id: number
  at: Date
  lesson: Lesson
  beforeD: number
}

/**
 * 选出需要排期的考试提醒（纯函数，便于测试）：
 * - 只看 `type === 'exam'` 且尚未结束的条目
 * - 每个考试在开始前 7 天 / 1 天各提醒一次，已过去的时点跳过
 * - 只排 SCHEDULE_WINDOW_D 天内的考试
 */
export function wantedExamReminders(lessons: Lesson[], now: number): Map<number, ExamReminder> {
  const dayMs = 24 * 3600 * 1000
  const horizon = now + SCHEDULE_WINDOW_D * dayMs
  const wanted = new Map<number, ExamReminder>()
  for (const l of lessons) {
    if (l.type !== 'exam') continue
    const start = new Date(l.start).getTime()
    if (!Number.isFinite(start) || start <= now || start > horizon) continue
    for (const beforeD of EXAM_REMIND_BEFORE_D) {
      const at = start - beforeD * dayMs
      if (at <= now) continue
      const id = examNotifId(l.id, beforeD)
      wanted.set(id, { id, at: new Date(at), lesson: l, beforeD })
    }
  }
  return wanted
}

/** 把考试提醒与当前课表对齐（权限闸门同 refreshNotifications，失败静默）。 */
export async function refreshExamReminders(
  lessons: Lesson[],
  texts: ExamNotifTexts,
  locale?: string,
): Promise<void> {
  const granted = await ensurePermission()
  if (!granted) return
  const now = Date.now()
  const wanted = wantedExamReminders(lessons, now)

  const pending = await LocalNotifications.getPending()
  const stale = pending.notifications.filter(
    (n) => !wanted.has(n.id) && isExamNotifId(n.id, lessons),
  )
  if (stale.length > 0) {
    await LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) })
  }

  const scheduledIds = new Set(pending.notifications.map((n) => n.id))
  const exact = await exactAlarmsEnabled()
  const toSchedule = [...wanted.values()]
    .filter(({ id }) => !scheduledIds.has(id))
    .map(({ id, at, lesson, beforeD }) => ({
      id,
      title: texts.title,
      body: texts.body(
        lesson,
        beforeD,
        formatTime(lesson.start, locale),
        lesson.location ? ` @${lesson.location}` : '',
      ),
      schedule: { at, allowWhileIdle: true, exact },
      smallIcon: 'ic_stat_lesson',
      iconColor: '#e7e5e4',
    }))
  if (toSchedule.length > 0) {
    await LocalNotifications.schedule({ notifications: toSchedule })
  }
}

/** 关掉提醒开关时清掉考试提醒（不动课程/任务/摘要）。 */
export async function cancelExamReminders(lessons: Lesson[]): Promise<void> {
  try {
    const pending = await LocalNotifications.getPending()
    const mine = pending.notifications.filter((n) => isExamNotifId(n.id, lessons))
    if (mine.length > 0) {
      await LocalNotifications.cancel({ notifications: mine.map((n) => ({ id: n.id })) })
    }
  } catch {
    /* 静默 */
  }
}

/** Apakah id notifikasi ini milik pengingat ujian? */
function isExamNotifId(id: number, lessons: Lesson[]): boolean {
  for (const l of lessons) {
    if (l.type !== 'exam') continue
    for (const beforeD of EXAM_REMIND_BEFORE_D) {
      if (examNotifId(l.id, beforeD) === id) return true
    }
  }
  return false
}
