import { LocalNotifications } from '@capacitor/local-notifications'
import type { Lesson } from '../types'
import { formatTime } from './date'
import { ensurePermission, exactAlarmsEnabled } from './notifications'

/**
 * 每日摘要：早上把当天的课一次性推给用户（"3 节 · 第一节 08:15 @R112"），
 * 不用打开 App 也知道今天要不要早起。
 *
 * 为什么不是一条 `every: 'day'` 的重复通知：重复通知的正文是固定的，而摘要
 * 每天都不一样。所以按「未来 7 天各排一条」的方式预排——内容来自当前课表，
 * 课表一变（同步/手动改）就整窗重排。这是 refreshNotifications 里已经用过的
 * 模式，只是窗口从 48 小时变成 7 天。
 *
 * 通知 id 按日期推导（不是内容哈希），这样「哪条 pending 属于摘要」可以在
 * 不落盘的情况下算出来，取消过期条目不需要额外的存储。
 */

/** 推送时刻（本地 07:30）；课上得早的学校，太晚推就没意义了 */
export const DIGEST_HOUR = 7
export const DIGEST_MINUTE = 30
/** 预排天数：够覆盖一周，又不会在课表大改时留下太多陈旧条目 */
export const DIGEST_DAYS = 7

export interface DigestTexts {
  title: string
  /** 当天没有课 */
  empty: string
  /** n 节 · 第一节 {time}{loc} */
  body: (n: number, time: string, loc: string) => string
}

export interface DigestPlanItem {
  id: number
  at: Date
  /** yyyy-mm-dd（本地） */
  day: string
  title: string
  body: string
}

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 某一天的摘要 id：稳定的「基准 + 距 epoch 的天数」，可以反推任意日期的 id，
 * 因此取消陈旧条目时不必知道当时排了什么内容。
 */
export function digestIdFor(day: Date): number {
  const days = Math.floor(
    new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() / 86400000,
  )
  // notifId 的取值空间是 int32；这里取一段高位段避免与课程提醒/任务提醒撞号
  return 1_800_000_000 + (days % 100_000_000)
}

/**
 * 未来 DIGEST_DAYS 天的摘要安排（纯函数，可注入时钟）。
 * 今天 07:30 已过就不再排今天——排了也只会立刻弹出，反而像 bug。
 */
export function planDigests(
  lessons: Lesson[],
  now: Date,
  texts: DigestTexts,
  locale?: string,
): DigestPlanItem[] {
  const byDay = new Map<string, Lesson[]>()
  for (const l of lessons) {
    const key = ymd(new Date(l.start))
    const list = byDay.get(key)
    if (list) list.push(l)
    else byDay.set(key, [l])
  }

  const out: DigestPlanItem[] = []
  for (let i = 0; i < DIGEST_DAYS; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
    const at = new Date(day)
    at.setHours(DIGEST_HOUR, DIGEST_MINUTE, 0, 0)
    if (at.getTime() <= now.getTime()) continue
    const ofDay = (byDay.get(ymd(day)) ?? []).sort((a, b) => a.start.localeCompare(b.start))
    const first = ofDay[0]
    out.push({
      id: digestIdFor(day),
      at,
      day: ymd(day),
      title: texts.title,
      body: first
        ? texts.body(ofDay.length, formatTime(first.start, locale), first.location ? ` @${first.location}` : '')
        : texts.empty,
    })
  }
  return out
}

/** 上一次成功排入的内容签名——内容没变就不重排（每 10 分钟一次调用） */
let lastSignature = ''
/** 仅供测试：重置内存签名 */
export function resetDigestSignature(): void {
  lastSignature = ''
}

/**
 * 把摘要通知与当前课表对齐：取消窗口内的陈旧条目，排入最新计划。
 * 与 refreshNotifications 相同：先过权限闸门再碰插件（Android 13+ 未授权时
 * 插件会在原生线程 NPE 直接杀进程），失败一律静默。
 */
export async function refreshDigestNotifications(
  lessons: Lesson[],
  texts: DigestTexts,
  locale?: string,
  now: Date = new Date(),
): Promise<void> {
  try {
    const granted = await ensurePermission()
    if (!granted) return

    const plan = planDigests(lessons, now, texts, locale)
    const signature = JSON.stringify(plan.map((p) => [p.day, p.body]))
    if (signature === lastSignature) return

    const windowIds = new Set<number>()
    for (let i = 0; i < DIGEST_DAYS; i++) {
      windowIds.add(digestIdFor(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)))
    }
    const pending = await LocalNotifications.getPending()
    const stale = pending.notifications.filter((n) => windowIds.has(n.id))
    if (stale.length > 0) {
      await LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) })
    }
    if (plan.length > 0) {
      // 专用状态栏图标，理由同 refreshNotifications（厂商 ROM 对彩色图标
      // 的通知会抛 RemoteServiceException 直接杀进程）
      const exact = await exactAlarmsEnabled()
      await LocalNotifications.schedule({
        notifications: plan.map((p) => ({
          id: p.id,
          title: p.title,
          body: p.body,
          schedule: { at: p.at, allowWhileIdle: true, exact },
          smallIcon: 'ic_stat_lesson',
          iconColor: '#e7e5e4',
        })),
      })
    }
    lastSignature = signature
  } catch {
    // 摘要只是锦上添花——失败不影响课表本身
  }
}

/** 窗口内所有摘要 id（含已过时刻的）——判断「哪条 pending 属于摘要」 */
export function digestWindowIds(now: Date): number[] {
  return Array.from({ length: DIGEST_DAYS }, (_, i) =>
    digestIdFor(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)),
  )
}

/** 关掉摘要时清掉窗口内的条目（未排过时是廉价的空操作） */
export async function cancelDigestNotifications(now: Date = new Date()): Promise<void> {
  try {
    const ids = new Set(digestWindowIds(now))
    const pending = await LocalNotifications.getPending()
    const mine = pending.notifications.filter((n) => ids.has(n.id))
    if (mine.length > 0) {
      await LocalNotifications.cancel({ notifications: mine.map((n) => ({ id: n.id })) })
    }
    lastSignature = ''
  } catch {
    /* 静默 */
  }
}
