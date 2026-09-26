import { Capacitor } from '@capacitor/core'

/**
 * 调度意图的镜像（Preferences，键与前后台共享）：
 * iOS 每次从后台被唤起都要重新提交 BGTaskScheduler 请求（Apple 的规矩），
 * 原生侧靠这个键知道「用户到底要不要后台刷新」——localStorage 里的开关
 * 原生读不到，而 Preferences 两边都能读。Android 不需要它（JobScheduler
 * 自带 PERSISTED）。
 */
const SCHEDULE_PREF_KEY = 'bg_schedule_v1'

/**
 * 后台刷新的调度开关（原生侧）：Android 走 JobScheduler 周期任务，iOS 走
 * BGAppRefreshTask。两边都只是「最早可能的时间」——系统按电量/网络/使用习惯
 * 自行合并，所以周期定 6 小时就够（ICS 源一天也就更新几次，15 分钟只会烧电）。
 *
 * 调度器归原生所有（注册在 lutWidget 插件里，和小组件共用一条桥）；
 * JS 只有一个入口：跟着「自动同步」开关走，不新增一个用户看不见的第二开关。
 */
export const BG_REFRESH_INTERVAL_MINUTES = 360

interface LutWidgetPlugin {
  scheduleBackgroundSync?: (opts: { minutes: number }) => Promise<{ scheduled?: boolean }>
  cancelBackgroundSync?: () => Promise<{ scheduled?: boolean }>
  backgroundStatus?: () => Promise<{ scheduled?: boolean; jobId?: number }>
}

function widgetPlugin(): LutWidgetPlugin | undefined {
  const plugins = (Capacitor as unknown as { Plugins?: { lutWidget?: LutWidgetPlugin } }).Plugins
  return plugins?.lutWidget
}

/** 开/关周期后台刷新；Web 与 Electron 上是 no-op（它们有自己的常驻进程/无原生）。 */
export async function syncBackgroundSchedule(enabled: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  // 先记意图再调原生：意图记的是「用户想不想要」，不是「这一次成没成」。
  // iOS 的 BGTask 请求只生效一次，进后台就靠它续期——如果这一次 submit 失败就
  // 把意图吞了，用户开着开关也永远不会再被唤醒。成不成由 backgroundStatus 回答。
  await writeScheduleIntent(enabled ? String(BG_REFRESH_INTERVAL_MINUTES) : null)
  try {
    const plugin = widgetPlugin()
    if (!plugin) return
    if (enabled) await plugin.scheduleBackgroundSync?.({ minutes: BG_REFRESH_INTERVAL_MINUTES })
    else await plugin.cancelBackgroundSync?.()
  } catch {
    // 调度失败不能影响前台开关：用户看到的状态就是「自动同步开着」。
  }
}

/**
 * 后台刷新现在到底排上了没有（诊断用，只读）。
 *
 * 「上一次跑成功过」和「此刻有没有排队」是两件事：Android 的 JobScheduler 在缺权限
 * 或被系统清掉之后会变空，iOS 的 BGTask 请求只生效一次、不续就断链。诊断报告里分不出
 * 这两者时，「小组件不更新」就只能靠猜。
 * 返回 null = 非原生 / 插件没有这个方法（老版本原生壳）。
 */
export async function backgroundScheduleStatus(): Promise<boolean | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const res = await widgetPlugin()?.backgroundStatus?.()
    return typeof res?.scheduled === 'boolean' ? res.scheduled : null
  } catch {
    // 状态问不到不影响别的诊断项。
    return null
  }
}

/** 把调度意图写进 Preferences（null = 关掉）。失败不影响调度本身。 */
async function writeScheduleIntent(minutes: string | null): Promise<void> {
  try {
    const { Preferences } = await import('@capacitor/preferences')
    if (minutes == null) await Preferences.remove({ key: SCHEDULE_PREF_KEY })
    else await Preferences.set({ key: SCHEDULE_PREF_KEY, value: minutes })
  } catch {
    // iOS 侧读不到意图时只影响「下一次重排」，不影响已经提交的请求。
  }
}
