import { useRef, useState } from 'react'
import { useI18n } from '../i18n'
import Icon from './Icon'
import { formatTime } from '../lib/date'
import { sourceFromUrl } from '../lib/store'
import { clearEnrolledCoursesCache } from '../lib/courses'
import { exportBackup, importBackupDetail } from '../lib/backup'
import SyncAuditPanel from './SyncAuditPanel'
import type { SyncAudit } from '../lib/syncAudit'
import { TYPE_META } from '../lib/lessonTypes'
import { parseNoteKey, scopeText, type NotesMap } from '../lib/notes'
import { useTheme } from '../theme'
import { THEME_PRESETS, type Preset } from '../lib/theme'
import type { Contrast, TextScale } from '../lib/uiPrefs'
import { acceleratorLabel, type DesktopPrefs, type DesktopState } from '../lib/desktop'
import type { Subscription } from '../lib/subscriptions'
import { useExitAnimation } from '../lib/useExitAnimation'
import { useMoodleData } from '../hooks/useMoodleData'
import { openExternal } from '../lib/openExternal'
import SyncProtection from './SyncProtection'
import IdentityDiagnostics from './IdentityDiagnostics'
import type { SyncSource } from '../types'

interface Props {
  sources: SyncSource[]
  syncing: boolean
  syncMessage: string | null
  autoSync: boolean
  onToggleAutoSync: (v: boolean) => void
  notifEnabled: boolean
  onToggleNotif: (v: boolean) => void
  digestEnabled: boolean
  onToggleDigest: (v: boolean) => void
  onAddSource: (s: SyncSource) => void
  onRemoveSource: (id: string) => void
  onSync: (s: SyncSource) => void
  translatorUrl: string
  onTranslatorUrl: (u: string) => void
  onLinkTranslator: () => void
  translatorMsg: string | null
  notes: NotesMap
  onRemoveNote: (key: string) => void
  /** 导出 .ics（App 提供：用可见课表而不是原始存储，单一入口在 lib/exportIcs） */
  onExportIcs: () => void
  /** 分享本周课表链接（返回给用户的提示语：已复制 / 已分享 / 太大） */
  onShareWeek: () => Promise<string>
  /** 订阅式提醒（课程变动 / 教室空出）：在这里可以静音或删除 */
  subscriptions: Subscription[]
  onToggleSubscription: (id: string) => void
  onRemoveSubscription: (id: string) => void
  /** 无障碍：字号档 / 对比度档 */
  textScale: TextScale
  contrast: Contrast
  onTextScale: (v: TextScale) => void
  onContrast: (v: Contrast) => void
  /** 本地错误条数（打开设置时刷新） */
  errorCount: number
  /** 导出诊断文本（返回给用户看的提示语） */
  onExportDiagnostics: () => Promise<string>
  onClearErrors: () => void
  /** 同步变更审计（lib/syncAudit） */
  audits: SyncAudit[]
  onClearAudits: () => void
  /** 桌面端（Electron）托盘 / 全局快捷键：浏览器与移动端为 null，整个分区隐藏 */
  desktop: DesktopState | null
  onDesktopPrefs: (patch: Partial<DesktopPrefs>) => void
  onClose: () => void
}

export default function Settings({
  sources,
  syncing,
  syncMessage,
  autoSync,
  onToggleAutoSync,
  notifEnabled,
  onToggleNotif,
  digestEnabled,
  onToggleDigest,
  onAddSource,
  onRemoveSource,
  onSync,
  translatorUrl,
  onTranslatorUrl,
  onLinkTranslator,
  translatorMsg,
  notes,
  onRemoveNote,
  onExportIcs,
  onShareWeek,
  subscriptions,
  onToggleSubscription,
  onRemoveSubscription,
  textScale,
  contrast,
  onTextScale,
  onContrast,
  errorCount,
  onExportDiagnostics,
  onClearErrors,
  audits,
  onClearAudits,
  desktop,
  onDesktopPrefs,
  onClose,
}: Props) {
  const { t, lang, setLang } = useI18n()
  const { theme, setTheme, preset, setPreset } = useTheme()
  const md = useMoodleData()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [icsDone, setIcsDone] = useState<string | null>(null)
  const [shareMsg, setShareMsg] = useState<string | null>(null)
  const [diagMsg, setDiagMsg] = useState<string | null>(null)

  // Semua jalur tutup (✕ / ESC / klik luar) lewat satu frame keluar.
  const [closing, requestClose] = useExitAnimation(onClose)

  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [moodleIcsInput, setMoodleIcsInput] = useState('')

  const exportIcs = () => {
    onExportIcs()
    setIcsDone(t('exportIcsDone'))
  }

  // URL → 来源的唯一解析器在 lib/store（首次引导共用同一份）；
  // 添加成功后由 App 立即同步一次，这里只收集输入 + 报错。
  const addSource = () => {
    const src = sourceFromUrl(sourceUrl)
    if (!src) {
      setSourceError(t('badUrl'))
      return
    }
    setSourceError(null)
    onAddSource(src)
    setSourceUrl('')
  }

  const entries = Object.entries(notes).sort((a, b) => a[0].localeCompare(b[0]))

  const inputCls =
    'w-full rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-xs focus:outline-none focus:border-[var(--info)]'

  return (
    <div
      className={
        (closing ? 'animate-fade-out ' : 'animate-fade-in ') +
        'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4'
      }
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
      onKeyDown={(e) => e.key === 'Escape' && requestClose()}
      tabIndex={-1}
    >
      <div
        className={
          (closing ? 'animate-exit-down ' : 'animate-modal-in ') +
          'w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 shadow-2xl'
        }
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold"><Icon name="settings" size={15} /> {t('settingsTitle')}</h3>
          <button
            onClick={requestClose}
            className="text-[var(--text-3)] hover:text-[var(--text-1)]"
            title={t('closeHint')}
          >
            <Icon name="close" size={13} />
          </button>
        </div>

        <div className="space-y-6 text-xs">
          {/* 外观：跟随系统 / 深色 / 浅色 */}
          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
              {t('themeTitle')}
            </h4>
            <div className="app-seg w-full">
              {(['system', 'dark', 'light'] as const).map((v) => (
                <button
                  key={v}
                  aria-pressed={theme === v}
                  onClick={() => setTheme(v)}
                  className="flex-1"
                >
                  {t(v === 'system' ? 'themeSystem' : v === 'dark' ? 'themeDark' : 'themeLight')}
                </button>
              ))}
            </div>
          </section>

          {/* 预设配色：Nord / Catppuccin / …，与深浅模式正交，全模块即时生效 */}
          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
              {t('presetTitle')}
            </h4>
            <div className="grid grid-cols-3 gap-2">
              {THEME_PRESETS.map((p) => (
                <button
                  key={p.id}
                  aria-pressed={preset === p.id}
                  onClick={() => setPreset(p.id as Preset)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2 transition-colors ${
                    preset === p.id
                      ? 'border-[var(--info)] bg-[var(--tint-info)]'
                      : 'border-[var(--line)] hover:bg-[var(--hover-1)]'
                  }`}
                  title={t('presetHint')}
                >
                  <span className="flex">
                    {p.swatch.map((c) => (
                      <span
                        key={c}
                        className="h-4 w-4 first:rounded-l-full last:rounded-r-full"
                        style={{ background: c }}
                      />
                    ))}
                  </span>
                  <span className="text-[10px] leading-none text-[var(--text-2)]">
                    {p.id === 'default' ? t('presetDefault') : p.name}
                  </span>
                </button>
              ))}
            </div>
          </section>

          {/* 无障碍：字号与对比度（存 uiPrefs，写在 <html> 上由 CSS 消费） */}
          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
              {t('a11yTitle')}
            </h4>
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-2)]">
              <input
                type="checkbox"
                checked={textScale === 'large'}
                onChange={(e) => onTextScale(e.target.checked ? 'large' : 'normal')}
                className="accent-sky-500"
              />
              {t('a11yLargeText')}
            </label>
            <label className="mt-1 flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-2)]">
              <input
                type="checkbox"
                checked={contrast === 'high'}
                onChange={(e) => onContrast(e.target.checked ? 'high' : 'normal')}
                className="accent-sky-500"
              />
              {t('a11yHighContrast')}
            </label>
          </section>

          {/* 桌面端：托盘与全局快捷键（只有 Electron 里有 lutDesktop 桥） */}
          {desktop && (
            <section>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                {t('desktopTitle')}
              </h4>
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

          {/* 语言 */}
          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
              {t('langTitle')}
            </h4>
            <div className="app-seg w-full">
              {(['zh', 'en'] as const).map((v) => (
                <button
                  key={v}
                  aria-pressed={lang === v}
                  onClick={() => setLang(v)}
                  className="flex-1"
                >
                  {v === 'zh' ? '中文' : 'English'}
                </button>
              ))}
            </div>
          </section>

          {/* 课程同步：源管理 + 开关 */}
          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
              {t('syncCalendar')}
            </h4>
            <textarea
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder={t('pasteUrl')}
              rows={2}
              className={inputCls + ' resize-none'}
            />
            {sourceError && <p className="mt-1 text-[11px] text-[var(--danger)]">{sourceError}</p>}
            <button onClick={addSource} className="mt-2 w-full rounded-md app-btn-primary px-2 py-1.5 text-xs font-medium">
              {t('addSource')}
            </button>
            <div className="mt-2 space-y-1.5">
              {sources.map((s) => (
                <div key={s.id} className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">
                      <span className={'mr-1 inline-block h-2 w-2 rounded-full align-middle ' + (s.type === 'sisu' ? 'bg-[var(--info)]' : 'bg-[var(--violet)]')} />
                      {s.type === 'sisu' ? 'SISU' : 'TimeEdit'} · <span className="text-[10px] font-normal text-[var(--text-3)]" title={s.url}>{s.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <button onClick={() => onSync(s)} disabled={syncing} className="rounded bg-[var(--surface-1)] px-2 py-0.5 text-[10px] hover:bg-[var(--hover-1)] disabled:opacity-50">
                        {t('syncNow')}
                      </button>
                      <button onClick={() => onRemoveSource(s.id)} className="text-[var(--text-3)] hover:text-[var(--danger)]" title={t('delete')}>
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-[var(--text-3)]">
                    {t('lessonsN', { n: s.count })}{s.lastSync ? ` · ${formatTime(s.lastSync)}` : ''}
                  </div>
                </div>
              ))}
              {sources.length === 0 && <p className="text-[11px] text-[var(--text-3)]">{t('sourceEmpty')}</p>}
              {syncMessage && <p className="text-[11px] text-[var(--text-2)]">{syncMessage}</p>}
            </div>
            <div className="mt-2 space-y-1">
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-2)]">
                <input type="checkbox" checked={autoSync} onChange={(e) => onToggleAutoSync(e.target.checked)} className="accent-sky-500" />
                {t('autoSyncHint')}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-2)]">
                <input type="checkbox" checked={notifEnabled} onChange={(e) => onToggleNotif(e.target.checked)} className="accent-sky-500" />
                {t('notifHint')}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-2)]">
                <input type="checkbox" checked={digestEnabled} onChange={(e) => onToggleDigest(e.target.checked)} className="accent-sky-500" />
                {t('digestToggle')}
              </label>
            </div>
          </section>

          {/* Moodle 连接：密钥 + ICS 兜底 */}
          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
              <span className="inline-flex items-center gap-1.5"><Icon name="assignment" size={12} /> {t('moodleTitle')}</span>
            </h4>
            <div className="space-y-2">
              {md.token ? (
                <div className="rounded-md border border-[var(--line-ok)] bg-[var(--tint-ok)] p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[var(--ok)]">✓ {t('gradesConnected')}</span>
                    <button onClick={md.disconnectToken} className="text-[10px] text-[var(--text-3)] hover:text-[var(--danger)]">
                      {t('moodleRemove')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[11px] leading-relaxed text-[var(--text-3)]">{t('gradesHint')}</p>
                  {/* SSO 浏览器登录：唯一支持 LUT SSO + Duo 双因素的主路径 */}
                  <button
                    onClick={() =>
                      md.loginWithSso((url) => {
                        // Android: openExternal 导航主帧被原生层拦截 → 系统浏览器；
                        // web/Electron: 打开新标签（Electron 由 external-links 转系统浏览器）。
                        openExternal(url)
                      })
                    }
                    disabled={md.ssoState === 'pending'}
                    className="app-btn-primary w-full px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    {md.ssoState === 'pending' ? t('ssoWaiting') : t('ssoLoginBtn')}
                  </button>
                  {(md.ssoMessage || md.message) && (
                    <p className="text-[10px] leading-relaxed text-[var(--text-2)]">{md.ssoMessage ?? md.message}</p>
                  )}
                  <input
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder={t('gradesTokenPh')}
                    className={inputCls}
                    autoComplete="off"
                  />
                  <button
                    onClick={() => void md.connectToken(tokenInput)}
                    disabled={md.busy !== 'idle' || !tokenInput.trim()}
                    className="w-full rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs hover:bg-[var(--hover-1)]"
                  >
                    {md.busy === 'grades' ? t('gradesFetching') : t('gradesConnect')}
                  </button>
                </div>
              )}

              {md.ics ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2">
                  <span className="min-w-0 truncate text-[10px] text-[var(--text-3)]" title={md.ics.url}>{md.ics.url}</span>
                  <button onClick={md.disconnectIcs} className="shrink-0 text-[10px] text-[var(--text-3)] hover:text-[var(--danger)]">
                    {t('moodleRemove')}
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-[var(--text-3)]">{t('moodleIcsLabel')}</p>
                  <input
                    value={moodleIcsInput}
                    onChange={(e) => setMoodleIcsInput(e.target.value)}
                    placeholder={t('moodleUrlPh')}
                    className={inputCls}
                  />
                  <button
                    onClick={() => { if (md.setIcsUrl(moodleIcsInput)) setMoodleIcsInput('') }}
                    className="w-full rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs hover:bg-[var(--hover-1)]"
                  >
                    {t('moodleConnect')}
                  </button>
                </div>
              )}

              <button onClick={() => void md.syncNow()} disabled={md.busy !== 'idle' || !md.connected} className="app-btn-primary w-full px-3 py-1.5 text-xs disabled:opacity-50">
                {md.busy === 'sync' ? t('moodleSyncing') : t('moodleSyncNow')}
              </button>
              {md.message && <p className="text-[11px] text-[var(--text-2)]">{md.message}</p>}
            </div>
          </section>

          {/* 数据备份 */}
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2">
              {t('dataTitle')}
            </h4>
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
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2">
              {t('syncAuditTitle')}
            </h4>
            <SyncAuditPanel audits={audits} onClear={onClearAudits} />
          </section>

          {/* Lecture Translator */}
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2">
              {t('translatorTitle')}
            </h4>
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

          {/* 订阅式提醒：本机判断、本机推送，这里只管列出与开关 */}
          <section>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
              <span className="inline-flex items-center gap-1.5"><Icon name="warn" size={12} /> {t('subsTitle')} ({subscriptions.length})</span>
            </h4>
            {subscriptions.length === 0 ? (
              <p className="text-[11px] text-[var(--text-3)]">{t('subsEmpty')}</p>
            ) : (
              <ul className="space-y-1.5">
                {subscriptions.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px]"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        onChange={() => onToggleSubscription(s.id)}
                        className="accent-sky-500"
                      />
                      <span className="min-w-0 truncate text-[var(--text-1)]" title={s.label}>
                        {s.label}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--text-3)]">
                        {t(s.kind === 'course-change' ? 'subKindCourse' : 'subKindRoom')}
                      </span>
                    </label>
                    <button
                      onClick={() => onRemoveSubscription(s.id)}
                      className="shrink-0 text-[var(--text-3)] hover:text-[var(--danger)]"
                      title={t('subsRemove')}
                      aria-label={t('subsRemove')}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 错误日志：本机最近几次异常 + 导出诊断（不能自动上报，用户手动发） */}
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2">
              <span className="inline-flex items-center gap-1.5"><Icon name="warn" size={12} /> {t('errorsTitle')} ({errorCount})</span>
            </h4>
            <p className="text-[11px] text-[var(--text-3)]">{t('errorsHint')}</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={async () => {
                  setDiagMsg(null)
                  setDiagMsg(await onExportDiagnostics())
                }}
                className="flex-1 rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] px-2 py-1.5 text-xs"
              >
                {t('errorsExport')}
              </button>
              {errorCount > 0 && (
                <button
                  onClick={() => {
                    onClearErrors()
                    setDiagMsg(t('errorsCleared'))
                  }}
                  className="shrink-0 rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] px-2 py-1.5 text-xs text-[var(--text-2)]"
                >
                  {t('errorsClear')}
                </button>
              )}
            </div>
            {diagMsg && <p className="mt-1 text-[11px] text-[var(--text-2)]">{diagMsg}</p>}
          </section>

          {/* 课程备注 */}
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)] mb-2">
              <span className="inline-flex items-center gap-1.5"><Icon name="note" size={12} /> {t('notesTitle')} ({entries.length})</span>
            </h4>
            {entries.length === 0 ? (
              <p className="text-[11px] text-[var(--text-3)]">{t('notesEmpty')}</p>
            ) : (
              <ul className="space-y-1.5">
                {entries.map(([key, n]) => {
                  const parts = parseNoteKey(key)
                  const typeLabel =
                    parts.type && TYPE_META[parts.type]
                      ? t(TYPE_META[parts.type].key)
                      : t('noteScopeAny')
                  return (
                    <li
                      key={key}
                      className="flex items-start gap-2 rounded-md border border-[var(--line-due)] bg-[var(--tint-due)] px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[11px] font-medium text-[var(--due)]">
                          {scopeText(parts.code, typeLabel)}
                        </div>
                        <div
                          className="mt-0.5 line-clamp-2 text-[11px] text-[var(--due)]"
                          title={n.note}
                        >
                          {n.note}
                        </div>
                      </div>
                      <button
                        onClick={() => onRemoveNote(key)}
                        className="shrink-0 text-[var(--text-3)] hover:text-[var(--danger)]"
                        title={t('noteRemove')}
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-1.5 text-[10px] text-[var(--text-3)]">{t('notesHint')}</p>
          </section>
        </div>
      </div>
    </div>
  )
}
