import { useCallback, useState } from 'react'
import type { Lesson } from '../types'
import { decodeShare, parseShareHash, shareLinkFor } from '../lib/shareLink'
import { encodeQr, type QrCode } from '../lib/qr'
import { shareLinkText } from '../lib/download'

type ShareImportState =
  | { kind: 'confirm'; decoded: NonNullable<ReturnType<typeof decodeShare>> }
  | { kind: 'failed' }
  | { kind: 'done'; added: number; skipped: number }
  | null

/**
 * 分享 / 导入：链接与二维码弹层的状态 + 本周课表打包，只在这一处。
 *
 * 二维码可能装不下（等级 L 上限 2953 字节）——那时仍给链接，但要把「为什么
 * 没有码」说出来（shareWeekQrTooBig），不能装作成功。
 */
export function useShareLinks(params: {
  lessons: Lesson[]
  weekStart: Date
  t: (key: string) => string
  importLessons: (lessons: Omit<Lesson, 'id' | 'source'>[]) => { added: number; skipped: number }
}) {
  const { lessons, weekStart, t, importLessons } = params
  /** 分享链接打开的导入确认（null = 没在导入流程里） */
  const [shareImport, setShareImport] = useState<ShareImportState>(null)
  /** 分享本周课表的二维码弹层（链接 + 可扫的码，null = 没开） */
  const [shareQr, setShareQr] = useState<{ link: string; qr: QrCode; count: number } | null>(null)

  /** hash（#/import/<payload>）→ 弹层；挂载时和运行中改 hash 都走这里。 */
  const openShareImport = useCallback((payload: string) => {
    const decoded = decodeShare(payload)
    setShareImport(decoded ? { kind: 'confirm', decoded } : { kind: 'failed' })
  }, [])

  // 先落库、再切状态：importLessons 是副作用，不能放进 setState 的 updater——
  // StrictMode（见 src/main.tsx）会把 updater 跑两次，这一条实测会让同一批课
  // 落库两遍、弹层还报「已存在」（见 shareImportStrict.test.tsx）。
  // 次序与重构前的 App.tsx 一致：先 importLessons，再 setShareImport 结果。
  const confirmShareImport = useCallback(() => {
    if (shareImport?.kind !== 'confirm') return
    const r = importLessons(shareImport.decoded.lessons)
    setShareImport({ kind: 'done', added: r.added, skipped: r.skipped })
  }, [importLessons, shareImport])

  const closeShareImport = useCallback(() => {
    setShareImport(null)
    // 清掉 hash，否则刷新/返回时又弹一次
    if (parseShareHash(location.hash)) history.replaceState(null, '', location.pathname)
  }, [])

  const closeShareQr = useCallback(() => setShareQr(null), [])

  /** 分享本周课表：把当前显示那一周的可见课表压成链接（/ 二维码弹层）。 */
  const shareWeek = useCallback(async (): Promise<string> => {
    const end = new Date(weekStart)
    end.setDate(weekStart.getDate() + 7)
    const week = lessons.filter((l) => {
      const t0 = new Date(l.start)
      return t0 >= weekStart && t0 < end
    })
    if (week.length === 0) return t('shareWeekEmpty')
    const link = shareLinkFor(week, location.href)
    if (!link) return t('shareWeekTooBig')
    const qr = encodeQr(link)
    if (!qr) {
      const where = await shareLinkText(link, t('shareWeek'))
      return where === 'failed' ? link : t('shareWeekQrTooBig')
    }
    // 链接 + 二维码一起给：弹层里自己选「复制链接」还是让对方直接扫。
    setShareQr({ link, qr, count: week.length })
    return ''
  }, [lessons, t, weekStart])

  return {
    shareImport,
    openShareImport,
    confirmShareImport,
    closeShareImport,
    shareQr,
    closeShareQr,
    shareWeek,
  }
}
