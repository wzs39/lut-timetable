// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bgHost, hasBgHost } from '../lib/bgHost'
import {
  BG_SEED_KEYS,
  BG_SEED_KEY,
  BG_STATUS_KEY,
  captureBackgroundSeed,
  parseBackgroundSeed,
  replayBackgroundSeed,
  type BackgroundSeed,
} from '../lib/backgroundSeed'
import { runBackgroundRefresh } from '../lib/backgroundSync'
import { lessonKey, syncSource } from '../lib/store'
import { KEYS } from '../lib/storage'
import { PREF_KEY, PREF_TASK_KEY } from '../lib/widgetData'
import type { SyncSource } from '../types'

/**
 * 后台刷新：种子的白名单、宿主桥两种形状、以及「回灌 localStorage → 跑既有
 * syncSource → 写同一份小组件载荷」这条编排。测试里只换宿主（网络/存储出口），
 * 同步逻辑本身用的就是 App 的那一份。
 */

const NOW = new Date(2026, 8, 26, 12, 0, 0)

function icsUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00Z`
}

function icsOf(events: Array<{ uid: string; summary: string; start: Date; end: Date; location?: string }>): string {
  return [
    'BEGIN:VCALENDAR',
    'PRODID:-//Funidata//SISU//FI',
    'VERSION:2.0',
    ...events.flatMap((e) => [
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTART:${icsUtc(e.start)}`,
      `DTEND:${icsUtc(e.end)}`,
      `SUMMARY:${e.summary}`,
      ...(e.location ? [`LOCATION:${e.location}`] : []),
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ].join('\r\n')
}

/** 距 now ± 小时，避免依赖运行机器的时区（localDate 按本地时区切天）。 */
const at = (hours: number) => new Date(NOW.getTime() + hours * 3600_000)

const SOURCE_A: SyncSource = {
  id: 'src-a',
  type: 'sisu',
  url: 'https://sisu.lut.fi/x.ics',
  icsUrl: 'https://sisu.lut.fi/x.ics',
  label: 'SISU',
  count: 0,
}
const SOURCE_B: SyncSource = {
  id: 'src-b',
  type: 'timeedit',
  url: 'https://cloud.timeedit.net/x.ics',
  icsUrl: 'https://cloud.timeedit.net/x.ics',
  label: 'TimeEdit',
  count: 0,
}

/**
 * 装一个 Android 形状的宿主（方法同步返回，和 @JavascriptInterface 一致），
 * 再用真实的 bgHost() 包一层——测试跑的桥就是生产里那条桥。
 */
function fakeHost(files: Record<string, string>) {
  const prefs = new Map<string, string>()
  const refreshes: number[] = []
  ;(window as unknown as { lutBg?: unknown }).lutBg = {
    prefGet: (key: string) => prefs.get(key) ?? null,
    prefSet: (key: string, value: string) => {
      prefs.set(key, value)
    },
    fetchText: (url: string) => {
      const text = files[url]
      // 宿主的原生 HTTP 失败会抛回 JS —— 这里用同样的方式模拟
      if (text == null) throw new Error('HTTP 404')
      return text
    },
    refreshWidgets: () => {
      refreshes.push(Date.now())
    },
    done: () => {},
  }
  return { prefs, refreshes, host: bgHost()! }
}

const seedOf = (over: Partial<BackgroundSeed['keys']> = {}, updatedAt = NOW.getTime()): BackgroundSeed => ({
  updatedAt,
  keys: {
    [KEYS.sources]: JSON.stringify([SOURCE_A]),
    [KEYS.lessons]: '[]',
    ...over,
  },
})

afterEach(() => {
  localStorage.clear()
  delete (window as unknown as { lutBg?: unknown }).lutBg
  delete (window as unknown as { webkit?: unknown }).webkit
})

describe('background host bridge', () => {
  it('is absent in a plain browser (App / web)', () => {
    expect(hasBgHost()).toBe(false)
    expect(bgHost()).toBeNull()
  })

  it('wraps the Android sync interface (methods return values directly)', async () => {
    const store = new Map([['k', 'v']])
    ;(window as unknown as { lutBg?: unknown }).lutBg = {
      prefGet: (key: string) => store.get(key) ?? null,
      prefSet: (key: string, value: string) => store.set(key, value),
      fetchText: (url: string) => `body:${url}`,
      refreshWidgets: vi.fn(),
      done: vi.fn(),
    }
    const host = bgHost()
    expect(hasBgHost()).toBe(true)
    expect(await host!.prefGet('k')).toBe('v')
    await host!.prefSet('k2', 'v2')
    expect(store.get('k2')).toBe('v2')
    expect(await host!.fetchText('u', 'text/calendar')).toBe('body:u')
  })

  it('wraps the iOS message handler as request/response', async () => {
    const postMessage = vi.fn((msg: { id: number; op: string }) => {
      // 宿主侧：evaluateJavaScript("window.__lutBgResolve(id, json)")
      const reply = msg.op === 'prefGet' ? '"stored"' : 'null'
      setTimeout(() => {
        const resolve = (window as unknown as Record<string, (id: number, json: string) => void>)[
          '__lutBgResolve'
        ]
        resolve(msg.id, JSON.parse(reply))
      }, 0)
    })
    ;(window as unknown as { webkit?: unknown }).webkit = { messageHandlers: { lutBg: { postMessage } } }
    const host = bgHost()
    expect(hasBgHost()).toBe(true)
    expect(await host!.prefGet('any')).toBe('stored')
    await host!.refreshWidgets()
    expect(postMessage.mock.calls.map((c) => c[0].op)).toEqual(['prefGet', 'refreshWidgets'])
  })
})

describe('background seed', () => {
  it('captures only the whitelist — credential keys never enter the seed', () => {
    localStorage.setItem(KEYS.lessons, '[]')
    localStorage.setItem(KEYS.sources, '[]')
    localStorage.setItem(KEYS.gradesSource, '{"authtoken":"secret"}')
    localStorage.setItem(KEYS.moodleSource, 'https://moodle.lut.fi/calendar/export.php?authtoken=secret')
    const seed = captureBackgroundSeed(NOW)
    expect(Object.keys(seed.keys).sort()).toEqual([KEYS.lessons, KEYS.sources].sort())
    expect(JSON.stringify(seed)).not.toContain('secret')
    expect(BG_SEED_KEYS).toContain(KEYS.hidden)
    expect(BG_SEED_KEYS).not.toContain(KEYS.gradesSource)
  })

  it('replays into localStorage and treats corrupt payloads as "no seed"', () => {
    localStorage.setItem(KEYS.lessons, '[]')
    localStorage.setItem(KEYS.gradesSource, '{"authtoken":"secret"}')
    replayBackgroundSeed(seedOf({ [KEYS.lessons]: '[{"id":"1"}]' }))
    expect(localStorage.getItem(KEYS.lessons)).toBe('[{"id":"1"}]')
    expect(localStorage.getItem(KEYS.gradesSource)).toBe('{"authtoken":"secret"}')
    expect(parseBackgroundSeed(null)).toBeNull()
    expect(parseBackgroundSeed('{oops')).toBeNull()
    expect(parseBackgroundSeed('{"updatedAt":1}')).toBeNull()
    expect(parseBackgroundSeed('{"updatedAt":1,"keys":{}}')?.updatedAt).toBe(1)
  })
})

describe('background refresh pass', () => {
  it('does nothing without a seed (App never ran / old version)', async () => {
    const { prefs, host } = fakeHost({})
    const result = await runBackgroundRefresh(host, NOW)
    expect(result.ok).toBe(false)
    expect(result.note).toBe('no-seed')
    expect(prefs.has(PREF_KEY)).toBe(false)
  })

  it('re-syncs every source, writes the widget payload contract and refreshes the widget', async () => {
    const { prefs, refreshes, host } = fakeHost({
      [SOURCE_A.icsUrl]: icsOf([
        { uid: 'a1', summary: 'BM20A9200 Mathematics', start: at(1), end: at(2), location: 'R112' },
      ]),
      [SOURCE_B.icsUrl]: icsOf([
        { uid: 'b1', summary: 'K200DJ96 Finnish 1', start: at(3), end: at(4), location: 'MC105' },
      ]),
    })
    prefs.set(
      BG_SEED_KEY,
      JSON.stringify(seedOf({ [KEYS.sources]: JSON.stringify([SOURCE_A, SOURCE_B]) })),
    )

    const result = await runBackgroundRefresh(host, NOW)
    expect(result.ok).toBe(true)
    expect(result.sources).toBe(2)
    expect(result.failed).toEqual([])
    expect(result.today).toBe(2)

    const payload = JSON.parse(prefs.get(PREF_KEY) as string)
    expect(payload.items.map((i: { name: string }) => i.name)).toEqual(['BM20A9200', 'K200DJ96'])
    expect(payload.items[0].room).toBe('R112')
    expect(payload.nextStartMs).toBe(at(1).getTime())
    // 载荷的日期按本地时区切天（与 App 一致），不是 UTC 日期
    const p = (n: number) => String(n).padStart(2, '0')
    expect(payload.date).toBe(
      `${NOW.getFullYear()}-${p(NOW.getMonth() + 1)}-${p(NOW.getDate())}`,
    )

    // 任务载荷也刷新（同一个契约），小组件被叫醒，结果落盘供诊断
    expect(JSON.parse(prefs.get(PREF_TASK_KEY) as string).openCount).toBe(0)
    expect(refreshes.length).toBe(1)
    const status = JSON.parse(prefs.get(BG_STATUS_KEY) as string)
    expect(status.lessons).toBe(2)
    expect(status.changes.added).toBe(2)

    // 种子被回写：下一趟从这次的结果继续（不是从 1970 年的空种子）
    const nextSeed = parseBackgroundSeed(prefs.get(BG_SEED_KEY) as string)
    expect(nextSeed?.updatedAt).toBe(NOW.getTime())
    expect(JSON.parse(nextSeed!.keys[KEYS.lessons]).length).toBe(2)
  })

  it('keeps hidden lessons out of the widget payload (same rule as the app)', async () => {
    const { prefs, host } = fakeHost({
      [SOURCE_A.icsUrl]: icsOf([
        { uid: 'a1', summary: 'BM20A9200 Mathematics', start: at(1), end: at(2), location: 'R112' },
      ]),
    })
    // 隐藏键的口径就是 store.lessonKey（代码|开始时间）：用同一函数算出来，
    // 免得测试自己编一个永远不匹配的键（“隐藏生效了吗”就成了假断言）。
    const hiddenKey = lessonKey({
      id: 'x',
      code: 'BM20A9200',
      title: 'Mathematics',
      start: at(1).toISOString(),
      end: at(2).toISOString(),
      source: 'sisu',
    })
    prefs.set(BG_SEED_KEY, JSON.stringify(seedOf({ [KEYS.hidden]: JSON.stringify([hiddenKey]) })))

    const result = await runBackgroundRefresh(host, NOW)
    const payload = JSON.parse(prefs.get(PREF_KEY) as string)
    expect(result.lessons).toBe(1) // 课还在列表里（隐藏不是删除）
    expect(payload.items).toHaveLength(0) // 但小组件不该显示它
  })

  it('isolates a failing source: the others still land, failure is recorded', async () => {
    const { prefs, host } = fakeHost({
      [SOURCE_A.icsUrl]: icsOf([
        { uid: 'a1', summary: 'BM20A9200 Mathematics', start: at(1), end: at(2) },
      ]),
      // SOURCE_B 故意缺 URL → fetch 抛错
    })
    prefs.set(
      BG_SEED_KEY,
      JSON.stringify(seedOf({ [KEYS.sources]: JSON.stringify([SOURCE_A, SOURCE_B]) })),
    )
    const result = await runBackgroundRefresh(host, NOW)
    expect(result.failed.map((f) => f.id)).toEqual(['src-b'])
    expect(result.ok).toBe(true)
    expect(JSON.parse(prefs.get(PREF_KEY) as string).items).toHaveLength(1)
    expect(JSON.parse(prefs.get(BG_STATUS_KEY) as string).failed[0].error).toContain('404')
  })

  it('走缓存的源不算刷新：记 stale，且 ok 不能写 true（否则诊断说一切正常）', async () => {
    // 第一趟：网络通，顺便把 feed 存进本地缓存
    const feed = icsOf([
      { uid: 'a1', summary: 'BM20A9200 Mathematics', start: at(1), end: at(2), location: 'R112' },
    ])
    const online = fakeHost({ [SOURCE_A.icsUrl]: feed })
    online.prefs.set(BG_SEED_KEY, JSON.stringify(seedOf()))
    expect((await runBackgroundRefresh(online.host, NOW)).ok).toBe(true)

    // 第二趟：同一个宿主，但网络断了（真实行为：fetchIcs 退回缓存）
    const offline = fakeHost({})
    ;(window as unknown as { lutBg: { fetchText: () => string } }).lutBg.fetchText = () => {
      throw new Error('SocketTimeoutException')
    }
    offline.prefs.set(BG_SEED_KEY, JSON.stringify(seedOf()))

    const result = await runBackgroundRefresh(offline.host, NOW)
    expect(result.failed).toEqual([]) // 没报成失败…
    expect(result.stale.map((f) => f.error)).toEqual(['SocketTimeoutException']) // …但也不是健康
    expect(result.ok).toBe(false)
    expect(JSON.parse(offline.prefs.get(BG_STATUS_KEY) as string).stale).toHaveLength(1)
    // 小组件还是能拿到旧数据（不能因为断网就清空）
    expect(JSON.parse(offline.prefs.get(PREF_KEY) as string).items).toHaveLength(1)
  })

  it('reports a change audit so the widget can mark moved lessons', async () => {
    const { prefs, host } = fakeHost({
      [SOURCE_A.icsUrl]: icsOf([
        { uid: 'a1', summary: 'BM20A9200 Mathematics', start: at(1), end: at(2), location: 'R112' },
      ]),
    })
    // 种子里已有的旧课：同 uid、同码，但换了教室 → room 变更
    prefs.set(
      BG_SEED_KEY,
      JSON.stringify(
        seedOf({
          [KEYS.lessons]: JSON.stringify([
            {
              id: 'l1',
              uid: 'a1',
              code: 'BM20A9200',
              title: 'Mathematics',
              start: at(1).toISOString(),
              end: at(2).toISOString(),
              location: 'OLD',
              source: 'sisu',
              syncId: SOURCE_A.id,
            },
          ]),
        }),
      ),
    )
    const result = await runBackgroundRefresh(host, NOW)
    expect(result.changes.room).toBe(1)
    const audits = JSON.parse(localStorage.getItem(KEYS.syncAudit) as string)
    expect(audits[0].sourceLabel).toBe('SISU')
    expect(audits[0].changes[0].kind).toBe('room')
    // 变动标记进载荷（小组件那一行的 chg）
    expect(JSON.parse(prefs.get(PREF_KEY) as string).items[0].chg).toBe(true)
  })
})

describe('background pass reuses the app pipeline verbatim', () => {
  it('produces the same lessons as an in-app syncSource for the same feed', async () => {
    const feed = icsOf([
      { uid: 'a1', summary: 'BM20A9200 Mathematics', start: at(1), end: at(2), location: 'R112' },
    ])
    const { prefs, host } = fakeHost({ [SOURCE_A.icsUrl]: feed })
    prefs.set(BG_SEED_KEY, JSON.stringify(seedOf()))
    await runBackgroundRefresh(host, NOW)
    const bgLessons = JSON.parse(prefs.get(PREF_KEY) as string).items

    // 同一份 feed 走 App 的同步（同样经宿主网络，因为 bridge 就装在 window 上）
    localStorage.clear()
    const { lessons } = await syncSource(SOURCE_A, [])
    expect(bgLessons).toHaveLength(lessons.length)
    expect(bgLessons[0].name).toBe(lessons[0].code)
    expect(bgLessons[0].title).toBe(lessons[0].title.split(' · ')[0])
    expect(bgLessons[0].sms).toBe(new Date(lessons[0].start).getTime())
    expect(bgLessons[0].ems).toBe(new Date(lessons[0].end).getTime())
  })
})
