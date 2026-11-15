import { useMemo, useState } from 'react'
import type { Lesson } from '../../types'
import type { CourseGrades } from '../../lib/grades'
import type { StudyBlock } from '../../lib/studyBlocks'
import type { Task } from '../../lib/tasks'
import { buildCrunchRadar, type CrunchDayPoint } from '../../lib/crunchRadar'
import { useI18n } from '../../i18n'
import Icon from '../Icon'

interface Props {
  lessons: Lesson[]
  tasks: Task[]
  studyBlocks: StudyBlock[]
  grades?: CourseGrades[]
  onInspectCourse?: (code: string) => void
}

const SVG_W = 560
const SVG_H = 104
const PAD_L = 12
const PAD_R = 12
const PAD_T = 16
const PAD_B = 22

export default function CrunchRadarChart({
  lessons,
  tasks,
  studyBlocks,
  grades,
  onInspectCourse,
}: Props) {
  const { t, locale } = useI18n()
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  const report = useMemo(
    () =>
      buildCrunchRadar({
        lessons,
        tasks,
        studyBlocks,
        grades,
        horizonDays: 14,
      }),
    [lessons, tasks, studyBlocks, grades],
  )

  const days = report.days
  const plotW = SVG_W - PAD_L - PAD_R
  const plotH = SVG_H - PAD_T - PAD_B
  const stepX = days.length > 1 ? plotW / (days.length - 1) : plotW

  const coords = useMemo(
    () =>
      days.map((d, idx) => {
        const x = PAD_L + idx * stepX
        const y = PAD_T + plotH - (Math.min(100, d.crunchScore) / 100) * plotH
        return { x, y, d }
      }),
    [days, plotH, stepX],
  )

  const splinePath = useMemo(() => {
    if (coords.length === 0) return ''
    if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`
    let path = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`
    for (let i = 0; i < coords.length - 1; i++) {
      const p0 = coords[i]
      const p1 = coords[i + 1]
      const cx = ((p0.x + p1.x) / 2).toFixed(1)
      path += ` C ${cx} ${p0.y.toFixed(1)}, ${cx} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`
    }
    return path
  }, [coords])

  const areaPath = useMemo(() => {
    if (coords.length === 0) return ''
    const base = PAD_T + plotH
    return `${splinePath} L ${coords[coords.length - 1].x.toFixed(1)} ${base} L ${coords[0].x.toFixed(1)} ${base} Z`
  }, [coords, plotH, splinePath])

  const activePoint: CrunchDayPoint | null =
    hoveredIdx != null ? days[hoveredIdx] ?? null : report.peakDay

  const formatShortDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' })

  const toneColor = (level: CrunchDayPoint['level']) => {
    if (level === 'critical') return 'var(--danger)'
    if (level === 'high') return 'var(--due)'
    if (level === 'moderate') return 'var(--info)'
    return 'var(--text-3)'
  }

  return (
    <section
      data-testid="crunch-radar-chart"
      className="app-card p-3 space-y-2.5"
      aria-label={t('crunchRadarTitle')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={
              'led-dot ' +
              (report.peakDay && report.peakDay.level === 'critical'
                ? 'led-danger led-pulse'
                : report.peakDay && report.peakDay.level === 'high'
                  ? 'led-warn'
                  : 'led-ok')
            }
            aria-hidden="true"
          />
          <h3 className="app-card-label">{t('crunchRadarTitle')}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
          {activePoint && activePoint.crunchScore > 0 ? (
            <span
              className="rounded border px-1.5 py-0.5"
              style={{
                borderColor: toneColor(activePoint.level),
                color: toneColor(activePoint.level),
              }}
            >
              {t('crunchRadarPeak', {
                day: formatShortDate(activePoint.dateIso),
                score: Math.round(activePoint.crunchScore),
              })}
              {activePoint.dueTasks.length > 0 ? ` · ${activePoint.dueTasks.length} DDL` : ''}
              {activePoint.examCount > 0 ? ` · ${activePoint.examCount} Exam` : ''}
            </span>
          ) : (
            <span className="text-[var(--ok)]">{t('crunchRadarCalm')}</span>
          )}
          {report.unscheduledTasksInWindow.length > 0 && (
            <span className="app-badge app-badge-due text-[10px]">
              {t('crunchRadarUnscheduled', { n: report.unscheduledTasksInWindow.length })}
            </span>
          )}
        </div>
      </div>

      {/* SVG 14 天脉冲曲线 + 每日负荷柱 */}
      <div className="relative overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/60 px-1 py-1">
        <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="h-24 w-full overflow-visible">
          <defs>
            <linearGradient id="crunchAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--due)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--info)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {/* Baseline */}
          <line
            x1={PAD_L}
            y1={PAD_T + plotH}
            x2={SVG_W - PAD_R}
            y2={PAD_T + plotH}
            stroke="var(--line)"
            strokeWidth="1"
          />
          {/* Area + Wave */}
          {areaPath && <path d={areaPath} fill="url(#crunchAreaGrad)" />}
          {splinePath && (
            <path
              d={splinePath}
              fill="none"
              stroke="var(--info)"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          )}
          {/* Day columns + interactive targets */}
          {coords.map(({ x, y, d }, idx) => {
            const barH = Math.max(2, Math.min(plotH, (d.lessonHours + d.studyBlockHours) * 7))
            const isActive = hoveredIdx === idx || (hoveredIdx == null && report.peakDay?.dateKey === d.dateKey && d.crunchScore > 0)
            return (
              <g
                key={d.dateKey}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                className="cursor-pointer"
              >
                <rect
                  x={x - stepX / 2}
                  y={PAD_T}
                  width={Math.max(12, stepX)}
                  height={plotH + PAD_B}
                  fill="transparent"
                />
                <rect
                  x={x - 4}
                  y={PAD_T + plotH - barH}
                  width={8}
                  height={barH}
                  rx={2}
                  fill={d.dueTasks.length > 0 ? toneColor(d.level) : 'var(--line-info)'}
                  opacity={isActive ? 0.95 : 0.4}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={isActive ? 4 : d.dueTasks.length > 0 || d.examCount > 0 ? 2.8 : 1.5}
                  fill={toneColor(d.level)}
                  stroke="var(--surface-0)"
                  strokeWidth="1.2"
                />
                {(idx === 0 || idx === 6 || idx === 13 || isActive) && (
                  <text
                    x={x}
                    y={SVG_H - 5}
                    textAnchor="middle"
                    fontSize="9"
                    fontFamily="monospace"
                    fill={isActive ? 'var(--text-1)' : 'var(--text-3)'}
                  >
                    {formatShortDate(d.dateIso)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {report.alerts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {report.alerts.slice(0, 4).map((alert, i) => (
            <button
              key={`${alert.kind}-${alert.dateKey}-${i}`}
              type="button"
              onClick={() => {
                if (alert.courseCodes[0] && onInspectCourse) {
                  onInspectCourse(alert.courseCodes[0])
                }
              }}
              className={
                'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] transition hover:brightness-110 ' +
                (alert.severity === 'critical'
                  ? 'border-[var(--danger)]/40 bg-[var(--tint-danger)] text-[var(--danger)]'
                  : 'border-[var(--line-due)] bg-[var(--tint-due)] text-[var(--due)]')
              }
            >
              <Icon name="warn" size={10} />
              <span className="truncate max-w-[220px]">{alert.title}</span>
              <span className="font-mono opacity-80">{formatShortDate(alert.dateKey)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
