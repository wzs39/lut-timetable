import { useMemo, useState } from 'react'
import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { useNow } from '../lib/useNow'
import {
  attendanceFor,
  courseAttendance,
  loadAttendance,
  saveAttendance,
  setAttendance,
  type AttendanceStatus,
} from '../lib/attendance'
import Icon from './Icon'

/**
 * 出勤打卡：三态 + 清除。只对已经开始的课显示（未来的课没有「到没到」）。
 * 状态读写都在 lib/attendance.ts；这里只维护一份本地镜像用于重渲染。
 */
export default function AttendanceControl({
  lesson,
  lessons = [],
}: {
  lesson: Lesson
  /** 同一门课的全部课时（用于课程级出勤率）；不传则只统计这一节 */
  lessons?: Lesson[]
}) {
  const { t } = useI18n()
  const [records, setRecords] = useState(() => loadAttendance())
  // 共享时钟：渲染期不直接调 Date.now()（不稳定且会被 lint 判为不纯）
  const now = useNow()

  const started = new Date(lesson.start).getTime() <= now
  const status = attendanceFor(records, lesson)
  const courseKey = lesson.code?.trim() || lesson.title?.trim() || ''
  const stats = useMemo(
    () => courseAttendance(lessons.length > 0 ? lessons : [lesson], records, courseKey, new Date(now)),
    [lessons, lesson, records, courseKey, now],
  )

  if (!started) return null

  const apply = (next: AttendanceStatus | null) => {
    setRecords(saveAttendance(setAttendance(records, lesson, next)))
  }

  const options: { value: AttendanceStatus; label: string; icon: 'check' | 'close' | 'eye-off' }[] = [
    { value: 'attended', label: t('attendanceAttended'), icon: 'check' },
    { value: 'missed', label: t('attendanceMissed'), icon: 'close' },
    { value: 'cancelled', label: t('attendanceCancelled'), icon: 'eye-off' },
  ]

  const pct = stats.rate == null ? null : Math.round(stats.rate * 100)

  return (
    <section className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)] inline-flex items-center gap-1.5">
          <Icon name="attendance" size={12} /> {t('attendanceTitle')}
        </span>
        <span
          className={
            'text-[11px] tabular-nums ' +
            (stats.warn ? 'text-[var(--due)]' : 'text-[var(--text-3)]')
          }
          title={t('attendanceCourseHint')}
        >
          {pct == null
            ? t('attendanceNone')
            : t('attendanceCourse', { a: stats.attended, n: stats.total, p: pct })}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={status === o.value}
            onClick={() => apply(status === o.value ? null : o.value)}
            className={
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ' +
              (status === o.value
                ? 'border-[var(--accent)] bg-[var(--surface-1)] text-[var(--text-1)]'
                : 'border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--hover-1)]')
            }
          >
            <Icon name={o.icon} size={11} /> {o.label}
          </button>
        ))}
        {status && (
          <button
            type="button"
            onClick={() => apply(null)}
            className="rounded-md px-2 py-1 text-[11px] text-[var(--text-3)] hover:bg-[var(--hover-1)]"
          >
            {t('attendanceClear')}
          </button>
        )}
      </div>

      {stats.warn && (
        <p className="mt-1 text-[10px] text-[var(--due)]">{t('attendanceWarn', { p: 80 })}</p>
      )}
    </section>
  )
}
