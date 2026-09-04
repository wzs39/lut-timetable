import { useEffect, useMemo, useState } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { formatTime } from '../lib/date'
import { courseColor } from '../lib/colors'
import {
  loadPresets,
  addPreset,
  removePreset,
  type FilterPreset,
} from '../lib/filterPresets'
import { TYPE_META } from '../lib/lessonTypes'
import { SOURCE_ICON } from '../lib/sources'
import { displayTitle } from '../lib/display'

interface Props {
  lessons: Lesson[]
  onRemoveMany: (ids: string[]) => void
  /** Sembunyikan tanpa menghapus — bisa dibuka lagi dari header */
  onHideMany: (ids: string[]) => void
  onClose: () => void
}

const ALL_SOURCES: Lesson['source'][] = ['sisu', 'timeedit', 'manual']
const ALL_TYPES: NonNullable<Lesson['type']>[] = [
  'lecture',
  'exercise',
  'tutorial',
  'seminar',
  'lab',
  'exam',
  'workshop',
]
const DAY_ZH = ['一', '二', '三', '四', '五', '六', '日']
const DAY_EN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']


/**
 * 批量筛选 + 删除：按文本 / 日期范围 / 星期 / 来源过滤课程，
 * 勾选后批量删除（同步来源自动记入墓碑，不会被重新导入）。
 */
export default function BatchFilter({
  lessons,
  onRemoveMany,
  onHideMany,
  onClose,
}: Props) {
  const { t, lang } = useI18n()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
  const DAYS = lang === 'zh' ? DAY_ZH : DAY_EN

  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [days, setDays] = useState<number[]>([])
  const [sources, setSources] = useState<Set<Lesson['source']>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<'time' | 'name' | 'source'>('time')
  const [typeFilter, setTypeFilter] = useState<Set<NonNullable<Lesson['type']>>>(new Set())
  const [presets, setPresets] = useState<FilterPreset[]>(() => loadPresets())

  const matched = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity
    return lessons
      .filter((l) => {
        if (kw) {
          const hay = `${l.code || ''} ${l.title}`.toLowerCase()
          if (!hay.includes(kw)) return false
        }
        const st = new Date(l.start).getTime()
        if (st < fromMs || st > toMs) return false
        if (days.length > 0 && !days.includes((new Date(l.start).getDay() + 6) % 7))
          return false
        if (sources.size > 0 && !sources.has(l.source)) return false
        if (typeFilter.size > 0 && (!l.type || !typeFilter.has(l.type)))
          return false
        return true
      })
      .sort((a, b) => {
        if (sort === 'name')
          return (
            (a.code || a.title).localeCompare(b.code || b.title) ||
            a.start.localeCompare(b.start)
          )
        if (sort === 'source')
          return (
            a.source.localeCompare(b.source) || a.start.localeCompare(b.start)
          )
        return a.start.localeCompare(b.start)
      })
  }, [lessons, q, from, to, days, sources, typeFilter, sort])

  // 筛选条件变化后：默认全选匹配结果
  const matchedKey = matched.map((l) => l.id).join(',')
  useEffect(() => {
    setSelected(new Set(matchedKey ? matchedKey.split(',') : []))
  }, [matchedKey])

  const toggleDay = (d: number) =>
    setDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort(),
    )

  const toggleSource = (s: Lesson['source']) =>
    setSources((prev) => {
      const n = new Set(prev)
      if (n.has(s)) n.delete(s)
      else n.add(s)
      return n
    })

  const toggleType = (ty: NonNullable<Lesson['type']>) =>
    setTypeFilter((prev) => {
      const n = new Set(prev)
      if (n.has(ty)) n.delete(ty)
      else n.add(ty)
      return n
    })

  const hasFilters =
    q.trim() || from || to || days.length > 0 || sources.size > 0 || typeFilter.size > 0
  const reset = () => {
    setQ('')
    setFrom('')
    setTo('')
    setDays([])
    setSources(new Set())
    setTypeFilter(new Set())
  }

  /** 当前筛选状态是否与某个预设一致（高亮用） */
  const activePresetId = useMemo(() => {
    const srcArr = [...sources].sort()
    return presets.find(
      (p) =>
        p.q === q &&
        p.from === from &&
        p.to === to &&
        p.sort === sort &&
        p.days.length === days.length &&
        p.days.every((d) => days.includes(d)) &&
        p.sources.length === srcArr.length &&
        p.sources.every((s) => srcArr.includes(s)) &&
        (p.types ?? []).length === typeFilter.size &&
        (p.types ?? []).every((ty) => typeFilter.has(ty)),
    )?.id
  }, [presets, q, from, to, days, sources, typeFilter, sort])

  const applyPreset = (p: FilterPreset) => {
    setQ(p.q)
    setFrom(p.from)
    setTo(p.to)
    setDays([...p.days].sort())
    setSources(new Set(p.sources))
    setTypeFilter(new Set(p.types ?? []))
    setSort(p.sort)
  }

  const saveCurrent = () => {
    const name = prompt(t('presetNamePrompt'), hasFilters ? '' : t('presetDefaultName'))
    if (name == null) return
    const trimmed = name.trim() || t('presetDefaultName')
    setPresets(
      addPreset({
        name: trimmed,
        q,
        from,
        to,
        days: [...days],
        sources: [...sources],
        types: [...typeFilter],
        sort,
      }),
    )
  }

  const applyDelete = () => {
    if (selected.size === 0) return
    if (confirm(t('batchDeleteConfirm', { n: selected.size }))) {
      onRemoveMany([...selected])
      onClose()
    }
  }

  const applyHide = () => {
    if (selected.size === 0) return
    onHideMany([...selected])
    onClose()
  }

  const inputCls =
    'rounded-md bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs focus:outline-none focus:border-sky-500'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      tabIndex={-1}
    >
      <div className="flex w-full max-w-lg flex-col rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl max-h-[85vh]">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t('batchTitle')}</h3>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            title={t('closeHint')}
          >
            ✕
          </button>
        </div>

        {/* 预设 */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            {t('presetsLabel')}
          </span>
          {presets.map((p) => (
            <span
              key={p.id}
              className={
                'group flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ' +
                (p.id === activePresetId
                  ? 'border-sky-500 bg-sky-600/30 text-sky-200'
                  : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:border-zinc-600')
              }
            >
              <button onClick={() => applyPreset(p)} title={`${p.q} ${p.from}${p.to ? '→' + p.to : ''}`}>
                {p.name}
              </button>
              <button
                onClick={() => setPresets(removePreset(p.id))}
                className="text-zinc-500 hover:text-rose-400"
                title={t('presetDelete')}
              >
                ✕
              </button>
            </span>
          ))}
          <button
            onClick={saveCurrent}
            className="rounded-full border border-dashed border-zinc-600 px-2 py-0.5 text-[11px] text-zinc-400 hover:border-sky-500 hover:text-sky-300"
          >
            ＋ {t('presetSave')}
          </button>
        </div>

        {/* 筛选条件 */}
        <div className="space-y-2 rounded-md border border-zinc-800 bg-zinc-800/40 p-2.5">
          <div className="flex gap-1.5">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('batchTextPh')}
              autoFocus
              className={`flex-1 ${inputCls}`}
            />
            {hasFilters && (
              <button
                onClick={reset}
                className="rounded-md bg-zinc-700 hover:bg-zinc-600 px-2 text-[11px] text-zinc-300"
              >
                {t('batchReset')}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={`w-1/2 ${inputCls}`}
            />
            <span>→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={`w-1/2 ${inputCls}`}
            />
          </div>
          <div className="flex gap-1">
            {DAYS.map((label, d) => (
              <button
                key={d}
                onClick={() => toggleDay(d)}
                className={
                  'flex-1 rounded-md py-1 text-[11px] border ' +
                  (days.includes(d)
                    ? 'bg-sky-600/80 border-sky-500 text-white'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600')
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {ALL_SOURCES.map((s) => (
              <button
                key={s}
                onClick={() => toggleSource(s)}
                className={
                  'flex-1 rounded-md py-1 text-[11px] border ' +
                  (sources.has(s)
                    ? 'bg-sky-600/80 border-sky-500 text-white'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600')
                }
              >
                {SOURCE_ICON[s]}{' '}
                {s === 'sisu' ? 'SISU' : s === 'timeedit' ? 'TimeEdit' : t('srcManual')}
              </button>
            ))}
          </div>
          {/* 课程类型多选 */}
          <div className="flex flex-wrap gap-1">
            {ALL_TYPES.map((ty) => (
              <button
                key={ty}
                onClick={() => toggleType(ty)}
                className={
                  'rounded-md py-1 px-2 text-[11px] border ' +
                  (typeFilter.has(ty)
                    ? 'bg-violet-600/80 border-violet-500 text-white'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-500 hover:border-zinc-600')
                }
              >
                {TYPE_META[ty].icon} {t(TYPE_META[ty].key)}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-400">
              {t('batchMatched', { n: matched.length })}
            </span>
            <label className="flex items-center gap-1 text-zinc-500">
              {t('batchSort')}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="rounded bg-zinc-800 border border-zinc-700 px-1 py-0.5 text-[11px] focus:outline-none"
              >
                <option value="time">{t('batchSortTime')}</option>
                <option value="name">{t('batchSortName')}</option>
                <option value="source">{t('batchSortSource')}</option>
              </select>
            </label>
            <span className="flex gap-2">
              <button
                onClick={() => setSelected(new Set(matched.map((l) => l.id)))}
                className="text-sky-400 hover:text-sky-300"
              >
                {t('selectAll')}
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="text-zinc-500 hover:text-zinc-300"
              >
                {t('clearSel')}
              </button>
            </span>
          </div>
        </div>

        {/* 结果列表 */}
        <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {matched.length === 0 ? (
            <p className="py-8 text-center text-xs text-zinc-600">
              {t('batchEmpty')}
            </p>
          ) : (
            matched.map((l) => {
              const c = courseColor(l)
              const checked = selected.has(l.id)
              return (
                <label
                  key={l.id}
                  className={
                    'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-[11px] ' +
                    (checked ? '' : 'opacity-50')
                  }
                  style={{ background: c.bg, borderColor: c.border }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() =>
                      setSelected((prev) => {
                        const n = new Set(prev)
                        if (n.has(l.id)) n.delete(l.id)
                        else n.add(l.id)
                        return n
                      })
                    }
                    className="accent-sky-500"
                  />
                  <span className="w-24 shrink-0 font-mono text-zinc-300">
                    {formatTime(l.start, locale)}–{formatTime(l.end, locale)}
                  </span>
                  <span className="min-w-0 flex-1 truncate" style={{ color: c.text }}>
                    {SOURCE_ICON[l.source]}{' '}
                    {l.code ? `${l.code} · ` : ''}
                    {l.type && TYPE_META[l.type] && (
                      <span title={t(TYPE_META[l.type].key)}>
                        {TYPE_META[l.type].icon}
                      </span>
                    )}
                    {displayTitle(l)}
                  </span>
                  <span className="shrink-0 text-zinc-500">
                    {new Date(l.start).toLocaleDateString(locale, {
                      month: 'numeric',
                      day: 'numeric',
                    })}
                    {' '}
                    {DAYS[(new Date(l.start).getDay() + 6) % 7]}
                  </span>
                </label>
              )
            })
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium hover:bg-zinc-600"
          >
            {t('cancel')}
          </button>
          <button
            onClick={applyHide}
            disabled={selected.size === 0}
            title={t('batchHideHint')}
            className="flex-1 rounded-md bg-amber-600/90 px-3 py-1.5 text-xs font-medium hover:bg-amber-500 disabled:opacity-50"
          >
            🙈 {t('batchHide', { n: selected.size })}
          </button>
          <button
            onClick={applyDelete}
            disabled={selected.size === 0}
            className="flex-1 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium hover:bg-rose-500 disabled:opacity-50"
          >
            {t('batchDelete', { n: selected.size })}
          </button>
        </div>
      </div>
    </div>
  )
}
