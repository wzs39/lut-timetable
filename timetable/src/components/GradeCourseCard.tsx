import { useMemo, useState } from 'react'
import type { CourseGrades, GradeItem } from '../lib/grades'
import { contributionOf, courseProjection, effectiveGrade, gradeTargetPlan } from '../lib/gradeCalc'
import { KEYS, readString, writeString } from '../lib/storage'
import { useI18n } from '../i18n'
import Icon from './Icon'

/** 目标档位（百分制）。LUT 的 1–5 换算各课不同，所以直接用百分比，不替用户换算。 */
const GRADE_TARGETS = [60, 70, 80, 90]
const DEFAULT_TARGET = 80

function loadTarget(): number {
  const saved = Number(readString(KEYS.gradeTarget))
  return GRADE_TARGETS.includes(saved) ? saved : DEFAULT_TARGET
}

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
  onOpenUngradedTasks,
}: {
  c: CourseGrades
  onJumpToCourse?: (code: string) => void
  /** Ada di ≥1: chip "N belum dinilai" jadi tautan ke daftar tugas tersaring kursus ini. */
  onOpenUngradedTasks?: () => void
}) {
  const { t } = useI18n()
  const [overrides, setOverrides] = useState<Record<number, number>>({})
  const [q, setQ] = useState('')
  const [expanded, setExpanded] = useState(false)

  const proj = useMemo(() => courseProjection(c, overrides), [c, overrides])
  // 目标分数：全局偏好（一次选定，所有课共用），存 storage 以便重开后仍在
  const [target, setTarget] = useState<number>(loadTarget)
  const pickTarget = (v: number) => {
    setTarget(v)
    writeString(KEYS.gradeTarget, String(v))
  }
  const plan = useMemo(
    () => gradeTargetPlan(c.items, overrides, target),
    [c.items, overrides, target],
  )
  // LUT tidak selalu mengekspos bobot per item: meta memakai hitungan item
  // bila tak ada bobot sama sekali, dan menandai sebagian berbobot.
  const weighted = proj.coveredWeight > 0
  const weightTotal = c.items.reduce((s, it) => s + (it.weight != null ? it.weight : 0), 0)
  const partialWeight = weighted && weightTotal > 0 && weightTotal < 100 - 0.5
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
          <span title={t('gradeCurTitle')}>
            {proj.current != null ? proj.current.toFixed(1) : '—'}%
          </span>
          {proj.current != null && proj.coveredAvg != null && Math.abs(proj.current - proj.coveredAvg) >= 0.05 && (
            <span className="ml-1 text-[10px] font-normal text-[var(--text-3)]" title={t('gradeCoveredAvgTitle')}>
              ({proj.coveredAvg.toFixed(0)}%)
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
          {partialWeight && ` · ${t('gradePartialWeight', { w: weightTotal.toFixed(0) })}`}
          {proj.ungraded > 0 && ` · `}
          {proj.ungraded > 0 && onOpenUngradedTasks ? (
            <button
              onClick={onOpenUngradedTasks}
              title={t('gradeUngradedJumpTitle')}
              className="inline-flex items-center gap-0.5 text-[var(--text-3)] hover:text-[var(--text-1)] hover:underline"
            >
              {t('gradeUngraded', { n: proj.ungraded })} <Icon name="chevron-right" size={9} />
            </button>
          ) : (
            proj.ungraded > 0 && <span>{t('gradeUngraded', { n: proj.ungraded })}</span>
          )}
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
          {/* 目标模式：选一个目标分，看剩下未评分的部分平均需要多少 */}
          <div className="flex flex-wrap items-center gap-1 text-[10px]">
            <span className="shrink-0 text-[var(--text-3)]">{t('gradeTargetLabel')}</span>
            {GRADE_TARGETS.map((v) => (
              <button
                key={v}
                onClick={() => pickTarget(v)}
                aria-pressed={v === target}
                className={
                  'shrink-0 rounded-full border px-1.5 py-px tabular-nums ' +
                  (v === target
                    ? 'border-[var(--info)] text-[var(--info)]'
                    : 'border-[var(--line)] text-[var(--text-2)] hover:bg-[var(--hover-1)]')
                }
              >
                {v}%
              </button>
            ))}
            <span
              className={
                'ml-auto shrink-0 text-right tabular-nums ' +
                (plan.status === 'unreachable'
                  ? 'text-[var(--due)]'
                  : plan.status === 'reached'
                    ? 'text-[var(--ok)]'
                    : 'text-[var(--text-2)]')
              }
            >
              {plan.status === 'possible' &&
                t('gradeTargetNeed', { n: Math.ceil(plan.requiredAvg ?? 0) })}
              {plan.status === 'reached' && t('gradeTargetReached')}
              {plan.status === 'unreachable' &&
                t('gradeTargetUnreachable', { max: plan.maxFinal.toFixed(0) })}
              {plan.status === 'done' && t('gradeTargetDone')}
            </span>
          </div>
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
  // Kontribusi ke total (w·g/100) — ikut override secara live saat what-if.
  const contrib = contributionOf(it, override)
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
      {(it.weight != null || contrib != null || it.classAvg != null) && (
        <span className="shrink-0 tabular-nums text-[var(--text-3)]">
          {it.weight != null && `${t('gradesWeight')} ${it.weight}%`}
          {contrib != null && (
            <span className="ml-1 text-[var(--info)]" title={t('gradeContribTitle')}>
              +{contrib.toFixed(1)}
            </span>
          )}
          {it.classAvg != null && (
            <span className="ml-1" title={t('gradesClassAvg')}>
              {t('gradesClassAvgShort')} {it.classAvg}%
            </span>
          )}
        </span>
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
          {/* Teks resmi Moodle ("Passed"/"8.00") lebih dulu; persen sebagai fallback. */}
          {it.gradeText ?? (it.grade != null ? `${it.grade}` : '—')}
        </button>
      )}
    </li>
  )
}
