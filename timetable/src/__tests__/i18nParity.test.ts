import { describe, expect, it } from 'vitest'
import { messages } from '../i18n/messages'

/**
 * 【文案对齐契约】中英键集合必须完全相同，值不能为空，占位符集合必须一致。
 *
 * 以前没有这条守卫：漏写英文只会静默显示原始 key，而漏写 `{n}` 会在
 * 另一个语言里留下一个空洞的内容。新增文案时这条测试是唯一提醒。
 */

const paramsOf = (value: string): string[] =>
  [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('i18n messages', () => {
  const zh = messages.zh
  const en = messages.en

  it('has the same keys in both languages', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('has no empty or placeholder-less mismatches', () => {
    const bad: string[] = []
    for (const key of Object.keys(zh)) {
      if (!zh[key]?.trim() || !en[key]?.trim()) bad.push(`${key}: empty`)
      else if (paramsOf(zh[key]).join(',') !== paramsOf(en[key]).join(',')) {
        bad.push(`${key}: {${paramsOf(zh[key]).join(',')}} vs {${paramsOf(en[key]).join(',')}}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('keeps newly added keys translated', () => {
    for (const key of [
      'semesterTitle',
      'semesterProgress',
      'insightsTitle',
      'printWeek',
      'attendanceTitle',
      'attendanceCourse',
    ] as const) {
      expect(zh[key], key).toBeTruthy()
      expect(en[key], key).toBeTruthy()
    }
  })
})
