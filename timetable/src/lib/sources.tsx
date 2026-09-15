import type { ReactNode } from 'react'
import type { Lesson } from '../types'
import Icon from '../components/Icon'

/** Ikon sumber: satu-satunya definisi (dipakai TodayView, BatchFilter, ConflictCheck) */
export const SOURCE_ICON: Record<Lesson['source'], ReactNode> = {
  sisu: <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--info)]" aria-label="SISU" />,
  timeedit: <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--violet)]" aria-label="TimeEdit" />,
  manual: <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--ok)]" aria-label="Manual" />,
}

/** Re-export for convenience so consumers don't import Icon separately */
export { Icon }
