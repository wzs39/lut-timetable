import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n'
import Icon from './Icon'
import type { Lesson } from '../types'
import {
  buildOmniExtras,
  filterPalette,
  type PaletteAction,
  type PaletteGroup,
  type PaletteItem,
} from '../lib/palette'
import { parseQuickAdd } from '../lib/quickAdd'
import { roomTimelinesForDay, type RoomDayTimeline } from '../lib/freeRooms'
import { loadLessons } from '../lib/store'
import { formatDateTime } from '../lib/date'

interface Props {
  /** 候选清单（由 App 用 lib/palette.buildPalette 生成） */
  items: PaletteItem[]
  onRun: (action: PaletteAction) => void
  onClose: () => void
  /** 可选课程列表（供 Omni 2.0 教室全天占用时间轴与课程码识别使用） */
  lessons?: Lesson[]
  /** 已知课程代码清单 */
  knownCourseCodes?: string[]
  /** 可选注入当前时间（供单测稳定断言） */
  now?: Date
}

/**
 * Omni-Command Bar 2.0（Ctrl/Cmd+K）：
 * - 自然语言快速排块与建任务（如 `周四 15:00 算法复习 90m`）
 * - 教室 08:00–20:00 全天空置时间轴检索（如 `room 1325` / `教室`）
 * - 一步式内联成绩目标速算（如 `grade CT60A2411 4` / `目标 80`）
 * - 全局课程全景档案（Course Dossier）深链直达
 */
export default function CommandPalette({
  items,
  onRun,
  onClose,
  lessons,
  knownCourseCodes,
  now,
}: Props) {
  const { t, locale } = useI18n()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const effectiveLessons = useMemo<Lesson[]>(
    () => (lessons && lessons.length > 0 ? lessons : loadLessons()),
    [lessons],
  )

  const effectiveCourseCodes = useMemo<string[]>(() => {
    if (knownCourseCodes && knownCourseCodes.length > 0) return knownCourseCodes
    const set = new Set<string>()
    for (const item of items) {
      if (item.action.kind === 'course' && item.action.code) {
        set.add(item.action.code)
      }
    }
    return [...set]
  }, [knownCourseCodes, items])

  /**
   * Omni-Command Bar 2.0 动态增强项：
   * 包含 `parseOmniQuickAdd`（学习块/任务）、教室空置时间轴、成绩目标速算与课程档案直达。
   */
  const omniExtras = useMemo<PaletteItem[]>(() => {
    const trimmed = q.trim()
    if (!trimmed) return []

    const extras = buildOmniExtras(trimmed, {
      lessons: effectiveLessons,
      knownCourseCodes: effectiveCourseCodes,
      now,
      locale,
    })

    // 若传统 parseQuickAdd 命中而 buildOmniExtras 未产出任务/学习块，兜底保留
    const hasQuickAdd = extras.some(
      (item) =>
        item.action.kind === 'quickAddTask' || item.action.kind === 'quickAddStudyBlock',
    )
    if (!hasQuickAdd) {
      const parsed = parseQuickAdd(trimmed, now)
      if (parsed) {
        extras.unshift({
          id: 'quick:add',
          group: 'actions',
          label: t('paletteQuickAdd', { title: parsed.title }),
          sub: parsed.dueAt ? formatDateTime(parsed.dueAt, locale) : t('taskNoDue'),
          icon: 'plus',
          action: { kind: 'quickAddTask', title: parsed.title, dueAt: parsed.dueAt },
        })
      }
    }

    // 支持 `dossier <code/title>` 或 `档案 <code/title>` 直接检索课程全景档案
    const dossierMatch = trimmed.match(/^(?:dossier|档案)\s*(.*)$/i)
    if (dossierMatch) {
      const subQuery = dossierMatch[1].trim().toLowerCase()
      const courseItems = items.filter((it) => it.action.kind === 'course')
      for (const cItem of courseItems) {
        if (cItem.action.kind !== 'course') continue
        const hay = `${cItem.action.code} ${cItem.action.title}`.toLowerCase()
        if (!subQuery || hay.includes(subQuery)) {
          const codeOrTitle = cItem.action.code || cItem.action.title
          extras.push({
            id: `omni:dossier:${codeOrTitle}`,
            group: 'courses',
            label: t('paletteOpenDossier', { code: codeOrTitle }),
            sub: cItem.action.title,
            icon: 'book',
            keywords: `dossier 档案 ${codeOrTitle}`,
            action: {
              kind: 'dossier',
              courseKey: codeOrTitle,
              code: cItem.action.code,
              title: cItem.action.title,
            },
          })
        }
      }
    }

    return extras
  }, [q, effectiveLessons, effectiveCourseCodes, now, locale, items, t])

  const roomTimelineMap = useMemo<Map<string, RoomDayTimeline>>(() => {
    const map = new Map<string, RoomDayTimeline>()
    if (!/^(?:room|rooms|教室|空教室)\b/i.test(q.trim()) || effectiveLessons.length === 0) {
      return map
    }
    for (const tl of roomTimelinesForDay(effectiveLessons, now)) {
      map.set(tl.room, tl)
    }
    return map
  }, [q, effectiveLessons, now])

  const results = useMemo(() => {
    const base = filterPalette(items, q)
    if (omniExtras.length === 0) return base
    const seen = new Set(omniExtras.map((e) => e.id))
    return [...omniExtras, ...base.filter((b) => !seen.has(b.id))]
  }, [items, q, omniExtras])

  // 输入变化的事件里重置高亮（不在 effect 里 setState：避免级联渲染）
  const onQueryChange = (value: string) => {
    setQ(value)
    setActive(0)
  }

  // 键盘移动时保证高亮项在可视区内（jsdom 没有 scrollIntoView：先探测）
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [active, results])

  const groupLabel: Record<PaletteGroup, string> = {
    views: t('paletteGroupViews'),
    actions: t('paletteGroupActions'),
    courses: t('paletteGroupCourses'),
    tasks: t('paletteGroupTasks'),
  }

  const run = (item?: PaletteItem) => {
    const target = item ?? results[active]
    if (target) onRun(target.action)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(Math.max(0, results.length - 1), i + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      run()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="omni-palette-dialog"
      className="animate-fade-in fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onClose()
        }
      }}
    >
      <div className="animate-modal-in w-full max-w-lg overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-1)] shadow-2xl shadow-black/50">
        <div className="flex items-center gap-2 border-b border-[var(--line)] px-3 py-2.5">
          <span className="text-[var(--text-3)]">
            <Icon name="search" size={14} />
          </span>
          <input
            autoFocus
            value={q}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('palettePlaceholder')}
            aria-label={t('paletteOpen')}
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--text-1)] outline-none placeholder:text-[var(--text-3)]"
          />
          <button
            onClick={onClose}
            className="shrink-0 text-[var(--text-3)] hover:text-[var(--text-1)]"
            title={t('closeHint')}
          >
            <Icon name="close" size={12} />
          </button>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-[var(--text-3)]">
              {t('paletteEmpty')}
            </p>
          ) : (
            results.map((item, idx) => {
              const roomTl =
                item.action.kind === 'roomStatus'
                  ? roomTimelineMap.get(item.action.room)
                  : undefined
              return (
                <div key={item.id}>
                  {(idx === 0 || results[idx - 1].group !== item.group) && (
                    <div className="px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                      {groupLabel[item.group]}
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <button
                      data-idx={idx}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => run(item)}
                      className={
                        'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs ' +
                        (idx === active
                          ? 'bg-[var(--accent)] text-[var(--accent-text)]'
                          : 'text-[var(--text-1)] hover:bg-[var(--hover-1)]')
                      }
                    >
                      <span
                        className={
                          'shrink-0 ' + (idx === active ? 'opacity-90' : 'text-[var(--text-3)]')
                        }
                      >
                        <Icon name={item.icon ?? 'chevron-right'} size={13} />
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                      {item.sub && (
                        <span
                          className={
                            'num max-w-[45%] shrink-0 truncate text-[10px] tabular-nums ' +
                            (idx === active ? 'opacity-80' : 'text-[var(--text-3)]')
                          }
                        >
                          {item.sub}
                        </span>
                      )}
                    </button>
                    {item.action.kind === 'course' && (
                      <button
                        type="button"
                        onClick={() => {
                          if (item.action.kind !== 'course') return
                          onRun({
                            kind: 'dossier',
                            courseKey: item.action.code || item.action.title,
                            code: item.action.code,
                            title: item.action.title,
                          })
                        }}
                        title={t('dossierTitle')}
                        className="shrink-0 rounded border border-[var(--line)] bg-[var(--surface-2)] px-1.5 py-1 text-[10px] font-medium text-[var(--text-2)] hover:border-[var(--hover-line)] hover:text-[var(--text-1)]"
                      >
                        {t('dossierTitle')}
                      </button>
                    )}
                  </div>
                  {roomTl && (
                    <div
                      data-testid={`room-timeline-${roomTl.room}`}
                      className="mx-2.5 mb-1.5 mt-1 rounded border border-[var(--line)] bg-[var(--surface-2)] p-1.5"
                    >
                      <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--text-3)]">
                        <span>{t('paletteRoomTimelineHint')}</span>
                        <span className="num font-mono tabular-nums">
                          {roomTl.freeMinutesRemainingToday}m free
                        </span>
                      </div>
                      <div className="flex h-2 w-full overflow-hidden rounded-sm bg-[var(--surface-0)]">
                        {roomTl.intervals.map((iv, ivIdx) => {
                          const sMs = Date.parse(iv.start)
                          const eMs = Date.parse(iv.end)
                          const durMin = Math.max(5, Math.round((eMs - sMs) / 60_000))
                          const widthPct = Math.max(2, (durMin / (12 * 60)) * 100)
                          return (
                            <span
                              key={ivIdx}
                              style={{ width: `${widthPct}%` }}
                              title={
                                iv.state === 'occupied'
                                  ? `${iv.lessonCode || iv.lessonTitle || 'Occupied'}`
                                  : 'Free'
                              }
                              className={
                                iv.state === 'free'
                                  ? 'h-full bg-[var(--ok)]/60 border-r border-[var(--surface-0)]'
                                  : 'h-full bg-[var(--danger)]/70 border-r border-[var(--surface-0)]'
                              }
                            />
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--text-3)]">
          {q.trim() ? t('paletteHint') : t('paletteShortcuts')}
        </div>
      </div>
    </div>
  )
}
