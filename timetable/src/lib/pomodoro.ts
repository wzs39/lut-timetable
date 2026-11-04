/**
 * 番茄钟：一个纯状态机 + 一份持久化配置。
 *
 * 设计约束（都是本仓既有铁律逼出来的）：
 * - 判定逻辑必须是 `(state, now) => state` 的纯函数，计时器只是「定期喂 now」；
 *   这样 jsdom / node 测试都不需要真跑 25 分钟，也不需要 `document`。
 * - 不引第三方：只需要 `Date.now()` 与一个 `setInterval`，两者平台都有。
 * - 不新增存储层：配置与当日计数走 `KEYS.pomodoro`，自动进备份（BACKUP_KEYS 派生自 KEYS）。
 * - 不自己维护「还剩几秒」：剩余量由 `endsAt - now` 推出来，所以后台被节流、
 *   手机息屏、应用被挂起都不会漂——漂的是 tick，不是真相。
 */
import { KEYS, readJson, writeJson } from './storage'

export type PomodoroPhase = 'focus' | 'short' | 'long'

export interface PomodoroConfig {
  /** 专注时长（分钟） */
  focusMinutes: number
  /** 短休息（分钟） */
  shortMinutes: number
  /** 长休息（分钟） */
  longMinutes: number
  /** 每几轮专注后进入长休息 */
  roundsPerLong: number
  /** 一轮结束是否自动进入下一阶段 */
  autoAdvance: boolean
}

export const DEFAULT_POMODORO_CONFIG: PomodoroConfig = {
  focusMinutes: 25,
  shortMinutes: 5,
  longMinutes: 15,
  roundsPerLong: 4,
  autoAdvance: false,
}

/** 上限/下限是给「用户输入」兜底的，不是产品口味：25 小时的一轮没有意义。 */
const LIMITS = {
  focusMinutes: [1, 180],
  shortMinutes: [1, 60],
  longMinutes: [1, 120],
  roundsPerLong: [1, 12],
} as const

const clamp = (value: unknown, [min, max]: readonly [number, number], fallback: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
  return Math.min(max, Math.max(min, n))
}

export function normalizePomodoroConfig(raw: unknown): PomodoroConfig {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Partial<PomodoroConfig>
  return {
    focusMinutes: clamp(source.focusMinutes, LIMITS.focusMinutes, DEFAULT_POMODORO_CONFIG.focusMinutes),
    shortMinutes: clamp(source.shortMinutes, LIMITS.shortMinutes, DEFAULT_POMODORO_CONFIG.shortMinutes),
    longMinutes: clamp(source.longMinutes, LIMITS.longMinutes, DEFAULT_POMODORO_CONFIG.longMinutes),
    roundsPerLong: clamp(source.roundsPerLong, LIMITS.roundsPerLong, DEFAULT_POMODORO_CONFIG.roundsPerLong),
    autoAdvance: source.autoAdvance === true,
  }
}

export function phaseMinutes(config: PomodoroConfig, phase: PomodoroPhase): number {
  if (phase === 'focus') return config.focusMinutes
  if (phase === 'short') return config.shortMinutes
  return config.longMinutes
}

/**
 * 一个计时会话。`endsAt` 是绝对时间戳（ms），不是倒计数——
 * 息屏/后台节流后仍然正确；`pausedRemainingMs` 只在暂停时有值。
 */
export interface PomodoroTimer {
  phase: PomodoroPhase
  /** 本次会话的计划总时长（ms），用于算进度条比例 */
  totalMs: number
  /** 运行中：结束时刻；暂停中：null */
  endsAt: number | null
  /** 暂停中剩余毫秒；运行中为 null */
  pausedRemainingMs: number | null
  /** 本轮已经完成的专注轮数（跨休息保留，用于判断何时长休息） */
  completedRounds: number
  /** 绑定的学习块 id（可选）：一轮专注结束后可以把块标成完成 */
  studyBlockId: string | null
}

export function startTimer(
  config: PomodoroConfig,
  phase: PomodoroPhase,
  now: number,
  completedRounds = 0,
  studyBlockId: string | null = null,
): PomodoroTimer {
  const totalMs = phaseMinutes(config, phase) * 60_000
  return {
    phase,
    totalMs,
    endsAt: now + totalMs,
    pausedRemainingMs: null,
    completedRounds,
    studyBlockId,
  }
}

export function isRunning(timer: PomodoroTimer): boolean {
  return timer.endsAt !== null
}

/** 剩余毫秒：运行中由 endsAt 推导（可能为负，调用方先判断完成），暂停中取存量。 */
export function remainingMs(timer: PomodoroTimer, now: number): number {
  if (timer.endsAt !== null) return timer.endsAt - now
  return timer.pausedRemainingMs ?? 0
}

/** 进度 0..1，用于画环；总时长为 0 时返回 0，不产生 NaN。 */
export function progress(timer: PomodoroTimer, now: number): number {
  if (timer.totalMs <= 0) return 0
  const left = remainingMs(timer, now)
  return Math.min(1, Math.max(0, 1 - left / timer.totalMs))
}

export function pauseTimer(timer: PomodoroTimer, now: number): PomodoroTimer {
  if (timer.endsAt === null) return timer
  return { ...timer, endsAt: null, pausedRemainingMs: Math.max(0, timer.endsAt - now) }
}

export function resumeTimer(timer: PomodoroTimer, now: number): PomodoroTimer {
  if (timer.endsAt !== null) return timer
  const left = timer.pausedRemainingMs ?? 0
  return { ...timer, endsAt: now + left, pausedRemainingMs: null }
}

/**
 * 本轮是否已经结束。**这就是唯一的「完成」判定**：
 * 组件只在 `phaseDone` 为真时推一次阶段切换，而不是自己数 tick。
 */
export function phaseDone(timer: PomodoroTimer, now: number): boolean {
  return timer.endsAt !== null && now >= timer.endsAt
}

/**
 * 推进到下一阶段。返回新 timer 与被完成的那一轮（供调用方做副作用：
 * 标记学习块完成、发通知）。`autoAdvance` 为 false 时返回 `ended` 状态
 * （endsAt=null 且剩余 0），等用户手动开始下一轮。
 */
export interface AdvanceResult {
  timer: PomodoroTimer
  /** 刚结束的阶段；调用方据此决定是否把学习块标完成 */
  finishedPhase: PomodoroPhase
  /** 这一轮专注是否计入「已完成轮数」 */
  countedRound: boolean
  nextPhase: PomodoroPhase
}

export function advancePhase(config: PomodoroConfig, timer: PomodoroTimer, now: number): AdvanceResult {
  const finishedPhase = timer.phase
  const countedRound = finishedPhase === 'focus'
  const completedRounds = countedRound ? timer.completedRounds + 1 : timer.completedRounds
  const nextPhase: PomodoroPhase = finishedPhase === 'focus'
    ? (completedRounds % Math.max(1, config.roundsPerLong) === 0 ? 'long' : 'short')
    : 'focus'
  const totalMs = phaseMinutes(config, nextPhase) * 60_000
  const keepBlock = nextPhase === 'focus' ? timer.studyBlockId : null
  const timerNext: PomodoroTimer = config.autoAdvance
    ? { phase: nextPhase, totalMs, endsAt: now + totalMs, pausedRemainingMs: null, completedRounds, studyBlockId: keepBlock }
    : { phase: nextPhase, totalMs, endsAt: null, pausedRemainingMs: totalMs, completedRounds, studyBlockId: keepBlock }
  return { timer: timerNext, finishedPhase, countedRound, nextPhase }
}

/* ------------------------------ 持久化 ------------------------------ */

export interface PomodoroState {
  config: PomodoroConfig
  /** 当日已完成的专注轮数；`day` 是本地日期键，跨天自动归零 */
  day: string
  roundsToday: number
}

const localDayKey = (date: Date): string => {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function emptyPomodoroState(now = new Date()): PomodoroState {
  return { config: { ...DEFAULT_POMODORO_CONFIG }, day: localDayKey(now), roundsToday: 0 }
}

export function loadPomodoroState(now = new Date()): PomodoroState {
  const raw = readJson<Partial<PomodoroState> | null>(KEYS.pomodoro, null)
  const base = emptyPomodoroState(now)
  if (!raw || typeof raw !== 'object') return base
  const today = localDayKey(now)
  const rounds = typeof raw.roundsToday === 'number' && Number.isFinite(raw.roundsToday)
    ? Math.max(0, Math.trunc(raw.roundsToday))
    : 0
  return {
    config: normalizePomodoroConfig(raw.config),
    day: typeof raw.day === 'string' ? raw.day : today,
    // 跨天归零：昨天攒的轮数不该算进今天的长休息节奏
    roundsToday: raw.day === today ? rounds : 0,
  }
}

export function savePomodoroState(state: PomodoroState): void {
  writeJson(KEYS.pomodoro, state)
}

/** mm:ss；负数按 0 处理（结束时不该显示 -00:01）。 */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}


/**
 * 纯 Web Audio 合成音效（零外部 mp3 文件依赖，离线可用）。
 * - 专注完成 (focus)：三音上行清脆钟声 (C5 523Hz -> E5 659Hz -> G5 784Hz)
 * - 休息完成 (break)：双音提示 (G5 784Hz -> C5 523Hz)
 */
export function playPomodoroChime(phase: PomodoroPhase): void {
  if (typeof window === 'undefined') return
  try {
    const AudioContextClass =
      window.AudioContext ||
      // @ts-expect-error webkit prefix fallback
      window.webkitAudioContext
    if (!AudioContextClass) return
    const ctx = new AudioContextClass()

    const notes =
      phase === 'focus'
        ? [523.25, 659.25, 783.99]
        : [783.99, 523.25]

    const startTime = ctx.currentTime
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, startTime + idx * 0.18)

      gain.gain.setValueAtTime(0, startTime + idx * 0.18)
      gain.gain.linearRampToValueAtTime(0.2, startTime + idx * 0.18 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + idx * 0.18 + 0.45)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(startTime + idx * 0.18)
      osc.stop(startTime + idx * 0.18 + 0.5)
    })
  } catch {
    // 忽略静音或禁止自动播放环境下的报错
  }
}
