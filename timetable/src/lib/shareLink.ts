import type { Lesson } from '../types'

/**
 * 课表分享链接：把一段课表压成紧凑载荷放进 URL hash，同学点链接（或扫码）
 * 就能看到"要不要导入这几节课"，不需要后端、不需要账号。
 *
 * 为什么是紧凑数组而不是 JSON 对象：URL 有长度上限（约 2000 字符才开始被
 * 削减，各家浏览器不同）。对象形式里每个字段名都要重复一遍，数组形式省掉
 * 这些开销，一周十来节课约 600–900 字符。
 *
 * 范围提醒：链接**不适合整学期**（那就是 JSON 备份/`.ics` 导出的活）。
 * `encodeShare` 会在超出 MAX_SHARE_CHARS 时返回 null，界面据此引导用户改用
 * 导出功能，而不是发一个被截断的链接。
 */

/** hash 路由前缀：`#/import/v1.xxxx` */
export const SHARE_HASH_PREFIX = '#/import/'
/** 载荷版本前缀（将来字段变了可以并行支持） */
export const SHARE_VERSION = 'v1'
/** 载荷长度上限（留出 host/path 的空间） */
export const MAX_SHARE_CHARS = 3500
/** 单次最多分享多少节课（防止有人手改 hash 塞进来） */
export const MAX_SHARE_LESSONS = 200

/** 紧凑行：[code, title, location, start, end, type] */
type ShareRow = [string, string, string, string, string, string]

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(input: string): string {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
  const bin = atob(b64 + pad)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

/** 编码课表；超出长度/条数上限时返回 null（让调用方改走导出）。 */
export function encodeShare(lessons: Lesson[]): string | null {
  if (lessons.length === 0 || lessons.length > MAX_SHARE_LESSONS) return null
  const rows: ShareRow[] = [...lessons]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((l) => [
      l.code ?? '',
      (l.title ?? '').replace(/\s+/g, ' ').trim(),
      l.location ?? '',
      l.start,
      l.end,
      l.type ?? '',
    ])
  const payload = `${SHARE_VERSION}.${toBase64Url(JSON.stringify(rows))}`
  return payload.length > MAX_SHARE_CHARS ? null : payload
}

/** 完整分享链接（origin + path + hash）。 */
export function shareLinkFor(lessons: Lesson[], baseUrl: string): string | null {
  const payload = encodeShare(lessons)
  if (!payload) return null
  const base = baseUrl.replace(/[#?].*$/, '')
  return `${base}${SHARE_HASH_PREFIX}${payload}`
}

/**
 * 解出分享载荷；不是本应用的载荷 / 版本不认识 / 内容损坏 → null。
 * 返回的课不带 id 与 source——那两样由导入方（本机）决定。
 */
export function decodeShare(
  payload: string,
): { lessons: Omit<Lesson, 'id' | 'source'>[]; dropped: number } | null {
  const dot = payload.indexOf('.')
  if (dot < 0) return null
  if (payload.slice(0, dot) !== SHARE_VERSION) return null
  let rows: unknown
  try {
    rows = JSON.parse(fromBase64Url(payload.slice(dot + 1)))
  } catch {
    return null
  }
  if (!Array.isArray(rows)) return null
  const lessons: Omit<Lesson, 'id' | 'source'>[] = []
  let dropped = 0
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) {
      dropped++
      continue
    }
    const [code, title, location, start, end, type] = row as ShareRow
    // 时间必须能被解析，否则这行无法进课表
    if (Number.isNaN(new Date(start).getTime()) || Number.isNaN(new Date(end).getTime())) {
      dropped++
      continue
    }
    lessons.push({
      code: String(code ?? '') || undefined,
      title: String(title ?? ''),
      location: String(location ?? '') || undefined,
      start: String(start),
      end: String(end),
      type: (String(type ?? '') || undefined) as Lesson['type'],
    })
  }
  if (lessons.length === 0) return null
  return { lessons: lessons.slice(0, MAX_SHARE_LESSONS), dropped }
}

/** 从 hash 里取分享载荷；不是分享链接时返回 null。 */
export function parseShareHash(hash: string): string | null {
  if (!hash.startsWith(SHARE_HASH_PREFIX)) return null
  const payload = hash.slice(SHARE_HASH_PREFIX.length).trim()
  return payload ? payload : null
}
