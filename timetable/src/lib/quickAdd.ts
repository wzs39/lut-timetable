/**
 * 命令面板里的自然语言录入：`作业 周三 14:00 密码学报告` → 一条带截止时间的任务。
 *
 * 为什么需要：现在开面板只能"找"东西（切视图/搜课程），要加作业必须
 * 「作业页 → ＋ → 填三个框」。真实场景是脑子里已经有一句话了，直接敲进去最快。
 *
 * 设计原则（比"识别所有自然语言"重要得多）：
 * 1. **必须有触发词**（作业/任务/todo/task）。没有触发词就当作普通搜索——
 *    否则你搜课程 "Data" 时面板会冒出一条"新建任务"，把搜索变成猜谜。
 * 2. **认不出来的原样当标题**，不报错、不静默丢弃：认不出"周四"就只丢"周四"
 *    这一层，其余文字仍然是标题。
 * 3. 纯函数 + 可注入时钟：日期解析是最容易出错的部分，必须有测试钉住。
 */

/** 触发词：中文两个 + 英文两个，大小写不敏感（英文需要词边界）。 */
const TRIGGERS = ['作业', '任务', 'todo', 'task']

export interface QuickAdd {
  title: string
  /** ISO 截止时间；没写时间/日期时为 undefined（无截止的任务） */
  dueAt?: string
}

/** 默认截止时刻：只写了日期时按当天 23:59（人的直觉是"这天结束前"）。 */
const DEFAULT_HOUR = 23
const DEFAULT_MINUTE = 59

const WEEKDAY_CHARS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0,
  七: 0,
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/**
 * 解析输入；不是"快速录入"时返回 null（调用方应退回普通搜索）。
 * @param now 注入当前时间（测试用；生产传 new Date()）
 */
export function parseQuickAdd(input: string, now: Date = new Date()): QuickAdd | null {
  const raw = input.trim()
  if (!raw) return null

  const lower = raw.toLowerCase()
  const trigger = TRIGGERS.find((tr) =>
    tr.charCodeAt(0) > 0x2e80 ? lower.startsWith(tr) : new RegExp(`^${tr}\\b`).test(lower),
  )
  if (!trigger) return null

  // 去掉触发词后的剩余文本（保留原大小写与空格）
  let rest = raw.slice(trigger.length).trim()
  if (!rest) return null

  let date: Date | null = null
  let hour: number | null = null
  let minute: number | null = null

  // 英文日期词（英文界面的人不该被迫写中文）。词边界用 \b 避免吃掉标题里的词。
  const EN_WEEKDAYS: Record<string, number> = {
    sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
    wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5, sat: 6, saturday: 6,
  }

  const eat = (re: RegExp, fn: (m: RegExpMatchArray) => boolean) => {
    const m = rest.match(re)
    if (!m) return
    if (fn(m)) rest = (rest.slice(0, m.index!) + ' ' + rest.slice(m.index! + m[0].length)).trim()
  }

  // ---- 时刻：14:00 / 14点 / 14点半 / 下午3点 ----
  eat(/(上午|早上|中午|下午|晚上)?\s*(\d{1,2})[:：](\d{2})/, (m) => {
    const h = Number(m[2])
    if (h > 23 || Number(m[3]) > 59) return false
    hour = applyPeriod(h, m[1])
    minute = Number(m[3])
    return true
  })
  if (hour == null) {
    eat(/(上午|早上|中午|下午|晚上)?\s*(\d{1,2})\s*点\s*(半|\d{1,2}分?)?/, (m) => {
      const h = Number(m[2])
      if (h > 24) return false
      hour = applyPeriod(h, m[1])
      if (m[3] === '半') minute = 30
      else if (m[3]) minute = Number(m[3].replace(/分/, ''))
      else minute = 0
      return true
    })
  }

  // ---- 日期：今天/明天/后天 → 周X/下周三 → N天后/+N天 → M月D日 / M/D / ISO ----
  if (!date) eat(/今天|今日/, () => ((date = startOfDay(now)), true))
  if (!date) eat(/明天|明日/, () => ((date = addDays(now, 1)), true))
  if (!date) eat(/后天/, () => ((date = addDays(now, 2)), true))
  if (!date) {
    eat(/(下下|下|本|这)?\s*(?:周|星期|礼拜)\s*([一二三四五六日天七1-7])/, (m) => {
      const target = /[1-7]/.test(m[2]) ? Number(m[2]) % 7 : WEEKDAY_CHARS[m[2]]
      if (target == null) return false
      const forward = (target - now.getDay() + 7) % 7
      const weeks = m[1] === '下' ? 1 : m[1] === '下下' ? 2 : 0
      // "下周X" 指的是下一周的那一天（即使今天就是周X，也推到下周）
      date = addDays(now, forward + weeks * 7)
      return true
    })
  }
  if (!date) {
    eat(/(\d{1,3})\s*天\s*(?:后|之后)/, (m) => ((date = addDays(now, Number(m[1]))), true))
  }
  if (!date) {
    eat(/\+\s*(\d{1,3})\s*d?/, (m) => ((date = addDays(now, Number(m[1]))), true))
  }
  if (!date) {
    eat(/(\d{4})-(\d{1,2})-(\d{1,2})/, (m) => {
      const d = mkDate(Number(m[1]), Number(m[2]), Number(m[3]))
      if (!d) return false
      date = d
      return true
    })
  }
  if (!date) {
    eat(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/, (m) => {
      const d = mkDate(now.getFullYear(), Number(m[1]), Number(m[2]))
      if (!d) return false
      // 已经过去的日子 → 认为是明年（学期内的直觉）
      date = d.getTime() < startOfDay(now).getTime() ? mkDate(now.getFullYear() + 1, Number(m[1]), Number(m[2])) : d
      return true
    })
  }
  if (!date) {
    eat(/(\d{1,2})\/(\d{1,2})/, (m) => {
      const d = mkDate(now.getFullYear(), Number(m[1]), Number(m[2]))
      if (!d) return false
      date = d
      return true
    })
  }
  if (!date) eat(/\btoday\b/i, () => ((date = startOfDay(now)), true))
  if (!date) eat(/\btomorrow\b/i, () => ((date = addDays(now, 1)), true))
  if (!date) {
    eat(/\b(next\s+)?(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\b/i, (m) => {
      const target = EN_WEEKDAYS[m[2].toLowerCase()]
      if (target == null) return false
      const forward = (target - now.getDay() + 7) % 7
      date = addDays(now, forward + (m[1] ? 7 : 0))
      return true
    })
  }
  if (!date) {
    eat(/\bin\s+(\d{1,3})\s*days?\b/i, (m) => ((date = addDays(now, Number(m[1]))), true))
  }

  const title = rest.replace(/\s{2,}/g, ' ').trim()
  if (!title) return null

  if (!date) {
    if (hour == null) return { title }
    // 只写了时刻：最早是今天，已经过了就顺延到明天
    const at = new Date(now)
    at.setHours(hour, minute ?? 0, 0, 0)
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1)
    return { title, dueAt: at.toISOString() }
  }

  const at = new Date(date)
  at.setHours(hour ?? DEFAULT_HOUR, hour == null ? DEFAULT_MINUTE : (minute ?? 0), 0, 0)
  return { title, dueAt: at.toISOString() }
}

/** 下午/晚上 + 12 小时；12 点本身不动（12:30 下午是 12:30，不是 24:30）。 */
function applyPeriod(hour: number, period?: string): number {
  if (!period) return hour
  if (period === '下午' || period === '晚上') return hour < 12 ? hour + 12 : hour
  if (period === '中午') return hour < 12 ? 12 : hour
  return hour
}

function addDays(from: Date, days: number): Date {
  const d = startOfDay(from)
  d.setDate(d.getDate() + days)
  return d
}

/** 构造本地日期；越界（2 月 30 日这种）返回 null，交给调用方放弃该片段。 */
function mkDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(year, month - 1, day)
  d.setHours(0, 0, 0, 0)
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null
  return d
}
