import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useI18n } from '../i18n'
import Icon from './Icon'
import {
  filterPalette,
  type PaletteAction,
  type PaletteGroup,
  type PaletteItem,
} from '../lib/palette'
import { parseQuickAdd } from '../lib/quickAdd'
import { formatDateTime } from '../lib/date'

interface Props {
  /** 候选清单（由 App 用 lib/palette.buildPalette 生成） */
  items: PaletteItem[]
  onRun: (action: PaletteAction) => void
  onClose: () => void
}

/**
 * 命令面板：一个入口找课程 / 作业 / 操作。
 * 纯展示 + 键盘导航；动作执行（切视图、跳课程…）全部回调给 App。
 */
export default function CommandPalette({ items, onRun, onClose }: Props) {
  const { t, locale } = useI18n()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  /**
   * 自然语言录入：`作业 周三 14:00 密码学报告` → 面板顶部多一条"新建作业"。
   * 解析失败（没触发词）就什么都没有，搜索体验一点不变。
   */
  const quickAdd = useMemo<PaletteItem | null>(() => {
    const parsed = parseQuickAdd(q)
    if (!parsed) return null
    return {
      id: 'quick:add',
      group: 'actions',
      label: t('paletteQuickAdd', { title: parsed.title }),
      sub: parsed.dueAt ? formatDateTime(parsed.dueAt, locale) : t('taskNoDue'),
      icon: 'plus',
      action: { kind: 'quickAddTask', title: parsed.title, dueAt: parsed.dueAt },
    }
  }, [q, t, locale])

  const results = useMemo(() => {
    const base = filterPalette(items, q)
    return quickAdd ? [quickAdd, ...base] : base
  }, [items, q, quickAdd])

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
      className="animate-fade-in fixed inset-0 z-[60] flex items-start justify-center bg-black/60 p-4 pt-[12vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
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
            results.map((item, idx) => (
              <div key={item.id}>
                {(idx === 0 || results[idx - 1].group !== item.group) && (
                  <div className="px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                    {groupLabel[item.group]}
                  </div>
                )}
                <button
                  data-idx={idx}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => run(item)}
                  className={
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs ' +
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
                        'max-w-[45%] shrink-0 truncate text-[10px] ' +
                        (idx === active ? 'opacity-80' : 'text-[var(--text-3)]')
                      }
                    >
                      {item.sub}
                    </span>
                  )}
                </button>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-[var(--line)] px-3 py-1.5 text-[10px] text-[var(--text-3)]">
          {q.trim() ? t('paletteHint') : t('paletteShortcuts')}
        </div>
      </div>
    </div>
  )
}
