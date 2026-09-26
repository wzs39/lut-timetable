import type { ReactNode } from 'react'
import type { Lesson, SyncSource } from '../types'
import { QUICK_LINKS } from '../lib/quickLinks'
import { formatTime } from '../lib/date'
import ExternalLink from './ExternalLink'
import { useI18n } from '../i18n'
import Icon from './Icon'
import CourseSearch from './CourseSearch'
import ManualLessonForm from './ManualLessonForm'
import { useCollapse } from '../lib/useCollapse'
import { KEYS } from '../lib/storage'

/**
 * 侧栏内的可折叠分区：标题行本身就是开关，选择记忆在 localStorage。
 * 与 CollapsiblePanel 的卡片视觉不同（侧栏是扁平区块），但共用 useCollapse
 * 与 collapse-wrap 动画，行为保持一致；`defaultOpen=false` 用于低频表单
 * （从未选择过的用户默认看到收起状态）。
 */
function Section({
  title,
  storageKey,
  defaultOpen = true,
  hint,
  children,
}: {
  title: string
  storageKey: string
  defaultOpen?: boolean
  /** 收起时也能看到的摘要（如「3 个来源」），给折叠区一点信息线索 */
  hint?: string
  children: ReactNode
}) {
  const { t } = useI18n()
  const [open, toggle] = useCollapse(storageKey, defaultOpen)
  return (
    <section>
      <button
        onClick={toggle}
        aria-expanded={open}
        title={t('toggleHint')}
        className="mb-2 flex w-full items-center gap-1 text-left"
      >
        <span
          className={'collapse-chevron shrink-0 text-[var(--text-3)]' + (open ? ' open' : '')}
          aria-hidden
        >
          <Icon name="chevron-down" size={11} />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">
          {title}
        </span>
        {hint && !open && (
          <span className="ml-auto shrink-0 truncate text-[10px] text-[var(--text-3)]">{hint}</span>
        )}
      </button>
      <div className={`collapse-wrap${open ? ' open' : ' is-closed'}`} inert={!open}>
        <div>{children}</div>
      </div>
    </section>
  )
}

/** 桌面用的普通标题块（不可折叠） */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">
        {title}
      </h2>
      {children}
    </div>
  )
}

/**
 * 分区的唯一渲染入口。
 *
 * 桌面（非 embedded）保持原样：没有 `desktopKey` 的块是普通标题（同步日历 /
 * 查询课程），其余可折叠并沿用 sidebar* key 的记忆；
 * 抽屉（embedded）四块一律折叠且默认收起——手机打开「更多」先只看到动作
 * 网格，数据与工具按需展开，折叠状态存在 sheet* key，与桌面选择互不干扰。
 */
function Group({
  embedded,
  title,
  desktopKey,
  desktopOpen = true,
  sheetKey,
  hint,
  children,
}: {
  embedded: boolean
  title: string
  desktopKey?: string
  desktopOpen?: boolean
  sheetKey: string
  hint?: string
  children: ReactNode
}) {
  if (embedded)
    return (
      <Section title={title} storageKey={sheetKey} defaultOpen={false} hint={hint}>
        {children}
      </Section>
    )
  if (!desktopKey) return <Block title={title}>{children}</Block>
  return (
    <Section title={title} storageKey={desktopKey} defaultOpen={desktopOpen}>
      {children}
    </Section>
  )
}

/** 同步日历区：来源卡片 + 每个来源的「同步」+ 在设置中管理 */
function SourcesPanel({
  sources,
  syncing,
  syncMessage,
  onSync,
  onOpenSettings,
}: {
  sources: SyncSource[]
  syncing: boolean
  syncMessage: string | null
  onSync: (s: SyncSource) => void
  onOpenSettings: () => void
}) {
  const { t } = useI18n()
  return (
    <>
      {sources.length === 0 ? (
        <p className="text-[11px] text-[var(--text-3)]">{t('sourceEmpty')}</p>
      ) : (
        <div className="space-y-2">
          {sources.map((s) => (
            <div
              key={s.id}
              className="rounded-md bg-[var(--surface-2)] border border-[var(--line)] p-2 text-xs"
            >
              <div className="flex items-center justify-between">
                <span className="min-w-0 truncate font-medium">
                  <span className="inline-flex items-center gap-1">
                    <span
                      className={
                        'inline-block h-2 w-2 rounded-full ' +
                        (s.type === 'sisu' ? 'bg-[var(--info)]' : 'bg-[var(--violet)]')
                      }
                    />{' '}
                    {s.type === 'sisu' ? 'SISU' : 'TimeEdit'}
                  </span>{' '}
                  · <span className="text-[10px] font-normal text-[var(--text-3)]">{s.label}</span>
                </span>
                <button
                  onClick={() => onSync(s)}
                  disabled={syncing}
                  className="shrink-0 rounded bg-[var(--surface-1)] hover:bg-[var(--hover-1)] disabled:opacity-50 px-2 py-0.5 text-[10px]"
                >
                  {t('syncNow')}
                </button>
              </div>
              <div className="text-[10px] text-[var(--text-3)] mt-0.5 truncate" title={s.url}>
                {s.url}
              </div>
              <div className="mt-1 text-[10px] text-[var(--text-3)]">
                {t('lessonsN', { n: s.count })}
                {s.lastSync ? ` · ${formatTime(s.lastSync)}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
      {syncMessage && <p className="text-[11px] text-[var(--text-2)] mt-2">{syncMessage}</p>}
      <button
        onClick={onOpenSettings}
        className="mt-2 w-full rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] px-2 py-1.5 text-[11px] text-[var(--text-2)]"
      >
        <span className="inline-flex items-center gap-1.5">
          <Icon name="settings" size={12} /> {t('manageInSettings')}
        </span>
      </button>
    </>
  )
}

interface Props {
  sources: SyncSource[]
  syncing: boolean
  syncMessage: string | null
  onSync: (s: SyncSource) => void
  onAddManual: (l: Omit<Lesson, 'id' | 'source'>) => void
  onOpenSettings: () => void
  /** 嵌在移动端底部抽屉里：自身占满剩余高度并向上收边（不再是整屏侧栏） */
  embedded?: boolean
}

export default function Sidebar({
  sources,
  syncing,
  syncMessage,
  onSync,
  onAddManual,
  onOpenSettings,
  embedded = false,
}: Props) {
  const { t } = useI18n()

  return (
    // 宽度由外层容器决定（桌面可拖拽调宽；embedded = 移动端抽屉内占满剩余高度）
    <aside
      className={
        'w-full min-w-0 shrink-0 bg-[var(--surface-1)] flex flex-col overflow-y-auto safe-bottom ' +
        (embedded
          ? 'flex-1 min-h-0 border-t border-[var(--line)]'
          : 'h-full border-r border-[var(--line)]')
      }
    >
      <div className="p-4 space-y-6">
        <Group
          embedded={embedded}
          title={t('syncCalendar')}
          sheetKey={KEYS.sheetSourcesOpen}
          hint={t('sourcesN', { n: sources.length })}
        >
          <SourcesPanel
            sources={sources}
            syncing={syncing}
            syncMessage={syncMessage}
            onSync={onSync}
            onOpenSettings={onOpenSettings}
          />
        </Group>

        <Group
          embedded={embedded}
          title={t('addManual')}
          desktopKey={KEYS.sidebarManualOpen}
          desktopOpen={false}
          sheetKey={KEYS.sheetManualOpen}
        >
          <ManualLessonForm onAddManual={onAddManual} />
        </Group>

        <Group embedded={embedded} title={t('courseSearch')} sheetKey={KEYS.sheetSearchOpen}>
          <CourseSearch />
        </Group>

        <Group
          embedded={embedded}
          title={t('quickLinks')}
          desktopKey={KEYS.sidebarLinksOpen}
          sheetKey={KEYS.sheetLinksOpen}
        >
          <div className="grid grid-cols-2 gap-1.5">
            {QUICK_LINKS.map((l) => (
              <ExternalLink
                key={l.key}
                href={l.url}
                className="rounded-md bg-[var(--surface-2)] hover:bg-[var(--hover-1)] border border-[var(--line)] px-2 py-1.5 text-[11px] text-[var(--text-2)] truncate"
                title={l.url}
              >
                {<Icon name={l.icon} size={12} />} {l.name}
              </ExternalLink>
            ))}
          </div>
        </Group>
      </div>
    </aside>
  )
}
