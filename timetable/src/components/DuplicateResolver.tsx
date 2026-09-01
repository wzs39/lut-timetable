import { useMemo, useState } from 'react'
import type { DupGroup } from '../lib/dedupe'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
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
  const { t, lang } = useI18n()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
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
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t('dupTitle')}</h3>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            title={t('closeHint')}
          >
            ✕
          </button>
        </div>
        <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
          {t('dupIntro')}
        </p>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {groups.map((g) => (
            <div
              key={g.key}
              className="rounded-md border border-zinc-700 bg-zinc-800/50 p-2"
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium">
                  {g.code ? `${g.code} ` : ''}
                  {g.title.length > 40 ? `${g.title.slice(0, 40)}…` : g.title}
                </span>
                <span className="text-[10px] text-zinc-500">
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
                        (disabled ? 'opacity-50 ' : 'cursor-pointer hover:bg-zinc-700/50 ')
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
                      <span className="text-zinc-400">
                        {sourceLabel(l.source)}
                      </span>
                      <span className="text-zinc-200">
                        {formatTime(l.start, locale)}–{formatTime(l.end, locale)}
                      </span>
                      {l.location && (
                        <span className="truncate text-zinc-500">{l.location}</span>
                      )}
                    </label>
                  )
                })}
              </div>
              <label className="mt-1 flex cursor-pointer items-center gap-1.5 text-[10px] text-zinc-500">
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
            onClick={onClose}
            className="flex-1 rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
          >
            {t('cancel')}
          </button>
          <button
            onClick={apply}
            disabled={removable === 0}
            className="flex-[2] rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium hover:bg-rose-500 disabled:opacity-50"
          >
            {t('applyRemove', { n: removable })}
          </button>
        </div>
      </div>
    </div>
  )
}
