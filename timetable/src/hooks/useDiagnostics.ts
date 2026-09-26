import { useCallback, useState } from 'react'
import { loadBackgroundStatus } from '../lib/backgroundSeed'
import { backgroundScheduleStatus } from '../lib/backgroundSchedule'
import {
  buildDiagnosticsReport,
  clearErrors,
  loadErrors,
  scrubSecrets,
  snapshotFor,
} from '../lib/errorLog'
import { downloadBlob } from '../lib/download'

/**
 * 诊断：错误条数（打开设置时刷新）+ 导出报告。
 *
 * 报告要能回答「后台刷新到底跑过没有」，所以两份后台状态也在这条链上：只有
 * `last` 说明跑过、`scheduled` 才能分清「没跑过」和「根本没排队」。
 */
export function useDiagnostics(params: {
  locale: string
  t: (key: string) => string
  sourceCount: number
  lessonCount: number
  taskCount: number
}) {
  const { locale, t, sourceCount, lessonCount, taskCount } = params
  /** 本地错误条数：打开设置时才重新读（没必要每次渲染都碰 localStorage） */
  const [errorCount, setErrorCount] = useState(() => loadErrors().length)

  const reloadErrorCount = useCallback(() => setErrorCount(loadErrors().length), [])

  /** 导出诊断：纯文本报告（版本 / 平台 / 数据规模 / 最近错误）。出去之前过一遍
   *  scrubSecrets——token 和带查询串的 URL 不进报告。 */
  const exportDiagnostics = useCallback(async (): Promise<string> => {
    const bg = await loadBackgroundStatus()
    const bgScheduled = await backgroundScheduleStatus()
    const report = buildDiagnosticsReport(
      snapshotFor({
        appVersion: String(import.meta.env.VITE_APP_VERSION ?? 'dev'),
        locale,
        sourceCount,
        lessonCount,
        taskCount,
        backgroundSummary: `${
          bg
            ? `last ${new Date(bg.at).toISOString()} ok=${bg.ok} sources=${bg.sources} failed=${bg.failed.length} stale=${bg.stale?.length ?? 0} today=${bg.today}`
            : 'never (off, unsupported, or not run yet)'
        } scheduled=${bgScheduled === null ? '?' : String(bgScheduled)}`,
      }),
      loadErrors(),
    )
    const blob = new Blob([scrubSecrets(report)], { type: 'text/plain;charset=utf-8' })
    const native = await downloadBlob('lut-timetable-diagnostics.txt', blob)
    return t(native ? 'errorsExportedShare' : 'errorsExported')
  }, [lessonCount, locale, sourceCount, t, taskCount])

  /** 设置页的「清空」：清掉本机错误日志，并把条数立刻归零。 */
  const clearErrorLog = useCallback(() => {
    clearErrors()
    setErrorCount(0)
  }, [])

  return { errorCount, reloadErrorCount, exportDiagnostics, clearErrorLog }
}
