import { describe, expect, it } from 'vitest'
import type { Lesson } from '../types'
import {
  DIGEST_DAYS,
  DIGEST_HOUR,
  DIGEST_MINUTE,
  digestIdFor,
  digestWindowIds,
  planDigests,
  type DigestTexts,
} from '../lib/dailyDigest'

// 【每日摘要契约】早上 07:30 推当天第一节课：排几天、什么时候排、正文长什么样，
// 以及「今天已经过了 07:30 就不再排今天」——纯函数，可注入时钟。

const texts: DigestTexts = {
  title: 'D',
  empty: 'none',
  body: (n, time, loc) => `${n}|${time}${loc}`,
}

function lesson(start: string, location = 'R112', code = 'CT60A0250'): Lesson {
  return {
    id: start + code,
    title: code,
    code,
    location,
    start,
    end: new Date(new Date(start).getTime() + 7200000).toISOString(),
    source: 'sisu',
    type: 'lecture',
  } as unknown as Lesson
}

describe('planDigests', () => {
  const morning = new Date('2026-09-21T06:00:00') // 周一 06:00 — 还没到 07:30

  it('schedules one digest per day for the whole window', () => {
    const plan = planDigests([], morning, texts)
    expect(plan).toHaveLength(DIGEST_DAYS)
    expect(plan[0].at.getHours()).toBe(DIGEST_HOUR)
    expect(plan[0].at.getMinutes()).toBe(DIGEST_MINUTE)
    expect(plan[0].day).toBe('2026-09-21')
    expect(plan[1].day).toBe('2026-09-22')
    expect(plan[0].body).toBe('none')
  })

  it('counts the day\'s lessons and names the first one', () => {
    const plan = planDigests(
      [
        lesson('2026-09-21T10:15:00'),
        lesson('2026-09-21T08:15:00', 'MC105'),
        lesson('2026-09-22T09:00:00', 'M19'),
      ],
      morning,
      texts,
    )
    // 第一节按时间取，不按输入顺序
    expect(plan[0].body).toBe('2|08:15 @MC105')
    expect(plan[1].body).toBe('1|09:00 @M19')
    expect(plan[2].body).toBe('none')
  })

  it('omits a location suffix when the room is unknown', () => {
    const plan = planDigests(
      [{ ...lesson('2026-09-21T08:15:00'), location: '' } as Lesson],
      morning,
      texts,
    )
    expect(plan[0].body).toBe('1|08:15')
  })

  it('skips today once the digest time has passed, keeps the rest', () => {
    const plan = planDigests([lesson('2026-09-21T10:00:00')], new Date('2026-09-21T09:00:00'), texts)
    expect(plan.map((p) => p.day)).not.toContain('2026-09-21')
    expect(plan[0].day).toBe('2026-09-22')
    expect(plan).toHaveLength(DIGEST_DAYS - 1)
  })

  it('does not leak lessons from other days into a digest', () => {
    const plan = planDigests([lesson('2026-09-20T08:00:00'), lesson('2026-09-23T08:00:00')], morning, texts)
    // 窗口从 9/21 开始，所以 9/23（周三）落在索引 2；9/20 已在窗口之前
    expect(plan.map((p) => p.body)).toEqual([
      'none',
      'none',
      '1|08:00 @R112',
      'none',
      'none',
      'none',
      'none',
    ])
  })

  it('derives stable, distinct ids from the calendar date', () => {
    const a = digestIdFor(new Date('2026-09-21T06:00:00'))
    const b = digestIdFor(new Date('2026-09-21T23:59:00'))
    const c = digestIdFor(new Date('2026-09-22T06:00:00'))
    expect(a).toBe(b)
    expect(c).toBe(a + 1)
    expect(digestWindowIds(morning)).toHaveLength(DIGEST_DAYS)
    // 与课程提醒的哈希 id（< 2^31 的任意值）区分：摘要固定在 18 亿段
    expect(a).toBeGreaterThan(1_800_000_000)
  })
})
