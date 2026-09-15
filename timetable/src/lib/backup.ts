import { downloadBlob } from './download'
import { BACKUP_KEYS, type StorageKey } from './storage'

export interface BackupFile {
  app: 'lut-timetable'
  version: 1
  exportedAt: string
  data: Partial<Record<StorageKey, string>>
}

export async function exportBackup(): Promise<void> {
  const data: BackupFile['data'] = {}
  for (const k of BACKUP_KEYS) {
    const v = localStorage.getItem(k)
    if (v !== null) data[k] = v
  }
  const file: BackupFile = {
    app: 'lut-timetable',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  }
  const blob = new Blob([JSON.stringify(file, null, 2)], {
    type: 'application/json',
  })
  await downloadBlob(
    `lut-timetable-backup-${new Date().toISOString().slice(0, 10)}.json`,
    blob,
  )
}

/**
 * Terapkan file backup; return jumlah key yang ditulis.
 * Key di luar registry tetap diterima agar backup lama tidak hilang.
 */
export function importBackup(text: string): number {
  const file = JSON.parse(text) as BackupFile
  if (file.app !== 'lut-timetable' || file.version !== 1) {
    throw new Error('bad-format')
  }
  let n = 0
  for (const [k, v] of Object.entries(file.data ?? {})) {
    if (typeof v === 'string') {
      localStorage.setItem(k, v)
      n++
    }
  }
  return n
}
