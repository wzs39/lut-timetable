package dev.lut.timetable

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context

/**
 * 后台刷新的周期任务（JobScheduler，framework API）。
 *
 * 为什么不用 WorkManager：这里只需要「有网时每 N 小时跑一次」，JobScheduler 就是
 * WorkManager 的底层，少一个依赖、少一层重试策略；`dumpsys jobscheduler` /
 * `cmd jobscheduler run` 还能直接查证与手动触发（E2E 用得上）。
 *
 * 调度权在原生（注册在 lutWidget 插件上，与小组件共用一条桥），JS 只有一个入口：
 * lib/backgroundSchedule —— 跟着「自动同步」开关走，不新增第二个开关。
 */
object BackgroundSyncScheduler {

    /** 任务 id：dumpsys / adb shell cmd jobscheduler run 都用它定位。 */
    const val JOB_ID = 7310
    /** JobScheduler 的硬下限（API 24+ 周期任务最少 15 分钟）。 */
    private const val MIN_PERIOD_MIN = 15
    private const val MAX_PERIOD_MIN = 24 * 60

    fun schedule(context: Context, minutes: Int): Boolean {
        val periodMs = minutes.coerceIn(MIN_PERIOD_MIN, MAX_PERIOD_MIN) * 60_000L
        val info = JobInfo.Builder(JOB_ID, ComponentName(context, BackgroundSyncJobService::class.java))
            .setPeriodic(periodMs)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            // 重启之后仍然有效（需要 RECEIVE_BOOT_COMPLETED，manifest 里已声明）
            .setPersisted(true)
            .build()
        return try {
            context.getSystemService(JobScheduler::class.java)?.schedule(info) == JobScheduler.RESULT_SUCCESS
        } catch (e: Exception) {
            // 个别 ROM 限制周期任务/持久任务：失败＝后台刷新没开，绝不能影响前台开关。
            // 带异常对象打日志（而不是只打类名）——否则只有 "SecurityException" 一个词，
            // 根本看不出是权限、组件还是配额问题。
            android.util.Log.w("LUTBgSync", "schedule failed", e)
            false
        }
    }

    fun cancel(context: Context, reason: String) {
        try {
            context.getSystemService(JobScheduler::class.java)?.cancel(JOB_ID)
            android.util.Log.i("LUTBgSync", "cancelled ($reason)")
        } catch (_: Exception) {
            // 取不到 JobScheduler 时无事可做
        }
    }

    fun isScheduled(context: Context): Boolean = try {
        context.getSystemService(JobScheduler::class.java)
            ?.allPendingJobs?.any { it.id == JOB_ID } == true
    } catch (_: Exception) {
        false
    }
}
