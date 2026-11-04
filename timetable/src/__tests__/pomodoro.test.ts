// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  advancePhase,
  DEFAULT_POMODORO_CONFIG,
  formatRemaining,
  isRunning,
  loadPomodoroState,
  normalizePomodoroConfig,
  pauseTimer,
  phaseDone,
  phaseMinutes,
  progress,
  remainingMs,
  resumeTimer,
  startTimer,
  type PomodoroConfig,
  type PomodoroTimer,
} from '../lib/pomodoro'
import { KEYS } from '../lib/storage'

describe('normalizePomodoroConfig', () => {
  it('returns default config on empty or null raw input', () => {
    expect(normalizePomodoroConfig(null)).toEqual(DEFAULT_POMODORO_CONFIG)
    expect(normalizePomodoroConfig({})).toEqual(DEFAULT_POMODORO_CONFIG)
  })

  it('clamps numerical values within bounds', () => {
    const config = normalizePomodoroConfig({
      focusMinutes: 999,
      shortMinutes: -5,
      longMinutes: 200,
      roundsPerLong: 0,
      autoAdvance: true,
    })
    expect(config.focusMinutes).toBe(180)
    expect(config.shortMinutes).toBe(1)
    expect(config.longMinutes).toBe(120)
    expect(config.roundsPerLong).toBe(1)
    expect(config.autoAdvance).toBe(true)
  })
})

describe('phaseMinutes', () => {
  const config: PomodoroConfig = {
    focusMinutes: 30,
    shortMinutes: 7,
    longMinutes: 20,
    roundsPerLong: 4,
    autoAdvance: false,
  }

  it('returns appropriate minutes for each phase', () => {
    expect(phaseMinutes(config, 'focus')).toBe(30)
    expect(phaseMinutes(config, 'short')).toBe(7)
    expect(phaseMinutes(config, 'long')).toBe(20)
  })
})

describe('Pomodoro Timer state transitions', () => {
  const config = DEFAULT_POMODORO_CONFIG
  const now = 1_000_000

  it('starts a timer correctly', () => {
    const timer = startTimer(config, 'focus', now, 2, 'block-42')
    expect(timer.phase).toBe('focus')
    expect(timer.totalMs).toBe(25 * 60_000)
    expect(timer.endsAt).toBe(now + 25 * 60_000)
    expect(timer.pausedRemainingMs).toBeNull()
    expect(timer.completedRounds).toBe(2)
    expect(timer.studyBlockId).toBe('block-42')
    expect(isRunning(timer)).toBe(true)
  })

  it('calculates remainingMs and progress correctly', () => {
    const timer = startTimer(config, 'focus', now)
    const mid = now + 12.5 * 60_000
    expect(remainingMs(timer, now)).toBe(25 * 60_000)
    expect(remainingMs(timer, mid)).toBe(12.5 * 60_000)
    expect(progress(timer, now)).toBe(0)
    expect(progress(timer, mid)).toBeCloseTo(0.5, 4)
    expect(progress(timer, now + 30 * 60_000)).toBe(1)
  })

  it('pauses and resumes a running timer', () => {
    const timer = startTimer(config, 'focus', now)
    const atPause = now + 5 * 60_000
    const paused = pauseTimer(timer, atPause)

    expect(isRunning(paused)).toBe(false)
    expect(paused.endsAt).toBeNull()
    expect(paused.pausedRemainingMs).toBe(20 * 60_000)
    expect(remainingMs(paused, atPause + 999_999)).toBe(20 * 60_000)

    const resumeAt = atPause + 50_000
    const resumed = resumeTimer(paused, resumeAt)
    expect(isRunning(resumed)).toBe(true)
    expect(resumed.endsAt).toBe(resumeAt + 20 * 60_000)
    expect(resumed.pausedRemainingMs).toBeNull()
  })

  it('evaluates phaseDone accurately', () => {
    const timer = startTimer(config, 'focus', now)
    expect(phaseDone(timer, now)).toBe(false)
    expect(phaseDone(timer, now + 25 * 60_000 - 1)).toBe(false)
    expect(phaseDone(timer, now + 25 * 60_000)).toBe(true)
    expect(phaseDone(timer, now + 30 * 60_000)).toBe(true)

    const paused = pauseTimer(timer, now + 10_000)
    expect(phaseDone(paused, now + 30 * 60_000)).toBe(false)
  })
})

describe('advancePhase', () => {
  it('advances from focus to short break and increments completed rounds', () => {
    const config = { ...DEFAULT_POMODORO_CONFIG, autoAdvance: true }
    const now = 2_000_000
    const timer: PomodoroTimer = {
      phase: 'focus',
      totalMs: 25 * 60_000,
      endsAt: now,
      pausedRemainingMs: null,
      completedRounds: 1,
      studyBlockId: 'block-1',
    }

    const res = advancePhase(config, timer, now)
    expect(res.finishedPhase).toBe('focus')
    expect(res.countedRound).toBe(true)
    expect(res.nextPhase).toBe('short')
    expect(res.timer.completedRounds).toBe(2)
    expect(res.timer.phase).toBe('short')
    expect(res.timer.endsAt).toBe(now + 5 * 60_000)
    expect(res.timer.studyBlockId).toBeNull() // breaks do not hold a block
  })

  it('triggers long break on completing round equal to roundsPerLong', () => {
    const config = { ...DEFAULT_POMODORO_CONFIG, roundsPerLong: 4, autoAdvance: false }
    const now = 3_000_000
    const timer: PomodoroTimer = {
      phase: 'focus',
      totalMs: 25 * 60_000,
      endsAt: now,
      pausedRemainingMs: null,
      completedRounds: 3, // Completing this makes it 4 -> Long break!
      studyBlockId: 'block-x',
    }

    const res = advancePhase(config, timer, now)
    expect(res.countedRound).toBe(true)
    expect(res.nextPhase).toBe('long')
    expect(res.timer.completedRounds).toBe(4)
    expect(res.timer.phase).toBe('long')
    expect(res.timer.totalMs).toBe(15 * 60_000)
    expect(res.timer.endsAt).toBeNull() // autoAdvance false
    expect(res.timer.pausedRemainingMs).toBe(15 * 60_000)
  })

  it('advances from break back to focus with studyBlockId retained if specified', () => {
    const config = { ...DEFAULT_POMODORO_CONFIG, autoAdvance: true }
    const now = 4_000_000
    const timer: PomodoroTimer = {
      phase: 'short',
      totalMs: 5 * 60_000,
      endsAt: now,
      pausedRemainingMs: null,
      completedRounds: 4,
      studyBlockId: 'prior-block',
    }

    const res = advancePhase(config, timer, now)
    expect(res.finishedPhase).toBe('short')
    expect(res.countedRound).toBe(false)
    expect(res.nextPhase).toBe('focus')
    expect(res.timer.completedRounds).toBe(4)
    expect(res.timer.studyBlockId).toBe('prior-block')
  })
})

describe('loadPomodoroState & emptyPomodoroState', () => {
  it('resets roundsToday when loaded on a different calendar day', () => {
    const yesterday = new Date(2026, 9, 20)
    const today = new Date(2026, 9, 21)

    localStorage.setItem(
      KEYS.pomodoro,
      JSON.stringify({
        day: '2026-10-20',
        roundsToday: 6,
        config: DEFAULT_POMODORO_CONFIG,
      }),
    )

    const loaded = loadPomodoroState(today)
    expect(loaded.roundsToday).toBe(0)

    const loadedSameDay = loadPomodoroState(yesterday)
    expect(loadedSameDay.roundsToday).toBe(6)
  })
})

describe('formatRemaining', () => {
  it('formats milliseconds into MM:SS string correctly', () => {
    expect(formatRemaining(25 * 60_000)).toBe('25:00')
    expect(formatRemaining(65_000)).toBe('01:05')
    expect(formatRemaining(500)).toBe('00:01')
    expect(formatRemaining(0)).toBe('00:00')
    expect(formatRemaining(-5000)).toBe('00:00')
  })
})
