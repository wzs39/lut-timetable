import { useMemo, useState } from 'react'
import type { CourseGrades, GradeItem } from '../lib/grades'
import { courseProjection, effectiveGrade } from '../lib/gradeCalc'
import { useI18n } from '../i18n'
import Icon from './Icon'

/**
 * Kartu satu kursus di daftar nilai: proyeksi what-if.
 *
 * State lokal (filter teks + override nilai harapan) dimiliki komponen ini —
 * data Moodle tetap read-only; override hanya mengubah proyeksi, tidak pernah
 * ditulis balik ke sumber.
 */
export default function GradeCourseCard({
  c,
  onJumpToCourse,
}: {
  c: CourseGrades
  onJumpToCourse?: (code: string) => void
}) {
  const { t } = useI18n()
  const [overrides, setOverrides] = useState<Record<number, number>>({})
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState(false)

  const proj = useMemo(() => courseProjection(c, overrides), [c, overrides])
  // LUT tidak mengekspos bobot: meta memakai hitungan item, bukan persen.
  const weighted = proj.coveredWeight > 0
  const gradedCount = c.items.filter((it) => it.grade != null).length

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return c.items
      .map((it, i) => ({ it, i }))
      .filter(
        ({ it }) =>
          !kw ||
          it.name.toLowerCase().includes(kw) ||
          (it.feedback ?? '').toLowerCase().includes(kw),
      )
  }, [c.items, q])

  const setOverride = (i: number, raw: string) => {
    const v = raw.trim()
    setOverrides((prev) => {
      const next = { ...prev }
      if (v === '') delete next[i]
      else {
        const n = Number(v)
        if (Number.isNaN(n)) return prev
        next[i] = n
      }
      return next
    })
  }

  const hasOverrides = Object.keys(overrides).length > 0
  const dirty = hasOverrides || q.trim() !== ''

  return (
    <li className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2">
      {/* Header: kode + nama + nilai saat ini */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          {c.matched ? (
            <button
              onClick={() => onJumpToCourse?.(c.course)}
              title={t('jumpToCourse')}
              className="shrink-0 font-mono text-[11px] font-semibold text-[var(--info)] hover:underline"
            >
              {c.course}
            </button>
          ) : (
            <span className="shrink-0 font-mono text-[11px] font-semibold">{c.course}</span>
          )}
          {c.courseTitle && (
            <span className="min-w-0 truncate text-[11px] text-[var(--text-2)]" title={c.courseTitle}>
              {c.courseTitle}
            </span>
          )}
        </span>
        <span className="shrink-0 tabular-nums text-[11px] font-semibold text-[var(--text-1)]">
          <span title={t('gradeProjTitle')}>
            {proj.projected != null ? proj.projected.toFixed(1) : '—'}%
          </span>
          {proj.projected != null && c.average != null && Math.abs(proj.projected - c.average) >= 0.05 && (
            <span className="ml-1 text-[10px] font-normal text-[var(--text-3)]" title={t('gradeMoodleAvg')}>
              ({c.average.toFixed(0)}%)
            </span>
          )}
        </span>
      </div>

      {/* Meta: bobot tercover + belum dinilai + toggle expand */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] text-[var(--text-3)]">
          {weighted
            ? t('gradeCovered', { w: proj.coveredWeight.toFixed(0) })
            : t('gradeGradedOf', { g: gradedCount, n: c.items.length })}
          {proj.ungraded > 0 && ` · ${t('gradeUngraded', { n: proj.ungraded })}`}
        </span>
        <button
          onClick={() => setExpanded((o) => !o)}
          className="shrink-0 text-[10px] text-[var(--text-2)] hover:text-[var(--text-1)]"
          title={t('toggleHint')}
        >
          <span className="inline-flex items-center gap-0.5">
            {t(expanded ? 'gradeCollapse' : 'gradeWhatIf')}
            <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={10} />
          </span>
        </button>
      </div>

      {/* Isi: filter + item */}
      {expanded && (
        <div className="animate-modal-in mt-2 space-y-1.5">
          {c.items.length > 3 && (
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('gradeFilterPh')}
              className="w-full rounded-md border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1 text-[11px] focus:outline-none focus:border-[var(--info)]"
            />
          )}
          <ul className="space-y-1">
            {filtered.map(({ it, i }) => (
              <GradeItemRow
                key={i}
                it={it}
                override={overrides[i]}
                onOverride={(v) => setOverride(i, v)}
              />
            ))}
            {filtered.length === 0 && (
              <li className="py-1 text-center text-[10px] text-[var(--text-3)]">{t('assignNoMatch')}</li>
            )}
          </ul>
          {hasOverrides && (
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="text-[10px] text-[var(--text-3)]">{t('gradeWhatIfHint')}</span>
              <button
                onClick={() => setOverrides({})}
                className="rounded bg-[var(--surface-1)] px-2 py-0.5 text-[10px] text-[var(--text-2)] hover:bg-[var(--hover-1)]"
              >
                {t('gradeReset')}
              </button>
            </div>
          )}
        </div>
      )}
      {dirty && !expanded && (
        <span className="sr-only">{t('gradeWhatIfHint')}</span>
      )}
    </li>
  )
}

/** Satu baris item nilai: nama · bobot · progress · nilai asli vs harapan. */
function GradeItemRow({
  it,
  override,
  onOverride,
}: {
  it: GradeItem
  override: number | undefined
  onOverride: (v: string) => void
}) {
  const { t } = useI18n()
  const eff = effectiveGrade(it, override)
  // Editing adalah state baris ini: tombol '—'/'90' membuka editor (draft
  // kosong untuk item belum dinilai, nilai asli untuk yang sudah), ✕/Enter
  // kosong menghapus override. Jangan turunkan "editing" dari override —
  // item belum dinilai butuh membuka editor tanpa override yang sudah ada.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const openEditor = () => {
    setDraft(override != null ? String(override) : '')
    setEditing(true)
  }

  const commit = () => {
    onOverride(draft.trim())
    setEditing(false)
  }

  return (
    <li className="flex items-center gap-2 text-[10px]">
      <span className="min-w-0 flex-1 truncate text-[var(--text-2)]" title={it.feedback || it.name}>
        {editing && <span className="mr-1 inline-flex align-[-1px] text-[var(--info)]">✎</span>}
        {it.name}
      </span>
      {it.weight != null && (
        <span className="shrink-0 tabular-nums text-[var(--text-3)]">{t('gradesWeight')} {it.weight}%</span>
      )}
      <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full border border-[var(--line)] bg-[var(--surface-1)]">
        <span
          className="block h-full rounded-full transition-[width] duration-300"
          style={{
            width: `${Math.min(100, eff ?? 0)}%`,
            background: editing ? 'var(--accent)' : it.grade != null ? 'var(--info)' : 'var(--line)',
          }}
        />
      </span>
      {editing ? (
        <span className="flex w-14 shrink-0 items-center gap-0.5">
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              onOverride(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') setEditing(false)
            }}
            inputMode="decimal"
            aria-label={t('gradeExpectPh', { name: it.name })}
            className="w-9 rounded border border-[var(--info)] bg-[var(--surface-1)] px-1 text-right tabular-nums text-[10px] focus:outline-none"
          />
          <button
            onClick={() => {
              onOverride('')
              setEditing(false)
            }}
            className="text-[var(--text-3)] hover:text-[var(--danger)]"
            title={t('gradeReset')}
          >
            <Icon name="close" size={9} />
          </button>
        </span>
      ) : (
        <button
          onClick={openEditor}
          className="w-14 shrink-0 text-right tabular-nums text-[var(--text-1)] hover:text-[var(--info)]"
          title={t('gradeWhatIfTitle')}
        >
          {it.grade != null ? `${it.grade}` : '—'}
        </button>
      )}
    </li>
  )
}
