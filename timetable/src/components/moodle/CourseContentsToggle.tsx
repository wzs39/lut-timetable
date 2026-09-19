import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import {
  fetchCourseContents,
  loadCachedContents,
  type CourseSection,
} from '../../lib/contents'
import Icon from '../Icon'
import CourseContentsTree, { setContentsTokenSource } from './CourseContentsTree'

/** Expand/collapse tombol konten kursus + pohon kontennya (lazy fetch). */
export default function CourseContentsToggle({
  courseId,
  token,
}: {
  courseId: number
  token: { token: string; userid?: number } | null
}) {
  const { t } = useI18n()
  // Tree memanggil markActivityCompletion lewat holder ini (hindari prop
  // drilling token ke tiap node).
  setContentsTokenSource(token)
  const [open, setOpen] = useState(false)
  const [sections, setSections] = useState<CourseSection[] | null>(() => loadCachedContents(courseId))
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (force = false) => {
      if (busy) return
      setBusy(true)
      try {
        setSections(await fetchCourseContents(token, courseId, { force }))
      } catch {
        setSections(null)
      } finally {
        setBusy(false)
      }
    },
    [busy, token, courseId],
  )

  useEffect(() => {
    if (open && !sections && !busy) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    // display: contents：在 flex 行（CoursesSection <li>）里让按钮和展开面板
    // 成为 <li> 的直接 flex 项——按钮 shrink-0 留在行内，面板 basis-full 换行
    // 占满。此前根节点 w-full 会抢占整行宽度，把课程名挤成 1 字宽竖排。
    <div className="contents">
      <button
        onClick={() => setOpen((o) => !o)}
        className="app-btn-ghost shrink-0 px-1.5 py-1"
        title={t('contentsToggle')}
      >
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} />
      </button>
      {open && (
        <div className="animate-modal-in order-last w-full basis-full">
          {busy && !sections && <p className="py-2 text-center text-[11px] text-[var(--text-3)]">{t('contentsLoading')}</p>}
          {!busy && !sections && <p className="py-2 text-center text-[11px] text-[var(--text-3)]">{t('contentsEmpty')}</p>}
          {sections && sections.length === 0 && (
            <p className="py-2 text-center text-[11px] text-[var(--text-3)]">{t('contentsEmpty')}</p>
          )}
          {sections && sections.length > 0 && (
            <CourseContentsTree
              sections={sections}
              onRefresh={() => void load(true)}
              busy={busy}
              onToggleComplete={() => void load(true)}
            />
          )}
        </div>
      )}
    </div>
  )
}
