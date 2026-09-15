import { useRef, useState } from 'react'
import { useI18n } from '../i18n'
import Icon from './Icon'
import { loadLessons } from '../lib/store'
import { buildIcs } from '../lib/ics'
import { downloadBlob } from '../lib/download'
import { exportBackup, importBackup } from '../lib/backup'
import { TYPE_META } from '../lib/lessonTypes'
import { parseNoteKey, scopeText, type NotesMap } from '../lib/notes'
import { useTheme } from '../theme'

interface Props {
  translatorUrl: string
  onTranslatorUrl: (u: string) => void
  onLinkTranslator: () => void
  translatorMsg: string | null
  notes: NotesMap
  onRemoveNote: (key: string) => void
  onClose: () => void
}

export default function Settings({
  translatorUrl,
  onTranslatorUrl,
  onLinkTranslator,
  translatorMsg,
  notes,
  onRemoveNote,
  onClose,
}: Props) {
  const { t } = useI18n()
  const { theme, setTheme } = useTheme()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [icsDone, setIcsDone] = useState<string | null>(null)

  const exportIcs = async () => {
    const blob = new Blob([buildIcs(loadLessons())], {
      type: 'text/calendar;charset=utf-8',
    })
    await downloadBlob('lut-timetable.ics', blob)
    setIcsDone(t('exportIcsDone'))
  }

  const entries = Object.entries(notes).sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      tabIndex={-1}
    >
      <div className="animate-modal-in w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="inline-flex items-center gap-2 text-sm font-semibold"><Icon name="settings" size={15} /> {t('settingsTitle')}</h3>
          <button
            onClick={onClose}
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