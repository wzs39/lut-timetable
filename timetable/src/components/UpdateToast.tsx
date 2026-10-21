import { useI18n } from '../i18n'
import { maybeCleanOldApks } from '../lib/apkUpdate'
import Icon from './Icon'

export type UpdateToastState = {
  version: string
  kind: 'ready' | 'downloading' | 'available' | 'latest' | 'error'
  percent?: number
  /** Android: direct APK asset URL to download */
  apkUrl?: string
}

/**
 * 底部更新提示条（检查更新 / 下载进度 / 可安装 / 出错）。
 *
 * 状态由 App 持有（含 Electron 事件与 Android APK 检查两条来源），
 * 这里只按 kind 渲染文案与按钮；配色取自既有令牌，不新造颜色。
 */
export default function UpdateToast({
  state,
  onInstall,
  onDismiss,
  /** 撤销条同时可见时上移，避免两条叠在一起 */
  raised,
}: {
  state: UpdateToastState
  onInstall: () => void
  onDismiss: () => void
  raised: boolean
}) {
  const { t } = useI18n()
  const tone =
    state.kind === 'error'
      ? 'bg-[var(--btn-danger)] text-white'
      : state.kind === 'ready'
        ? 'bg-[var(--btn-ok)] text-white'
        : 'bg-[var(--surface-2)] text-[var(--text-1)] border border-[var(--line)]'

  return (
    <div
      className={
        'fixed inset-x-0 z-50 flex justify-center px-4 animate-modal-in ' +
        (raised ? 'bottom-20' : 'bottom-4')
      }
    >
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg text-sm px-4 py-3 shadow-lg max-w-full ${tone}`}
      >
        <span>
          {state.kind === 'ready' && (
            <span className="inline-flex items-center gap-2">
              <Icon name="sync" /> {t('updateReady', { v: state.version })}
            </span>
          )}
          {state.kind === 'downloading' &&
            t('updateDownloading', { p: state.percent ?? 0 })}
          {state.kind === 'available' &&
            (state.apkUrl
              ? t('updateApkAvailable', { v: state.version })
              : t('updateAvailable', { v: state.version }))}
          {state.kind === 'latest' && t('updateUpToDate', { v: state.version })}
          {state.kind === 'error' && t('updateCheckFail')}
        </span>
        {state.kind === 'ready' && (
          <button
            className="rounded bg-white text-[var(--ok)] px-3 min-h-9 font-medium"
            onClick={onInstall}
          >
            {t('updateInstallNow')}
          </button>
        )}
        {state.kind === 'available' && state.apkUrl && (
          <a
            href={state.apkUrl}
            download="app-release.apk"
            onClick={() => {
              // Unduhan lama di Download/ (APK versi sebelumnya) dibuang:
              // installed APK tidak terpakai lagi & memakan storage.
              void maybeCleanOldApks()
            }}
            className="inline-flex items-center gap-1.5 rounded bg-white text-[var(--text-3)] px-3 min-h-9 font-medium"
          >
            <Icon name="external" size={13} /> {t('updateGetApk')}
          </a>
        )}
        <button className="opacity-80 transition hover:opacity-100" onClick={onDismiss}>
          {t('updateLater')}
        </button>
      </div>
    </div>
  )
}
