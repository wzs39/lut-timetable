import { describe, expect, it, vi } from 'vitest'
import {
  needsAttention,
  orderSheetActions,
  type SheetAction,
} from '../lib/sheetActions'

// 【排序契约】抽屉动作格子自适应：
// 有待处理事项（pending>0 / attention）的排最前——先比 priority，再比数量；
// 无事的保持声明顺序落在后面。零/缺省不算"有事"。

const a = (key: string, extra: Partial<SheetAction> = {}): SheetAction => ({
  key,
  icon: 'settings',
  label: key,
  onRun: vi.fn(),
  ...extra,
})

describe('sheetActions', () => {
  it('treats only positive counts or explicit attention as pending', () => {
    expect(needsAttention(a('x'))).toBe(false)
    expect(needsAttention(a('x', { pending: 0 }))).toBe(false)
    expect(needsAttention(a('x', { pending: 2 }))).toBe(true)
    expect(needsAttention(a('x', { attention: true }))).toBe(true)
  })

  it('keeps the declaration order when nothing needs attention', () => {
    const list = [a('settings'), a('batch'), a('lang')]
    expect(orderSheetActions(list).map((x) => x.key)).toEqual(['settings', 'batch', 'lang'])
  })

  it('hoists pending tiles by priority, then by count', () => {
    const list = [
      a('settings'),
      a('unhide', { pending: 9, priority: 2 }),
      a('lang'),
      a('dups', { pending: 3, priority: 3 }),
      a('update', { attention: true, priority: 4 }),
      a('dups-big', { pending: 7, priority: 3 }),
    ]
    expect(orderSheetActions(list).map((x) => x.key)).toEqual([
      'update', // priority 4（可更新）
      'dups-big', // priority 3，数量多者靠前
      'dups',
      'unhide', // priority 2
      'settings', // 无事 ⇒ 保持声明顺序落到后面
      'lang',
    ])
  })

  it('does not mutate the input', () => {
    const list = [a('settings'), a('dups', { pending: 1 })]
    orderSheetActions(list)
    expect(list.map((x) => x.key)).toEqual(['settings', 'dups'])
  })
})
