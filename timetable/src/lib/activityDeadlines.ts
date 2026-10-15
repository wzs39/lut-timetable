import type { Task } from './tasks'

/** Extract a Moodle activity cmid from an activity page URL (calendar event URLs are not cmids). */
export function activityCmidOf(url: string | undefined): number | undefined {
  if (!url) return undefined
  const match = url.match(/\/mod\/[a-z0-9_]+\/view\.php\?(?:[^#]*&)?id=(\d+)(?:&|#|$)/i)
  if (!match) return undefined
  const cmid = Number(match[1])
  return Number.isSafeInteger(cmid) && cmid > 0 ? cmid : undefined
}

/**
 * Build deadlines keyed by cmid from Moodle-synced activities. Manual tasks do
 * not become an alternate Moodle deadline source, even if they contain a URL.
 */
export function activityDeadlinesFromTasks(tasks: Task[]): Map<number, string> {
  const deadlines = new Map<number, string>()
  for (const task of tasks) {
    if (!/^moodle(?:-act)?:/i.test(task.id) || !task.dueAt || !Number.isFinite(Date.parse(task.dueAt))) continue
    const cmid = activityCmidOf(task.url)
    if (cmid != null && !deadlines.has(cmid)) deadlines.set(cmid, task.dueAt)
  }
  return deadlines
}
