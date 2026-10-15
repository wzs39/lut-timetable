import { useEffect, useState } from 'react'
import { loadStudyBlocks, subscribeStudyBlocks, type StudyBlock } from '../lib/studyBlocks'

/**
 * 已确认的学习块（周视图 / 今日页只读呈现用的那份列表）。
 *
 * 变更即重算：挂载时读一次，之后由 `lib/studyBlocks` 的变更信号驱动——确认/删除
 * 写盘后立刻重读，不需要切换视图、也不需要重挂载。取代了早期
 * `useMemo(() => loadStudyBlocks(), [view])` 那种「三视图互斥、切回来才重算」的
 * 隐式机制（备份导入走整页 reload，另有兜底；部分写入失败时不 reload 是可接受的
 * 退化路径）。
 */
export function useStudyBlocks(): StudyBlock[] {
  const [blocks, setBlocks] = useState<StudyBlock[]>(loadStudyBlocks)
  useEffect(() => subscribeStudyBlocks(() => setBlocks(loadStudyBlocks())), [])
  return blocks
}
