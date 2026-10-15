import { useMemo, useState } from 'react'
import {
  activeSchemeWeights,
  confirmGradeScheme,
  updateGradeSchemeOverride,
  type SchemeWeight,
} from '../lib/gradeScheme'
import { useI18n } from '../i18n'
import Icon from './Icon'

interface Props {
  courseId: number
  courseCode: string
  weights: SchemeWeight[]
  onConfirmed?: () => void
}

export default function GradeSchemeReview({ courseId, courseCode, weights, onConfirmed }: Props) {
  const { t } = useI18n()
  const active = activeSchemeWeights(courseId)
  const [draft, setDraft] = useState<SchemeWeight[]>(() => active ?? weights)
  const [saved, setSaved] = useState(false)
  const hasActive = active !== null
  const total = useMemo(() => draft.reduce((sum, entry) => sum + (Number(entry.weight) || 0), 0), [draft])

  const savePreview = () => {
    updateGradeSchemeOverride(courseId, courseCode, draft, false)
    setSaved(true)
  }

  const confirm = () => {
    updateGradeSchemeOverride(courseId, courseCode, draft, true)
    confirmGradeScheme(courseId)
    setSaved(false)
    onConfirmed?.()
  }

  return (
    <div className="mt-2 rounded-md border border-[var(--line-info)] bg-[var(--tint-info)] p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold text-[var(--info)]">{t('gradeSchemeReview')}</span>
        {hasActive && <span className="text-[10px] text-[var(--ok)]">{t('gradeSchemeActive')}</span>}
      </div>
      <p className="mt-1 text-[10px] text-[var(--text-2)]">{t('gradeSchemeScopeWarning')}</p>
      <ul className="mt-2 space-y-1">
        {draft.map((entry, index) => (
          <li key={`${entry.label}-${index}`} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[10px]" title={entry.label}>{entry.label}</span>
            <label className="flex shrink-0 items-center gap-1 text-[10px] text-[var(--text-3)]">
              <input
                aria-label={`${entry.label} ${t('gradeSchemeWeight')}`}
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={entry.weight}
                onChange={(event) => {
                  const value = Number(event.target.value)
                  setSaved(false)
                  setDraft((current) => current.map((item, i) => i === index ? { ...item, weight: value } : item))
                }}
                className="w-14 rounded border border-[var(--line)] bg-[var(--surface-1)] px-1 py-0.5 text-right tabular-nums"
              /> %
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[10px] tabular-nums text-[var(--text-2)]">{t('gradeSchemeTotal', { w: total.toFixed(1) })}{saved ? ` · ${t('gradeSchemeSaved')}` : ''}</span>
        <div className="flex gap-1.5">
          <button onClick={savePreview} className="app-btn px-2 py-1 text-[10px]">{t('gradeSchemeSavePreview')}</button>
          <button onClick={confirm} className="app-btn-primary inline-flex items-center gap-1 px-2 py-1 text-[10px]">
            <Icon name="check" size={11} /> {t('gradeSchemeConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
