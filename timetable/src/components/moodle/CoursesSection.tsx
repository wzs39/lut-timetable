import { useMemo } from 'react'
import type { Lesson } from '../../types'
import { useI18n } from '../../i18n'
import type { EnrolledCourse } from '../../lib/courses'
import type { CourseGrades } from '../../lib/grades'
import type { Task } from '../../lib/tasks'
import { buildCourseGraph } from '../../lib/courseGraph'
import { loadSisuStudyPlan } from '../../lib/sisuStudyPlan'
import { loadStudyBlocks, type StudyBlock } from '../../lib/studyBlocks'
import { courseColorByKey } from '../../lib/colors'
import ExternalLink from '../ExternalLink'
import Icon from '../Icon'
import CourseContentsToggle from './CourseContentsToggle'
import { isHddCourse } from '../../lib/courseResources'

export default function CoursesSection({
  enrolled,
  loading,
  lessons,
  tasks,
  grades,
  studyBlocks,
  onJumpToCourse,
  onInspectCourse,
  token,
}: {
  enrolled: EnrolledCourse[] | null
  loading: boolean
  lessons: Lesson[]
  tasks: Array<{ completed: boolean; course?: string; title?: string; id?: string; dueAt?: string; createdAt?: string; updatedAt?: string }>
  grades: Array<Partial<CourseGrades> & { courseId?: number; average: number | null }> | null
  studyBlocks?: StudyBlock[]
  onJumpToCourse?: (code: string) => void
  onInspectCourse?: (code: string) => void
  token: { token: string; userid?: number } | null
}) {
  const { t } = useI18n()

  const graph = useMemo(() => {
    const fallbackIso = new Date().toISOString()
    const normalizedTasks: Task[] = tasks.map((task, idx) => ({
      id: task.id ?? `t-${idx}`,
      title: task.title ?? '',
      completed: task.completed,
      course: task.course,
      dueAt: task.dueAt,
      createdAt: task.createdAt ?? fallbackIso,
      updatedAt: task.updatedAt ?? fallbackIso,
    }))
    const normalizedGrades: CourseGrades[] = (grades ?? []).map((g, idx) => ({
      course: g.course ?? `Moodle #${g.courseId ?? idx}`,
      courseId: g.courseId,
      matched: g.matched ?? false,
      average: g.average,
      officialTotal: g.officialTotal,
      items: g.items ?? [],
    }))
    const planItems = loadSisuStudyPlan().items
    return buildCourseGraph({
      lessons,
      enrolled: enrolled ?? [],
      grades: normalizedGrades,
      planItems,
      tasks: normalizedTasks,
      studyBlocks: studyBlocks ?? loadStudyBlocks(),
    })
  }, [enrolled, lessons, tasks, grades, studyBlocks])

  if (loading && graph.nodes.length === 0) {
    return <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('coursesLoading')}</p>
  }
  if (graph.nodes.length === 0) {
    return <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('coursesEmpty')}</p>
  }

  return (
    <div className="space-y-2.5">
      {graph.discrepancies.length > 0 && (
        <div
          data-testid="courses-discrepancies-banner"
          className="rounded-lg border border-[var(--due)]/40 bg-[var(--due)]/10 px-3 py-2 text-[11px] text-[var(--text-1)]"
        >
          <span className="font-semibold text-[var(--due)]">
            {t('courseGraphDiscrepanciesTitle', { n: graph.discrepancies.length })}
          </span>
        </div>
      )}

      <ul data-testid="courses-tri-source-list" className="animate-stagger space-y-1.5">
        {graph.nodes.map((node) => {
          const color = node.code ? courseColorByKey(node.code) : courseColorByKey(node.key)
          const hdd = node.enrolled ? isHddCourse(node.enrolled.shortname) : false
          const avg = node.grades?.average ?? null
          const inspectTarget = node.code || node.title
          return (
            <li
              key={node.key}
              data-testid={`course-graph-row-${node.code || node.key}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2 transition hover:border-[var(--info)]/40"
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: color.bg }}
                aria-hidden="true"
              />
              {hdd && (
                <span className="app-badge shrink-0 border-[var(--line-violet)] bg-[var(--tint-violet)] text-[var(--violet)]">HDD</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {node.code && onJumpToCourse ? (
                    <button
                      onClick={() => onJumpToCourse(node.code)}
                      className="shrink-0 font-mono text-[11px] font-semibold text-[var(--info)] hover:underline"
                      title={t('jumpToCourse')}
                    >
                      {node.code}
                    </button>
                  ) : (
                    node.code && <span className="shrink-0 font-mono text-[11px] font-semibold text-[var(--text-2)]">{node.code}</span>
                  )}
                  <span className="min-w-0 truncate text-[11px] font-medium text-[var(--text-1)]" title={node.title}>
                    {node.title}
                  </span>
                  {node.sources.map((src) => (
                    <span
                      key={src}
                      data-source-badge={src}
                      className={
                        'rounded border px-1 py-px text-[9px] font-medium uppercase ' +
                        (src === 'sisu'
                          ? 'border-[var(--line-violet)] bg-[var(--tint-violet)] text-[var(--violet)]'
                          : src === 'moodle'
                            ? 'border-[var(--line-info)] bg-[var(--tint-info)] text-[var(--info)]'
                            : 'border-[var(--line)] bg-[var(--surface-1)] text-[var(--text-3)]')
                      }
                    >
                      {src}
                    </span>
                  ))}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-[var(--text-3)]">
                  {node.credits != null && <span className="tabular-nums">{node.credits} ECTS</span>}
                  {node.periods.length > 0 && (
                    <span className="tabular-nums">{node.periods.map((p) => `P${p}`).join('/')}</span>
                  )}
                  {node.pendingTaskCount > 0 && <span>{t('coursesPending', { n: node.pendingTaskCount })}</span>}
                  {avg != null && (
                    <span className="tabular-nums" title={t('gradeMoodleAvg')}>
                      {t('coursesAvg')} {avg.toFixed(0)}%
                    </span>
                  )}
                </div>
                {node.discrepancies.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {node.discrepancies.map((d) => (
                      <span
                        key={d.kind}
                        className="rounded border border-[var(--due)]/40 bg-[var(--due)]/10 px-1.5 py-px text-[9px] text-[var(--due)]"
                      >
                        {t(d.messageKey, d.meta)}
                      </span>
                    ))}
                  </div>
                )}
                {hdd && <p className="mt-1 text-[10px] text-[var(--text-3)]">{t('heButSeparateNote')}</p>}
              </div>
              {onInspectCourse && inspectTarget && (
                <button
                  type="button"
                  data-testid={`course-dossier-btn-${node.code || node.key}`}
                  onClick={() => onInspectCourse(inspectTarget)}
                  className="app-btn-ghost shrink-0 px-2 py-1 text-[10px] text-[var(--info)]"
                >
                  {t('coursesOpenDossier')}
                </button>
              )}
              {node.moodleCourseId != null && !hdd && (
                <CourseContentsToggle courseId={node.moodleCourseId} token={token} />
              )}
              {node.moodleCourseId != null && !hdd && (
                <ExternalLink
                  href={`https://moodle.lut.fi/course/view.php?id=${node.moodleCourseId}`}
                  className="app-btn-ghost shrink-0 px-1.5 py-1"
                  title={t('coursesOpenInMoodle')}
                >
                  <Icon name="external" size={12} />
                </ExternalLink>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
