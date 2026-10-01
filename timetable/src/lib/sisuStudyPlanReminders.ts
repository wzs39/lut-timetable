import { LocalNotifications } from '@capacitor/local-notifications'
import type { SisuPlanItem } from './sisuStudyPlan'
import { ensurePermission, exactAlarmsEnabled } from './notifications'
import { KEYS, readJson, writeJson } from './storage'

const REMINDER_HOURS = [24, 1] as const
const TRACKED_KEY = `${KEYS.sisuStudyPlan}:scheduled`
const SISU_URL = 'https://sisu.lut.fi/'

export function normalizeSisuStudyPlanUrl(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'sisu.lut.fi' || url.port || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

export function sisuPlanReminderId(itemId: string, beforeHours: number): number {
  let hash = 0x811c9dc5
  const key = `sisu-plan:${itemId}:${beforeHours}`
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 2147483647
}

export async function refreshSisuPlanReminders(
  items: SisuPlanItem[],
  texts: { title: string; body: (item: SisuPlanItem, beforeHours: number) => string },
): Promise<void> {
  const now = Date.now()
  const desired = new Map<number, { item: SisuPlanItem; beforeHours: number; at: Date }>()
  for (const item of items) {
    if (item.completed || !item.dueAt) continue
    const dueAt = new Date(item.dueAt).getTime()
    if (!Number.isFinite(dueAt) || dueAt <= now || dueAt > now + 30 * 86400000) continue
    for (const beforeHours of REMINDER_HOURS) {
      const at = dueAt - beforeHours * 3600000
      if (at > now) desired.set(sisuPlanReminderId(item.id, beforeHours), { item, beforeHours, at: new Date(at) })
    }
  }

  // 存储可能被旧版本/备份导入写坏：非数组直接当空处理，别让 .filter 抛异常把
  // 整个提醒刷新静默吞掉（调用方 .catch 会吃掉错误，用户永远收不到提醒）。
  const trackedRaw = readJson<unknown>(TRACKED_KEY, [])
  const previous = (Array.isArray(trackedRaw) ? trackedRaw : []).filter((id): id is number => Number.isSafeInteger(id))
  if (desired.size === 0) {
    if (previous.length > 0) await LocalNotifications.cancel({ notifications: previous.map((id) => ({ id })) })
    writeJson(TRACKED_KEY, [])
    return
  }
  const granted = await ensurePermission()
  if (!granted) {
    if (previous.length > 0) await LocalNotifications.cancel({ notifications: previous.map((id) => ({ id })) })
    writeJson(TRACKED_KEY, [])
    return
  }

  const wantedIds = new Set(desired.keys())
  // Reminders have stable IDs but their due time can move; replace every
  // previously scheduled plan reminder to keep both time and text in sync.
  if (previous.length > 0) await LocalNotifications.cancel({ notifications: previous.map((id) => ({ id })) })
  const exact = await exactAlarmsEnabled()
  const notifications = [...desired].map(([id, data]) => ({
    id,
    title: texts.title,
    body: texts.body(data.item, data.beforeHours),
    schedule: { at: data.at, allowWhileIdle: true, exact },
    extra: { url: SISU_URL },
    smallIcon: 'ic_stat_lesson',
    iconColor: '#e7e5e4',
  }))
  if (notifications.length > 0) await LocalNotifications.schedule({ notifications })
  writeJson(TRACKED_KEY, [...wantedIds])
}

