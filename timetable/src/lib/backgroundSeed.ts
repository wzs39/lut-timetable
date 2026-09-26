import { Capacitor } from '@capacitor/core'
import { KEYS } from './storage'

/**
 * 后台刷新的「种子」：让后台同步 pass 拿到它需要的全部输入。
 *
 * 为什么需要它：后台任务只能起一个自己的 JS 引擎（Android 隐藏 WebView / iOS
 * 隐藏 WKWebView），那个 origin 看不到 App 的 localStorage。种子放在
 * **Capacitor Preferences 的既有通道**里（Android SharedPreferences
 * `CapacitorStorage` / iOS UserDefaults.standard），和 widget_payload 同一条路，
 * 所以两端都不需要新存储、不需要第三方插件、更不需要后端。
 *
 * 白名单只收同步合并真正要读的键；**凭证类键（grades/SSO/translator/Moodle
 * 令牌）刻意不进**——后台只需要公开日历源与本地派生数据，敏感值不进第二个存储。
 */
export const BG_SEED_KEY = 'bg_seed_v1'
/** 最近一次后台刷新结果（诊断用，设置页/诊断报告可读） */
export const BG_STATUS_KEY = 'bg_status_v1'

export const BG_SEED_KEYS = [
  KEYS.lessons,
  KEYS.sources,
  KEYS.tombstones,
  KEYS.overrides,
  KEYS.hidden,
  KEYS.courseIdentity,
  KEYS.syncAudit,
  KEYS.tasks,
] as const

export interface BackgroundSeed {
  updatedAt: number
  /** 键名 → 原始 localStorage 值（回灌时原样写回，语义与 App 内完全一致） */
  keys: Record<string, string>
}

/** 从当前 localStorage 抓一份种子（只抓白名单里存在的键）。 */
export function captureBackgroundSeed(now: Date = new Date()): BackgroundSeed {
  const keys: Record<string, string> = {}
  for (const key of BG_SEED_KEYS) {
    try {
      const value = localStorage.getItem(key)
      if (value != null) keys[key] = value
    } catch {
      /* 隐私模式 / 配额：少一个键也能跑，pass 里按空数据处理 */
    }
  }
  return { updatedAt: now.getTime(), keys }
}

/**
 * 把种子回灌进当前 localStorage —— 后台 WebView 的 origin 与 App 不同，
 * 先铺好，既有的 syncSource / 身份表 / 审计读路径就能原样工作（零分叉）。
 * 只写白名单键，不动其他键。
 */
export function replayBackgroundSeed(seed: BackgroundSeed | null): void {
  if (!seed) return
  for (const key of BG_SEED_KEYS) {
    const value = seed.keys?.[key]
    if (value == null) continue
    try {
      localStorage.setItem(key, value)
    } catch {
      /* 配额：能铺多少算多少 */
    }
  }
}

/**
 * 最近一次后台刷新的结果（诊断用）。前台只读不写——写入方是后台 pass。
 */
export async function loadBackgroundStatus(): Promise<BackgroundSyncStatus | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { Preferences } = await import('@capacitor/preferences')
    const { value } = await Preferences.get({ key: BG_STATUS_KEY })
    if (!value) return null
    const parsed = JSON.parse(value) as Partial<BackgroundSyncStatus>
    return typeof parsed?.at === 'number' ? (parsed as BackgroundSyncStatus) : null
  } catch {
    return null
  }
}

/** 后台 pass 写进 BG_STATUS_KEY 的形状（与 lib/backgroundSync 的结果一致）。 */
export interface BackgroundSyncStatus {
  ok: boolean
  at: number
  ms: number
  sources: number
  failed: { id: string; error: string }[]
  /** feed 没拉到、只读了缓存的源（老版本记录里没有这个字段）。 */
  stale?: { id: string; error: string }[]
  lessons: number
  today: number
  note?: string
}

/**
 * 把当前状态写成后台种子（写入方只有一个：这里）。
 *
 * 由几个变更点触发（课程/来源/审计/隐藏/任务），但每次都从 localStorage 重新抓
 * 整份白名单——多写几次不丢数据，也不需要把各块状态串成一条链。
 * Web 上不写：后台任务根本不会被唤醒（Electron 有自己的常驻进程）。
 */
export async function pushBackgroundSeed(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { Preferences } = await import('@capacitor/preferences')
    await Preferences.set({
      key: BG_SEED_KEY,
      value: JSON.stringify(captureBackgroundSeed()),
    })
  } catch {
    // 种子写不进去 = 后台刷新暂时不动，不能影响前台的任何流程。
  }
}

/** 解析种子；损坏/为空一律当作「没有种子」（后台失败不能影响下一趟）。 */
export function parseBackgroundSeed(raw: string | null): BackgroundSeed | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<BackgroundSeed>
    if (!parsed || typeof parsed !== 'object' || !parsed.keys || typeof parsed.keys !== 'object') {
      return null
    }
    return {
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      keys: parsed.keys as Record<string, string>,
    }
  } catch {
    return null
  }
}
