import { useI18n } from '../../i18n'
import type { CourseSection } from '../../lib/contents'
import type { IconName } from '../Icon'
import ExternalLink from '../ExternalLink'
import Icon from '../Icon'

const MOD_ICON: Record<string, IconName> = {
  assign: 'pencil',
  quiz: 'exam',
  forum: 'megaphone',
  resource: 'book',
  book: 'book',
  url: 'link',
  page: 'note',
  folder: 'book',
  label: 'pin',
  choice: 'check',
  feedback: 'check',
  glossary: 'book',
  wiki: 'book',
  scorm: 'live',
  h5pactivity: 'live',
  bigbluebuttonbn: 'live',
  lesson: 'book',
  workshop: 'pencil',
  imscp: 'book',
  survey: 'check',
  data: 'book',
  chat: 'megaphone',
}

export default function CourseContentsTree({
  sections,
  onRefresh,
  busy,
}: {
  sections: CourseSection[]
  onRefresh: () => void
  busy: boolean
}) {
  const { t } = useI18n()
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
          {t('contentsTitle')}
        </span>
        <button onClick={onRefresh} disabled={busy} className="app-btn-ghost px-1.5 py-0.5 disabled:opacity-50" title={t('contentsRefresh')}>
          <Icon name="restore" size={11} />
        </button>
      </div>
      <ul className="space-y-1.5">
        {sections.map((s) => (
          <li key={s.id}>
            <div className="text-[10px] font-semibold text-[var(--text-2)]">{s.name}</div>
            <ul className="mt-0.5 space-y-0.5">
              {s.modules.map((m) => (
                <li key={m.id} className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-[var(--surface-2)]">
                  <Icon name={MOD_ICON[m.modname] ?? 'book'} size={11} className="shrink-0 text-[var(--text-3)]" />
                  {m.url ? (
                    <ExternalLink href={m.url} className="min-w-0 flex-1 truncate text-[var(--info)] hover:underline" title={m.description || m.name}>
                      {m.name}
                    </ExternalLink>
                  ) : (
                    <span className="min-w-0 flex-1 truncate" title={m.description || m.name}>{m.name}</span>
                  )}
                  {m.completion === 1 || m.completion === 2 ? (
                    <Icon name="check" size={11} className="shrink-0 text-[var(--ok)]" />
                  ) : m.completion === 3 ? (
                    <Icon name="close" size={11} className="shrink-0 text-[var(--danger)]" />
                  ) : null}
                </li>
              ))}
              {s.modules.length === 0 && <li className="py-0.5 text-[10px] text-[var(--text-3)]">{t('contentsSectionEmpty')}</li>}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  )
}
