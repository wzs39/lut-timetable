import { LocalNotifications } from './localNotifications'

/**
 * 「我排的提醒到底进没进系统队列」——设置页诊断面板的**唯一数据源**。
 *
 * 为什么需要：提醒是「排期成功才算功能可用」的，但排期在 JS 侧只表现为一个
 * Promise。权限被拒（Android 13+ 的 POST_NOTIFICATIONS）、精确闹钟被拒
 * （Android 14+ 的 SCHEDULE_EXACT_ALARM 默认拒绝）、插件在某平台缺失、提醒点
 * 已被钳到过去……全都会平静地不报错。用户在设置里勾了开关却什么都没发生时，
 * 唯一能判别「排期失败」与「排期成功但时间还没到」的办法就是**把系统队列读出来
 * 给人看**（`LocalNotifications.getPending()`）。
 *
 * 边界（重要）：
 * - **只读**：不排期、不取消、不写任何存储，也不碰别类提醒的记账。
 * - 任何平台都可能抛（web 实现与原生实现行为不同），一律转成 `ok:false` +
 *   可读的 `error`，绝不把异常抛给设置页——诊断工具自己崩掉比没有诊断更糟。
 * - 解析层对脏载荷全容忍：平台之间 `schedule.at` 可能是字符串/数字/Date，
 *   甚至整条记录缺字段；坏记录丢掉即可，不能让一条脏数据把整块视图弄崩。
 */

/** 列表最多展示多少条：诊断是「看一眼」，不是通知历史。 */
export const PENDING_LIST_LIMIT = 8

export interface PendingNotificationItem {
  id: number
  title: string
  body: string
  /** 计划触发时刻（ISO）；平台没给或解析不出来时 null */
  at: string | null
}

export interface PendingNotificationsSummary {
  /** 按触发时刻升序；没有时刻的排在最后并保持原序 */
  items: PendingNotificationItem[]
  /** 队列里最近的一条未来提醒；没有未来条目时 null */
  next: PendingNotificationItem | null
  /** 时刻已过却仍在队列里的条数（系统没投递 / 排到了过去） */
  overdue: number
}

export interface PendingNotificationsReport extends PendingNotificationsSummary {
  ok: boolean
  error?: string
}

/** 平台给的 `schedule.at` 归一成 ISO；认不出来返回 null。 */
function normalizeAt(value: unknown): string | null {
  let ms: number
  if (value instanceof Date) ms = value.getTime()
  else if (typeof value === 'number') ms = value
  else if (typeof value === 'string') ms = Date.parse(value)
  else return null
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

/** 单条记录的解析（纯函数）：id 是数字才算一条，其余字段缺失就用空串。 */
export function pendingItemFrom(raw: unknown): PendingNotificationItem | null {
  if (!raw || typeof raw !== 'object') return null
  const n = raw as { id?: unknown; title?: unknown; body?: unknown; schedule?: unknown }
  if (typeof n.id !== 'number' || !Number.isSafeInteger(n.id)) return null
  const schedule = n.schedule as { at?: unknown } | undefined
  return {
    id: n.id,
    title: typeof n.title === 'string' ? n.title : '',
    body: typeof n.body === 'string' ? n.body : '',
    at: normalizeAt(schedule?.at),
  }
}

/** 触发时刻的数值形态；没有时刻返回 NaN。 */
function atMs(item: PendingNotificationItem): number {
  return item.at ? Date.parse(item.at) : NaN
}

/**
 * 把平台载荷（`{ notifications: [...] }` 或裸数组）汇总成视图模型（纯函数）。
 *
 * 排序按触发时刻升序——「下一条什么时候响」是最常问的问题，所以 `next` 直接取
 * 排完序的第一个未来条目；时刻已过的单独计数（这是「排期到了过去」的信号，
 * 与「还没到点」必须区分）。
 */
export function summarizePending(raw: unknown, now: number): PendingNotificationsSummary {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { notifications?: unknown } | null)?.notifications)
      ? ((raw as { notifications: unknown[] }).notifications)
      : []
  const items = list
    .map(pendingItemFrom)
    .filter((item): item is PendingNotificationItem => item !== null)
    .sort((a, b) => {
      const am = atMs(a)
      const bm = atMs(b)
      if (!Number.isFinite(am) && !Number.isFinite(bm)) return 0
      if (!Number.isFinite(am)) return 1
      if (!Number.isFinite(bm)) return -1
      return am - bm
    })
  const upcoming = items.filter((item) => atMs(item) > now)
  const overdue = items.filter((item) => {
    const ms = atMs(item)
    return Number.isFinite(ms) && ms <= now
  }).length
  return { items, next: upcoming[0] ?? null, overdue }
}

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err.slice(0, 200)
  const e = err as { message?: unknown } | undefined
  if (e && typeof e.message === 'string') return e.message.slice(0, 200)
  return err === undefined || err === null ? 'unknown error' : String(err).slice(0, 200)
}

/**
 * 读一次系统队列。失败不抛：把异常文本原样带回去——诊断面板要展示的正是
 * 「为什么没有排期」（如原生插件未实现、权限被拒），吞掉错误等于把线索删了。
 */
export async function loadPendingNotifications(
  now: number = Date.now(),
): Promise<PendingNotificationsReport> {
  try {
    const raw = await LocalNotifications.getPending()
    return { ok: true, ...summarizePending(raw, now) }
  } catch (err) {
    return { ok: false, items: [], next: null, overdue: 0, error: messageOf(err) }
  }
}
