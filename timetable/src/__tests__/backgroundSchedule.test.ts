// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 调度封装：JS ↔ 原生（`lutWidget.scheduleBackgroundSync/cancelBackgroundSync/
 * backgroundStatus`）这条缝。iOS 在本机编译不了、也跑不了，所以契约由这里锁死：
 * 方法名、分钟数、意图镜像（`bg_schedule_v1`）、以及“失败不能影响前台开关”。
 */

const prefs = new Map<string, string>()

type Plugin = {
  scheduleBackgroundSync?: (opts: { minutes: number }) => Promise<{ scheduled?: boolean }>
  cancelBackgroundSync?: () => Promise<{ scheduled?: boolean }>
  backgroundStatus?: () => Promise<{ scheduled?: boolean; jobId?: number }>
}

const isNative = vi.fn(() => true)
let plugin: Plugin | undefined

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNative(),
    get Plugins() {
      return { lutWidget: plugin }
    },
  },
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => ({ value: prefs.get(key) ?? null }),
    set: async ({ key, value }: { key: string; value: string }) => void prefs.set(key, value),
    remove: async ({ key }: { key: string }) => void prefs.delete(key),
  },
}))

const {
  BG_REFRESH_INTERVAL_MINUTES,
  backgroundScheduleStatus,
  syncBackgroundSchedule,
} = await import('../lib/backgroundSchedule')

beforeEach(() => {
  prefs.clear()
  plugin = undefined
  isNative.mockReturnValue(true)
})

describe('syncBackgroundSchedule', () => {
  it('web/Electron 上是 no-op：不碰插件，也不写意图', async () => {
    isNative.mockReturnValue(false)
    const schedule = vi.fn()
    plugin = { scheduleBackgroundSync: schedule }

    await syncBackgroundSchedule(true)

    expect(schedule).not.toHaveBeenCalled()
    expect(prefs.size).toBe(0)
  })

  it('开启：按 6 小时排一次，并把意图镜像进 Preferences', async () => {
    const schedule = vi.fn(async () => ({ scheduled: true }))
    plugin = { scheduleBackgroundSync: schedule }

    await syncBackgroundSchedule(true)

    expect(schedule).toHaveBeenCalledWith({ minutes: BG_REFRESH_INTERVAL_MINUTES })
    // iOS 进后台要靠它续期；字符串形式（Preferences 存的就是字符串，Swift 侧 Int(raw)）
    expect(prefs.get('bg_schedule_v1')).toBe(String(BG_REFRESH_INTERVAL_MINUTES))
  })

  it('关闭：取消任务并删掉意图（留着意图会让 iOS 自己续期，关不掉）', async () => {
    prefs.set('bg_schedule_v1', '360')
    const cancel = vi.fn(async () => ({ scheduled: false }))
    plugin = { cancelBackgroundSync: cancel }

    await syncBackgroundSchedule(false)

    expect(cancel).toHaveBeenCalledOnce()
    expect(prefs.has('bg_schedule_v1')).toBe(false)
  })

  it('老原生壳没有这个方法：静默跳过，不抛错', async () => {
    plugin = {}
    await expect(syncBackgroundSchedule(true)).resolves.toBeUndefined()
  })

  it('意图和现实分开：submit 抛错也保留意图（iOS 靠它续期），但状态不谎报已排上', async () => {
    plugin = {
      scheduleBackgroundSync: async () => {
        throw new Error('ACCESS_NETWORK_STATE required')
      },
    }

    await expect(syncBackgroundSchedule(true)).resolves.toBeUndefined()

    expect(prefs.get('bg_schedule_v1')).toBe(String(BG_REFRESH_INTERVAL_MINUTES))
    await expect(backgroundScheduleStatus()).resolves.toBeNull()
  })
})

describe('backgroundScheduleStatus', () => {
  it('报告此刻有没有排队', async () => {
    plugin = { backgroundStatus: async () => ({ scheduled: true, jobId: 7310 }) }
    await expect(backgroundScheduleStatus()).resolves.toBe(true)

    plugin = { backgroundStatus: async () => ({ scheduled: false }) }
    await expect(backgroundScheduleStatus()).resolves.toBe(false)
  })

  it('非原生 / 没有该方法 / 抛错 → null（诊断报告里显示 `?`，不猜）', async () => {
    isNative.mockReturnValue(false)
    await expect(backgroundScheduleStatus()).resolves.toBeNull()

    isNative.mockReturnValue(true)
    plugin = {}
    await expect(backgroundScheduleStatus()).resolves.toBeNull()

    plugin = {
      backgroundStatus: async () => {
        throw new Error('bridge gone')
      },
    }
    await expect(backgroundScheduleStatus()).resolves.toBeNull()
  })
})
