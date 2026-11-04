/**
 * 课间轻量小游戏引擎 (Study Break Game Engine)
 *
 * 纯 TypeScript 实现的无依赖 Canvas 2D 物理与逻辑引擎。
 * 状态机与物理碰撞为纯函数，脱离 DOM / Canvas 亦可由 vitest 完全测试。
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Obstacle extends Rect {
  type: 'book' | 'alarm' | 'exam'
  passed?: boolean
}

export interface Collectible extends Rect {
  collected?: boolean
}

export interface GameState {
  player: {
    x: number
    y: number
    vy: number
    w: number
    h: number
    jumping: boolean
  }
  groundY: number
  obstacles: Obstacle[]
  collectibles: Collectible[]
  score: number
  highScore: number
  speed: number
  gameOver: boolean
  paused: boolean
  spawnTimer: number
}

const GRAVITY = 0.0018 // px / ms^2
const JUMP_FORCE = -0.58 // px / ms
const BASE_SPEED = 0.22 // px / ms
const SPEED_ACCEL = 0.000008 // px / ms per ms elapsed

export const STORAGE_KEY_HIGH_SCORE = 'lut-break-game-high-score'

export function loadHighScore(): number {
  if (typeof localStorage === 'undefined') return 0
  try {
    const val = localStorage.getItem(STORAGE_KEY_HIGH_SCORE)
    const n = Number(val)
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
  } catch {
    return 0
  }
}

export function saveHighScore(score: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    const cur = loadHighScore()
    if (score > cur) {
      localStorage.setItem(STORAGE_KEY_HIGH_SCORE, String(Math.trunc(score)))
    }
  } catch {
    // silent
  }
}

export function createInitialState(_canvasWidth = 400, canvasHeight = 180): GameState {
  const groundY = canvasHeight - 28
  return {
    player: {
      x: 32,
      y: groundY - 24,
      vy: 0,
      w: 20,
      h: 24,
      jumping: false,
    },
    groundY,
    obstacles: [],
    collectibles: [],
    score: 0,
    highScore: loadHighScore(),
    speed: BASE_SPEED,
    gameOver: false,
    paused: false,
    spawnTimer: 1000,
  }
}

export function triggerJump(state: GameState): boolean {
  if (state.gameOver || state.paused) return false
  if (!state.player.jumping) {
    state.player.vy = JUMP_FORCE
    state.player.jumping = true
    return true
  }
  return false
}

export function checkAABBCollision(a: Rect, b: Rect): boolean {
  // 留少许边缘容错缓冲 (padding 2px)，使碰撞体感更合理
  const pad = 2
  return (
    a.x + pad < b.x + b.w - pad &&
    a.x + a.w - pad > b.x + pad &&
    a.y + pad < b.y + b.h - pad &&
    a.y + a.h - pad > b.y + pad
  )
}

export function updateGameState(state: GameState, deltaMs: number, canvasWidth = 400): GameState {
  if (state.gameOver || state.paused) return state

  const dt = Math.min(Math.max(deltaMs, 0), 100) // 限制单帧步长防止离屏突变

  // 1. 玩家重力与跳跃
  const player = state.player
  player.vy += GRAVITY * dt
  player.y += player.vy * dt

  const floorY = state.groundY - player.h
  if (player.y >= floorY) {
    player.y = floorY
    player.vy = 0
    player.jumping = false
  }

  // 2. 障碍物生成
  state.spawnTimer -= dt
  if (state.spawnTimer <= 0) {
    state.spawnTimer = 1200 + Math.random() * 1000 // 1.2s - 2.2s 生成间隔
    const obsHeight = 18 + Math.floor(Math.random() * 14)
    state.obstacles.push({
      x: canvasWidth + 20,
      y: state.groundY - obsHeight,
      w: 16,
      h: obsHeight,
      type: obsHeight > 24 ? 'exam' : obsHeight > 20 ? 'alarm' : 'book',
    })

    // 几率生成咖啡豆得分星
    if (Math.random() > 0.4) {
      state.collectibles.push({
        x: canvasWidth + 80,
        y: state.groundY - 45 - Math.random() * 25,
        w: 12,
        h: 12,
      })
    }
  }

  // 3. 速度与分数增长
  state.speed += SPEED_ACCEL * dt
  const dist = state.speed * dt
  state.score += Math.round(dt * 0.05)

  // 4. 障碍物移动与碰撞
  for (let i = state.obstacles.length - 1; i >= 0; i--) {
    const obs = state.obstacles[i]
    obs.x -= dist

    // 碰撞检测
    if (checkAABBCollision(player, obs)) {
      state.gameOver = true
      if (state.score > state.highScore) {
        state.highScore = state.score
        saveHighScore(state.highScore)
      }
      return state
    }

    // 越界清除与越过加分
    if (obs.x + obs.w < 0) {
      state.obstacles.splice(i, 1)
    } else if (!obs.passed && obs.x + obs.w < player.x) {
      obs.passed = true
      state.score += 20 // 成功跃过障碍奖励 20 分
    }
  }

  // 5. 奖励品移动与收集
  for (let i = state.collectibles.length - 1; i >= 0; i--) {
    const col = state.collectibles[i]
    col.x -= dist

    if (!col.collected && checkAABBCollision(player, col)) {
      col.collected = true
      state.score += 50 // 吃到咖啡加 50 分
      state.collectibles.splice(i, 1)
      continue
    }

    if (col.x + col.w < 0) {
      state.collectibles.splice(i, 1)
    }
  }

  return state
}
