import type { ReactNode } from 'react'
import Icon from './Icon'
import { useI18n } from '../i18n'
import { useCollapse } from '../lib/useCollapse'

interface Props {
  /** Key penyimpanan yang mengingat pilihan buka/tutup panel ini. */
  storageKey: string
  /** Isi header — ikon + label (biasanya `app-card-label`). */
  label: ReactNode
  /** Node opsional di ujung header (badge / tombol aksi). */
  right?: ReactNode
  children: ReactNode
}

/**
 * Kartu yang isinya bisa dilipat; pilihannya menempel per panel.
 *
 * Header selalu tampil (cukup satu baris ringkas saat tertutup), isi hanya
 * dirender saat terbuka — jadi daftar yang panjang seperti daftar ruang
 * kosong atau navigasi gedung tidak lagi memakan ruang begitu selesai
 * dipakai.
 */
export default function CollapsiblePanel({ storageKey, label, right, children }: Props) {
  const { t } = useI18n()
  const [open, toggle] = useCollapse(storageKey)

  return (
    <section className="app-card">
      <div className="flex items-center justify-between gap-2">
        {/* Padding lives on the button so the whole header row is a 44px tap
            target on a phone, not just the 24px text line. */}
        <button
          onClick={toggle}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-3 py-2.5 text-left"
          title={t('toggleHint')}
          aria-expanded={open}
        >
          {/* .open 必须显式给出：chevron 只有这个类才会转正（CSS 无祖先选择器） */}
          <span
            className={'collapse-chevron shrink-0 text-[var(--text-3)]' + (open ? ' open' : '')}
            aria-hidden
          >
            <Icon name="chevron-down" size={12} />
          </span>
          <span className="min-w-0 truncate">{label}</span>
        </button>
        {right && <div className="shrink-0 pr-3">{right}</div>}
      </div>
      <div className={`collapse-wrap${open ? ' open' : ' is-closed'}`} inert={!open}>
        <div>
          <div className="px-3 pb-2.5">{children}</div>
        </div>
      </div>
    </section>
  )
}
