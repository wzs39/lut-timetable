// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * 【契约】首次碰插件必须只发生一次、且被 await 到所有家族之前。
 *
 * 为什么值得单独锁：`@capacitor/core` 的懒加载是 `jsImplementation = await factory()`，
 * 赋值在 await 之后——并发首次调用各造一个实现实例，最后一个才被记住，其余变成孤儿。
 * 实测（打包桌面端挂载周期）一次造出 5 个实例，排期全写进孤儿，应用看到的队列是空的，
 * 诊断面板于是报告「应该排上却没排上」。这条契约就是防它复发：并发调用共享同一个
 * prime，`getPending` 只被调一次。
 */

const { mockGetPending, mockCheckPermissions, mockRequestPermissions, mockCancel, mockAddListener } = vi.hoisted(() => ({
  mockGetPending: vi.fn<() => Promise<unknown>>(async () => ({ notifications: [] })),
  mockCheckPermissions: vi.fn(async () => ({ display: 'granted' })),
  mockRequestPermissions: vi.fn(async () => ({ display: 'granted' })),
  mockCancel: vi.fn<(options: unknown) => Promise<void>>(async () => {}),
  mockAddListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'web', isNativePlatform: () => false },
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    getPending: mockGetPending,
    checkPermissions: mockCheckPermissions,
    requestPermissions: mockRequestPermissions,
    cancel: mockCancel,
    addListener: mockAddListener,
  },
}))

/**
 * 必须每个用例重新 import：`pluginPrimed` 是模块级单例，模块只加载一次的话，
 * 第二个用例会复用到第一个用例已经落地的那份 prime，断言就失去意义。
 */
async function load() {
  vi.resetModules()
  const [notifications, funnel] = await Promise.all([
    import('../lib/notifications'),
    import('../lib/localNotifications'),
  ])
  return { ...notifications, primeNotificationPlugin: funnel.pluginReady }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('plugin priming', () => {
  it('shares a single first plugin touch across concurrent callers', async () => {
    const { ensurePermission } = await load()
    const [a, b, c] = await Promise.all([ensurePermission(), ensurePermission(), ensurePermission()])
    expect([a, b, c]).toEqual([true, true, true])
    // 关键：并发首次调用只把实现拉起来一次（否则就是那个孤儿实例 bug）
    expect(mockGetPending).toHaveBeenCalledTimes(1)
    expect(mockCheckPermissions).toHaveBeenCalledTimes(3)
  })

  it('is idempotent when called again', async () => {
    const { ensurePermission, primeNotificationPlugin } = await load()
    await primeNotificationPlugin()
    await primeNotificationPlugin()
    await ensurePermission()
    expect(mockGetPending).toHaveBeenCalledTimes(1)
  })

  it('does not let a queue read failure block permission handling', async () => {
    const { ensurePermission } = await load()
    mockGetPending.mockRejectedValueOnce(new Error('not implemented'))
    await expect(ensurePermission()).resolves.toBe(true)
    expect(mockCheckPermissions).toHaveBeenCalledTimes(1)
  })

  it('still reports a denied permission (priming must not fake consent)', async () => {
    const { ensurePermission } = await load()
    mockCheckPermissions.mockResolvedValueOnce({ display: 'denied' })
    await expect(ensurePermission()).resolves.toBe(false)
    expect(mockRequestPermissions).not.toHaveBeenCalled()
  })

  /**
   * 【契约】漏斗不能只给 `ensurePermission` 用：**任何**会读写插件状态的调用都必须先等
   * 实现落地。实测的漏网之鱼就是一条直接 `getPending()`（诊断/自愈的读取路径）抢在 prime
   * 之前造出了第二个实例，于是排期进了孤儿、队列看起来是空的。
   */
  it('gates direct funnel calls behind the first touch', async () => {
    const { ensurePermission } = await load()
    const { LocalNotifications } = await import('../lib/localNotifications')
    let release: () => void = () => {}
    mockGetPending.mockImplementationOnce(
      () => new Promise((resolve) => { release = () => resolve({ notifications: [] }) }),
    )
    const permissions = ensurePermission()
    const cancel = LocalNotifications.cancel({ notifications: [{ id: 1 }] })
    // prime 是在微任务里才真正调用 getPending 的，得先让那一步跑起来（release 才被赋值）
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mockCancel).not.toHaveBeenCalled()
    release()
    await Promise.all([permissions, cancel])
    expect(mockCancel).toHaveBeenCalledTimes(1)
    expect(mockGetPending).toHaveBeenCalledTimes(1)
  })

  it('passes the native-only event API through untouched', async () => {
    await load()
    const { LocalNotifications } = await import('../lib/localNotifications')
    // addListener 只在原生平台用（组件里先判平台），包一层反而会破坏 .then(h => h.remove())
    expect(LocalNotifications.addListener).toBe(mockAddListener)
  })
})
