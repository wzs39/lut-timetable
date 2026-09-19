import { useCallback, useEffect, useState } from 'react'
import type { Lesson } from '../types'
import {
  loadTombstones,
  removeTombstone,
  clearTombstones,
  loadOverrides,
  deleteOverride,
  clearOverrides,
} from '../lib/store'
import { useI18n } from '../i18n'
import Icon from './Icon'

function hhmm(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

/** Tombstone key: "CODE|start|end" | "uid:..." | "id:..." -> label yang mudah dibaca */
function tombLabel(key: string): string {
  const [code, start, end] = key.split('|')
  if (code && start && end) {
    const s = new Date(start)
    const e = new Date(end)
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      return `${code} · ${s.getMonth() + 1}/${s.getDate()} ${hhmm(s)}–${hhmm(e)}`
    }
  }
  return key.replace(/^(uid|id):/, '')
}

/** Ringkas isi patch override (kode dari key jika ada) */
function overrideLabel(key: string, patch: Partial<Lesson>): string {
  const bits: string[] = []
  const keyCode = key.split('|')[0]
  if (key.includes('|') && keyCode) bits.push(keyCode)
  if (patch.title) bits.push(patch.title)
  if (patch.code) bits.push(patch.code)
  if (patch.location) bits.push(patch.location)
  if (patch.start && patch.end) {
    const s = new Date(patch.start)
    const e = new Date(patch.end)
    if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
      bits.push(
        `${s.getMonth() + 1}/${s.getDate()} ${hhmm(s)}–${hhmm(e)}`,
      )
    }
  }
  return bits.join(' · ') || '?'
}

interface Props {
  /** berubah setelah sinkronisasi/hapus -> memicu refresh daftar */
  revision: string | number
}

/**
 * Manajemen sinkronisasi: lihat & cabut tombstone penghapusan + override
 * suntingan yang melindungi modifikasi pengguna dari sync otomatis.
 */
export default function SyncProtection({ revision }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [tombs, setTombs] = useState<string[]>([])
  const [ovrs, setOvrs] = useState<[string, Partial<Lesson>][]>([])

  const refresh = useCallback(() => {
    setTombs([...loadTombstones()])
    setOvrs(Object.entries(loadOverrides()))
  }, [])

  useEffect(refresh, [refresh, revision, open])

  const total = tombs.length + ovrs.length

  return (
    <div className="rounded-md bg-[var(--surface-2)] border border-[var(--line)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-xs"
      >
        <span className="font-medium text-[var(--text-2)] inline-flex items-center gap-1.5"><Icon name="shield" size={13} /> {t('syncProtection')}</span>
        <span className="flex items-center gap-1.5">
          {total > 0 && (
            <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-2)]">
              {total}
            </span>
          )}
          <span className="text-[var(--text-3)] inline-flex"><Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} /></span>
        </span>
      </button>

      {open && (
        <div className="px-2 pb-2 space-y-2">
          {total === 0 && (
            <p className="text-[10px] text-[var(--text-3)]">{t('protectionEmpty')}</p>
          )}

          {tombs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                  {t('tombstoneList', { n: tombs.length })}
                </span>
                <button
                  onClick={() => {
                    if (confirm(t('clearConfirm', { n: tombs.length }))) {
                      clearTombstones()
                      refresh()
                    }
                  }}
                  className="text-[10px] text-[var(--text-3)] hover:text-[var(--danger)]"
                >
                  {t('clearAll')}
                </button>
              </div>
              <ul className="space-y-1">
                {tombs.map((k) => (
                  <li
                    key={k}
                    className="flex items-center justify-between gap-1 rounded bg-[var(--surface-1)] px-1.5 py-1 text-[10px]"
                  >
                    <span className="min-w-0 truncate text-[var(--text-2)]" title={k}>
                      <span className="inline-flex items-center gap-1"><Icon name="close" size={11} className="text-[var(--danger)]" /> {tombLabel(k)}</span>
                    </span>
                    <button
                      onClick={() => {
                        removeTombstone(k)
                        refresh()
                      }}
                      className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--text-1)] hover:bg-[var(--btn-info)] hover:text-[var(--btn-fg)]"
                    >
                      {t('revoke')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ovrs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-3)]">
                  {t('overrideList', { n: ovrs.length })}
                </span>
                <button
                  onClick={() => {
                    if (confirm(t('clearConfirm', { n: ovrs.length }))) {
                      clearOverrides()
                      refresh()
                    }
                  }}
                  className="text-[10px] text-[var(--text-3)] hover:text-[var(--danger)]"
                >
                  {t('clearAll')}
                </button>
              </div>
              <ul className="space-y-1">
                {ovrs.map(([k, patch]) => (
                  <li
                    key={k}
                    className="flex items-center justify-between gap-1 rounded bg-[var(--surface-1)] px-1.5 py-1 text-[10px]"
                  >
                    <span className="min-w-0 truncate text-[var(--text-2)]" title={k}>
                      <span className="inline-flex items-center gap-1"><Icon name="pencil" size={11} /> {overrideLabel(k, patch)}</span>
                    </span>
                    <button
                      onClick={() => {
                        deleteOverride(k)
                        refresh()
                      }}
                      className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--text-1)] hover:bg-[var(--btn-info)] hover:text-[var(--btn-fg)]"
                    >
                      {t('revoke')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {total > 0 && (
            <p className="text-[10px] text-[var(--text-3)]">{t('protectionHint')}</p>
          )}
        </div>
      )}
    </div>
  )
}
