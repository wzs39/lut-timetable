import { KEYS, readJson, writeJson } from './storage'
import { normalizeCourseCode } from './ics'
import type { SyncChange } from './syncAudit'
import type { FreeRoom } from './freeRooms'

/**
 * 订阅式提醒：把「一次性的查看」变成**持续的关照**。
 *
 * 两类订阅（都只用本机已经算出来的数据，不需要后端）：
 * - `course-change`：这门课有变动（时间/教室/取消）就通知我 —— 数据来自同步审计；
 * - `room-free`：这个教室（或这栋楼任意教室）空出来就通知我 —— 数据来自空闲教室推算。
 *
 * 防骚扰设计（比"能不能推"重要）：
 * - `lastFiredAt` + REFIRE_COOLDOWN_MS：同类提醒（同一间教室/同一门课）在冷却期内
 *   只响一次。教室空出来可能反复发生，一天几百条通知比不提醒更糟。
 * - `enabled`：订阅可以静音而不删除，考试周暂时关掉再打开不丢。
 */

export type SubscriptionKind = 'course-change' | 'room-free'

/** 同一条订阅两次提醒之间的最小间隔 */
export const REFIRE_COOLDOWN_MS = 6 * 3600 * 1000

export interface Subscription {
  id: string
  kind: SubscriptionKind
  /** course-change：课程码；room-free：`楼_房间` 或单独的楼号 */
  target: string
  /** 展示文本（课程名 / 教室名），订阅列表里直接显示 */
  label: string
  createdAt: string
  enabled: boolean
  /** 上次触发时间（ISO）；冷却期内不再触发 */
  lastFiredAt?: string
}

export function loadSubscriptions(): Subscription[] {
  const raw = readJson<Subscription[]>(KEYS.subscriptions, [])
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (s) =>
      s &&
      typeof s.id === 'string' &&
      (s.kind === 'course-change' || s.kind === 'room-free') &&
      typeof s.target === 'string',
  )
}

export function saveSubscriptions(list: Subscription[]): void {
  writeJson(KEYS.subscriptions, list)
}

/** 同一个目标只保留一条订阅（重复点击「提醒我」应该是切换，不是叠加） */
export function subKey(kind: SubscriptionKind, target: string): string {
  return `${kind}:${target.toLowerCase()}`
}

/** 新增（已存在则原样返回，不重复添加） */
export function addSubscription(
  list: Subscription[],
  sub: Omit<Subscription, 'createdAt' | 'enabled' | 'lastFiredAt'> &
    Partial<Pick<Subscription, 'enabled'>>,
): Subscription[] {
  const key = subKey(sub.kind, sub.target)
  if (list.some((s) => subKey(s.kind, s.target) === key)) return list
  return [
    ...list,
    { ...sub, createdAt: new Date().toISOString(), enabled: sub.enabled ?? true },
  ]
}

export function removeSubscription(list: Subscription[], id: string): Subscription[] {
  return list.filter((s) => s.id !== id)
}

export function toggleSubscription(list: Subscription[], id: string): Subscription[] {
  return list.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s))
}

/** 是否已经订阅（UI 用它决定按钮的高亮态） */
export function isSubscribed(list: Subscription[], kind: SubscriptionKind, target: string): boolean {
  const key = subKey(kind, target)
  return list.some((s) => subKey(s.kind, s.target) === key)
}

/** 还在冷却期内？ */
function cooling(s: Subscription, now: number): boolean {
  if (!s.lastFiredAt) return false
  const at = new Date(s.lastFiredAt).getTime()
  if (!Number.isFinite(at)) return false
  return now - at < REFIRE_COOLDOWN_MS
}

/**
 * 计算本次该触发的订阅（纯函数）。
 * - course-change：本次同步的变动里有这门课（按代码/标题规范化比较）
 * - room-free：目标教室（或目标楼里的任一教室）现在空闲
 * 已静音、冷却期内的条目不会返回。
 */
export function dueSubscriptions(
  list: Subscription[],
  ctx: { changes?: SyncChange[]; freeRooms?: FreeRoom[]; now: number },
): Subscription[] {
  const out: Subscription[] = []
  const changes = ctx.changes ?? []
  for (const s of list) {
    if (!s.enabled || cooling(s, ctx.now)) continue
    if (s.kind === 'course-change') {
      const target = normalizeCourseCode(s.target)
      const hit = changes.some((c) => {
        const label = normalizeCourseCode(c.label)
        return label === target || label.includes(target)
      })
      if (hit) out.push(s)
      continue
    }
    const want = s.target.toLowerCase()
    const hit = (ctx.freeRooms ?? []).some((r) => {
      const exact = `${r.building}_${r.room}`.toLowerCase()
      return exact === want || r.building.toLowerCase() === want
    })
    if (hit) out.push(s)
  }
  return out
}

/** 标记触发时间（写回订阅列表，纯函数） */
export function markFired(list: Subscription[], ids: string[], atIso: string): Subscription[] {
  const set = new Set(ids)
  return list.map((s) => (set.has(s.id) ? { ...s, lastFiredAt: atIso } : s))
}
