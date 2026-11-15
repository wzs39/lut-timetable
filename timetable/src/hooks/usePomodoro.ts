import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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
  recordFocusRound,
  remainingMs,
  resumeTimer,
  savePomodoroState,
  startFocusForBlock,
  startFocusSession,
  startTimer,
  type PomodoroConfig,
  type PomodoroPhase,
  type PomodoroSessionRecord,
  type PomodoroState,
  type PomodoroTimer,
  type PomodoroTimerMeta,
} from '../lib/pomodoro'
import { loadStudyBlocks, setStudyBlockCompleted, subscribeStudyBlocks, type StudyBlock } from '../lib/studyBlocks'
import { pushPomodoroData } from '../lib/widgetData'

/** tick 周期：1s 只影响指针的观感，真实剩余按 endsAt 算，差一秒也不会漂移 */
const TICK_MS = 1_000

export interface PomodoroController {
  state: PomodoroState
  timer: PomodoroTimer | null
  config: PomodoroConfig
  roundsToday: number
  focusMinutesByCourse: Record<string, number>
  recentSessions: PomodoroSessionRecord[]
  /** 上一轮刚结束的阶段；供 UI 弹提示或播放动画，用户调 acknowledgeFinish 关掉 */
  justFinished: PomodoroPhase | null
  blocks: StudyBlock[]
  start: (phase?: PomodoroPhase, studyBlockId?: string | null, meta?: PomodoroTimerMeta) => void
  startForCourse: (courseCode: string, opts?: { taskId?: string | null; studyBlockId?: string | null; label?: string | null }) => void
  startForBlock: (block: StudyBlock) => void
  bindContext: (meta: PomodoroTimerMeta) => void
  pause: () => void
  resume: () => void
  reset: () => void
  skip: () => void
  updateConfig: (patch: Partial<PomodoroConfig>) => void
  acknowledgeFinish: () => void
}

const PomodoroContext = createContext<PomodoroController | null>(null)

function usePomodoroStandalone(enabled = true): PomodoroController {
  const [state, setState] = useState<PomodoroState>(() => loadPomodoroState())
  const [timer, setTimer] = useState<PomodoroTimer | null>(null)
  const [justFinished, setJustFinished] = useState<PomodoroPhase | null>(null)
  const [blocks, setBlocks] = useState<StudyBlock[]>(loadStudyBlocks)

  // 状态机在 interval 回调里要读最新 timer，用 ref 镜像避免把 interval 反复重建
  const timerRef = useRef<PomodoroTimer | null>(null)
  const stateRef = useRef(state)
  const blocksRef = useRef(blocks)

  useEffect(() => {
    timerRef.current = timer
  }, [timer])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    blocksRef.current = blocks
  }, [blocks])

  useEffect(() => {
    if (!enabled) return
    return subscribeStudyBlocks(() => setBlocks(loadStudyBlocks()))
  }, [enabled])

  // 配置变化立即落盘；timer 本身不持久化
  useEffect(() => {
    if (!enabled) return
    savePomodoroState(state)
  }, [state, enabled])

  // 番茄钟阶段/起停/绑定变化时推送到原生 4x2 小组件
  useEffect(() => {
    if (!enabled) return
    void pushPomodoroData(timer, state.roundsToday)
  }, [enabled, timer, state.roundsToday])

  const finishPhase = useCallback((finished: PomodoroTimer, now: number) => {
    const current = stateRef.current
    const result = advancePhase(current.config, finished, now)
    setTimer(result.timer)
    setJustFinished(result.finishedPhase)

    // 播放提示铃声
    playPomodoroChime(result.finishedPhase)

    if (result.countedRound) {
      const linkedBlock = finished.studyBlockId
        ? blocksRef.current.find((b) => b.id === finished.studyBlockId)
        : undefined
      const resolvedCourse = finished.courseCode ?? linkedBlock?.courseCode ?? null
      const resolvedTask =
        finished.taskId ?? (linkedBlock?.sourceKind === 'task' ? linkedBlock.sourceId : null)
      const finishedMinutes = Math.max(1, Math.round(finished.totalMs / 60_000))
      setState((prev) =>
        recordFocusRound(prev, new Date(now), {
          courseCode: resolvedCourse,
          taskId: resolvedTask,
          studyBlockId: finished.studyBlockId,
          minutes: finishedMinutes,
        }),
      )
    }
    // 专注轮结束时把绑定的学习块标完成
    if (result.finishedPhase === 'focus' && finished.studyBlockId) {
      setStudyBlockCompleted(finished.studyBlockId, true)
      setBlocks(loadStudyBlocks())
    }
  }, [])

  useEffect(() => {
    if (!enabled || !timer || !isRunning(timer)) return
    const tick = () => {
      const live = timerRef.current
      if (!live) return
      const now = Date.now()
      if (phaseDone(live, now)) finishPhase(live, now)
    }
    const handle = setInterval(tick, TICK_MS)
    return () => clearInterval(handle)
  }, [enabled, timer, finishPhase])

  // 标签页标题倒计时同步
  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return
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
  }, [enabled, timer])

  const start = useCallback(
    (
      phase: PomodoroPhase = 'focus',
      studyBlockId: string | null = null,
      meta?: PomodoroTimerMeta,
    ) => {
      const current = stateRef.current
      const linkedBlock = studyBlockId
        ? blocksRef.current.find((b) => b.id === studyBlockId)
        : undefined
      const mergedMeta: PomodoroTimerMeta | undefined =
        meta || linkedBlock
          ? {
              courseCode: meta?.courseCode ?? linkedBlock?.courseCode ?? null,
              taskId:
                meta?.taskId ??
                (linkedBlock?.sourceKind === 'task' ? linkedBlock.sourceId : null),
              label: meta?.label ?? linkedBlock?.title ?? null,
            }
          : undefined
      setJustFinished(null)
      setTimer(
        startTimer(
          current.config,
          phase,
          Date.now(),
          current.roundsToday,
          studyBlockId,
          mergedMeta,
        ),
      )
    },
    [],
  )

  const startForCourse = useCallback(
    (
      courseCode: string,
      opts?: { taskId?: string | null; studyBlockId?: string | null; label?: string | null },
    ) => {
      const current = stateRef.current
      setJustFinished(null)
      setTimer(
        startFocusSession(current.config, Date.now(), {
          completedRounds: current.roundsToday,
          courseCode,
          taskId: opts?.taskId ?? null,
          studyBlockId: opts?.studyBlockId ?? null,
          label: opts?.label ?? courseCode,
        }),
      )
    },
    [],
  )

  const startForBlock = useCallback((block: StudyBlock) => {
    const current = stateRef.current
    setJustFinished(null)
    setTimer(startFocusForBlock(current.config, block, Date.now(), current.roundsToday))
  }, [])

  const bindContext = useCallback((meta: PomodoroTimerMeta) => {
    setTimer((prev) => (prev ? { ...prev, ...meta } : prev))
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
    setTimer(
      startTimer(current.config, next, Date.now(), current.roundsToday, null, {
        courseCode: live.courseCode,
        taskId: live.taskId,
        label: live.label,
      }),
    )
  }, [])

  const updateConfig = useCallback((patch: Partial<PomodoroConfig>) => {
    setState((prev) => ({
      ...prev,
      config: normalizePomodoroConfig({ ...prev.config, ...patch }),
    }))
  }, [])

  const acknowledgeFinish = useCallback(() => setJustFinished(null), [])

  return {
    state,
    timer,
    config: state.config,
    roundsToday: state.roundsToday,
    focusMinutesByCourse: state.focusMinutesByCourse ?? {},
    recentSessions: state.recentSessions ?? [],
    justFinished,
    blocks,
    start,
    startForCourse,
    startForBlock,
    bindContext,
    pause,
    resume,
    reset,
    skip,
    updateConfig,
    acknowledgeFinish,
  }
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const controller = usePomodoroStandalone(true)
  return createElement(PomodoroContext.Provider, { value: controller }, children)
}

/**
 * 番茄钟控制器：
 * - 若外层挂载了 `PomodoroProvider`（根组件跨视图保活），直接共享同一份计时会话
 * - 若独立渲染（如单测直接挂载 `PomodoroCard`），自动回退到本地控制器实例
 */
export function usePomodoro(): PomodoroController {
  const ctx = useContext(PomodoroContext)
  const fallback = usePomodoroStandalone(ctx === null)
  return ctx ?? fallback
}

/** 测试与「恢复出厂」共用：不读 localStorage 的干净状态。 */
export { emptyPomodoroState }
