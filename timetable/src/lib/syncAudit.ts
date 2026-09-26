import type { Lesson } from '../types'
import { lessonKey } from './store'
import { KEYS, readJson, writeJson } from './storage'

/**
 * 同步变更审计：把「这次同步到底改了什么」从一行计数器变成可回溯的明细。
 *
 * 之前同步只报 `新增 a 条，更新 u 条，合并 m 条`——用户看不到是哪节课、
 * 改了什么。这里用**纯函数 diff**（可单测）比较同步前后的课表，并把结果
 * 存成一份很短的日志（默认最近 10 次，每次最多 40 条）。
 *
 * 分类规则：
 * - `lessonKey` 含开始时间，所以「时间一改 key 就变」→ 先按 key 比，
 *   剩下的「同日同课 被删 + 被加」配对为 `moved`（时间变动）；
 * - key 相同但字段变了 → `room`（换教室）/ `title`（标题变动）；
 * - 只删不加 → `cancelled`（课程被取消/移出窗口）。
 */

export type SyncChangeKind = 'added' | 'moved' | 'room' | 'title' | 'cancelled'

export interface SyncChange {
  kind: SyncChangeKind
  key: string
  /** 课程标识：代码优先，无代码用标题 */
  label: string
  /** moved：改动前后的开始时间（ISO） */
  from?: string
  to?: string
  /** room / title：改动前后的值 */
  before?: string
  after?: string
}

export interface SyncAudit {
  at: string
  sourceId: string
  sourceLabel: string
  changes: SyncChange[]
}

/** 保留最近多少次同步的明细 */
export const MAX_AUDITS = 10
/** 单次同步最多记录多少条（避免一次全量导入把存储撑爆） */
export const MAX_CHANGES_PER_AUDIT = 40

/** 需要在界面上「提醒」的类别；title 只是文案变化，仅入日志 */
export const NOTABLE_KINDS: SyncChangeKind[] = ['added', 'moved', 'room', 'cancelled']

function labelOf(l: Lesson): string {
  return l.code || l.title || '?'
}

/** 同一天（按本地日期）——时间改动的配对范围 */
function dayOf(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/**
 * 同步前后两张课表的差异明细。稳定输出：added → moved → room → title → cancelled。
 */
/** 同一个 key 可能有多条（跨来源重复课），所以归组成列表而不是单值 Map */
function groupByKey(lessons: Lesson[]): Map<string, Lesson[]> {
  const map = new Map<string, Lesson[]>()
  for (const l of lessons) {
    const k = lessonKey(l)
    const list = map.get(k)
    if (list) list.push(l)
    else map.set(k, [l])
  }
  return map
}

export function diffLessons(prev: Lesson[], next: Lesson[]): SyncChange[] {
  const prevByKey = groupByKey(prev)
  const nextByKey = groupByKey(next)

  const added: Lesson[] = []
  const removed: Lesson[] = []
  const roomChanges: SyncChange[] = []
  const titleChanges: SyncChange[] = []
  const moved: SyncChange[] = []

  for (const [key, list] of nextByKey) {
    const before = prevByKey.get(key) ?? []
    // 同 key 的条目按数量配对：多出来的才算新增，少了的才算消失
    const shared = Math.min(before.length, list.length)
    for (let i = 0; i < shared; i++) {
      const p = before[i]
      const l = list[i]
      if ((p.location ?? '') !== (l.location ?? '')) {
        roomChanges.push({ kind: 'room', key, label: labelOf(l), before: p.location, after: l.location })
      }
      if ((p.title ?? '') !== (l.title ?? '')) {
        titleChanges.push({ kind: 'title', key, label: labelOf(l), before: p.title, after: l.title })
      }
    }
    for (let i = shared; i < list.length; i++) added.push(list[i])
  }
  for (const [key, list] of prevByKey) {
    const afterCount = nextByKey.get(key)?.length ?? 0
    for (let i = afterCount; i < list.length; i++) removed.push(list[i])
  }

  // 「同日同课」的删除 + 新增 = 时间变动；同一门课可能有多处，按时间最近配对
  const unmatchedAdded = new Set(added)
  const cancelled: Lesson[] = []
  for (const gone of removed) {
    const day = dayOf(gone.start)
    let best: Lesson | null = null
    let bestDelta = Number.POSITIVE_INFINITY
    for (const cand of unmatchedAdded) {
      if (labelOf(cand) !== labelOf(gone)) continue
      if (dayOf(cand.start) !== day) continue
      const delta = Math.abs(new Date(cand.start).getTime() - new Date(gone.start).getTime())
      // delta === 0 表示开始时间没变，那不是「时间变动」，别误报
      if (delta > 0 && delta < bestDelta) {
        best = cand
        bestDelta = delta
      }
    }
    if (best) {
      unmatchedAdded.delete(best)
      moved.push({
        kind: 'moved',
        key: lessonKey(best),
        label: labelOf(best),
        from: gone.start,
        to: best.start,
      })
    } else {
      cancelled.push(gone)
    }
  }

  return [
    // 已被配对成 moved 的新增项不再算「新增」（Set 保持插入顺序）
    ...[...unmatchedAdded].map<SyncChange>((l) => ({
      kind: 'added',
      key: lessonKey(l),
      label: labelOf(l),
      to: l.start,
    })),
    ...moved,
    ...roomChanges,
    ...titleChanges,
    ...cancelled.map<SyncChange>((l) => ({ kind: 'cancelled', key: lessonKey(l), label: labelOf(l), from: l.start })),
  ]
}

/** 各类别计数（键固定，便于界面直接渲染） */
export function summarizeChanges(changes: SyncChange[]): Record<SyncChangeKind, number> {
  const out: Record<SyncChangeKind, number> = {
    added: 0,
    moved: 0,
    room: 0,
    title: 0,
    cancelled: 0,
  }
  for (const c of changes) out[c.kind]++
  return out
}

/** 是否有需要主动提醒用户的变动（新增/时间/教室/取消） */
export function hasNotableChanges(changes: SyncChange[]): boolean {
  return changes.some((c) => NOTABLE_KINDS.includes(c.kind))
}

/** 最近一次同步里第一条值得提醒的变动（用于通知正文） */
export function firstNotableChange(changes: SyncChange[]): SyncChange | null {
  return changes.find((c) => NOTABLE_KINDS.includes(c.kind)) ?? null
}

/** i18n 键：把类别交给界面/通知去做本地化文案 */
export const CHANGE_KIND_KEY: Record<SyncChangeKind, string> = {
  added: 'changeAdded',
  moved: 'changeMoved',
  room: 'changeRoom',
  title: 'changeTitle',
  cancelled: 'changeCancelled',
}

/** 小组件打标的新鲜度窗口：只标 24 小时内的变动，过期后标记自行消失 */
export const WIDGET_MARK_TTL_MS = 24 * 3600 * 1000

/**
 * 给小组件用的变动标记：最近一次同步（足够新）里值得标出来的条数 +
 * 涉及的课程标识（`label`，与 payload 里的 `name` 同口径）。
 * 超过 TTL 或没有变动 → null（小组件就不打标）。
 */
export function recentChangeMarks(
  audits: SyncAudit[],
  now: number,
): { codes: string[]; n: number } | null {
  const latest = audits[0]
  if (!latest) return null
  const at = new Date(latest.at).getTime()
  if (!Number.isFinite(at) || now - at > WIDGET_MARK_TTL_MS) return null
  const notable = latest.changes.filter((c) => NOTABLE_KINDS.includes(c.kind))
  if (notable.length === 0) return null
  return { codes: [...new Set(notable.map((c) => c.label))], n: notable.length }
}

export function loadAudits(): SyncAudit[] {
  const raw = readJson<SyncAudit[]>(KEYS.syncAudit, [])
  return Array.isArray(raw) ? raw.filter((a) => a && typeof a.at === 'string') : []
}

/**
 * 追加一条审计（新的在前）并裁剪总量——**纯函数**，不写存储。
 * 持久化由调用方用 `saveAudits` 在 effect 里做，避免在 setState 更新函数里
 * 产生副作用（StrictMode 下会跑两次）。
 */
export function appendAudit(audit: SyncAudit, audits: SyncAudit[]): SyncAudit[] {
  const trimmed: SyncAudit = {
    ...audit,
    changes: audit.changes.slice(0, MAX_CHANGES_PER_AUDIT),
  }
  return [trimmed, ...audits].slice(0, MAX_AUDITS)
}

export function saveAudits(audits: SyncAudit[]): void {
  writeJson(KEYS.syncAudit, audits)
}

export function clearAudits(): void {
  writeJson(KEYS.syncAudit, [])
}
