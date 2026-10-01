import { useMemo, useState } from 'react'
import { useI18n } from '../../i18n'
import { useNow } from '../../lib/useNow'
import { fetchCourseContents, loadCachedContents, type CourseSection } from '../../lib/contents'
import {
  collectCourseResources,
  isCourseResourceFavorite,
  loadCourseResourceFavorites,
  loadRecentCourseResources,
  recordCourseResourceVisit,
  searchCourseResources,
  toggleCourseResourceFavorite,
  type CourseResource,
} from '../../lib/courseResources'
import { normalizeMoodleLink } from '../../lib/moodleUrl'
import { openExternal } from '../../lib/openExternal'
import type { EnrolledCourse } from '../../lib/courses'
import Icon from '../Icon'

type ResourceTab = 'search' | 'favorites' | 'recent'

export default function CourseResourcesSection({ enrolled, token }: {
  enrolled: EnrolledCourse[] | null
  token: { token: string; userid?: number } | null
}) {
  const { t } = useI18n()
  const now = useNow()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<ResourceTab>('search')
  const [sectionsByCourse, setSectionsByCourse] = useState<Record<number, CourseSection[] | null>>({})
  const [loading, setLoading] = useState(false)
  const [favorites, setFavorites] = useState(loadCourseResourceFavorites)
  const [recent, setRecent] = useState(loadRecentCourseResources)

  const cachedResources = useMemo(() => collectCourseResources(
    (enrolled ?? []).map((course) => ({
      courseId: course.courseid,
      courseName: course.fullname,
      sections: sectionsByCourse[course.courseid] ?? loadCachedContents(course.courseid),
    })),
  ), [enrolled, sectionsByCourse])

  const matches = useMemo(() => searchCourseResources(cachedResources, query), [cachedResources, query])
  const visible = tab === 'favorites' ? favorites : tab === 'recent' ? recent : matches

  const loadAll = async () => {
    if (!enrolled || !token || loading) return
    const missing = enrolled.filter((course) => !sectionsByCourse[course.courseid] && !loadCachedContents(course.courseid))
    if (missing.length === 0) return
    setLoading(true)
    try {
      for (let i = 0; i < missing.length; i += 4) {
        const batch = await Promise.all(missing.slice(i, i + 4).map(async (course) => {
          try { return [course.courseid, await fetchCourseContents(token, course.courseid)] as const }
          catch { return [course.courseid, null] as const }
        }))
        setSectionsByCourse((current) => ({ ...current, ...Object.fromEntries(batch) }))
      }
    } finally {
      setLoading(false)
    }
  }

  const open = (resource: CourseResource) => {
    const url = normalizeMoodleLink(resource.url)
    if (!url) return
    setRecent(recordCourseResourceVisit(resource))
    openExternal(url)
  }

  const toggleFavorite = (resource: CourseResource) => setFavorites(toggleCourseResourceFavorite(resource))

  return (
    <section className="space-y-3">
      <div className="app-card space-y-3 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="app-card-label inline-flex items-center gap-1.5"><Icon name="search" size={13} /> {t('courseResourcesTitle')}</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-3)]">{t('courseResourcesHint')}</p>
          </div>
          <button onClick={() => void loadAll()} disabled={!token || loading || !enrolled?.length} className="app-btn inline-flex shrink-0 items-center gap-1 px-2 py-1 text-[10px] disabled:opacity-50">
            <Icon name={loading ? 'sync' : 'restore'} size={11} className={loading ? 'animate-spin' : ''} /> {loading ? t('courseResourcesLoading') : t('courseResourcesLoad')}
          </button>
        </div>
        <label className="relative block">
          <Icon name="search" size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-3)]" />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setTab('search') }} placeholder={t('courseResourcesSearch')} className="app-input w-full pl-7 pr-3 text-xs" />
        </label>
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-1" role="tablist">
          {(['search', 'favorites', 'recent'] as const).map((value) => (
            <button key={value} role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className="min-w-0 rounded-lg px-1.5 py-1.5 text-[10px] transition-colors" title={t(`courseResourcesTab_${value}`)}>
              <span className="truncate">{t(`courseResourcesTab_${value}`)}</span> <span className="tabular-nums text-[var(--text-3)]">{value === 'search' ? matches.length : value === 'favorites' ? favorites.length : recent.length}</span>
            </button>
          ))}
        </div>
      </div>
      {!enrolled?.length ? (
        <p className="py-8 text-center text-xs text-[var(--text-3)]">{t('courseResourcesNoCourses')}</p>
      ) : visible.length === 0 ? (
        <div className="animate-modal-in rounded-xl border border-dashed border-[var(--line)] px-4 py-8 text-center text-xs text-[var(--text-3)]">
          <Icon name={tab === 'favorites' ? 'book' : 'search'} size={19} className="mb-2 opacity-50" />
          <p>{tab === 'search' && !query.trim() ? t('courseResourcesEmptyQuery') : t('courseResourcesEmpty')}</p>
        </div>
      ) : (
        <ul key={tab + query} className="animate-list-in space-y-1.5">
          {visible.map((resource) => (
            <ResourceRow key={`${resource.courseId}:${resource.id}`} resource={resource} favorite={isCourseResourceFavorite(resource, favorites)} onOpen={open} onToggleFavorite={toggleFavorite} date={('visitedAt' in resource && typeof resource.visitedAt === 'string' ? resource.visitedAt : undefined)} now={now} t={t} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ResourceRow({ resource, favorite, onOpen, onToggleFavorite, date, now, t }: {
  resource: CourseResource
  favorite: boolean
  onOpen: (resource: CourseResource) => void
  onToggleFavorite: (resource: CourseResource) => void
  date?: string
  now: number
  t: (key: string, params?: Record<string, string | number>) => string
}) {
  const safeUrl = normalizeMoodleLink(resource.url)
  const ago = date ? Math.max(0, Math.floor((now - new Date(date).getTime()) / 60000)) : null
  const agoLabel = ago == null ? '' : ago < 60 ? t('courseResourcesAgoMinutes', { n: ago }) : ago < 1440 ? t('courseResourcesAgoHours', { n: Math.floor(ago / 60) }) : t('courseResourcesAgoDays', { n: Math.floor(ago / 1440) })
  return (
    <li className="resource-row group flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-2.5 transition-colors hover:border-[var(--line-info)] hover:bg-[var(--surface-1)]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-1)] text-[var(--info)]"><Icon name={resource.modname === 'assign' ? 'pencil' : resource.modname === 'quiz' ? 'exam' : 'book'} size={14} /></span>
      <button onClick={() => safeUrl && onOpen(resource)} disabled={!safeUrl} className="min-w-0 flex-1 text-left disabled:opacity-50">
        <span className="block truncate text-xs font-medium text-[var(--text-1)]" title={resource.name}>{resource.name}</span>
        <span className="mt-0.5 block truncate text-[10px] text-[var(--text-3)]" title={`${resource.courseName} · ${resource.sectionName}${ago != null ? ` · ${agoLabel}` : ''}`}>{resource.courseName} · {resource.sectionName}{ago != null ? ` · ${agoLabel}` : ''}</span>
        {resource.description && <span className="mt-0.5 block truncate text-[10px] text-[var(--text-3)]" title={resource.description}>{resource.description}</span>}
      </button>
      <button onClick={() => onToggleFavorite(resource)} aria-pressed={favorite} aria-label={favorite ? t('courseResourcesUnfavorite') : t('courseResourcesFavorite')} className={'favorite-button shrink-0 rounded-lg p-1.5 transition-colors ' + (favorite ? 'text-[var(--due)]' : 'text-[var(--text-3)] hover:text-[var(--due)]')} title={favorite ? t('courseResourcesUnfavorite') : t('courseResourcesFavorite')}>
        <span className="inline-block" aria-hidden="true">{favorite ? '★' : '☆'}</span>
      </button>
    </li>
  )
}
