import { bgHost, type BgHost } from './bgHost'
import {
  BG_SEED_KEY,
  BG_STATUS_KEY,
  captureBackgroundSeed,
  parseBackgroundSeed,
  replayBackgroundSeed,
} from './backgroundSeed'
import {
  backfillLessonTypes,
  dedupeLessons,
  lessonKey,
  loadHiddenKeys,
  loadLessons,
  loadSources,
  saveLessons,
  syncSource,
} from './store'
import { loadTasks } from './tasks'
import { loadIdentityIndex } from './courseIdentity'
import {
  appendAudit,
  diffLessons,
  loadAudits,
  recentChangeMarks,
  saveAudits,
  summarizeChanges,
  type SyncChangeKind,
} from './syncAudit'
import { PREF_KEY, PREF_TASK_KEY, buildTasksPayload, buildWidgetPayload } from './widgetData'
import type { Lesson } from '../types'

/**
 * 后台刷新 pass：不开 App 也能把小组件载荷拉新。
 *
 * 它**不复制**任何同步逻辑——把种子回灌进 localStorage 后，直接跑 App 用的那条
 * `syncSource` + 去重 + 类型回填 + 变更审计，再用同一个 `buildWidgetPayload`
 * 写同一份 Preferences。后台唯一特殊的地方是出口：网络走宿主的原生 HTTP，
 * 载荷写进偏好由宿主代劳（后台没有 Capacitor 插件）。
 */

export interface BackgroundRunResult {
  ok: boolean
  /** epoch ms（结果写进 BG_STATUS_KEY，设置诊断可读） */
  at: number
  ms: number
  sources: number
  /** 单源失败不致命，但要留痕——静默失败是「后台刷新没反应」这类问题的根源 */
  failed: { id: string; error: string }[]
  /** feed 没拉到、只读了缓存：小组件还是旧数据，ok 不能因此写 true。 */
  stale: { id: string; error: string }[]
  changes: Record<SyncChangeKind, number>
  lessons: number
  /** 载荷里今天的课程数（0 也可能是正常，诊断要能分辨） */
  today: number
  note?: string
}

/** 一趟后台刷新的纯编排：输入是种子内容（已回灌），输出是载荷与结果。
 *  单独导出便于测试——测试里只需要一个假的 host。 */
export async function runBackgroundRefresh(
  host: BgHost,
  now: Date = new Date(),
): Promise<BackgroundRunResult> {
  const started = Date.now()
  const at = now.getTime()
  const seed = parseBackgroundSeed(await host.prefGet(BG_SEED_KEY))
  if (!seed) {
    // 种子的写入方是 App：没有它说明用户还没打开过新版本，什么都不做。
    return {
      ok: false,
      at,
      ms: Date.now() - started,
      sources: 0,
      failed: [],
      stale: [],
      changes: { added: 0, moved: 0, room: 0, title: 0, cancelled: 0 },
      lessons: 0,
      today: 0,
      note: 'no-seed',
    }
  }
  replayBackgroundSeed(seed)

  const sources = loadSources()
  const before = loadLessons()
  let lessons = before
  const failed: { id: string; error: string }[] = []
  const stale: { id: string; error: string }[] = []
  const totals = { added: 0, moved: 0, room: 0, title: 0, cancelled: 0 } as Record<
    SyncChangeKind,
    number
  >

  for (const src of sources) {
    try {
      const prev = lessons
      // 走缓存的源不算失败，但也绝不是「刷新了」——它写出来的还是旧数据。
      const { lessons: next } = await syncSource(src, lessons, (reason) =>
        stale.push({ id: src.id, error: reason }),
      )
      lessons = next
      const changes = diffLessons(prev, next)
      if (changes.length > 0) {
        // 审计与 App 同一条通道（同样带 sourceLabel）：小组件的「变动标记」
        // 在后台同步之后也亮得起来，⌘ 里的变更明细也接得上。
        saveAudits(
          appendAudit(
            { at: new Date().toISOString(), sourceId: src.id, sourceLabel: src.label, changes },
            loadAudits(),
          ),
        )
        for (const [kind, n] of Object.entries(summarizeChanges(changes))) {
          totals[kind as SyncChangeKind] += n
        }
      }
    } catch (e) {
      failed.push({ id: src.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  lessons = dedupeLessons(backfillLessonTypes(lessons))
  if (lessons !== before) saveLessons(lessons)

  const visible = visibleOf(lessons)
  const marks = recentChangeMarks(loadAudits(), at)
  const payload = buildWidgetPayload(visible, now, (code) => loadIdentityIndex().idForCode(code), marks)
  const tasks = buildTasksPayload(loadTasks(), now)

  // 先落载荷再落种子：种子代表「这次同步后的输入」，失败也不影响小组件已经拿到的数据。
  await host.prefSet(PREF_KEY, JSON.stringify(payload))
  await host.prefSet(PREF_TASK_KEY, JSON.stringify(tasks))
  await host.prefSet(BG_SEED_KEY, JSON.stringify(captureBackgroundSeed(now)))
  await host.refreshWidgets()

  const result: BackgroundRunResult = {
    // ok = 「至少一个源真的拉到了新数据」；全是缓存就写 false，
    // 否则「小组件没更新」时诊断报告会说一切正常。
    ok: failed.length + stale.length < sources.length || sources.length === 0,
    at,
    ms: Date.now() - started,
    sources: sources.length,
    failed,
    stale,
    changes: totals,
    lessons: lessons.length,
    today: payload.items.length,
  }
  await host.prefSet(BG_STATUS_KEY, JSON.stringify(result))
  return result
}

/** 与 App 的 visibleLessons 同口径：隐藏的课不进小组件载荷。 */
function visibleOf(lessons: Lesson[]): Lesson[] {
  const hidden = loadHiddenKeys()
  return hidden.size === 0 ? lessons : lessons.filter((l) => !hidden.has(lessonKey(l)))
}

/** 后台入口：宿主存在才跑，结果回给宿主（Android jobFinished / iOS setTaskCompleted）。 */
export async function runBackgroundEntry(): Promise<void> {
  const host = bgHost()
  if (!host) return
  try {
    const result = await runBackgroundRefresh(host)
    host.done({ ok: result.ok, message: result.note ?? `lessons=${result.lessons}` })
  } catch (e) {
    // 未捕获异常必须回给宿主，否则 JobScheduler 会当成超时而不是失败
    host.done({ ok: false, message: e instanceof Error ? e.message : String(e) })
  }
}
