// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BACKUP_KEYS, KEYS } from '../lib/storage'
import {
  DEFAULT_STUDY_BLOCK_PREFS,
  STUDY_BLOCK_LIMITS,
  loadStudyBlockPrefs,
  normalizeStudyBlockPrefs,
  saveStudyBlockPrefs,
  studyDayWindow,
  withStudyDayOverride,
  type StudyDayOverrides,
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
      dayOverrides: {},
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

  it('normalizes stored per-day overrides without inventing weekdays', () => {
    const prefs = normalizeStudyBlockPrefs({
      ...DEFAULT_STUDY_BLOCK_PREFS,
      dayOverrides: { 3: 'late', 4: { startHour: '8', off: 'yes' }, 7: { off: true }, '-1': { off: true }, 2: null },
    })
    expect(prefs.dayOverrides).toEqual({})
  })

  it('materializes both sides when a single-day override cannot fit one block plus its buffer', () => {
    const squeezed = normalizeStudyBlockPrefs({ ...DEFAULT_STUDY_BLOCK_PREFS, dayOverrides: { 3: { endHour: 9 } } })
    // 08:00 起放一块 60 分钟 + 15 分钟缓冲要到 10:00：存储里落成显式的双边窗口，而不是骗人的 09:00
    expect(squeezed.dayOverrides[3]).toEqual({ startHour: 8, endHour: 10 })
  })

  it('drops an override that lost all of its fields', () => {
    const prefs = normalizeStudyBlockPrefs({ ...DEFAULT_STUDY_BLOCK_PREFS, dayOverrides: { 3: { off: false } } })
    expect(prefs.dayOverrides).toEqual({})
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

// 按星期几调整：单日窗口覆盖全局窗口；不传覆盖时每一天都与全局逐字节一致。
describe('per-weekday windows', () => {
  const withDays = (dayOverrides: StudyDayOverrides) =>
    normalizeStudyBlockPrefs({ ...DEFAULT_STUDY_BLOCK_PREFS, dayOverrides })

  it('defaults to an empty map so every weekday keeps the daily window', () => {
    expect(DEFAULT_STUDY_BLOCK_PREFS.dayOverrides).toEqual({})
    for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
      expect(studyDayWindow(DEFAULT_STUDY_BLOCK_PREFS, weekday)).toEqual({ startHour: 8, endHour: 22 })
    }
  })

  it('applies one day without touching the others and keeps the untouched side inherited', () => {
    const prefs = withDays({ 3: { endHour: 16 } })
    expect(prefs.dayOverrides[3]).toEqual({ endHour: 16 })
    expect(studyDayWindow(prefs, 3)).toEqual({ startHour: 8, endHour: 16 })
    expect(studyDayWindow(prefs, 4)).toEqual({ startHour: 8, endHour: 22 })
  })

  it('lets a day opt out of scheduling entirely', () => {
    const prefs = withDays({ 5: { off: true } })
    expect(studyDayWindow(prefs, 5)).toBeNull()
    expect(studyDayWindow(prefs, 6)).toEqual({ startHour: 8, endHour: 22 })
  })

  it('keeps “skip weekends” authoritative over a per-day window', () => {
    const prefs = normalizeStudyBlockPrefs({
      ...withDays({ 6: { startHour: 7, endHour: 24 } }),
      skipWeekends: true,
    })
    expect(studyDayWindow(prefs, 6)).toBeNull()
    expect(studyDayWindow(prefs, 5)).toEqual({ startHour: 8, endHour: 22 })
  })

  it('clamps out-of-range hours and still yields a workable window', () => {
    const prefs = withDays({ 1: { startHour: -3, endHour: 99 } })
    expect(prefs.dayOverrides[1]).toEqual({ startHour: 0, endHour: 24 })
    expect(studyDayWindow(prefs, 1)).toEqual({ startHour: 0, endHour: 24 })
  })

  it('adds, edits and clears a single day without disturbing the rest', () => {
    const base = withDays({ 3: { endHour: 16 }, 5: { off: true } })
    const edited = withStudyDayOverride(base, 3, { endHour: 18 })
    expect(edited.dayOverrides).toEqual({ 3: { endHour: 18 }, 5: { off: true } })

    const cleared = withStudyDayOverride(edited, 3, null)
    expect(cleared.dayOverrides).toEqual({ 5: { off: true } })
    expect(studyDayWindow(cleared, 3)).toEqual({ startHour: 8, endHour: 22 })
  })

  it('returns null for an unusable weekday instead of inventing one', () => {
    expect(studyDayWindow(DEFAULT_STUDY_BLOCK_PREFS, Number.NaN)).toBeNull()
  })

  it('persists the per-day map inside the single preferences key', () => {
    saveStudyBlockPrefs({ dayOverrides: { 3: { endHour: 16 } } })
    expect(loadStudyBlockPrefs().dayOverrides).toEqual({ 3: { endHour: 16 } })
    expect(JSON.parse(localStorage.getItem(KEYS.studyBlockPrefs) ?? '{}').dayOverrides).toEqual({ 3: { endHour: 16 } })
  })
})
