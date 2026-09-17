import { useRef, useState } from 'react'
import { useI18n } from '../i18n'
import Icon from './Icon'
import { loadLessons, normalizeSisuUrl, normalizeTimeEditUrl } from '../lib/store'
import { buildIcs } from '../lib/ics'
import { downloadBlob } from '../lib/download'
import { exportBackup, importBackup } from '../lib/backup'
import { TYPE_META } from '../lib/lessonTypes'
import { parseNoteKey, scopeText, type NotesMap } from '../lib/notes'
import { useTheme } from '../theme'
import { useExitAnimation } from '../lib/useExitAnimation'
import { useMoodleData } from '../hooks/useMoodleData'
import SyncProtection from './SyncProtection'
import type { SyncSource } from '../types'

interface Props {
  sources: SyncSource[]
  syncing: boolean
  syncMessage: string | null
  autoSync: boolean
  onToggleAutoSync: (v: boolean) => void
  notifEnabled: boolean
  onToggleNotif: (v: boolean) => void
  onAddSource: (s: SyncSource) => void
  onRemoveSource: (id: string) => void
  onSync: (s: SyncSource) => void
  translatorUrl: string
  onTranslatorUrl: (u: string) => void
  onLinkTranslator: () => void
  translatorMsg: string | null
  notes: NotesMap
  onRemoveNote: (key: string) => void
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
  onAddSource,
  onRemoveSource,
  onSync,
  translatorUrl,
  onTranslatorUrl,
  onLinkTranslator,
  translatorMsg,
  notes,
  onRemoveNote,
  onClose,
}: Props) {
  const { t, lang, setLang } = useI18n()
  const { theme, setTheme } = useTheme()
  const md = useMoodleData()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [icsDone, setIcsDone] = useState<string | null>(null)

  // Semua jalur tutup (✕ / ESC / klik luar) lewat satu frame keluar.
  const [closing, requestClose] = useExitAnimation(onClose)

  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [moodleIcsInput, setMoodleIcsInput] = useState('')

  const exportIcs = async () => {
    const blob = new Blob([buildIcs(loadLessons())], {
      type: 'text/calendar;charset=utf-8',
    })
    await downloadBlob('lut-timetable.ics', blob)
    setIcsDone(t('exportIcsDone'))
  }

  const addSource = () => {
    const raw = sourceUrl.trim()
    if (!raw) return
    const sisu = normalizeSisuUrl(raw)
    const timeedit = sisu ? null : normalizeTimeEditUrl(raw)
    const icsUrl = sisu || timeedit
    if (!icsUrl) {
      setSourceError(t('badUrl'))
      return
    }
    setSourceError(null)
    const type = sisu ? 'sisu' : 'timeedit'
    onAddSource({
      id: crypto.randomUUID(),
      type,
      url: raw,
      icsUrl,
      label: type === 'sisu' ? 'SISU calendar-share' : 'TimeEdit',
      count: 0,
    })
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
                    {t('lessonsN', { n: s.count })}{s.lastSync ? ` · ${new Date(s.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
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
                    className="app-btn-primary w-full px-3 py-1.5 text-xs disabled:opacity-50"
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
                    importBackup(await file.text())
                    location.reload()
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
            <p className="mt-1 text-[10px] text-[var(--text-3)]">{t('dataHint')}</p>
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
