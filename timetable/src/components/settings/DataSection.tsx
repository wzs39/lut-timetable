import { useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { clearEnrolledCoursesCache } from '../../lib/courses'
import { exportBackup, importBackupDetail } from '../../lib/backup'
import { canPrintSchedule } from '../../lib/print'
import { acceleratorLabel, type DesktopPrefs, type DesktopState } from '../../lib/desktop'
import type { SyncAudit } from '../../lib/syncAudit'
import type { SyncSource } from '../../types'
import { useMoodleData } from '../../hooks/useMoodleData'
import SyncAuditPanel from '../SyncAuditPanel'
import SyncProtection from '../SyncProtection'
import IdentityDiagnostics from '../IdentityDiagnostics'
import { SectionTitle } from './shared'

/**
 * 数据与工具：桌面端偏好（仅 Electron）/ 备份导入导出 / 同步变更记录 /
 * Lecture Translator / 同步保护 / 身份数据诊断。
 *
 * 「导入后立即刷新」这类本地副作用留在这里；真正的数据写入仍旧只在 lib 层。
 */
export default function DataSection({
  sources,
  syncing,
  syncMessage,
  translatorUrl,
  onTranslatorUrl,
  onLinkTranslator,
  translatorMsg,
  onExportIcs,
  onShareWeek,
  audits,
  onClearAudits,
  desktop,
  onDesktopPrefs,
}: {
  sources: SyncSource[]
  syncing: boolean
  syncMessage: string | null
  translatorUrl: string
  onTranslatorUrl: (u: string) => void
  onLinkTranslator: () => void
  translatorMsg: string | null
  onExportIcs: () => void
  onShareWeek: () => Promise<string>
  audits: SyncAudit[]
  onClearAudits: () => void
  desktop: DesktopState | null
  onDesktopPrefs: (patch: Partial<DesktopPrefs>) => void
}) {
  const { t } = useI18n()
  const md = useMoodleData()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [icsDone, setIcsDone] = useState<string | null>(null)
  const [shareMsg, setShareMsg] = useState<string | null>(null)

  const exportIcs = () => {
    onExportIcs()
    setIcsDone(t('exportIcsDone'))
  }

  return (
    <>
      {/* 桌面端：托盘与全局快捷键（只有 Electron 里有 lutDesktop 桥） */}
      {desktop && (
        <section>
          <SectionTitle>{t('desktopTitle')}</SectionTitle>
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-2)]">
            <input
              type="checkbox"
              checked={desktop.closeToTray}
              onChange={(e) => onDesktopPrefs({ closeToTray: e.target.checked })}
              className="accent-sky-500"
            />
            {t('desktopCloseToTray')}
          </label>
          <label className="mt-1 flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-2)]">
            <input
              type="checkbox"
              checked={desktop.shortcutEnabled}
              onChange={(e) => onDesktopPrefs({ shortcutEnabled: e.target.checked })}
              className="accent-sky-500"
            />
            <span>
              {t('desktopShortcut', {
                acc: acceleratorLabel(desktop.accelerator, desktop.platform === 'darwin'),
              })}
              {desktop.shortcutEnabled && !desktop.shortcutActive && (
                <span className="ml-1 text-[var(--due)]">{t('desktopShortcutBusy')}</span>
              )}
            </span>
          </label>
        </section>
      )}

      {/* 数据备份 */}
      <section>
        <SectionTitle>{t('dataTitle')}</SectionTitle>
        <div className="flex gap-1.5">
          <button
            onClick={() => void exportBackup()}
            className="flex-1 rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] px-2 py-1.5 text-xs"
          >
            {t('exportData')}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] px-2 py-1.5 text-xs"
          >
            {t('importData')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              try {
                const { written, skipped } = importBackupDetail(await file.text())
                if (skipped.length > 0) {
                  // Tulis sebagian: jangan reload (biar pengguna lihat
                  // pesannya), tampilkan key yang gagal.
                  setImportError(t('importPartial', { keys: skipped.join(', ') }))
                } else {
                  setImportError(t('importDone', { n: written }))
                  // Beri React satu frame untuk melukis pesan sebelum
                  // reload — di WebView native reload instan bisa
                  // memotong paint dan tampak seperti aplikasi mati.
                  setTimeout(() => location.reload(), 350)
                }
              } catch {
                setImportError(t('importFail'))
              }
              e.target.value = ''
            }}
          />
        </div>
        {importError && <p className="mt-1 text-[11px] text-[var(--danger)]">{importError}</p>}
        <button
          onClick={exportIcs}
          className="mt-2 w-full rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] px-2 py-1.5 text-xs"
        >
          {t('exportIcs')}
        </button>
        {icsDone && <p className="mt-1 text-[11px] text-[var(--ok)]">{icsDone}</p>}
        {canPrintSchedule() && (
          <button
            onClick={() => window.print()}
            className="mt-2 w-full rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] px-2 py-1.5 text-xs"
          >
            {t('printWeek')}
          </button>
        )}
        <button
          onClick={async () => {
            setShareMsg(null)
            setShareMsg(await onShareWeek())
          }}
          className="mt-2 w-full rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] px-2 py-1.5 text-xs"
          title={t('shareWeekHint')}
        >
          {t('shareWeek')}
        </button>
        {shareMsg && <p className="mt-1 text-[11px] text-[var(--text-2)]">{shareMsg}</p>}
        <p className="mt-1 text-[10px] text-[var(--text-3)]">{t('dataHint')}</p>
      </section>

      {/* 同步变更记录：每次同步到底改了什么 */}
      <section>
        <SectionTitle>{t('syncAuditTitle')}</SectionTitle>
        <SyncAuditPanel audits={audits} onClear={onClearAudits} />
      </section>

      {/* Lecture Translator */}
      <section>
        <SectionTitle>{t('translatorTitle')}</SectionTitle>
        <input
          defaultValue={translatorUrl}
          placeholder="http://localhost:8000"
          onBlur={(e) => {
            const u = e.target.value.trim().replace(/\/+$/, '')
            if (u && u !== translatorUrl) onTranslatorUrl(u)
          }}
          className="w-full rounded bg-[var(--surface-2)] border border-[var(--line)] px-2 py-1 text-[11px]"
        />
        <button
          onClick={onLinkTranslator}
          className="app-fill-ok mt-1.5 w-full rounded px-2 py-1 text-[11px]"
        >
          {t('translatorLinkNow')}
        </button>
        {translatorMsg && (
          <p className="mt-1 text-[11px] text-[var(--text-2)]">{translatorMsg}</p>
        )}
      </section>

      {/* 同步保护：tombstone / override 管理 */}
      <SyncProtection revision={syncMessage ?? ''} />

      {/* 身份数据诊断：各源课程数 / 覆盖率 / 最近同步。
          revision 组合两路信号：日历同步走 syncing/syncMessage（App），
          Moodle 域同步走 md.busy（useMoodleData 内部）——二者都会改身份
          表，任一变化都触发诊断重算。onResync 清 enrol 缓存后强制重取。 */}
      <IdentityDiagnostics
        sources={sources}
        revision={`${md.busy}|${syncing}|${syncMessage ?? ''}`}
        onResync={async () => {
          if (!md.token) return false
          clearEnrolledCoursesCache()
          await md.refreshGrades()
          return true
        }}
      />
    </>
  )
}
