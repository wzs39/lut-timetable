import { useMemo } from 'react'
import type { Lesson } from '../../types'
import { useI18n } from '../../i18n'
import {
  matchCourseCode,
  type EnrolledCourse,
} from '../../lib/courses'
import { normalizeCourseCode } from '../../lib/ics'
import { courseColorByKey } from '../../lib/colors'
import ExternalLink from '../ExternalLink'
import Icon from '../Icon'
import CourseContentsToggle from './CourseContentsToggle'

export default function CoursesSection({
  enrolled,
  loading,
  lessons,
  tasks,
  grades,
  onJumpToCourse,
  token,
}: {
  enrolled: EnrolledCourse[] | null
  loading: boolean
  lessons: Lesson[]
  tasks: Array<{ completed: boolean; course?: string }>
  grades: Array<{ courseId?: number; average: number | null }> | null
  onJumpToCourse?: (code: string) => void
  token: { token: string; userid?: number } | null
}) {
  const { t } = useI18n()

  const rows = useMemo(() => {
    if (!enrolled) return []
    return enrolled.map((c) => {
      const code = matchCourseCode(c.shortname, lessons) ?? null
      const norm = normalizeCourseCode(c.shortname)
      const pending = tasks.filter(
        (task) => !task.completed && task.course && normalizeCourseCode(task.course) === norm,
      ).length
      const avg = grades?.find((g) => g.courseId === c.courseid)?.average ?? null
      const color = code ? courseColorByKey(code) : null
      return { c, code, pending, avg, color }
    })
  }, [enrolled, lessons, tasks, grades])

  if (loading) {
    return <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('coursesLoading')}</p>
  }
  if (!enrolled || enrolled.length === 0) {
    return <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('coursesEmpty')}</p>
  }

  return (
    <ul className="space-y-1.5">
      {rows.map(({ c, code, pending, avg, color }) => (
        <li
          key={c.courseid}
          className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2"
        >
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: color?.bg ?? 'var(--line)' }}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {code && onJumpToCourse ? (
                <button
                  onClick={() => onJumpToCourse(code)}
                  className="shrink-0 font-mono text-[11px] font-semibold text-[var(--info)] hover:underline"
                  title={t('jumpToCourse')}
                >
                  {code}
                </button>
              ) : (
                <span className="shrink-0 font-mono text-[11px] font-semibold">{c.shortname}</span>
              )}
              <span className="min-w-0 truncate text-[11px] text-[var(--text-2)]" title={c.fullname}>
                {c.fullname}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-[var(--text-3)]">
              {pending > 0 && <span>{t('coursesPending', { n: pending })}</span>}
              {avg != null && (
                <span className="tabular-nums" title={t('gradeMoodleAvg')}>
                  {t('coursesAvg')} {avg.toFixed(0)}%
                </span>
              )}
            </div>
          </div>
          <CourseContentsToggle courseId={c.courseid} token={token} />
          <ExternalLink
            href={`https://moodle.lut.fi/course/view.php?id=${c.courseid}`}
            className="app-btn-ghost shrink-0 px-1.5 py-1"
            title={t('coursesOpenInMoodle')}
          >
            <Icon name="external" size={12} />
          </ExternalLink>
        </li>
      ))}
    </ul>
  )
}
