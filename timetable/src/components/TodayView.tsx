import { useEffect, useMemo, useState } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { courseColor } from '../lib/colors'
import { formatTime, sameDay } from '../lib/date'
import { TYPE_META } from '../lib/lessonTypes'
import { displayTitle, buildingOf, roomOf } from '../lib/display'

interface Props {
  lessons: Lesson[]
  onSelect: (id: string) => void
}

const SOURCE_ICON: Record<Lesson['source'], string> = {
  sisu: '🔵',
  timeedit: '🟣',
  manual: '🟢',
}

/** "1 小时 25 分" / "45 分钟" */
function fmtDuration(min: number, t: (k: string, p?: any) => string): string {
  if (min < 60) return t('durationM', { m: min })
  return t('durationHM', { h: Math.floor(min / 60), m: min % 60 })
}

/**
 * 今日视图: 按时间聚合今天的课程 + "下一节课"倒计时。
 * 每 30 秒刷新状态（即将上课 / 正在进行 / 已结束）。
 */
export default function TodayView({ lessons, onSelect }: Props) {
  const { t, lang } = useI18n()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const today = useMemo(() => {
    const nowDate = new Date(now)
    return lessons
      .filter((l) => sameDay(new Date(l.start), nowDate))
      .sort((a, b) => a.start.localeCompare(b.start))
  }, [lessons, now])

  const ongoing = today.find(
    (l) =>
      new Date(l.start).getTime() <= now && now < new Date(l.end).getTime(),
  )
  const next = today.find((l) => new Date(l.start).getTime() > now)
  const ended = today.length > 0 && !ongoing && !next

  const banner = (() => {
    if (ongoing) {
      const left = Math.max(
        1,
        Math.round((new Date(ongoing.end).getTime() - now) / 60000),
      )
      return { tone: 'ongoing', text: `${t('nowOngoing')} · ${fmtDuration(left, t)}`, lesson: ongoing }
    }
    if (next) {
      const left = Math.max(
        1,
        Math.round((new Date(next.start).getTime() - now) / 60000),
      )
      return { tone: 'next', text: `${t('startsIn', { t: fmtDuration(left, t) })}`, lesson: next }
    }
    if (ended) return { tone: 'done', text: t('allDone'), lesson: null }
    return { tone: 'empty', text: t('noLessonsToday'), lesson: null }
  })()

  const bannerCls =
    banner.tone === 'ongoing'
      ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
      : banner.tone === 'next'
        ? 'border-sky-500/60 bg-sky-500/10 text-sky-300'
        : 'border-zinc-700 bg-zinc-800/60 text-zinc-400'

  const todayLabel = new Date(now).toLocaleDateString(
    lang === 'zh' ? 'zh-CN' : 'en-US',
    { weekday: 'long', day: 'numeric', month: 'long' },
  )

  // Navigazione interna: raggruppa le lezioni di oggi per edificio
  const buildings = useMemo(() => {
    const map = new Map<string, { room: string; time: string; live: boolean }[]>()
    for (const l of today) {
      const b = buildingOf(l.location)
      if (!b) continue
      const arr = map.get(b) || []
      arr.push({
        room: roomOf(l.location as string),
        time: formatTime(l.start, lang === 'zh' ? 'zh-CN' : 'en-US'),
        live: new Date(l.start).getTime() <= now && now < new Date(l.end).getTime(),
      })
      map.set(b, arr)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [today, now, lang])

  return (
    <div className="flex-1 overflow-y-auto p-4 safe-bottom">
      <div className="mx-auto max-w-xl space-y-3">
        <h2 className="text-sm font-semibold text-zinc-300">{todayLabel}</h2>

        <div className={'rounded-lg border px-3 py-2.5 text-xs ' + bannerCls}>
          {banner.lesson ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {banner.tone === 'ongoing' ? '▶ ' : ''}
                  {banner.lesson.code ? `${banner.lesson.code} · ` : ''}
                  {banner.lesson.type && TYPE_META[banner.lesson.type] && (
                    <span title={t(TYPE_META[banner.lesson.type].key)}>
                      {TYPE_META[banner.lesson.type].icon}{' '}
                    </span>
                  )}
                  {displayTitle(banner.lesson)}
                </div>
                <div className="mt-0.5 text-[11px] opacity-80">
                  {formatTime(banner.lesson.start, lang === 'zh' ? 'zh-CN' : 'en-US')}
                  {' – '}
                  {formatTime(banner.lesson.end, lang === 'zh' ? 'zh-CN' : 'en-US')}
                  {banner.lesson.location ? ` · ${banner.lesson.location}` : ''}
                </div>
              </div>
              <span className="shrink-0 text-[11px] font-medium whitespace-nowrap">
                {banner.text}
              </span>
            </div>
          ) : (
            <span>{banner.text}</span>
          )}
        </div>

        {buildings.length > 0 && (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              🧭 {t('indoorNav')}
            </div>
            <div className="space-y-1">
              {buildings.map(([building, items]) => (
                <div key={building} className="text-[11px]">
                  <span className="font-semibold text-zinc-200">🏢 {building}</span>
                  <span className="ml-2 text-zinc-400">
                    {items.map((i) => `${i.room} ${i.time}${i.live ? ' ▶' : ''}`).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {today.length === 0 ? (
          <p className="py-10 text-center text-xs text-zinc-600">
            {t('noLessonsToday')}
          </p>
        ) : (
          <ul className="space-y-2">
            {today.map((l) => {
              const s = new Date(l.start).getTime()
              const e = new Date(l.end).getTime()
              const past = e <= now
              const live = s <= now && now < e
              const c = courseColor(l)
              return (
                <li key={l.id}>
                  <button
                    onClick={() => onSelect(l.id)}
                    className={
                      'w-full rounded-lg border px-3 py-2 text-left text-xs transition hover:brightness-125 ' +
                      (past ? 'opacity-40 ' : '') +
                      (live ? 'ring-1 ring-emerald-400/70 ' : '')
                    }
                    style={{ background: c.bg, borderColor: c.border }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div
                          className="truncate font-medium"
                          style={{ color: c.text }}
                        >
                          {SOURCE_ICON[l.source]}{' '}
                          {l.code ? `${l.code} · ` : ''}
                          {displayTitle(l)}
                        </div>
                        <div className="mt-0.5 text-[11px] text-zinc-400 truncate">
                          {l.location || '—'}
                          {l.mergedSources && l.mergedSources.length > 1
                            ? ' · 🔵+🟣'
                            : ''}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-zinc-300">
                          {formatTime(l.start, lang === 'zh' ? 'zh-CN' : 'en-US')}
                          {' – '}
                          {formatTime(l.end, lang === 'zh' ? 'zh-CN' : 'en-US')}
                        </div>
                        <div className="mt-0.5 flex items-center justify-end gap-1.5">
                          {l.type && TYPE_META[l.type] && (
                            <span
                              className="rounded-full border border-zinc-600 bg-zinc-900/50 px-1.5 py-px text-[10px] text-zinc-300"
                              title={t(TYPE_META[l.type].key)}
                            >
                              {TYPE_META[l.type].icon} {t(TYPE_META[l.type].key)}
                            </span>
                          )}
                          {live && (
                            <span className="text-[10px] font-medium text-emerald-300">
                              ▶ {t('nowOngoing')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
