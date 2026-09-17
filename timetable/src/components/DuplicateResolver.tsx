import { useMemo, useState } from 'react'
import { useExitAnimation } from '../lib/useExitAnimation'
import type { DupGroup } from '../lib/dedupe'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import Icon from './Icon'
import { formatDay, formatTime } from '../lib/date'

interface Props {
  groups: DupGroup[]
  onRemoveMany: (ids: string[]) => void
  onClose: () => void
}

/** Urutan preferensi default: manual > SISU > TimeEdit (manual dibuat user sendiri) */
function preference(l: Lesson): number {
  if (l.source === 'manual') return 0
  if (l.source === 'sisu') return 1
  return 2
}

// SISU/TimeEdit are proper nouns (same in both languages); manual must be
// localized, so it goes through i18n (t('srcManual')) inside the component.
const SOURCE_NAME: Record<Lesson['source'], string> = {
  sisu: 'SISU',
  timeedit: 'TimeEdit',
  manual: '',
}

export default function DuplicateResolver({
  groups,
  onRemoveMany,
  onClose,
}: Props) {
  const { t, locale } = useI18n()
  const sourceLabel = (s: Lesson['source']) =>
    s === 'manual' ? t('srcManual') : SOURCE_NAME[s]

  // pilihan awal: pelajaran dengan preferensi tertinggi per grup
  const initial = useMemo(() => {
    const m: Record<string, string> = {}
    for (const g of groups) {
      const best = [...g.lessons].sort(
        (a, b) => preference(a) - preference(b),
      )[0]
      m[g.key] = best.id
    }
    return m
  }, [groups])
  const [choices, setChoices] = useState(initial)
  const [keepAll, setKeepAll] = useState<Set<string>>(new Set())

  const removable = groups.reduce((n, g) => {
    if (keepAll.has(g.key)) return n
    const chosen = choices[g.key]
    return n + g.lessons.filter((l) => l.id !== chosen).length
  }, 0)

  // Semua jalur tutup lewat satu frame keluar.
  const [closing, requestClose] = useExitAnimation(onClose)

  const apply = () => {
    const ids: string[] = []
    for (const g of groups) {
      if (keepAll.has(g.key)) continue
      const chosen = choices[g.key]
      g.lessons.forEach((l) => {
        if (l.id !== chosen) ids.push(l.id)
      })
    }
    if (ids.length > 0) onRemoveMany(ids)
    requestClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') requestClose()
  }

  return (
    <div
      className={
        (closing ? 'animate-fade-out ' : 'animate-fade-in ') +
        'fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4'
      }
      onMouseDown={(e) => e.target === e.currentTarget && requestClose()}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div
        className={
          (closing ? 'animate-exit-down ' : 'animate-modal-in ') +
          'w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 shadow-2xl'
        }
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t('dupTitle')}</h3>
          <button
            onClick={requestClose}
            className="text-[var(--text-3)] hover:text-[var(--text-1)]"
            title={t('closeHint')}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-3)]">
          {t('dupIntro')}
        </p>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {groups.map((g) => (
            <div
              key={g.key}
              className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2"
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium">
                  {g.code ? `${g.code} ` : ''}
                  {g.title.length > 40 ? `${g.title.slice(0, 40)}…` : g.title}
                </span>
                <span className="text-[10px] text-[var(--text-3)]">
                  {formatDay(new Date(g.date), locale)}
                </span>
              </div>
              <div className="space-y-1">
                {g.lessons.map((l) => {
                  const checked = choices[g.key] === l.id
                  const disabled = keepAll.has(g.key)
                  return (
                    <label
                      key={l.id}
                      className={
                        'flex items-center gap-2 rounded px-1.5 py-1 text-[11px] ' +
                        (disabled ? 'opacity-50 ' : 'cursor-pointer hover:bg-[var(--surface-2)] ')
                      }
                    >
                      <input
                        type="radio"
                        name={g.key}
                        checked={checked}
                        disabled={disabled}
                        onChange={() =>
                          setChoices((prev) => ({ ...prev, [g.key]: l.id }))
                        }
                        className="accent-emerald-500"
                      />
                      <span className="text-[var(--text-2)]">
                        {sourceLabel(l.source)}
                      </span>
                      <span className="text-[var(--text-1)]">
                        {formatTime(l.start, locale)}–{formatTime(l.end, locale)}
                      </span>
                      {l.location && (
                        <span className="truncate text-[var(--text-3)]">{l.location}</span>
                      )}
                    </label>
                  )
                })}
              </div>
              <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-[10px] text-[var(--text-3)]">
                <input
                  type="checkbox"
                  checked={keepAll.has(g.key)}
                  onChange={(e) =>
                    setKeepAll((prev) => {
                      const n = new Set(prev)
                      if (e.target.checked) n.add(g.key)
                      else n.delete(g.key)
                      return n
                    })
                  }
                  className="accent-zinc-500"
                />
                {t('keepAll')}
              </label>
            </div>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={requestClose}
            className="flex-1 rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--hover-1)]"
          >
            {t('cancel')}
          </button>
          <button
            onClick={apply}
            disabled={removable === 0}
            className="app-fill-danger flex-[2] rounded-md px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {t('applyRemove', { n: removable })}
          </button>
        </div>
      </div>
    </div>
  )
}
