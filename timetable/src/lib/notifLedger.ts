import { KEYS, readJson, writeJson } from './storage'

/** 提醒家族标识：记账键、审计与诊断面板共用同一组名字，避免各处自造拼串。 */
export type NotifFamily = 'lesson' | 'due' | 'exam' | 'digest' | 'studyBlock' | 'sisuPlan'

/**
 * 家族 → 记账键。全是**派生后缀**（不进 BACKUP_KEYS）。
 *
 * 为什么 exam 与 lesson 不共用一个键：两家的 id 都从课表推导，但分属不同 id 空间
 * （`lesson|…` 与 `exam|…`）；共键会让一家的清扫把另一家记下的 id 当成自己的陈旧条目。
 */
export const NOTIF_LEDGER_KEYS: Record<NotifFamily, string> = {
  lesson: `${KEYS.lessons}:scheduled`,
  due: `${KEYS.tasks}:scheduled`,
  exam: `${KEYS.lessons}:exam-scheduled`,
  digest: `${KEYS.digest}:scheduled`,
  studyBlock: `${KEYS.studyBlocks}:scheduled`,
  sisuPlan: `${KEYS.sisuStudyPlan}:scheduled`,
}

/**
 * 提醒家族共用的「已排期记账」：**只取消自己排过的东西**。
 *
 * 为什么必须记账：取消陈旧提醒时，唯一能从当前数据反推出来的 id 是「还在数据里的条目」。
 * 一旦条目被删（课删了、任务删了、考试改了时间、块删了），它的 id 就再也算不出来，
 * 于是各家只能拿「当前想要的集合」去扫队列——**那就是把别的家族的通知一起删掉**
 * （实测：课程提醒在 wanted 为空时会清空整个队列，学习时段提醒记账里还记着 id、
 * 队列里已经没了，到点自然不响）。
 *
 * 记账把「我排过谁」变成一等数据，于是清扫可以收窄成三集合运算：
 * 「记账里有 ∧ 队列里在 ∧ 现在不想要」——其余一律不碰。
 *
 * 键是**派生后缀**（如 `tt_lessons_v1:scheduled`），不进 BACKUP_KEYS：
 * 它是可重建的运行时状态，导入备份时不该把别台机器的 id 带进来。
 */

/** 读取某家族的记账（脏数据容错：非数组当空，丢掉非安全整数）。 */
export function loadNotifLedger(key: string): number[] {
  const raw = readJson<unknown>(key, [])
  return (Array.isArray(raw) ? raw : []).filter((id): id is number => Number.isSafeInteger(id))
}

export function saveNotifLedger(key: string, ids: number[]): void {
  writeJson(key, ids)
}

/**
 * 该取消哪些 id（纯函数）：记账里有、队列里确实在、而当前已不再想要。
 *
 * 不碰「队列里在但没记账」的条目——那是别人排的（或别的版本排的），
 * 未经许可删除他人条目正是这个函数存在的理由。
 */
export function ownedStaleIds(
  recorded: number[],
  queuedIds: number[],
  wantedIds: number[],
): number[] {
  const queued = new Set(queuedIds)
  const wanted = new Set(wantedIds)
  return recorded.filter((id) => queued.has(id) && !wanted.has(id))
}

/**
 * 三集合对账的**唯一实现**（六家共用：各家的 `wanted` 纯函数产出 expected，
 * 各家的记账产出 recorded，队列是真实读数）。
 *
 * - `missing`：按当前数据本应排上、队列里却没有 → **到点不会响**
 * - `stale`：记账里有、但按当前数据**已不该有** → 下次清扫会收掉（条目被删、时间改到窗口外，
 *   或那一轮根本没排上）。与队列在不在无关：这两个问题都要报出来。
 *
 * 与 `ownedStaleIds`（清扫口径 = 记账 ∧ 队列 ∧ ¬想要）**刻意不同**：清扫只碰队列里真实
 * 存在的条目（取消一个不存在的 id 没意义），而审计要告诉用户「记账还留着它」。
 * 同一条不会既算 missing 又算 stale：missing ⊆ expected，而 stale ∩ expected = ∅。
 */
export function auditFamily(
  expected: number[],
  recorded: number[],
  queuedIds: number[],
): { missing: number[]; stale: number[] } {
  const queued = new Set(queuedIds)
  const expectedSet = new Set(expected)
  return {
    missing: expected.filter((id) => !queued.has(id)),
    stale: recorded.filter((id) => !expectedSet.has(id)),
  }
}
