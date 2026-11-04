import { useCallback, useEffect, useRef, useState } from 'react'
import {
  advancePhase,
  emptyPomodoroState,
  formatRemaining,
  isRunning,
  loadPomodoroState,
  normalizePomodoroConfig,
  pauseTimer,
  phaseDone,
  playPomodoroChime,
  remainingMs,
  resumeTimer,
  savePomodoroState,
  startTimer,
  type PomodoroConfig,
  type PomodoroPhase,
  type PomodoroState,
  type PomodoroTimer,
} from '../lib/pomodoro'
import { loadStudyBlocks, setStudyBlockCompleted, subscribeStudyBlocks, type StudyBlock } from '../lib/studyBlocks'

/** tick 周期：1s 只影响指针的观感，真实剩余按 endsAt 算，差一秒也不会漂移 */
const TICK_MS = 1_000

export interface PomodoroController {
  timer: PomodoroTimer | null
  config: PomodoroConfig
  roundsToday: number
  /** 上一轮刚结束的阶段；供 UI 弹提示或播放动画，用户调 acknowledgeFinish 关掉 */
  justFinished: PomodoroPhase | null
  blocks: StudyBlock[]
  start: (phase?: PomodoroPhase, studyBlockId?: string | null) => void
  pause: () => void
  resume: () => void
  reset: () => void
  skip: () => void
  updateConfig: (patch: Partial<PomodoroConfig>) => void
  acknowledgeFinish: () => void
}

/**
 * 番茄钟控制器：**状态机全部在 `lib/pomodoro.ts`**，这里只负责：
 * - 内部把 `now` 喂给 `phaseDone`，把阶段结束的副作用收拢（发声 + 标记学习块完成）
 * - 网页标签页标题动态倒计时展示
 * - 本地持久化与跨组件订阅
 */
export function usePomodoro(): PomodoroController {
  const [state, setState] = useState<PomodoroState>(() => loadPomodoroState())
  const [timer, setTimer] = useState<PomodoroTimer | null>(null)
  const [justFinished, setJustFinished] = useState<PomodoroPhase | null>(null)
  const [blocks, setBlocks] = useState<StudyBlock[]>(loadStudyBlocks)

  // 状态机在 interval 回调里要读最新 timer，用 ref 镜像避免把 interval 反复重建
  const timerRef = useRef<PomodoroTimer | null>(null)
  const stateRef = useRef(state)

  useEffect(() => {
    timerRef.current = timer
  }, [timer])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => subscribeStudyBlocks(() => setBlocks(loadStudyBlocks())), [])

  // 配置变化立即落盘；timer 本身不持久化
  useEffect(() => savePomodoroState(state), [state])

  const finishPhase = useCallback((finished: PomodoroTimer, now: number) => {
    const current = stateRef.current
    const result = advancePhase(current.config, finished, now)
    setTimer(result.timer)
    setJustFinished(result.finishedPhase)

    // 播放提示铃声
    playPomodoroChime(result.finishedPhase)

    if (result.countedRound) {
      setState((prev) => ({ ...prev, roundsToday: prev.roundsToday + 1 }))
    }
    // 专注轮结束时把绑定的学习块标完成
    if (result.finishedPhase === 'focus' && finished.studyBlockId) {
      setStudyBlockCompleted(finished.studyBlockId, true)
      setBlocks(loadStudyBlocks())
    }
  }, [])

  useEffect(() => {
    if (!timer || !isRunning(timer)) return
    const tick = () => {
      const live = timerRef.current
      if (!live) return
      const now = Date.now()
      if (phaseDone(live, now)) finishPhase(live, now)
    }
    const handle = setInterval(tick, TICK_MS)
    return () => clearInterval(handle)
  }, [timer, finishPhase])

  // 标签页标题倒计时同步
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (!timer || !isRunning(timer)) {
      document.title = 'LUT Timetable'
      return
    }
    const updateTitle = () => {
      const left = remainingMs(timer, Date.now())
      const prefix = timer.phase === 'focus' ? '🎯' : '☕'
      document.title = `(${formatRemaining(left)}) ${prefix} LUT Timetable`
    }
    updateTitle()
    const handle = setInterval(updateTitle, TICK_MS)
    return () => {
      clearInterval(handle)
      document.title = 'LUT Timetable'
    }
  }, [timer])

  const start = useCallback((phase: PomodoroPhase = 'focus', studyBlockId: string | null = null) => {
    const current = stateRef.current
    setJustFinished(null)
    setTimer(startTimer(current.config, phase, Date.now(), current.roundsToday, studyBlockId))
  }, [])

  const pause = useCallback(() => {
    setTimer((prev) => (prev ? pauseTimer(prev, Date.now()) : prev))
  }, [])

  const resume = useCallback(() => {
    setTimer((prev) => (prev ? resumeTimer(prev, Date.now()) : prev))
  }, [])

  const reset = useCallback(() => {
    setJustFinished(null)
    setTimer(null)
  }, [])

  /** 跳过当前阶段：不计数、不标块（跳过就是「这轮不算」）。 */
  const skip = useCallback(() => {
    const live = timerRef.current
    if (!live) return
    const current = stateRef.current
    const next: PomodoroPhase = live.phase === 'focus' ? 'short' : 'focus'
    setTimer(startTimer(current.config, next, Date.now(), current.roundsToday, null))
  }, [])

  const updateConfig = useCallback((patch: Partial<PomodoroConfig>) => {
    setState((prev) => ({
      ...prev,
      config: normalizePomodoroConfig({ ...prev.config, ...patch }),
    }))
  }, [])

  const acknowledgeFinish = useCallback(() => setJustFinished(null), [])

  return {
    timer,
    config: state.config,
    roundsToday: state.roundsToday,
    justFinished,
    blocks,
    start,
    pause,
    resume,
    reset,
    skip,
    updateConfig,
    acknowledgeFinish,
  }
}

/** 测试与「恢复出厂」共用：不读 localStorage 的干净状态。 */
export { emptyPomodoroState }
