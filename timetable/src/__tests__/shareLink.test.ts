import { describe, expect, it } from 'vitest'
import type { Lesson } from '../types'
import {
  decodeShare,
  encodeShare,
  MAX_SHARE_LESSONS,
  parseShareHash,
  SHARE_HASH_PREFIX,
  shareLinkFor,
} from '../lib/shareLink'

// 【分享链接契约】编码→解码往返必须等价；坏链接/别的版本/超长都要被拦住，
// 而不是把半个课表悄悄导进别人的日历。

/** 手搓 v1 载荷（全 ASCII），不依赖 Node 的 Buffer 类型 */
function base64Url(text: string): string {
  const b64 = btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `v1.${b64}`
}

function lesson(i: number, over: Partial<Lesson> = {}): Lesson {
  const start = new Date(Date.UTC(2026, 8, 21 + (i % 5), 6 + i, 15))
  return {
    id: `id-${i}`,
    code: `CT60A02${50 + i}`,
    title: `Course ${i}`,
    location: `M19_${i}`,
    start: start.toISOString(),
    end: new Date(start.getTime() + 7200000).toISOString(),
    source: 'sisu',
    type: 'lecture',
    ...over,
  } as unknown as Lesson
}

describe('encodeShare / decodeShare', () => {
  it('round-trips a week of lessons without ids or sources', () => {
    const lessons = [lesson(0), lesson(1), lesson(2, { location: undefined })]
    const payload = encodeShare(lessons)
    expect(payload).toBeTruthy()
    const back = decodeShare(payload!)
    expect(back?.dropped).toBe(0)
    expect(back?.lessons).toHaveLength(3)
    const first = back!.lessons[0]
    expect(first.code).toBe('CT60A0250')
    expect(first.title).toBe('Course 0')
    expect(first.location).toBe('M19_0')
    expect(first.start).toBe(lessons[0].start)
    // 不携带本机的 id / source —— 由导入方决定
    expect('id' in first).toBe(false)
    expect('source' in first).toBe(false)
    // 空教室还原成 undefined（而不是空字符串）
    expect(back!.lessons[2].location).toBeUndefined()
  })

  it('sorts rows by start time so the payload is stable', () => {
    const a = encodeShare([lesson(3), lesson(0)])
    const b = encodeShare([lesson(0), lesson(3)])
    expect(a).toBe(b)
  })

  it('produces a URL-safe payload (no +, / or =)', () => {
    const payload = encodeShare([lesson(1), lesson(4), lesson(7)])!
    expect(payload).toMatch(/^v1\.[A-Za-z0-9_-]+$/)
  })

  it('refuses to encode an empty or oversized timetable', () => {
    expect(encodeShare([])).toBeNull()
    const many = Array.from({ length: MAX_SHARE_LESSONS + 1 }, (_, i) => lesson(i))
    expect(encodeShare(many)).toBeNull()
    // 一整学期（~300 节）超出 URL 可用长度 → 返回 null，界面引导改用导出
    const semester = Array.from({ length: MAX_SHARE_LESSONS }, (_, i) =>
      lesson(i, { title: 'Todella pitkä kurssin nimi joka toistuu' }),
    )
    expect(encodeShare(semester)).toBeNull()
  })

  it('rejects broken, foreign and half-truncated payloads', () => {
    expect(decodeShare('nonsense')).toBeNull()
    expect(decodeShare('v2.abcd')).toBeNull()
    expect(decodeShare('v1.!!!!')).toBeNull()
    // 合法前缀但内容被截断
    const payload = encodeShare([lesson(0), lesson(1)])!
    expect(decodeShare(payload.slice(0, payload.length - 6))).toBeNull()
    // 行里缺字段 / 时间不合法 → 丢弃这一行，其余仍然导入
    const rows = JSON.stringify([['X', 'Broken', '', 'not-a-date', 'also-not']])
    expect(decodeShare(base64Url(rows))).toBeNull()
    const mixed = JSON.stringify([
      ['X', 'Broken', '', 'not-a-date', 'also-not'],
      ['CT60A0250', 'Fine', 'M19', lesson(0).start, lesson(0).end, 'lecture'],
    ])
    const ok = decodeShare(base64Url(mixed))
    expect(ok?.lessons).toHaveLength(1)
    expect(ok?.dropped).toBe(1)
  })
})

describe('shareLinkFor / parseShareHash', () => {
  it('builds a link with the import hash and drops any existing hash', () => {
    const link = shareLinkFor([lesson(0)], 'https://example.com/app/#/view/week')
    expect(link).toContain(`${SHARE_HASH_PREFIX}v1.`)
    expect(link).not.toContain('#/view/week')
    expect(link?.startsWith('https://example.com/app/')).toBe(true)
  })

  it('parses only import hashes', () => {
    const payload = encodeShare([lesson(0)])!
    expect(parseShareHash(`${SHARE_HASH_PREFIX}${payload}`)).toBe(payload)
    expect(parseShareHash('#/view/week')).toBeNull()
    expect(parseShareHash(SHARE_HASH_PREFIX)).toBeNull()
    expect(parseShareHash('')).toBeNull()
  })

  it('round-trips link → hash → lessons', () => {
    const link = shareLinkFor([lesson(2), lesson(5)], 'https://example.com/')!
    const hash = link.slice(link.indexOf('#'))
    const payload = parseShareHash(hash)!
    const back = decodeShare(payload)!
    // 行按开始时间排：lesson(5) 在 21 日 11:15，lesson(2) 在 23 日 8:15
    expect(back.lessons.map((l) => l.code)).toEqual(['CT60A0255', 'CT60A0252'])
  })
})
