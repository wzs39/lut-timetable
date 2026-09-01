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
    <div className="rounded-md bg-zinc-800/70 border border-zinc-700">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-2 py-1.5 text-xs"
      >
        <span className="font-medium text-zinc-300">🛡 {t('syncProtection')}</span>
        <span className="flex items-center gap-1.5">
          {total > 0 && (
            <span className="rounded-full bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300">
              {total}
            </span>
          )}
          <span className="text-zinc-500">{open ? '▾' : '▸'}</span>
        </span>
      </button>

      {open && (
        <div className="px-2 pb-2 space-y-2">
          {total === 0 && (
            <p className="text-[10px] text-zinc-500">{t('protectionEmpty')}</p>
          )}

          {tombs.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {t('tombstoneList', { n: tombs.length })}
                </span>
                <button
                  onClick={() => {
                    if (confirm(t('clearConfirm', { n: tombs.length }))) {
                      clearTombstones()
                      refresh()
                    }
                  }}
                  className="text-[10px] text-zinc-500 hover:text-rose-400"
                >
                  {t('clearAll')}
                </button>
              </div>
              <ul className="space-y-1">
                {tombs.map((k) => (
                  <li
                    key={k}
                    className="flex items-center justify-between gap-1 rounded bg-zinc-900/70 px-1.5 py-1 text-[10px]"
                  >
                    <span className="truncate text-zinc-400" title={k}>
                      🚫 {tombLabel(k)}
                    </span>
                    <button
                      onClick={() => {
                        removeTombstone(k)
                        refresh()
                      }}
                      className="shrink-0 rounded bg-zinc-700 hover:bg-sky-600 px-1.5 py-0.5 text-zinc-200"
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
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {t('overrideList', { n: ovrs.length })}
                </span>
                <button
                  onClick={() => {
                    if (confirm(t('clearConfirm', { n: ovrs.length }))) {
                      clearOverrides()
                      refresh()
                    }
                  }}
                  className="text-[10px] text-zinc-500 hover:text-rose-400"
                >
                  {t('clearAll')}
                </button>
              </div>
              <ul className="space-y-1">
                {ovrs.map(([k, patch]) => (
                  <li
                    key={k}
                    className="flex items-center justify-between gap-1 rounded bg-zinc-900/70 px-1.5 py-1 text-[10px]"
                  >
                    <span className="truncate text-zinc-400" title={k}>
                      ✏️ {overrideLabel(k, patch)}
                    </span>
                    <button
                      onClick={() => {
                        deleteOverride(k)
                        refresh()
                      }}
                      className="shrink-0 rounded bg-zinc-700 hover:bg-sky-600 px-1.5 py-0.5 text-zinc-200"
                    >
                      {t('revoke')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {total > 0 && (
            <p className="text-[10px] text-zinc-600">{t('protectionHint')}</p>
          )}
        </div>
      )}
    </div>
  )
}
