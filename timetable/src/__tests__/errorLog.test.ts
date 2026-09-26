// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  appendError,
  buildDiagnosticsReport,
  clearErrors,
  loadErrors,
  logError,
  MAX_ERRORS,
  MAX_FIELD_CHARS,
  scrubSecrets,
  shortPath,
  snapshotFor,
  type ErrorEntry,
} from '../lib/errorLog'

// 【错误日志契约】环形缓冲只留最近 N 条；导出报告不能带 token / 查询串；
// 记录失败本身不允许抛错（它跑在 catch 里）。

const entry = (i: number, over: Partial<ErrorEntry> = {}): ErrorEntry => ({
  at: `2026-09-2${i % 10}T08:00:00.000Z`,
  scope: 'sync',
  message: `boom ${i}`,
  ...over,
})

beforeEach(() => localStorage.clear())

describe('appendError', () => {
  it('keeps the newest first and caps the ring buffer', () => {
    let list: ErrorEntry[] = []
    for (let i = 0; i < MAX_ERRORS + 5; i++) list = appendError(list, entry(i))
    expect(list).toHaveLength(MAX_ERRORS)
    expect(list[0].message).toBe(`boom ${MAX_ERRORS + 4}`)
    expect(list.at(-1)?.message).toBe(`boom 5`)
  })

  it('truncates oversized fields instead of storing a whole stack dump', () => {
    const long = 'x'.repeat(MAX_FIELD_CHARS * 3)
    const [only] = appendError([], entry(1, { message: long, stack: long }))
    expect(only.message).toHaveLength(MAX_FIELD_CHARS)
    expect(only.stack).toHaveLength(MAX_FIELD_CHARS)
  })
})

describe('logError / loadErrors', () => {
  it('persists an entry for an Error, a string and an unknown throw', () => {
    logError('sync', new Error('network down'), 'sisu')
    logError('widget', 'plain string failure')
    logError('other', { weird: true })
    const list = loadErrors()
    expect(list).toHaveLength(3)
    expect(list[0].message).toContain('object Object')
    expect(list[1]).toMatchObject({ scope: 'widget', message: 'plain string failure' })
    expect(list[2]).toMatchObject({ scope: 'sync', message: 'network down', extra: 'sisu' })
  })

  it('survives garbage in storage and can be cleared', () => {
    localStorage.setItem('tt_error_log_v1', '{not json')
    expect(loadErrors()).toEqual([])
    logError('sync', new Error('x'))
    expect(loadErrors()).toHaveLength(1)
    clearErrors()
    expect(loadErrors()).toEqual([])
  })
})

describe('buildDiagnosticsReport', () => {
  const ctx = snapshotFor({ appVersion: '0.3.10', locale: 'zh-CN', sourceCount: 2, lessonCount: 7, taskCount: 3 })

  it('summarises the environment and lists errors newest first', () => {
    const report = buildDiagnosticsReport(ctx, [entry(2, { stack: 'a\nb' }), entry(1)])
    expect(report).toContain('version: 0.3.10')
    expect(report).toContain('lessons: 7')
    expect(report).toContain('errors (2, newest first):')
    expect(report.indexOf('boom 2')).toBeLessThan(report.indexOf('boom 1'))
    expect(report).toContain('   a\n   b')
  })

  it('says so when there is nothing to report', () => {
    expect(buildDiagnosticsReport(ctx, [])).toContain('no errors recorded')
  })
})

describe('scrubSecrets', () => {
  it('removes tokens and query strings before a report leaves the device', () => {
    const raw = [
      'GET https://sisu.lut.fi/calendar-share/feed?token=abc123&lang=fi failed',
      'wstoken=deadbeefdeadbeefdeadbeefdeadbeef',
      'https://moodle.lut.fi/webservice/rest/server.php?wstoken=secret&wsfunction=x',
    ].join('\n')
    const clean = scrubSecrets(raw)
    expect(clean).not.toContain('abc123')
    expect(clean).not.toContain('deadbeef')
    expect(clean).not.toContain('secret')
    expect(clean).toContain('token=***')
    expect(clean).toContain('https://sisu.lut.fi/calendar-share/feed?***')
  })

  it('leaves token-free text untouched', () => {
    const plain = 'sync failed: NetworkError when attempting to fetch resource.'
    expect(scrubSecrets(plain)).toBe(plain)
  })
})

describe('shortPath', () => {
  it('keeps only the last two segments so absolute paths stay private', () => {
    expect(shortPath('/Users/someone/dev/app/src/lib/x.ts')).toBe('lib/x.ts')
    // Windows 路径也归一成 '/'（报告里的分隔符统一，读起来不刺眼）
    expect(shortPath('C:\\Users\\someone\\app\\main.cjs')).toBe('app/main.cjs')
  })
})
