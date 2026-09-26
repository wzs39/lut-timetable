import { downloadBlob } from './download'
import { buildIcs } from './ics'
import { loadLessons } from './store'
import type { Lesson } from '../types'

/**
 * 导出课表为 .ics —— 唯一入口。
 *
 * 之前这段 Blob/文件名逻辑只写在 Settings 里，命令面板里虽然声明了
 * `{ kind: 'exportIcs' }` 却没有对应条目（死类型），手机上也只剩
 * 「设置 → 数据备份」一条路。现在 Settings 与命令面板都调这里。
 *
 * 原生（Capacitor）走 share sheet，桌面浏览器/Electron 走下载——
 * 具体分支在 downloadBlob 里，见 lib/download.ts。
 */

export const ICS_FILENAME = 'lut-timetable.ics'
export const ICS_MIME = 'text/calendar;charset=utf-8'

export async function exportTimetableIcs(lessons?: Lesson[]): Promise<void> {
  const list = lessons ?? loadLessons()
  await downloadBlob(ICS_FILENAME, new Blob([buildIcs(list)], { type: ICS_MIME }))
}
