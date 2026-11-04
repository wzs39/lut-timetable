import { useEffect, useRef, useState, useCallback } from 'react'
import { useI18n } from '../i18n'
import {
  createInitialState,
  loadHighScore,
  triggerJump,
  updateGameState,
  type GameState,
} from '../lib/gameEngine'
import Icon from './Icon'

const CANVAS_WIDTH = 380
const CANVAS_HEIGHT = 160

export default function BreakGame() {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef<GameState>(createInitialState(CANVAS_WIDTH, CANVAS_HEIGHT))
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(loadHighScore)
  const [gameOver, setGameOver] = useState(false)
  const animRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)

  const restart = useCallback(() => {
    stateRef.current = createInitialState(CANVAS_WIDTH, CANVAS_HEIGHT)
    setScore(0)
    setGameOver(false)
    lastTimeRef.current = null
  }, [])

  const handleJump = useCallback(() => {
    if (stateRef.current.gameOver) {
      restart()
    } else {
      triggerJump(stateRef.current)
    }
  }, [restart])

  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault()
        handleJump()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleJump])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const loop = (time: number) => {
      if (lastTimeRef.current == null) {
        lastTimeRef.current = time
      }
      const delta = time - lastTimeRef.current
      lastTimeRef.current = time

      const state = stateRef.current
      updateGameState(state, delta, CANVAS_WIDTH)

      setScore(state.score)
      setHighScore(state.highScore)
      setGameOver(state.gameOver)

      // 渲染画面
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

      // 1. 地平线
      ctx.strokeStyle = 'rgba(161, 161, 170, 0.4)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(0, state.groundY)
      ctx.lineTo(CANVAS_WIDTH, state.groundY)
      ctx.stroke()

      // 地面装饰点线
      ctx.fillStyle = 'rgba(161, 161, 170, 0.2)'
      for (let x = (time * 0.15) % 40; x < CANVAS_WIDTH; x += 40) {
        ctx.fillRect(CANVAS_WIDTH - x, state.groundY + 8, 12, 2)
      }

      // 2. 障碍物
      for (const obs of state.obstacles) {
        if (obs.type === 'exam') {
          ctx.fillStyle = '#fda4af' // danger tint
          ctx.fillRect(obs.x, obs.y, obs.w, obs.h)
          ctx.fillStyle = '#18181b'
          ctx.font = '9px monospace'
          ctx.fillText('EXAM', obs.x + 1, obs.y + 11)
        } else if (obs.type === 'alarm') {
          ctx.fillStyle = '#fcd34d' // due amber
          ctx.fillRect(obs.x, obs.y, obs.w, obs.h)
          ctx.fillStyle = '#18181b'
          ctx.font = '9px sans-serif'
          ctx.fillText('⏰', obs.x + 2, obs.y + 12)
        } else {
          ctx.fillStyle = '#7dd3fc' // info blue
          ctx.fillRect(obs.x, obs.y, obs.w, obs.h)
          ctx.fillStyle = '#18181b'
          ctx.font = '9px sans-serif'
          ctx.fillText('📖', obs.x + 2, obs.y + 12)
        }
      }

      // 3. 收集品 (咖啡豆)
      ctx.fillStyle = '#f59e0b'
      for (const col of state.collectibles) {
        ctx.beginPath()
        ctx.arc(col.x + col.w / 2, col.y + col.h / 2, col.w / 2, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#ffffff'
        ctx.font = '8px sans-serif'
        ctx.fillText('☕', col.x, col.y + 9)
      }

      // 4. 玩家
      const p = state.player
      ctx.fillStyle = '#6ee7b7' // ok emerald
      ctx.beginPath()
      ctx.roundRect(p.x, p.y, p.w, p.h, 4)
      ctx.fill()

      // 玩家面部 / 帽子
      ctx.fillStyle = '#18181b'
      ctx.fillRect(p.x + p.w - 7, p.y + 5, 4, 4) // 眼睛
      ctx.fillStyle = '#047857'
      ctx.fillRect(p.x + 2, p.y, p.w - 4, 4) // 帽子

      if (!state.gameOver) {
        animRef.current = requestAnimationFrame(loop)
      }
    }

    animRef.current = requestAnimationFrame(loop)
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [gameOver])

  return (
    <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-1)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-1)]">
          <Icon name="puzzle" size={13} className="text-[var(--accent)]" />
          <span>{t('pomodoroBreakGame')}</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] tabular-nums text-[var(--text-2)]">
          <span>{t('pomodoroCurrentScore', { n: score })}</span>
          <span className="text-[var(--text-3)]">{t('pomodoroHighScore', { n: highScore })}</span>
        </div>
      </div>

      <div
        onClick={handleJump}
        className="relative flex cursor-pointer items-center justify-center overflow-hidden rounded-md border border-[var(--line)] bg-[var(--surface-0)] select-none"
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block w-full max-w-[380px] h-[160px]"
        />
        {gameOver && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-xs">
            <p className="text-xs font-bold text-[var(--danger)]">{t('pomodoroGameOver')}</p>
            <p className="mt-1 text-[10px] text-[var(--text-2)]">
              {t('pomodoroCurrentScore', { n: score })}
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                restart()
              }}
              className="app-btn-primary mt-2 px-3 py-1 text-[11px]"
            >
              {t('restoreBtn') || '重试'}
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-[var(--text-3)]">
        <span>{t('pomodoroBreakGameHint')}</span>
        <button
          type="button"
          onClick={handleJump}
          className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-[var(--text-2)] hover:text-[var(--text-1)]"
        >
          {t('pomodoroJump')}
        </button>
      </div>
    </div>
  )
}
