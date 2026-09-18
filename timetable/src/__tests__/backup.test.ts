// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { importBackup, importBackupDetail } from '../lib/backup'

afterEach(() => {
  localStorage.clear()
})

function wrap(data: Record<string, unknown>): string {
  return JSON.stringify({ app: 'lut-timetable', version: 1, exportedAt: '2026-01-01T00:00:00Z', data })
}

describe('importBackup / importBackupDetail', () => {
  it('writes all string values and returns the count', () => {
    const n = importBackup(wrap({ tt_lang: '"zh"', tt_theme: '"dark"', 'tt_custom_key': 'x' }))
    expect(n).toBe(3)
    expect(localStorage.getItem('tt_lang')).toBe('"zh"')
    // Key di luar registry tetap diterima (backup lama).
    expect(localStorage.getItem('tt_custom_key')).toBe('x')
  })

  it('throws bad-format for wrong app or version', () => {
    expect(() => importBackup(JSON.stringify({ app: 'other', version: 1, data: {} }))).toThrow('bad-format')
    expect(() => importBackup(JSON.stringify({ app: 'lut-timetable', version: 2, data: {} }))).toThrow('bad-format')
    expect(() => importBackup('not json')).toThrow()
  })

  it('skips non-string values without aborting the import', () => {
    const { written, skipped } = importBackupDetail(
      wrap({ tt_lang: '"en"', tt_tasks_v1: { evil: true } }),
    )
    expect(written).toBe(1)
    expect(skipped).toEqual(['tt_tasks_v1'])
    expect(localStorage.getItem('tt_lang')).toBe('"en"')
  })

  it('reports skipped keys when setItem is rejected (quota) instead of crashing', () => {
    const big = 'x'.repeat(50)
    const setItem = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(function (this: Storage, k: string, v: string) {
      if (k === 'tt_lessons_v1') throw new DOMException('quota', 'QuotaExceededError')
      setItem.call(this, k, v)
    })
    const { written, skipped } = importBackupDetail(
      wrap({ tt_lessons_v1: big, tt_theme: '"light"' }),
    )
    spy.mockRestore()
    expect(written).toBe(1)
    expect(skipped).toEqual(['tt_lessons_v1'])
    // Key lain tetap tertulis — import parsial, bukan gagal total.
    expect(localStorage.getItem('tt_theme')).toBe('"light"')
  })

  it('treats missing data object as empty import', () => {
    const { written, skipped } = importBackupDetail(
      JSON.stringify({ app: 'lut-timetable', version: 1, exportedAt: 'x' }),
    )
    expect(written).toBe(0)
    expect(skipped).toEqual([])
  })
})
