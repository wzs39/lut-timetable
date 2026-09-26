import { Capacitor } from '@capacitor/core'
import { KEYS, readJson, writeJson } from './storage'

/**
 * 本地错误日志 + 诊断导出。
 *
 * 为什么需要：跨端问题（iOS 小组件"暂无数据"、WebView 里同步失败）在这个
 * 项目里只能靠"让用户描述现象"来定位，而错误全在 console 里、关掉应用就没了。
 * 这里做一个**环形缓冲**：最近 N 条异常落盘，设置页能看条数、能导出成文本
 * 让人发给你。
 *
 * 边界（重要）：
 * - 只存**本机诊断信息**，不联网、不上传（没有后端可传，也不该偷偷传）。
 * - 导出前必须**脱敏**：token、URL 查询串、cookie 一律不进报告（见 snapshotFor）。
 * - 记录失败本身绝不能再抛错（它常被调用于错误处理路径上）。
 */

export const MAX_ERRORS = 40
/** 单条消息/堆栈的字符上限——防止一次循环报错把存储撑爆 */
export const MAX_FIELD_CHARS = 400

export interface ErrorEntry {
  /** ISO 时间 */
  at: string
  /** 出错的地方：window | sync | widget | moodle | storage | other */
  scope: string
  message: string
  stack?: string
  /** 额外上下文（短字符串，同样会被裁剪） */
  extra?: string
}

/** 裁剪 + 追加（纯函数）：新的在前，超出上限丢最旧的。 */
export function appendError(list: ErrorEntry[], entry: ErrorEntry, cap = MAX_ERRORS): ErrorEntry[] {
  return [trimEntry(entry), ...list].slice(0, cap)
}

function trimEntry(entry: ErrorEntry): ErrorEntry {
  const cut = (s?: string) => (s ? s.slice(0, MAX_FIELD_CHARS) : undefined)
  return {
    at: entry.at,
    scope: entry.scope,
    message: cut(entry.message) ?? '',
    stack: cut(entry.stack),
    extra: cut(entry.extra),
  }
}

export function loadErrors(): ErrorEntry[] {
  const raw = readJson<ErrorEntry[]>(KEYS.errorLog, [])
  if (!Array.isArray(raw)) return []
  return raw.filter((e) => e && typeof e.message === 'string' && typeof e.at === 'string')
}

export function clearErrors(): void {
  writeJson(KEYS.errorLog, [])
}

/**
 * 记一条错误。绝不抛：调用点常在 catch 里，二次异常会把真正的错误盖掉。
 */
export function logError(
  scope: string,
  err: unknown,
  extra?: string,
): void {
  try {
    const e = err as { message?: string; stack?: string } | undefined
    const message =
      typeof err === 'string'
        ? err
        : e?.message
          ? String(e.message)
          : e !== undefined && e !== null
            ? String(err)
            : 'unknown error'
    const next = appendError(loadErrors(), {
      at: new Date().toISOString(),
      scope,
      message,
      stack: e?.stack,
      extra,
    })
    writeJson(KEYS.errorLog, next)
  } catch {
    /* 日志失败不影响主流程 */
  }
}

let installed = false

/** 注册全局兜底（幂等）：未捕获异常与未处理的 Promise 拒绝。 */
export function installErrorLogging(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (ev) => {
    logError('window', ev.error ?? ev.message, ev.filename ? shortPath(ev.filename) : undefined)
  })
  window.addEventListener('unhandledrejection', (ev) => {
    logError('promise', ev.reason)
  })
}

/** 只保留文件末尾（避免把本机绝对路径写进日志） */
export function shortPath(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts.slice(-2).join('/')
}

/** 报告里的环境信息——不含任何 token / 完整 URL。 */
export interface DiagnosticsContext {
  appVersion: string
  platform: string
  locale: string
  /** 已配置的来源数量（不写 URL） */
  sourceCount: number
  lessonCount: number
  taskCount: number
  /** 身份表覆盖率等既有诊断的紧凑串 */
  identitySummary?: string
  /** 最近一次后台刷新（没跑过 / 没开就是 never） */
  backgroundSummary?: string
}

/** 把上下文 + 错误列表拼成一份可以贴给人看的纯文本报告。 */
export function buildDiagnosticsReport(ctx: DiagnosticsContext, errors: ErrorEntry[]): string {
  const head = [
    `LUT Timetable diagnostics`,
    `generated: ${new Date().toISOString()}`,
    `version: ${ctx.appVersion}`,
    `platform: ${ctx.platform}`,
    `locale: ${ctx.locale}`,
    `sources: ${ctx.sourceCount}`,
    `lessons: ${ctx.lessonCount}`,
    `tasks: ${ctx.taskCount}`,
  ]
  if (ctx.identitySummary) head.push(`identity: ${ctx.identitySummary}`)
  if (ctx.backgroundSummary) head.push(`background: ${ctx.backgroundSummary}`)
  if (errors.length === 0) return [...head, '', 'no errors recorded'].join('\n')
  const body = errors.map((e, i) => {
    const lines = [
      `${i + 1}. [${e.scope}] ${e.at} — ${e.message}`,
    ]
    if (e.extra) lines.push(`   at: ${e.extra}`)
    if (e.stack) lines.push(`   ${e.stack.replace(/\n/g, '\n   ')}`)
    return lines.join('\n')
  })
  return [...head, '', `errors (${errors.length}, newest first):`, ...body].join('\n')
}

/**
 * 导出时用的**脱敏**快照：去掉任何可能带 token 的东西。
 * 传入的上下文里只保留白名单字段，避免以后有人往里塞了 URL 就泄露。
 */
export function snapshotFor(ctx: {
  appVersion?: string
  locale?: string
  sourceCount?: number
  lessonCount?: number
  taskCount?: number
  identitySummary?: string
  backgroundSummary?: string
}): DiagnosticsContext {
  return {
    appVersion: ctx.appVersion ?? 'unknown',
    platform: Capacitor.getPlatform?.() ?? 'web',
    locale: ctx.locale ?? 'unknown',
    sourceCount: ctx.sourceCount ?? 0,
    lessonCount: ctx.lessonCount ?? 0,
    taskCount: ctx.taskCount ?? 0,
    identitySummary: ctx.identitySummary,
    backgroundSummary: ctx.backgroundSummary,
  }
}

/** 脱敏：把明显的密钥/查询串从一段文本里抹掉（防御性，正常路径不该出现）。 */
export function scrubSecrets(text: string): string {
  return text
    // Moodle webservice token / calendar token
    .replace(/(token|wstoken|key|password|secret)=[^&\s"']+/gi, '$1=***')
    // URL 查询串整体（可能是 calendar-share 带 token 的链接）
    .replace(/(https?:\/\/[^\s?#]+)\?[^\s]*/gi, '$1?***')
}
