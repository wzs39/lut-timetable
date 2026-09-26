import { describe, expect, it } from 'vitest'
import type { Lesson } from '../types'
import {
  HOP_BUFFER_MIN,
  HOP_MAX_GAP_MIN,
  roomHop,
  roomHops,
  WALK_CROSS_BUILDING_MIN,
  WALK_SAME_BUILDING_MIN,
} from '../lib/roomHop'

// 【连堂赶课契约】空档 vs 步行估计。不提示的情况（没教室、同教室、并行、
// 空档太长）必须返回 null —— 误报比不报更烦人。

function l(start: string, end: string, location?: string, id = start + (location ?? '')): Lesson {
  return {
    id,
    title: 'Course',
    code: 'CT60A0250',
    location,
    start,
    end,
    source: 'sisu',
    type: 'lecture',
  } as unknown as Lesson
}

describe('roomHop', () => {
  it('estimates a cross-building walk and flags a tight gap', () => {
    const hop = roomHop(
      l('2026-09-21T08:00:00', '2026-09-21T10:00:00', 'M19_AUD1B'),
      l('2026-09-21T10:05:00', '2026-09-21T12:00:00', 'NIE73_B211'),
    )
    expect(hop).toMatchObject({
      from: 'M19_AUD1B',
      to: 'NIE73_B211',
      gapMin: 5,
      walkMin: WALK_CROSS_BUILDING_MIN,
      crossBuilding: true,
      tight: true,
    })
  })

  it('treats the same building as a short walk and a wide gap as comfortable', () => {
    const hop = roomHop(
      l('2026-09-21T08:00:00', '2026-09-21T10:00:00', 'M19_AUD1B'),
      l('2026-09-21T10:20:00', '2026-09-21T12:00:00', 'M19_LO12'),
    )
    expect(hop).toMatchObject({
      gapMin: 20,
      walkMin: WALK_SAME_BUILDING_MIN,
      crossBuilding: false,
      tight: false,
    })
    // 边界：空档 8 分钟 - 步行 3 分钟 = 正好留 HOP_BUFFER_MIN 分钟，还不算紧
    const edge = roomHop(
      l('2026-09-21T08:00:00', '2026-09-21T10:00:00', 'M19_AUD1B'),
      l('2026-09-21T10:08:00', '2026-09-21T12:00:00', 'M19_LO12'),
    )
    expect(edge?.tight).toBe(false)
    expect(edge && edge.gapMin - edge.walkMin).toBe(HOP_BUFFER_MIN)
    // 再少一分钟就该提示了
    const justTight = roomHop(
      l('2026-09-21T08:00:00', '2026-09-21T10:00:00', 'M19_AUD1B'),
      l('2026-09-21T10:07:00', '2026-09-21T12:00:00', 'M19_LO12'),
    )
    expect(justTight?.tight).toBe(true)
  })

  it('reads the building out of bare room numbers (R112 / R113 are the same building)', () => {
    const same = roomHop(
      l('2026-09-21T08:00:00', '2026-09-21T10:00:00', 'R112'),
      l('2026-09-21T10:20:00', '2026-09-21T12:00:00', 'R113'),
    )
    expect(same).toMatchObject({ crossBuilding: false, walkMin: WALK_SAME_BUILDING_MIN })
    const cross = roomHop(
      l('2026-09-21T08:00:00', '2026-09-21T10:00:00', 'R112'),
      l('2026-09-21T10:20:00', '2026-09-21T12:00:00', 'MC105'),
    )
    expect(cross).toMatchObject({ crossBuilding: true, walkMin: WALK_CROSS_BUILDING_MIN })
  })

  it('falls back to the worst case when the building is unrecognisable', () => {
    const hop = roomHop(
      l('2026-09-21T08:00:00', '2026-09-21T10:00:00', 'Etätila'),
      l('2026-09-21T10:10:00', '2026-09-21T12:00:00', 'Zoom'),
    )
    expect(hop).toMatchObject({ walkMin: WALK_CROSS_BUILDING_MIN, crossBuilding: false })
  })

  it('stays silent when there is nothing to warn about', () => {
    const a = l('2026-09-21T08:00:00', '2026-09-21T10:00:00', 'M19_AUD1B')
    // 同一间教室
    expect(roomHop(a, l('2026-09-21T10:05:00', '2026-09-21T12:00:00', 'M19_AUD1B'))).toBeNull()
    // 缺教室信息
    expect(roomHop(a, l('2026-09-21T10:05:00', '2026-09-21T12:00:00', undefined))).toBeNull()
    expect(roomHop(l('2026-09-21T08:00:00', '2026-09-21T10:00:00', undefined), a)).toBeNull()
    // 下一节更早开始（并行/数据重叠）→ 不是连堂
    expect(roomHop(a, l('2026-09-21T09:30:00', '2026-09-21T11:00:00', 'NIE73_B211'))).toBeNull()
    // 空档超过上限
    expect(
      roomHop(a, l('2026-09-21T11:00:00', '2026-09-21T13:00:00', 'NIE73_B211')),
    ).toBeNull()
    const justOver = new Date(new Date(a.end).getTime() + (HOP_MAX_GAP_MIN + 1) * 60000).toISOString()
    expect(roomHop(a, l(justOver, '2026-09-21T23:00:00', 'NIE73_B211'))).toBeNull()
  })
})

describe('roomHops', () => {
  it('keys each hop by the earlier lesson and follows time order, not input order', () => {
    const early = l('2026-09-21T08:00:00', '2026-09-21T10:00:00', 'M19_AUD1B', 'id-early')
    const late = l('2026-09-21T10:05:00', '2026-09-21T12:00:00', 'NIE73_B211', 'id-late')
    const hops = roomHops([late, early])
    expect([...hops.keys()]).toEqual(['id-early'])
    expect(hops.get('id-early')?.to).toBe('NIE73_B211')
  })

  it('skips pairs that need no hint and never leaks a hop onto an unrelated lesson', () => {
    const a = l('2026-09-21T08:00:00', '2026-09-21T10:00:00', 'M19_AUD1B', 'a')
    const b = l('2026-09-21T10:00:00', '2026-09-21T12:00:00', 'M19_AUD1B', 'b')
    const c = l('2026-09-21T12:10:00', '2026-09-21T14:00:00', 'NIE73_B211', 'c')
    const hops = roomHops([a, b, c])
    expect([...hops.keys()]).toEqual(['b'])
  })
})
