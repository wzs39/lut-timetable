import { isStudyBlock, type StudyBlock } from './studyBlocks'

/**
 * 本周负荷概览：**只读汇总**，只统计已确认的学习块。
 *
 * - 未确认的建议存在于 hook 内存里，根本不进这个函数——概览数字不因「生成建议」而变。
 * - 按**设备本地日**分桶（UTC 日期与本地日在 UTC+8 下差一天，跨日边界会静默漏块）。
 * - 坏数据（非法记录/非法区间/空白标题）忽略，不把它算成负荷；周锚点非法返回空概览。
 * - 不改任何数据：不新建日程、不参与冲突组/便签/ICS 导出。
 */

export interface StudyLoadDay {
  /** 本地日（YYYY-MM-DD） */
  date: string
  blocks: number
  completed: number
  minutes: number
}

export interface StudyLoadSummary {
  /** 本地周一 00:00（ISO） */
  weekStart: string
  /** 下周一 00:00（ISO，开区间） */
  weekEnd: string
  blocks: number
  completedBlocks: number
  remainingBlocks: number
  minutes: number
  completedMinutes: number
  remainingMinutes: number
  /** 本周内已经到点但还没完成的块数 */
  overdueBlocks: number
  /** 恰好 7 项，按本地日升序；周锚点非法时为空数组 */
  days: StudyLoadDay[]
}

function localDayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const EMPTY: Omit<StudyLoadSummary, 'days'> = {
  weekStart: '',
  weekEnd: '',
  blocks: 0,
  completedBlocks: 0,
  remainingBlocks: 0,
  minutes: 0,
  completedMinutes: 0,
  remainingMinutes: 0,
  overdueBlocks: 0,
}

/**
 * 汇总 `weekStart` 起 7 个本地日内的已确认块。
 *
 * 用本地日期算术（而不是 +7×24h）构造周界与日桶，夏令时切换不会把边界挪错。
 */
export function studyLoadSummary(blocks: StudyBlock[], weekStart: Date, now: Date): StudyLoadSummary {
  const anchor = weekStart.getTime()
  if (!Number.isFinite(anchor)) return { ...EMPTY, days: [] }

  const days: StudyLoadDay[] = []
  const dayIndexOf = new Map<string, number>()
  const weekEndDate = new Date(anchor)
  weekEndDate.setDate(weekEndDate.getDate() + 7)
  weekEndDate.setHours(0, 0, 0, 0)
  for (let offset = 0; offset < 7; offset++) {
    const day = new Date(anchor)
    day.setDate(day.getDate() + offset)
    day.setHours(0, 0, 0, 0)
    const key = localDayKey(day)
    dayIndexOf.set(key, offset)
    days.push({ date: key, blocks: 0, completed: 0, minutes: 0 })
  }

  const weekEnd = weekEndDate.getTime()
  const nowMs = now.getTime()
  let blockCount = 0
  let completedCount = 0
  let minutes = 0
  let completedMinutes = 0
  let overdue = 0

  for (const block of blocks) {
    if (!isStudyBlock(block)) continue
    const start = Date.parse(block.startAt)
    const end = Date.parse(block.endAt)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    // 归属按开始时刻：块跨日不重复计数，跨周同理
    if (start < anchor || start >= weekEnd) continue
    const index = dayIndexOf.get(localDayKey(new Date(start)))
    if (index === undefined) continue
    const duration = Math.round((end - start) / 60000)
    const done = block.completed === true
    blockCount++
    minutes += duration
    if (done) {
      completedCount++
      completedMinutes += duration
    }
    if (!done && Number.isFinite(nowMs) && start <= nowMs) overdue++
    const bucket = days[index]
    bucket.blocks++
    bucket.minutes += duration
    if (done) bucket.completed++
  }

  return {
    weekStart: new Date(anchor).toISOString(),
    weekEnd: new Date(weekEnd).toISOString(),
    blocks: blockCount,
    completedBlocks: completedCount,
    remainingBlocks: blockCount - completedCount,
    minutes,
    completedMinutes,
    remainingMinutes: minutes - completedMinutes,
    overdueBlocks: overdue,
    days,
  }
}
