import { useMemo, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { useI18n } from '../i18n'
import { shareLinkText } from '../lib/download'
import type { QrCode } from '../lib/qr'
import Icon from './Icon'

/** 静默区：扫描器要靠它把码和周围内容分开（规格要求 ≥4 个模块） */
const QUIET_ZONE = 4

/**
 * 分享本周课表：给出链接**和**一张可扫的二维码。
 *
 * 二维码永远画成黑白（不跟随主题）：深色主题下用主题色的码在相机里对比度不够。
 * 形状是内联 SVG 而不是 canvas —— 矢量、可缩放、可打印，而且 jsdom 里能直接断言，
 * 不需要 canvas 实现。
 */
export default function ShareQrDialog({
  link,
  qr,
  count,
  onClose,
}: {
  link: string
  qr: QrCode
  /** 本周课节数（界面上说出来，让人知道扫出来是多少） */
  count: number
  onClose: () => void
}) {
  const { t } = useI18n()
  const [msg, setMsg] = useState<string | null>(null)
  const native = Capacitor.isNativePlatform()

  const { size, path } = useMemo(() => {
    // 一个深色模块 = 一个 1×1 方块的子路径；用一条 path 而不是上万个 <rect>。
    const d: string[] = []
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) d.push(`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`)
      }
    }
    return { size: qr.size + QUIET_ZONE * 2, path: d.join('') }
  }, [qr])

  const copy = async () => {
    const where = await shareLinkText(link, t('shareWeek'))
    setMsg(where === 'native' ? t('shareQrShared') : where === 'clipboard' ? t('shareQrCopied') : t('shareQrCopyFailed'))
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={t('shareWeek')}
      onClick={onClose}
    >
      <div
        className="animate-modal-in w-full max-w-sm rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--text-1)]">
            <Icon name="link" size={14} /> {t('shareWeek')}
          </h3>
          <button onClick={onClose} className="app-btn px-2 py-1 text-xs" title={t('closeHint')}>
            <Icon name="close" size={12} />
          </button>
        </div>

        <p className="mt-2 text-xs text-[var(--text-2)]">{t('shareQrHint', { n: count })}</p>

        {/* 码：白底黑块 + 静默区，固定宽度免得大版本在小屏上被压扁 */}
        <div className="mt-3 flex justify-center">
          <svg
            viewBox={`0 0 ${size} ${size}`}
            width={240}
            height={240}
            shapeRendering="crispEdges"
            role="img"
            aria-label={t('shareQrAlt')}
            className="max-w-full rounded bg-white"
          >
            <rect width={size} height={size} fill="#ffffff" />
            <path d={path} fill="#000000" />
          </svg>
        </div>

        <p className="mt-2 break-all rounded bg-[var(--surface-2)] px-2 py-1 text-[10px] text-[var(--text-3)] select-all">
          {link}
        </p>

        <div className="mt-3 flex gap-2">
          <button onClick={copy} className="app-btn-primary flex-1 px-3 py-2 text-xs">
            {native ? t('shareQrShare') : t('shareQrCopy')}
          </button>
          <button onClick={onClose} className="app-btn flex-1 px-3 py-2 text-xs">
            {t('close')}
          </button>
        </div>
        {msg && <p className="mt-1 text-[11px] text-[var(--text-2)]">{msg}</p>}
      </div>
    </div>
  )
}
