// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Lesson } from '../types'

// 【导出契约】lib/exportIcs 是 .ics 导出的唯一入口（Settings 与命令面板共用）：
// 文件名/MIME 固定，内容来自传入的可见课表；不传则回落到存储里的课表。
vi.mock('../lib/download', () => ({ downloadBlob: vi.fn(async () => false) }))
vi.mock('../lib/store', () => ({
  loadLessons: vi.fn(() => [
    {
      id: 'stored',
      source: 'sisu',
      code: 'STORED1',
      title: 'From storage',
      start: '2026-05-05T08:00:00.000Z',
      end: '2026-05-05T10:00:00.000Z',
    } satisfies Lesson,
  ]),
}))

import { downloadBlob } from '../lib/download'
import { exportTimetableIcs, ICS_FILENAME, ICS_MIME } from '../lib/exportIcs'

const lesson: Lesson = {
  id: 'l1',
  source: 'sisu',
  code: 'CT60A4050',
  title: 'Software Engineering',
  location: 'R112',
  start: '2026-09-26T06:00:00.000Z',
  end: '2026-09-26T08:00:00.000Z',
}

beforeEach(() => vi.mocked(downloadBlob).mockClear())
afterEach(() => vi.restoreAllMocks())

describe('exportTimetableIcs', () => {
  it('hands one .ics blob to the download/share helper', async () => {
    await exportTimetableIcs([lesson])
    expect(downloadBlob).toHaveBeenCalledTimes(1)
    const [name, blob] = vi.mocked(downloadBlob).mock.calls[0]
    expect(name).toBe(ICS_FILENAME)
    expect(blob.type).toBe(ICS_MIME)
    const text = await blob.text()
    expect(text).toContain('BEGIN:VCALENDAR')
    expect(text).toContain('SUMMARY:CT60A4050 · Software Engineering')
    expect(text).toContain('LOCATION:R112')
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  it('falls back to the stored timetable when no lessons are passed', async () => {
    await exportTimetableIcs()
    const [, blob] = vi.mocked(downloadBlob).mock.calls[0]
    expect(await blob.text()).toContain('SUMMARY:STORED1 · From storage')
  })

  it('still exports a valid (empty) calendar when there is nothing to write', async () => {
    await exportTimetableIcs([])
    const [, blob] = vi.mocked(downloadBlob).mock.calls[0]
    const text = await blob.text()
    expect(text).not.toContain('BEGIN:VEVENT')
    expect(text).toContain('END:VCALENDAR')
  })
})
