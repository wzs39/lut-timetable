import { useCallback, useEffect, useState } from 'react'
import type { SyncSource } from '../types'
import { useI18n } from '../i18n'
import { KEYS } from '../lib/storage'
import { loadIdentityDiagnostics, type IdentityDiagnostics } from '../lib/diagnostics'
import { formatTime } from '../lib/date'

/**
 * Blok diagnostik read-only untuk tabel identitas (Settings).
 *
 * Tiga metrik: jumlah pelajaran per sumber, coverage tabel identitas
 * (baris berkode + pelajaran yang benar-benar resolve ke courseid Moodle),
 * dan stempel waktu sinkron terakhir per rantai. Mengikuti pola
 * SyncProtection: komponen mandiri yang memuat sendiri datanya, dengan
 * `revision` untuk memicu hitung ulang setelah sinkron.
 */
interface Props {
  sources: SyncSource[]
  revision: string | number
  /** 清 enrol 缓存并强制重取（重建身份表）；无 token 时返回 false。 */
  onResync: () => Promise<boolean>
}

export default function IdentityDiagnostics({ sources, revision, onResync }: Props) {
  const { t } = useI18n()
  const [diag, setDiag] = useState<IdentityDiagnostics | null>(null)
  const [resyncing, setResyncing] = useState(false)
  const [resyncMsg, setResyncMsg] = useState<string | null>(null)

  const refresh = useCallback(() => {
    // Tanpa hook Moodle: token state hidup di provider di atas Settings;
    // snapshot langsung dari storage cukup untuk diagnostik read-only.
    setDiag(
      loadIdentityDiagnostics(
        sources,
        readLastSync(KEYS.gradesSource),
        readLastSync(KEYS.moodleSource),
      ),
    )
  }, [sources])

  useEffect(refresh, [refresh, revision])

  const handleResync = async () => {
    setResyncing(true)
    setResyncMsg(null)
    try {
      const ok = await onResync()
      // revision（md.busy）变化已触发 refresh；这里再刷一次兜底时序。
      refresh()
      setResyncMsg(ok ? t('diagResyncDone') : t('diagResyncNoToken'))
    } catch {
      setResyncMsg(t('diagResyncFail'))
    } finally {
      setResyncing(false)
    }
  }

  if (!diag) return null
  const pct =
    diag.identityTotal > 0 ? Math.round((diag.identityCoded / diag.identityTotal) * 100) : null
  const resolvePct =
    diag.lessonCoded > 0 ? Math.round((diag.lessonResolved / diag.lessonCoded) * 100) : null

  return (
    <section>
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
        {t('diagTitle')}
      </h4>
      <div className="space-y-1.5 rounded-md border border-[var(--line)] bg-[var(--surface-2)] p-2 text-[11px]">
        {/* Sumber + jumlah pelajaran */}
        {diag.sources.length === 0 ? (
          <p className="text-[var(--text-3)]">{t('diagNoSources')}</p>
        ) : (
          diag.sources.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  className={
                    'inline-block h-2 w-2 shrink-0 rounded-full align-middle ' +
                    (s.type === 'sisu'
                      ? 'bg-[var(--info)]'
                      : s.type === 'timeedit'
                        ? 'bg-[var(--violet)]'
                        : 'bg-[var(--text-3)]')
                  }
                />
                <span className="min-w-0 truncate text-[var(--text-2)]">{s.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-[var(--text-3)]">
                {t('lessonsN', { n: s.count })}
                {s.lastSync ? ` · ${formatTime(s.lastSync)}` : ''}
              </span>
            </div>
          ))
        )}

        {/* Coverage identitas */}
        <div className="border-t border-[var(--line)] pt-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-2)]">{t('diagCoverage')}</span>
            <span className="shrink-0 tabular-nums">
              {pct == null ? t('diagEmptyTable') : `${diag.identityCoded}/${diag.identityTotal} · ${pct}%`}
            </span>
          </div>
          {pct != null && (
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-[var(--hover-1)]">
              <div className="h-full rounded-full bg-[var(--ok)]" style={{ width: `${pct}%` }} />
            </div>
          )}
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className="text-[var(--text-3)]">{t('diagResolve')}</span>
            <span className="shrink-0 tabular-nums text-[var(--text-3)]">
              {resolvePct == null ? '—' : `${diag.lessonResolved}/${diag.lessonCoded} · ${resolvePct}%`}
            </span>
          </div>
        </div>

        {/* Stempel waktu sinkron terakhir */}
        <div className="flex items-center justify-between gap-2 border-t border-[var(--line)] pt-1.5">
          <span className="text-[var(--text-2)]">{t('diagIdentityAge')}</span>
          <span className="shrink-0 text-[var(--text-3)]">
            {diag.identityUpdatedAt ? formatTime(diag.identityUpdatedAt) : '—'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[var(--text-2)]">{t('diagMoodleSync')}</span>
          <span className="shrink-0 text-[var(--text-3)]">
            {diag.moodleLastSync ? formatTime(diag.moodleLastSync) : '—'}
          </span>
        </div>
        {diag.moodleIcsLastSync && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[var(--text-2)]">{t('diagMoodleIcsSync')}</span>
            <span className="shrink-0 text-[var(--text-3)]">{formatTime(diag.moodleIcsLastSync)}</span>
          </div>
        )}
      </div>
      <button
        onClick={() => void handleResync()}
        disabled={resyncing}
        className="mt-1.5 w-full rounded-md bg-[var(--surface-2)] px-2 py-1.5 text-[11px] hover:bg-[var(--hover-1)] disabled:opacity-50"
      >
        {resyncing ? t('diagResyncing') : t('diagResync')}
      </button>
      {resyncMsg && <p className="mt-1 text-[10px] text-[var(--text-2)]">{resyncMsg}</p>}
    </section>
  )
}

/** Baca `lastSync` dari payload storage Moodle (grades/moodle source). */
function readLastSync(storageKey: string): string | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { lastSync?: unknown }
    return typeof parsed.lastSync === 'string' ? parsed.lastSync : null
  } catch {
    return null
  }
}
