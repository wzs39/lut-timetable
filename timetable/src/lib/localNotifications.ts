import { LocalNotifications as PluginLocalNotifications } from '@capacitor/local-notifications'

/**
 * 通知插件的**唯一入口**：所有会读写插件状态的调用都要经过这里。
 *
 * 为什么需要一层：`@capacitor/core` 的懒加载是
 *
 * ```js
 * let jsImplementation
 * if (!jsImplementation) jsImplementation = await jsImplementations[platform]()  // ← 赋值在 await 之后
 * ```
 *
 * 赋值发生在 await **之后**，于是**并发的首次调用**各自 `await factory()`、各造一个实现实例，
 * 只有最后一个被记住，其余变成孤儿。web 实现的状态（`pending` / `deliveredNotifications`）
 * 是实例字段，写进孤儿实例的排期谁也读不回来。
 *
 * 【实测·打包桌面端·挂载周期】一次造出 **5 个实例**：任务提醒排进实例 2、学习块排进实例 4，
 * 而应用后续调用用的是最后那个实例 5——队列看起来是空的，诊断面板因此报「有 1 条应该排上
 * 却没排上」，用户到点什么都听不到。原生平台是无状态桥（状态在系统里），不受影响，所以这个
 * 故障只在桌面端/浏览器（web 实现）发作。
 *
 * 修法：把「第一次碰插件」收敛到这个 awaited 的单例 promise 上（promise 是**同步**赋值的，
 * 不像 core 那样 await 之后才赋值），并且让**每个**调用点都先等它落地——只修 `ensurePermission`
 * 不够，实测还有一条直接 `getPending()` 的路径抢在 prime 之前造出第二个实例。
 *
 * `addListener` 刻意**不**包：它只在原生平台被调用（组件里先判 `Capacitor.isNativePlatform()`），
 * 而原生实现是无状态桥，不存在孤儿实例问题；包一层还会破坏它的 `.then(h => h.remove())` 形状。
 */
let primed: Promise<void> | null = null

/** 等实现落地。失败不抛：各调用点自己已有权限闸门与失败降级。 */
export function pluginReady(): Promise<void> {
  if (!primed) {
    primed = Promise.resolve()
      .then(() => PluginLocalNotifications.getPending())
      .then(
        () => {},
        () => {},
      )
  }
  return primed
}

type Plugin = typeof PluginLocalNotifications

/** 需要先等实现落地的调用（读写插件状态的那些）。 */
const GATED = new Set([
  'getPending',
  'schedule',
  'update',
  'cancel',
  'checkPermissions',
  'requestPermissions',
  'checkExactNotificationSetting',
])

/**
 * 懒代理，而不是显式对象：显式对象会在**模块初始化时**就访问插件对象的属性
 * （`PluginLocalNotifications.addListener.bind(...)`），而测试里常只 mock 用到的那几个
 * 方法——初始化期取属性会让整个模块导入就抛 TypeError。代理只在真正调用时读属性，
 * 并且完整保留插件的方法签名。
 */
export const LocalNotifications: Plugin = new Proxy(PluginLocalNotifications, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver) as unknown
    if (typeof prop !== 'string' || !GATED.has(prop) || typeof value !== 'function') return value
    return async (...args: unknown[]) => {
      await pluginReady()
      return (value as (...a: unknown[]) => unknown).apply(target, args)
    }
  },
})
