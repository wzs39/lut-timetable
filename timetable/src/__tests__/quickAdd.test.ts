import { describe, expect, it } from 'vitest'
import { parseOmniQuickAdd, parseQuickAdd } from '../lib/quickAdd'

// 【快速录入契约】必须带触发词（否则退回普通搜索）；日期/时刻解析要准；
// 认不出的部分原样留在标题里，绝不静默丢字。

// 2026-09-23 是周三，本地时间 10:00
const NOW = new Date(2026, 8, 23, 10, 0, 0)

const local = (iso?: string) => {
  if (!iso) return null
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

describe('trigger', () => {
  it('needs a trigger word so plain searching stays searching', () => {
    expect(parseQuickAdd('Data structures', NOW)).toBeNull()
    expect(parseQuickAdd('周三 密码学报告', NOW)).toBeNull()
    expect(parseQuickAdd('', NOW)).toBeNull()
    expect(parseQuickAdd('作业', NOW)).toBeNull() // 触发词后没内容
    expect(parseQuickAdd('task', NOW)).toBeNull()
  })

  it('accepts Chinese and English triggers, case-insensitively', () => {
    expect(parseQuickAdd('作业 写报告', NOW)?.title).toBe('写报告')
    expect(parseQuickAdd('任务 写报告', NOW)?.title).toBe('写报告')
    expect(parseQuickAdd('TODO write report', NOW)?.title).toBe('write report')
    // "tasklist" 不是触发词（词边界）
    expect(parseQuickAdd('tasklist review', NOW)).toBeNull()
  })

  it('keeps the title when there is no date at all', () => {
    const q = parseQuickAdd('作业 密码学报告', NOW)
    expect(q).toEqual({ title: '密码学报告' })
  })
})

describe('dates', () => {
  it('resolves relative days', () => {
    expect(local(parseQuickAdd('作业 今天 交报告', NOW)?.dueAt)).toBe('2026-09-23 23:59')
    expect(local(parseQuickAdd('作业 明天 交报告', NOW)?.dueAt)).toBe('2026-09-24 23:59')
    expect(local(parseQuickAdd('作业 后天 交报告', NOW)?.dueAt)).toBe('2026-09-25 23:59')
    expect(local(parseQuickAdd('作业 3天后 交报告', NOW)?.dueAt)).toBe('2026-09-26 23:59')
    expect(local(parseQuickAdd('作业 +5 交报告', NOW)?.dueAt)).toBe('2026-09-28 23:59')
  })

  it('resolves weekdays to the next occurrence, plus explicit 下/next week', () => {
    // 今天是周三：周一是"4 天后"，下周一再 +7
    expect(local(parseQuickAdd('作业 周一 交报告', NOW)?.dueAt)).toBe('2026-09-28 23:59')
    expect(local(parseQuickAdd('作业 下周一 交报告', NOW)?.dueAt)).toBe('2026-10-05 23:59')
    // 周三（今天）→ 今天
    expect(local(parseQuickAdd('作业 周三 交报告', NOW)?.dueAt)).toBe('2026-09-23 23:59')
    expect(local(parseQuickAdd('作业 星期三 交报告', NOW)?.dueAt)).toBe('2026-09-23 23:59')
    expect(local(parseQuickAdd('作业 周五 交报告', NOW)?.dueAt)).toBe('2026-09-25 23:59')
    expect(local(parseQuickAdd('task friday report', NOW)?.dueAt)).toBe('2026-09-25 23:59')
    expect(local(parseQuickAdd('task next fri report', NOW)?.dueAt)).toBe('2026-10-02 23:59')
  })

  it('resolves absolute dates and rolls past dates into next year', () => {
    expect(local(parseQuickAdd('作业 10月1日 交报告', NOW)?.dueAt)).toBe('2026-10-01 23:59')
    expect(local(parseQuickAdd('作业 10/2 交报告', NOW)?.dueAt)).toBe('2026-10-02 23:59')
    expect(local(parseQuickAdd('作业 2026-10-03 交报告', NOW)?.dueAt)).toBe('2026-10-03 23:59')
    // 9/1 已经过去 → 明年
    expect(local(parseQuickAdd('作业 9月1日 交报告', NOW)?.dueAt)).toBe('2027-09-01 23:59')
    // 2 月 30 日不存在 → 不当日期，留在标题里
    const bad = parseQuickAdd('作业 2月30日 交报告', NOW)
    expect(bad?.dueAt).toBeUndefined()
    expect(bad?.title).toContain('2月30日')
  })

  it('keeps the surrounding words as the title, without the date words', () => {
    const q = parseQuickAdd('作业 周三 14:00 密码学报告', NOW)
    expect(q?.title).toBe('密码学报告')
    expect(local(q?.dueAt)).toBe('2026-09-23 14:00')
  })
})

describe('times', () => {
  it('parses clock forms and periods', () => {
    expect(local(parseQuickAdd('作业 明天 8:15 交报告', NOW)?.dueAt)).toBe('2026-09-24 08:15')
    expect(local(parseQuickAdd('作业 明天 8点 交报告', NOW)?.dueAt)).toBe('2026-09-24 08:00')
    expect(local(parseQuickAdd('作业 明天 8点半 交报告', NOW)?.dueAt)).toBe('2026-09-24 08:30')
    expect(local(parseQuickAdd('作业 明天 下午3点 交报告', NOW)?.dueAt)).toBe('2026-09-24 15:00')
    expect(local(parseQuickAdd('作业 明天 晚上11点45分 交报告', NOW)?.dueAt)).toBe('2026-09-24 23:45')
    // 12 点不属于"下午 +12"
    expect(local(parseQuickAdd('作业 明天 下午12:30 交报告', NOW)?.dueAt)).toBe('2026-09-24 12:30')
  })

  it('with only a time, uses today and rolls to tomorrow once it has passed', () => {
    expect(local(parseQuickAdd('作业 23:00 交报告', NOW)?.dueAt)).toBe('2026-09-23 23:00')
    // 09:00 已经过了（现在是 10:00）→ 明天
    expect(local(parseQuickAdd('作业 09:00 交报告', NOW)?.dueAt)).toBe('2026-09-24 09:00')
  })
})

describe('parseOmniQuickAdd (Omni-Command Bar 2.0)', () => {
  it('parses prefix-free study block scheduling with weekday, start time, duration, and course code', () => {
    const res1 = parseOmniQuickAdd('周四 15:00 算法复习 90m', NOW)
    expect(res1?.kind).toBe('study-block')
    expect(res1?.title).toBe('算法复习')
    expect(res1?.durationMin).toBe(90)
    expect(local(res1?.startOrDueAt)).toBe('2026-09-24 15:00')
    expect(local(res1?.endAt)).toBe('2026-09-24 16:30')

    const res2 = parseOmniQuickAdd('明天 14:00 CT60A2411 刷题 2h', NOW)
    expect(res2?.kind).toBe('study-block')
    expect(res2?.course).toBe('CT60A2411')
    expect(res2?.title).toBe('刷题')
    expect(res2?.durationMin).toBe(120)
    expect(local(res2?.startOrDueAt)).toBe('2026-09-24 14:00')
    expect(local(res2?.endAt)).toBe('2026-09-24 16:00')

    const res3 = parseOmniQuickAdd('Thu 15:00 #BM20A9200 Algo review 1.5h', NOW)
    expect(res3?.kind).toBe('study-block')
    expect(res3?.course).toBe('BM20A9200')
    expect(res3?.title).toBe('Algo review')
    expect(res3?.durationMin).toBe(90)
  })

  it('parses task deadlines and returns null for plain search queries', () => {
    expect(parseOmniQuickAdd('Data structures', NOW)).toBeNull()
    const taskRes = parseOmniQuickAdd('ddl 周五 18:00 CT60A2411 提交实验报告', NOW)
    expect(taskRes?.kind).toBe('task')
    expect(taskRes?.course).toBe('CT60A2411')
    expect(taskRes?.title).toBe('提交实验报告')
    expect(local(taskRes?.startOrDueAt)).toBe('2026-09-25 18:00')
  })
})
