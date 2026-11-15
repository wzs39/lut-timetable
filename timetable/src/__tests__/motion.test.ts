// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SPRING_PRESETS,
  computeFlipDelta,
  prefersReducedMotion,
  runSharedTransition,
  stepSpring,
} from '../lib/motion'
import { reducedMotionProbe } from '../lib/useExitAnimation'

describe('motion primitives', () => {
  const originalGet = reducedMotionProbe.get

  afterEach(() => {
    reducedMotionProbe.get = originalGet
  })

  it('exposes calibrated SPRING_PRESETS for snappy, gentle, bouncy, drawer, and indicator', () => {
    expect(Object.keys(SPRING_PRESETS)).toEqual([
      'snappy',
      'gentle',
      'bouncy',
      'drawer',
      'indicator',
    ])
    for (const preset of Object.values(SPRING_PRESETS)) {
      expect(preset.stiffness).toBeGreaterThan(0)
      expect(preset.damping).toBeGreaterThan(0)
      expect(preset.mass).toBeGreaterThan(0)
      expect(preset.durationMs).toBeGreaterThan(0)
      expect(preset.cssEasing).toContain('cubic-bezier')
    }
  })

  it('integrates spring physics toward target and snaps immediately when reduced motion is active', () => {
    reducedMotionProbe.get = () => false
    let state = { position: 0, velocity: 0 }
    const step1 = stepSpring(state, 100, SPRING_PRESETS.snappy, 1 / 60)
    expect(step1.position).toBeGreaterThan(0)
    expect(step1.position).toBeLessThan(100)
    expect(step1.settled).toBe(false)

    // Converge over 120 frames (2 seconds)
    let settled = false
    for (let i = 0; i < 120; i++) {
      const next = stepSpring(state, 100, SPRING_PRESETS.snappy, 1 / 60)
      state = { position: next.position, velocity: next.velocity }
      if (next.settled) {
        settled = true
        break
      }
    }
    expect(settled).toBe(true)
    expect(state.position).toBe(100)

    // With reduced motion enabled, snaps in a single step
    reducedMotionProbe.get = () => true
    expect(prefersReducedMotion()).toBe(true)
    const snapped = stepSpring({ position: 0, velocity: 0 }, 100, SPRING_PRESETS.snappy, 1 / 60)
    expect(snapped).toEqual({ position: 100, velocity: 0, settled: true })
  })

  it('computes FLIP delta transforms and detects identity transforms', () => {
    const first = { left: 20, top: 40, width: 200, height: 100 }
    const last = { left: 120, top: 90, width: 400, height: 200 }
    const delta = computeFlipDelta(first, last)
    expect(delta.dx).toBe(-100)
    expect(delta.dy).toBe(-50)
    expect(delta.sx).toBeCloseTo(0.5, 5)
    expect(delta.sy).toBeCloseTo(0.5, 5)
    expect(delta.identity).toBe(false)

    const same = computeFlipDelta(first, first)
    expect(same.identity).toBe(true)
  })

  it('runs shared transition with document.startViewTransition when available and falls back cleanly', async () => {
    reducedMotionProbe.get = () => false
    let mutated = 0
    await runSharedTransition(() => {
      mutated++
    })
    expect(mutated).toBe(1)

    const startViewTransitionSpy = vi.fn((cb: () => void) => {
      cb()
      return { finished: Promise.resolve() }
    })
    Object.defineProperty(document, 'startViewTransition', {
      value: startViewTransitionSpy,
      configurable: true,
      writable: true,
    })

    await runSharedTransition(() => {
      mutated++
    })
    expect(startViewTransitionSpy).toHaveBeenCalledTimes(1)
    expect(mutated).toBe(2)

    // When reduced motion is active, bypass startViewTransition
    reducedMotionProbe.get = () => true
    await runSharedTransition(() => {
      mutated++
    })
    expect(startViewTransitionSpy).toHaveBeenCalledTimes(1)
    expect(mutated).toBe(3)
  })
})
