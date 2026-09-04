import { downloadBlob } from './download'

/** Semua key localStorage milik aplikasi */
const BACKUP_KEYS = [
  'tt_lessons_v1',
  'tt_sources_v1',
  'tt_tombstones',
  'tt_overrides',
  'tt_sisu_course_ids',
  'tt_conflict_dismissed',
  'tt_lang',
  'tt_autosync',
  'tt_notif',
] as const

export interface BackupFile {
  app: 'lut-timetable'
  version: 1
  exportedAt: string
  data: Partial<Record<(typeof BACKUP_KEYS)[number], string>>
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

/** Terapkan file backup; return jumlah key yang ditulis */
export function importBackup(text: string): number {
  const file = JSON.parse(text) as BackupFile
  if (file.app !== 'lut-timetable' || file.version !== 1) {
    throw new Error('bad-format')
  }
  let n = 0
  for (const k of BACKUP_KEYS) {
    const v = file.data[k]
    if (typeof v === 'string') {
      localStorage.setItem(k, v)
      n++
    }
  }
  return n
}
