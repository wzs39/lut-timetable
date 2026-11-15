import { reducedMotionProbe } from './useExitAnimation'

export interface SpringConfig {
  stiffness: number
  damping: number
  mass: number
  durationMs: number
  cssEasing: string
}

export type SpringPresetName = 'snappy' | 'gentle' | 'bouncy' | 'drawer' | 'indicator'

export const SPRING_PRESETS: Record<SpringPresetName, SpringConfig> = {
  snappy: {
    stiffness: 420,
    damping: 32,
    mass: 1,
    durationMs: 220,
    cssEasing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  gentle: {
    stiffness: 260,
    damping: 26,
    mass: 1,
    durationMs: 320,
    cssEasing: 'cubic-bezier(0.16, 1, 0.3, 1)',
  },
  bouncy: {
    stiffness: 380,
    damping: 20,
    mass: 1,
    durationMs: 380,
    cssEasing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  drawer: {
    stiffness: 340,
    damping: 34,
    mass: 1,
    durationMs: 280,
    cssEasing: 'cubic-bezier(0.32, 0.72, 0, 1)',
  },
  indicator: {
    stiffness: 480,
    damping: 36,
    mass: 0.9,
    durationMs: 200,
    cssEasing: 'cubic-bezier(0.25, 1, 0.5, 1)',
  },
}

/**
 * Returns true when the user or test environment prefers reduced motion.
 * Delegates to `reducedMotionProbe` so tests can override either `reducedMotionProbe.get`
 * or `window.matchMedia('(prefers-reduced-motion: reduce)')`.
 */
export function prefersReducedMotion(): boolean {
  return reducedMotionProbe.get()
}

export interface SpringStepState {
  position: number
  velocity: number
}

export interface SpringStepResult extends SpringStepState {
  settled: boolean
}

/**
 * Advances a 1D damped harmonic oscillator by `dtSec` toward `target` using
 * semi-implicit Euler integration (sub-stepped for numerical stability).
 * If `prefersReducedMotion()` is active, snaps immediately to `target`.
 */
export function stepSpring(
  state: SpringStepState,
  target: number,
  config: Partial<SpringConfig> = SPRING_PRESETS.snappy,
  dtSec = 1 / 60,
): SpringStepResult {
  if (prefersReducedMotion() || dtSec <= 0) {
    return { position: target, velocity: 0, settled: true }
  }

  const stiffness = config.stiffness ?? SPRING_PRESETS.snappy.stiffness
  const damping = config.damping ?? SPRING_PRESETS.snappy.damping
  const mass = Math.max(0.01, config.mass ?? SPRING_PRESETS.snappy.mass)

  // Sub-step into <= 4ms slices to guarantee stability at high stiffness
  const maxStep = 1 / 240
  const steps = Math.max(1, Math.ceil(Math.min(dtSec, 0.25) / maxStep))
  const h = Math.min(dtSec, 0.25) / steps

  let pos = state.position
  let vel = state.velocity

  for (let i = 0; i < steps; i++) {
    const displacement = pos - target
    const springForce = -stiffness * displacement
    const dampingForce = -damping * vel
    const accel = (springForce + dampingForce) / mass
    vel += accel * h
    pos += vel * h
  }

  const restDisplacement = Math.abs(pos - target)
  const restVelocity = Math.abs(vel)
  if (restDisplacement < 0.001 && restVelocity < 0.01) {
    return { position: target, velocity: 0, settled: true }
  }

  return { position: pos, velocity: vel, settled: false }
}

export interface RectLike {
  left: number
  top: number
  width: number
  height: number
}

export interface FlipDelta {
  dx: number
  dy: number
  sx: number
  sy: number
  identity: boolean
}

/**
 * Computes the FLIP (First, Last, Invert, Play) transform delta needed to
 * invert `lastRect` back onto `firstRect`.
 */
export function computeFlipDelta(firstRect: RectLike, lastRect: RectLike): FlipDelta {
  const dx = firstRect.left - lastRect.left
  const dy = firstRect.top - lastRect.top
  const sx = lastRect.width > 0 ? firstRect.width / lastRect.width : 1
  const sy = lastRect.height > 0 ? firstRect.height / lastRect.height : 1
  const identity =
    Math.abs(dx) < 0.5 &&
    Math.abs(dy) < 0.5 &&
    Math.abs(sx - 1) < 0.01 &&
    Math.abs(sy - 1) < 0.01
  return { dx, dy, sx, sy, identity }
}

export interface SharedTransitionOptions {
  skipIfReducedMotion?: boolean
}

interface DocumentWithViewTransition {
  startViewTransition?: (callback: () => void | Promise<void>) => {
    finished?: Promise<void>
    ready?: Promise<void>
  }
}

/**
 * Executes `mutateDom` inside the View Transitions API (`document.startViewTransition`)
 * when supported and when reduced-motion is off; otherwise runs `mutateDom()` synchronously.
 */
export async function runSharedTransition(
  mutateDom: () => void,
  options: SharedTransitionOptions = {},
): Promise<void> {
  const skipReduced = options.skipIfReducedMotion ?? true
  if (skipReduced && prefersReducedMotion()) {
    mutateDom()
    return
  }

  if (typeof document !== 'undefined') {
    const doc = document as unknown as DocumentWithViewTransition
    if (typeof doc.startViewTransition === 'function') {
      try {
        const transition = doc.startViewTransition(() => {
          mutateDom()
        })
        if (transition && transition.finished) {
          await transition.finished
        }
        return
      } catch {
        // If startViewTransition fails or was already called, ensure mutation ran
      }
    }
  }

  mutateDom()
}
