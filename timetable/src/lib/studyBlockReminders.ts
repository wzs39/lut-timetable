import { LocalNotifications } from './localNotifications'
import type { StudyBlock } from './studyBlocks'
import { formatTime } from './date'
import { ensurePermission, exactAlarmsEnabled } from './notifications'
import { NOTIF_LEDGER_KEYS, auditFamily, loadNotifLedger, saveNotifLedger } from './notifLedger'

/**
 * 已确认学习块的本地提醒：块开始前 10 分钟推一条。
 *
 * 与 `sisuStudyPlanReminders` 同一套模式（权限闸门 + 已排期清单对账 + 稳定 FNV-1a id），
 * 而不是另立一套：提醒只**读**学习块，绝不写服务器、不动已读记录，也不碰其它类别
 * 的提醒（课程/任务/考试/摘要各有自己的 id 空间与清理入口）。
 *
 * 为什么不用「从当前块反推 id」（examReminders 那套）：学习块可以被用户直接删除，
 * 删除后块已不在列表里，id 就再也反推不出来、陈旧通知会永远留着。所以维护一份
 * 已排期清单（`tt_study_blocks_v1:scheduled`，非备份键），对账只动自己的条目。
 */

/** 块开始前提醒的提前量（分钟） */
export const STUDY_BLOCK_REMIND_BEFORE_MINUTES = 10
/** 只排期窗口内的块（块本身不会超过用户设定的推荐范围，这里再兜一层） */
const SCHEDULE_WINDOW_D = 30
const TRACKED_KEY = NOTIF_LEDGER_KEYS.studyBlock

/** Stable positive int32 notification id from block id + lead time. */
export function studyBlockNotifId(blockId: string, beforeMinutes: number): number {
  let hash = 0x811c9dc5
  const key = `study-block:${blockId}:${beforeMinutes}`
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 2147483647
}

export interface StudyBlockReminder {
  id: number
  at: Date
  block: StudyBlock
  beforeMinutes: number
}

/**
 * 选出需要排期的提醒（纯函数，便于测试）：
 * - 只排尚未开始、区间有效且在 SCHEDULE_WINDOW_D 天内的块
 * - 每个块一条：开始前 STUDY_BLOCK_REMIND_BEFORE_MINUTES 分钟
 * - 提醒点已过去的块跳过（用户确认时块可能就差几分钟开始）
 */
export function wantedStudyBlockReminders(blocks: StudyBlock[], now: number): Map<number, StudyBlockReminder> {
  const windowMs = SCHEDULE_WINDOW_D * 86400000
  const wanted = new Map<number, StudyBlockReminder>()
  for (const block of blocks) {
    const start = Date.parse(block.startAt)
    const end = Date.parse(block.endAt)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    if (start <= now || start > now + windowMs) continue
    const at = start - STUDY_BLOCK_REMIND_BEFORE_MINUTES * 60000
    if (at <= now) continue
    const id = studyBlockNotifId(block.id, STUDY_BLOCK_REMIND_BEFORE_MINUTES)
    wanted.set(id, { id, at: new Date(at), block, beforeMinutes: STUDY_BLOCK_REMIND_BEFORE_MINUTES })
  }
  return wanted
}

/**
 * 已排期清单的读写全部走记账的唯一所有者 `notifLedger`（脏数据容错也在那里，只写一份）。
 * 曾经这里自己 `readJson` + 过滤：两份容错迟早分叉，就会出现「一家认得的记录另一家当垃圾」。
 */
function trackedIds(): number[] {
  return loadNotifLedger(TRACKED_KEY)
}

/** 已排期清单的只读投影（诊断用：把「记账」与真实系统队列对账）。 */
export function trackedStudyBlockIds(): number[] {
  return trackedIds()
}

export interface StudyBlockReminderAudit {
  /** 按当前块数据「本应排上」的 id */
  expected: number[]
  /** 本应排上、系统队列里却没有——这些提醒**不会响** */
  missing: number[]
  /** 记账清单里有、队列里也没有、且已不在待排集合里——陈旧记账（队列丢了/被系统清掉/块已删但没对上） */
  stale: number[]
}

/**
 * 记账 ↔ 真实队列对账（纯函数）。
 *
 * 为什么需要：排期链上有三份状态——**当前数据**（应排什么）、**记账清单**
 * （上次排完记下的 id）、**系统队列**（真正会响的东西）。三者一旦不同步，症状
 * 全都是“什么都不发生”：插件静默失败、WebView 重载把内存里的队列清掉、取消与
 * 重排交错、块被删但取消没走到。把它们摆在一起比较，才能区分「没排上」与「排过了」。
 *
 * 语义要点：
 * - 提醒点已过去的块**不算** missing（那时服务已完成，队列本就不该再有它）——
 *   所以投递后再看应该完全干净，不会留假警报。
 * - 只有既不在队列、又不在待排集合里的记账才算 stale（否则会和 missing 重复计数）。
 */
export function auditStudyBlockReminders(
  blocks: StudyBlock[],
  trackedIds: number[],
  queuedIds: number[],
  now: number,
): StudyBlockReminderAudit {
  const expected = [...wantedStudyBlockReminders(blocks, now).keys()]
  return { expected, ...auditFamily(expected, trackedIds, queuedIds) }
}

/** 撤销并遗忘自己排过的全部条目（只动 TRACKED_KEY 里记着的 id）。 */
async function cancelTracked(): Promise<void> {
  const previous = trackedIds()
  if (previous.length > 0) {
    await LocalNotifications.cancel({ notifications: previous.map((id) => ({ id })) })
  }
  saveNotifLedger(TRACKED_KEY, [])
}

/** 通知文案（唯一所有者是 i18n；这里只声明形状，便于自愈入口复用同一份）。 */
export interface StudyBlockNotifTexts {
  title: string
  body: (block: StudyBlock, time: string) => string
}

/**
 * 把学习块提醒与当前块列表对齐。
 *
 * - `enabled === false`（偏好里的提醒开关关掉）→ 只清自己的条目
 * - 无待排块 → 同上
 * - 权限未授予 → 清掉旧的、不排新的、不抛错（Android 13+ 未授权时插件会在
 *   原生线程 NPE 直接杀进程，闸门必须排在碰插件之前）
 * - 时间/标题可能变而 id 稳定，所以整体重排，不留下旧时间的副本
 *
 * **幂等**：重复调用（含「对账发现缺失后再排一次」的自愈路径）不会产生副本——
 * 每次都先 `cancelTracked()` 再按当前块排一遍，且记账随排期一起改写。
 */
export async function refreshStudyBlockReminders(
  blocks: StudyBlock[],
  texts: StudyBlockNotifTexts,
  options: { enabled: boolean; locale?: string },
): Promise<void> {
  if (!options.enabled) {
    await cancelTracked()
    return
  }
  const desired = wantedStudyBlockReminders(blocks, Date.now())
  if (desired.size === 0) {
    await cancelTracked()
    return
  }
  const granted = await ensurePermission()
  if (!granted) {
    await cancelTracked()
    return
  }

  await cancelTracked()
  const exact = await exactAlarmsEnabled()
  const notifications = [...desired].map(([id, data]) => ({
    id,
    title: texts.title,
    body: texts.body(data.block, formatTime(data.block.startAt, options.locale)),
    schedule: { at: data.at, allowWhileIdle: true, exact },
    smallIcon: 'ic_stat_lesson',
    iconColor: '#e7e5e4',
  }))
  if (notifications.length > 0) await LocalNotifications.schedule({ notifications })
  saveNotifLedger(TRACKED_KEY, [...desired.keys()])
}

/** 清空学习块提醒（提醒开关关掉 / 通知总开关关掉时用，不动别类提醒）。 */
export async function cancelStudyBlockReminders(): Promise<void> {
  try {
    await cancelTracked()
  } catch {
    /* 静默：通知清理失败不影响应用 */
  }
}
