import { useEffect, useMemo, useRef, useState } from 'react'
import type { Lesson } from '../types'
import { addDays, sameDay, startOfWeek, formatTime, formatDay } from '../lib/date'
import { useI18n } from '../i18n'
import { courseColor } from '../lib/colors'
import {
  layoutDay,
  conflictGroupsOf,
  type PlacedLesson,
  type ConflictGroup,
} from '../lib/layout'
import { TYPE_META } from '../lib/lessonTypes'
import { displayTitle } from '../lib/display'

const START_HOUR = 8
const END_HOUR = 20
const HOUR_PX = 56
/** Tinggi header hari (text-xs + py-1.5) — garis "sekarang" harus melewatinya */
const DAY_HEADER_PX = 28

interface Props {
  lessons: Lesson[]
  weekStart: Date
  onSelect: (id: string) => void
}

const LS_DISMISS = 'tt_conflict_dismissed'

/** ≥768px = tampilan grid penuh; di bawahnya pakai tampilan per-hari */
function useIsWideScreen(): boolean {
  const [wide, setWide] = useState(
    () => window.matchMedia('(min-width: 768px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const fn = (e: MediaQueryListEvent) => setWide(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  return wide
}

export default function WeekGrid({ lessons, weekStart, onSelect }: Props) {
  const { lang, t } = useI18n()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
  const isWide = useIsWideScreen()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => new Date())

  // Perbarui posisi garis "sekarang" tiap 30 detik
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(timer)
  }, [])

  // Auto-scroll ke jam sekarang saat pertama dibuka
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nowH = now.getHours() + now.getMinutes() / 60
    el.scrollTop = Math.max(0, (nowH - START_HOUR) * HOUR_PX - HOUR_PX * 1.5)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )
  const hours = useMemo(
    () => Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i),
    [],
  )

  const isCurrentWeek = useMemo(
    () => sameDay(startOfWeek(now), weekStart),
    [now, weekStart],
  )
  const nowH = now.getHours() + now.getMinutes() / 60
  // offset header hari agar garis sejajar persis dengan grid jam
  const nowTop = DAY_HEADER_PX + (nowH - START_HOUR) * HOUR_PX
  const showNowLine = isCurrentWeek && nowH >= START_HOUR && nowH <= END_HOUR
  const todayIndex = (now.getDay() + 6) % 7

  // Konflik yang diabaikan pengguna (per collision group; muncul lagi jika
  // data berubah sehingga clusterKey-nya baru)
  const [dismissed, setDismissed] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem(LS_DISMISS) || '[]')),
  )
  useEffect(() => {
    localStorage.setItem(LS_DISMISS, JSON.stringify([...dismissed]))
  }, [dismissed])

  /** Abaikan SATU collision group (semua permukaan memakai ini) */
  const dismissKey = (key: string) =>
    setDismissed((prev) => new Set([...prev, key]))

  const dateKeyOf = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  // Satu-satunya pemanggil layoutDay: hasil per hari dipakai grid desktop DAN
  // daftar mobile (tidak ada perhitungan duplikat), lengkap dengan aggregasi
  // collision group dari lib/layout.
  const byDay = useMemo(() => {
    const map = new Map<
      number,
      { placed: PlacedLesson[]; groups: ConflictGroup[] }
    >()
    weekDays.forEach((d, i) => {
      const placed = layoutDay(
        lessons.filter((l) => sameDay(new Date(l.start), d)),
        dateKeyOf(d),
      )
      map.set(i, { placed, groups: conflictGroupsOf(placed) })
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessons, weekDays])

  const shownGroupsOf = (i: number) =>
    (byDay.get(i)?.groups || []).filter((g) => !dismissed.has(g.key))
  const hiddenGroupsOf = (i: number) =>
    (byDay.get(i)?.groups || []).filter((g) => dismissed.has(g.key))

  /** Pulihkan semua group yang diabaikan pada satu hari */
  const restoreDay = (i: number) => {
    const keys = hiddenGroupsOf(i).map((g) => g.key)
    if (keys.length === 0) return
    setDismissed((prev) => {
      const next = new Set(prev)
      keys.forEach((k) => next.delete(k))
      return next
    })
  }

  /** Single owner of "this cluster is still shown as a conflict" */
  const shownConflict = (p: PlacedLesson) =>
    p.conflict && !dismissed.has(p.clusterKey)

  // ---- Tampilan mobile (<768px): satu hari penuh, tab pilih hari ----
  const [mobileDay, setMobileDay] = useState(() =>
    sameDay(startOfWeek(now), weekStart) ? (now.getDay() + 6) % 7 : 0,
  )
  useEffect(() => {
    setMobileDay(
      sameDay(startOfWeek(new Date()), weekStart)
        ? (new Date().getDay() + 6) % 7
        : 0,
    )
  }, [weekStart])

  // Urutan visual hari mobile: group yang masih tampil menjadi satu kontainer;
  // pelajaran biasa / group yang sudah diabaikan menjadi kartu tunggal.
  const mobileSegments = useMemo(() => {
    const info = byDay.get(mobileDay)
    if (!info) return []
    const { placed, groups } = info
    const shownKeys = new Set(
      groups.filter((g) => !dismissed.has(g.key)).map((g) => g.key),
    )
    const byKey = new Map(groups.map((g) => [g.key, g]))
    const out: { key: string; g?: ConflictGroup; p?: PlacedLesson }[] = []
    const emitted = new Set<string>()
    for (const p of placed) {
      if (p.conflict && shownKeys.has(p.clusterKey)) {
        if (!emitted.has(p.clusterKey)) {
          emitted.add(p.clusterKey)
          out.push({ key: p.clusterKey, g: byKey.get(p.clusterKey) })
        }
      } else {
        out.push({ key: p.lesson.id, p })
      }
    }
    return out
  }, [byDay, mobileDay, dismissed])

  // Baris info minggu ("本周 N 处冲突 · 周二 周四") — display only
  const weekStrip = useMemo(() => {
    let n = 0
    const days: string[] = []
    weekDays.forEach((d, i) => {
      const shown = shownGroupsOf(i)
      if (shown.length > 0) {
        n += shown.length
        days.push(d.toLocaleDateString(locale, { weekday: 'short' }))
      }
    })
    return n > 0
      ? t('weekStrip', {
          tag: isCurrentWeek ? t('thisWeek') : t('thatWeek'),
          n,
          days: days.join(' '),
        })
      : null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDay, weekDays, dismissed, lang, isCurrentWeek])

  const lessonCard = (l: Lesson) => {
    const cc = courseColor(l)
    return (
      <button
        key={l.id}
        onClick={() => onSelect(l.id)}
        className="w-full rounded-lg border px-3 py-2 text-left text-xs"
        style={{ background: cc.bg, borderColor: cc.border }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold" style={{ color: cc.text }}>
            {l.code || displayTitle(l)}
            {l.type && TYPE_META[l.type] && (
              <span
                className="ml-1 opacity-90"
                title={t(TYPE_META[l.type].key)}
              >
                {TYPE_META[l.type].icon}
              </span>
            )}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-zinc-300">
            {formatTime(l.start, locale)}–{formatTime(l.end, locale)}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[11px] text-zinc-400">
          {displayTitle(l)}
        </div>
        {l.location && (
          <div className="mt-0.5 truncate text-[10px] text-zinc-500">
            📍 {l.location}
          </div>
        )}
      </button>
    )
  }

  const groupBox = (g: ConflictGroup) => (
    <div
      key={g.key}
      className="rounded-lg border border-amber-400/70 bg-amber-400/10 px-2 py-2"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2 text-[10px] font-medium text-amber-300">
        <span>⚠ {t('conflictSameTimeN', { n: g.lessons.length })}</span>
        <button
          className="shrink-0 underline decoration-dotted opacity-80"
          onClick={() => dismissKey(g.key)}
        >
          {t('dismissHint')}
        </button>
      </div>
      <div className="space-y-2">
        {g.lessons.map((pl) => lessonCard(pl.lesson))}
      </div>
    </div>
  )

  if (!isWide) {
    const placed = byDay.get(mobileDay)?.placed || []
    const hiddenToday = hiddenGroupsOf(mobileDay)
    return (
      <div className="flex-1 flex flex-col min-h-0">
        {weekStrip && (
          <div className="px-3 pt-2 pb-0 text-[11px] text-amber-300/90">
            {weekStrip}
          </div>
        )}
        <div className="flex gap-1 px-3 pt-2 pb-1">
          {weekDays.map((d, i) => (
            <button
              key={i}
              onClick={() => setMobileDay(i)}
              className={
                'flex-1 rounded-md py-1 text-[11px] border ' +
                (i === mobileDay
                  ? 'bg-sky-600/90 border-sky-500 text-white'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400') +
                (sameDay(d, new Date()) ? ' ring-1 ring-sky-400/60' : '')
              }
            >
              <div className="font-medium">
                {d.toLocaleDateString(locale, { weekday: 'narrow' })}
              </div>
              <div className="tabular-nums">
                {d.getMonth() + 1}/{d.getDate()}
              </div>
            </button>
          ))}
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-4 safe-bottom">
          {hiddenToday.length > 0 && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-[11px] text-violet-300">
              <span>{t('hiddenClashN', { n: hiddenToday.length })}</span>
              <button
                className="shrink-0 underline decoration-dotted"
                onClick={() => restoreDay(mobileDay)}
              >
                {t('restoreBtn')}
              </button>
            </div>
          )}
          {placed.length === 0 ? (
            <p className="py-10 text-center text-xs text-zinc-600">
              {t('noLessonsToday')}
            </p>
          ) : (
            mobileSegments.map((seg) =>
              seg.g ? groupBox(seg.g) : seg.p ? lessonCard(seg.p.lesson) : null,
            )
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {weekStrip && (
        <div className="px-4 pt-2 pb-0 text-[11px] text-amber-300/90">
          {weekStrip}
        </div>
      )}
      <div ref={scrollRef} className="flex-1 overflow-auto px-4 pb-4">
        <div className="flex min-w-[720px]">
          {/* Jam */}
          <div className="w-12 shrink-0" style={{ paddingTop: 28 }}>
            {hours.map((h) => (
              <div
                key={h}
                className="text-[10px] text-zinc-500 text-right pr-2"
                style={{ height: HOUR_PX }}
              >
                {h.toString().padStart(2, '0')}:00
              </div>
            ))}
          </div>

          <div className="relative flex flex-1">
            {/* Hari */}
            {weekDays.map((day, i) => (
              <div key={i} className="flex-1 min-w-0 border-l border-zinc-800">
                <div
                  className={
                    'text-center text-xs py-1.5 ' +
                    (sameDay(day, new Date())
                      ? 'text-sky-400 font-medium'
                      : 'text-zinc-400')
                  }
                >
                  {formatDay(day, locale)}
                  {(() => {
                    const shown = shownGroupsOf(i)
                    const hidden = hiddenGroupsOf(i)
                    return (
                      <>
                        {shown.length > 0 && (
                          <span
                            role="img"
                            aria-label={`${t('dayConflictsTitle', { n: shown.length })} · ${t('blockDismissHint')}`}
                            title={`${t('dayConflictsTitle', { n: shown.length })} · ${t('blockDismissHint')}`}
                            className="ml-1 rounded bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-400 align-middle"
                          >
                            ⚠{shown.length}
                          </span>
                        )}
                        {hidden.length > 0 && (
                          <button
                            className="ml-1 rounded bg-violet-500/15 px-1 text-[10px] font-semibold text-violet-300 align-middle hover:bg-violet-500/25"
                            title={t('dayHiddenRestore', { n: hidden.length })}
                            onClick={() => restoreDay(i)}
                          >
                            ↩{hidden.length}
                          </button>
                        )}
                      </>
                    )
                  })()}
                </div>
                <div
                  className="relative"
                  style={{ height: hours.length * HOUR_PX }}
                >
                  {/* garis jam */}
                  {hours.map((h, idx) => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-t border-zinc-800/60"
                      style={{ top: idx * HOUR_PX }}
                    />
                  ))}
                  {(byDay.get(i)?.placed || []).map((p) => {
                    const { lesson: l, col, cols } = p
                    const visibleConflict = shownConflict(p)
                    const conflictTip = visibleConflict
                      ? (byDay.get(i)?.placed || [])
                          .filter((x) => x.clusterKey === p.clusterKey)
                          .map(
                            (x) =>
                              `${x.lesson.code || displayTitle(x.lesson)} ${formatTime(x.lesson.start, locale)}–${formatTime(x.lesson.end, locale)}`,
                          )
                          .join('\n')
                      : ''
                    const start = new Date(l.start)
                    const end = new Date(l.end)
                    const startH =
                      start.getHours() + start.getMinutes() / 60 - START_HOUR
                    const durH = Math.max(
                      0.25,
                      (end.getTime() - start.getTime()) / 3600000,
                    )
                    const top = Math.max(0, startH) * HOUR_PX
                    const height = Math.min(durH, END_HOUR - START_HOUR) * HOUR_PX
                    const widthPct = 100 / cols
                    const cc = courseColor(l)
                    const titleText = displayTitle(l)
                    const compact = height < 50
                    const showTitle =
                      height >= 68 &&
                      titleText.toLowerCase() !== (l.code || '').toLowerCase()
                    const showLocation = height >= 84 && !!l.location
                    return (
                      <button
                        key={l.id}
                        onClick={() => onSelect(l.id)}
                        title={`${visibleConflict ? `⚠ ${t('conflictSameTime')}\n${conflictTip}\n\n` : ''}${l.title}\n${formatTime(l.start, locale)}–${formatTime(l.end, locale)}\n${l.location || ''}\n${t('clickForDetail')}`}
                        className={
                          'absolute rounded-md px-1.5 py-1 text-left overflow-hidden border ' +
                          (visibleConflict
                            ? 'outline outline-1 outline-amber-400/90 shadow-[0_0_6px_rgba(251,191,36,0.35)]'
                            : '')
                        }
                        style={{
                          top,
                          height,
                          left: `calc(${col * widthPct}% + 1px)`,
                          width: `calc(${widthPct}% - 3px)`,
                          background: cc.bg,
                          borderColor: cc.border,
                          color: cc.text,
                        }}
                      >
                        {compact ? (
                          /* Blok pendek (<50min): satu baris kode + waktu */
                          <div className="text-[10px] leading-tight truncate">
                            {visibleConflict && (
                              <span
                                className="text-amber-400 mr-0.5 cursor-pointer"
                                title={t('blockDismissHint')}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  dismissKey(p.clusterKey)
                                }}
                              >
                                ⚠
                              </span>
                            )}
                            <span className="font-semibold">
                              {l.code || titleText}
                            </span>
                            <span className="opacity-80">
                              {' '}
                              {formatTime(l.start, locale)}
                            </span>
                          </div>
                        ) : (
                          <>
                            {/* Baris 1: kode (tebal) + ikon jenis */}
                            <div className="flex items-center gap-1 text-[11px] font-semibold leading-tight">
                              {visibleConflict && (
                                <span
                                  className="text-amber-400 shrink-0 cursor-pointer"
                                  title={t('blockDismissHint')}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    dismissKey(p.clusterKey)
                                  }}
                                >
                                  ⚠
                                </span>
                              )}
                              <span className="truncate">
                                {l.code || titleText}
                              </span>
                              {l.type && TYPE_META[l.type] && (
                                <span
                                  className="shrink-0 opacity-90"
                                  title={t(TYPE_META[l.type].key)}
                                >
                                  {TYPE_META[l.type].icon}
                                </span>
                              )}
                            </div>
                            {/* Baris 2: judul bersih (tanpa kode berulang) */}
                            {showTitle && (
                              <div
                                className={
                                  'text-[10px] leading-tight opacity-95 ' +
                                  (height >= 84 ? 'line-clamp-2' : 'truncate')
                                }
                              >
                                {titleText}
                              </div>
                            )}
                            {/* Baris waktu (+ lokasi bila muat) */}
                            <div className="text-[10px] opacity-80 leading-tight truncate">
                              {formatTime(l.start, locale)}–
                              {formatTime(l.end, locale)}
                              {!showLocation && l.location && ` · ${l.location}`}
                            </div>
                            {showLocation && (
                              <div className="text-[10px] opacity-70 leading-tight truncate">
                                📍 {l.location}
                              </div>
                            )}
                          </>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Garis waktu sekarang */}
            {showNowLine && (
              <>
                <div
                  className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-red-500/90"
                  style={{ top: nowTop }}
                />
                <div
                  className="pointer-events-none absolute z-20 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-red-500 shadow"
                  style={{
                    top: nowTop,
                    left: `calc(${(todayIndex * 100) / 7}% - 5px)`,
                  }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
