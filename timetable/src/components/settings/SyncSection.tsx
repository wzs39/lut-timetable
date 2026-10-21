import { useState } from 'react'
import { useI18n } from '../../i18n'
import Icon from '../Icon'
import { formatTime } from '../../lib/date'
import { sourceFromUrl } from '../../lib/store'
import { openExternal } from '../../lib/openExternal'
import { useMoodleData } from '../../hooks/useMoodleData'
import type { SyncSource } from '../../types'
import { inputCls } from './tokens'
import { SectionTitle } from './shared'

/**
 * 同步与连接：日历源管理 + 三个自动同步开关 + Moodle 连接（密钥 / ICS 兜底）。
 *
 * URL 解析仍走 `lib/store.sourceFromUrl`（与首次引导共用）；添加成功后由 App
 * 立刻同步一次，所以这里只收集输入与报错。
 */
export default function SyncSection({
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
}: {
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
}) {
  const { t } = useI18n()
  const md = useMoodleData()
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [moodleIcsInput, setMoodleIcsInput] = useState('')

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

  return (
    <>
      {/* 课程同步：源管理 + 开关 */}
      <section>
        <SectionTitle>{t('syncCalendar')}</SectionTitle>
        <textarea
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder={t('pasteUrl')}
          rows={2}
          className={inputCls + ' resize-none'}
        />
        {sourceError && <p className="mt-1 text-[11px] text-[var(--danger)]">{sourceError}</p>}
        <button
          onClick={addSource}
          className="mt-2 w-full rounded-md app-btn-primary px-2 py-1.5 text-xs font-medium"
        >
          {t('addSource')}
        </button>
        <div className="mt-2 space-y-1.5">
          {sources.map((s) => (
            <div
              key={s.id}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className="min-w-0 truncate font-medium"
                  title={`${s.type === 'sisu' ? 'SISU' : 'TimeEdit'} · ${s.label}`}
                >
                  <span
                    className={
                      'mr-1 inline-block h-2 w-2 rounded-full align-middle ' +
                      (s.type === 'sisu' ? 'bg-[var(--info)]' : 'bg-[var(--violet)]')
                    }
                  />
                  {s.type === 'sisu' ? 'SISU' : 'TimeEdit'} ·{' '}
                  <span className="text-[10px] font-normal text-[var(--text-3)]">{s.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => onSync(s)}
                    disabled={syncing}
                    className="rounded bg-[var(--surface-1)] px-2 py-0.5 text-[10px] hover:bg-[var(--hover-1)] disabled:opacity-50"
                  >
                    {t('syncNow')}
                  </button>
                  <button
                    onClick={() => onRemoveSource(s.id)}
                    className="text-[var(--text-3)] hover:text-[var(--danger)]"
                    title={t('delete')}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </span>
              </div>
              <div className="mt-0.5 text-[10px] text-[var(--text-3)]">
                {t('lessonsN', { n: s.count })}
                {s.lastSync ? ` · ${formatTime(s.lastSync)}` : ''}
              </div>
            </div>
          ))}
          {sources.length === 0 && (
            <p className="text-[11px] text-[var(--text-3)]">{t('sourceEmpty')}</p>
          )}
          {syncMessage && <p className="text-[11px] text-[var(--text-2)]">{syncMessage}</p>}
        </div>
        <div className="mt-2 space-y-1">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-2)]">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={(e) => onToggleAutoSync(e.target.checked)}
              className="accent-sky-500"
            />
            {t('autoSyncHint')}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-2)]">
            <input
              type="checkbox"
              checked={notifEnabled}
              onChange={(e) => onToggleNotif(e.target.checked)}
              className="accent-sky-500"
            />
            {t('notifHint')}
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[var(--text-2)]">
            <input
              type="checkbox"
              checked={digestEnabled}
              onChange={(e) => onToggleDigest(e.target.checked)}
              className="accent-sky-500"
            />
            {t('digestToggle')}
          </label>
        </div>
      </section>

      {/* Moodle 连接：密钥 + ICS 兜底 */}
      <section>
        <SectionTitle>
          <span className="inline-flex items-center gap-1.5">
            <Icon name="assignment" size={12} /> {t('moodleTitle')}
          </span>
        </SectionTitle>
        <div className="space-y-2">
          {md.token ? (
            <div className="rounded-md border border-[var(--line-ok)] bg-[var(--tint-ok)] p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-[var(--ok)]">✓ {t('gradesConnected')}</span>
                <button
                  onClick={md.disconnectToken}
                  className="text-[10px] text-[var(--text-3)] hover:text-[var(--danger)]"
                >
                  {t('moodleRemove')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[11px] leading-relaxed text-[var(--text-3)]">{t('gradesHint')}</p>
              {/* Browser SSO only works where a native/Electron return bridge is available. */}
              {md.ssoAvailable && (
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
              )}
              {(md.ssoMessage || md.message) && (
                <p className="text-[10px] leading-relaxed text-[var(--text-2)]">
                  {md.ssoMessage ?? md.message}
                </p>
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
              <span className="min-w-0 truncate text-[10px] text-[var(--text-3)]" title={md.ics.url}>
                {md.ics.url}
              </span>
              <button
                onClick={md.disconnectIcs}
                className="shrink-0 text-[10px] text-[var(--text-3)] hover:text-[var(--danger)]"
              >
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
                onClick={() => {
                  if (md.setIcsUrl(moodleIcsInput)) setMoodleIcsInput('')
                }}
                className="w-full rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs hover:bg-[var(--hover-1)]"
              >
                {t('moodleConnect')}
              </button>
            </div>
          )}

          <button
            onClick={() => void md.syncNow()}
            disabled={md.busy !== 'idle' || !md.connected}
            className="app-btn-primary w-full px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {md.busy === 'sync' ? t('moodleSyncing') : t('moodleSyncNow')}
          </button>
          {md.message && <p className="text-[11px] text-[var(--text-2)]">{md.message}</p>}
        </div>
      </section>
    </>
  )
}
