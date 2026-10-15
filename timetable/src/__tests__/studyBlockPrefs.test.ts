// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_KEYS, KEYS } from '../lib/storage'
import {
  DEFAULT_STUDY_BLOCK_PREFS,
  STUDY_BLOCK_LIMITS,
  loadStudyBlockPrefs,
  normalizeStudyBlockPrefs,
  saveStudyBlockPrefs,
} from '../lib/studyBlockPrefs'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
})

describe('study block preferences', () => {
  it('registers the key in backup storage and defaults to the Phase 1 scheduling constants', () => {
    expect(KEYS.studyBlockPrefs).toBe('tt_study_block_prefs_v1')
    expect(BACKUP_KEYS).toContain(KEYS.studyBlockPrefs)
    // 默认值就是契约：等于 Phase 1 的硬编码常量（08:00–22:00 / 60 分钟 / 15 分钟 / 未来 7 天）
    expect(DEFAULT_STUDY_BLOCK_PREFS).toEqual({
      dayStartHour: 8,
      dayEndHour: 22,
      blockMinutes: 60,
      bufferMinutes: 15,
      horizonDays: 7,
      skipWeekends: false,
      remindEnabled: false,
    })
    expect(loadStudyBlockPrefs()).toEqual(DEFAULT_STUDY_BLOCK_PREFS)
  })

  it('clamps out-of-range, unaligned and non-boolean values instead of trusting storage', () => {
    localStorage.setItem(KEYS.studyBlockPrefs, JSON.stringify({
      dayStartHour: -5,
      dayEndHour: 30,
      blockMinutes: 37,
      bufferMinutes: 900,
      horizonDays: 99,
      skipWeekends: 'yes',
      remindEnabled: 1,
    }))

    const prefs = loadStudyBlockPrefs()
    expect(prefs.dayStartHour).toBe(STUDY_BLOCK_LIMITS.dayStartHour.min)
    expect(prefs.dayEndHour).toBe(STUDY_BLOCK_LIMITS.dayEndHour.max)
    expect(prefs.blockMinutes).toBe(30) // 37 → 最近的 15 分钟倍数
    expect(prefs.bufferMinutes).toBe(60)
    expect(prefs.horizonDays).toBe(14)
    expect(prefs.skipWeekends).toBe(false) // 非布尔回默认，而不是取 truthy
    expect(prefs.remindEnabled).toBe(false)
  })

  it('falls back to the defaults for malformed payloads', () => {
    localStorage.setItem(KEYS.studyBlockPrefs, 'not json')
    expect(loadStudyBlockPrefs()).toEqual(DEFAULT_STUDY_BLOCK_PREFS)

    localStorage.setItem(KEYS.studyBlockPrefs, JSON.stringify([1, 2, 3]))
    expect(loadStudyBlockPrefs()).toEqual(DEFAULT_STUDY_BLOCK_PREFS)

    localStorage.setItem(KEYS.studyBlockPrefs, JSON.stringify('nope'))
    expect(loadStudyBlockPrefs()).toEqual(DEFAULT_STUDY_BLOCK_PREFS)
  })

  it('keeps the window wide enough for one block plus its buffer', () => {
    // 08:00 起、60 分钟块 + 15 分钟缓冲 → 窗口至少 2 小时
    expect(normalizeStudyBlockPrefs({
      dayStartHour: 8, dayEndHour: 9, blockMinutes: 60, bufferMinutes: 15,
    }).dayEndHour).toBe(10)

    // 结束时间已经贴到 24:00 时，反过来把开始时间前移（而不是留下一个放不下的窗口）
    const pulled = normalizeStudyBlockPrefs({
      dayStartHour: 23, dayEndHour: 24, blockMinutes: 120, bufferMinutes: 60,
    })
    expect(pulled.dayEndHour).toBe(24)
    expect(pulled.dayStartHour).toBe(21)

    // 刚好够用时不动任何一边
    expect(normalizeStudyBlockPrefs({
      dayStartHour: 12, dayEndHour: 14, blockMinutes: 60, bufferMinutes: 15,
    })).toMatchObject({ dayStartHour: 12, dayEndHour: 14 })
  })

  it('merges partial saves, persists the normalized result and survives a reload', () => {
    const saved = saveStudyBlockPrefs({ blockMinutes: 90, skipWeekends: true })
    expect(saved.blockMinutes).toBe(90)
    expect(saved.dayStartHour).toBe(DEFAULT_STUDY_BLOCK_PREFS.dayStartHour)
    expect(saved.skipWeekends).toBe(true)
    expect(loadStudyBlockPrefs()).toEqual(saved)

    // 把结束时间拉到 06:00 会被规则抬回「开始 + 一块 + 缓冲」
    const next = saveStudyBlockPrefs({ dayEndHour: 6 })
    expect(next.dayEndHour).toBe(10)
    expect(next.blockMinutes).toBe(90)
    expect(loadStudyBlockPrefs()).toEqual(next)
  })
})
