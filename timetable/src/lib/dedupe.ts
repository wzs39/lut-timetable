import type { Lesson } from '../types'
import { extractCourseCode, normalizeCourseCode } from './ics'

/** Kunci mata kuliah: kode ternormalisasi, fallback ekstrak dari judul */
function courseKeyOf(l: Lesson): string {
  return normalizeCourseCode(l.code || extractCourseCode(l.title) || l.title)
}

export interface DupGroup {
  /** stabil: kode|tanggal */
  key: string
  code?: string
  title: string
  date: string
  /** pelajaran yang saling tumpang tindih pada hari yang sama, urut waktu */
  lessons: Lesson[]
}

/**
 * Kelompokkan pelajaran "isi sama, muncul berkali-kali": kode sama
 * (fallback judul), tanggal sama, dan waktunya saling tumpang tindih.
 * Ini pola khas duplikasi SISU vs TimeEdit.
 */
export function findDuplicateGroups(lessons: Lesson[]): DupGroup[] {
  const buckets = new Map<string, Lesson[]>()
  for (const l of lessons) {
    const key = `${courseKeyOf(l)}|${l.start.slice(0, 10)}`
    const arr = buckets.get(key)
    if (arr) arr.push(l)
    else buckets.set(key, [l])
  }

  const groups: DupGroup[] = []
  for (const [key, arr] of buckets) {
    if (arr.length < 2) continue
    const sorted = [...arr].sort(
      (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
    )
    // cluster: pelajaran yang waktunya saling tumpang tindih
    let cluster: Lesson[] = []
    let clusterEnd = -Infinity
    for (const l of sorted) {
      const s = new Date(l.start).getTime()
      if (cluster.length > 0 && s >= clusterEnd) {
        if (cluster.length >= 2) pushGroup(groups, key, cluster)
        cluster = []
        clusterEnd = -Infinity
      }
      cluster.push(l)
      clusterEnd = Math.max(clusterEnd, new Date(l.end).getTime())
    }
    if (cluster.length >= 2) pushGroup(groups, key, cluster)
  }

  return groups
}

function pushGroup(groups: DupGroup[], key: string, cluster: Lesson[]) {
  const first = cluster[0]
  groups.push({
    key: `${key}|${cluster.map((l) => l.start).join('~')}`,
    code: first.code,
    title: first.title,
    date: first.start.slice(0, 10),
    lessons: cluster,
  })
}

/** Berapa pelajaran yang bisa dihapus (total - jumlah grup) */
export function removableCount(groups: DupGroup[]): number {
  return groups.reduce((n, g) => n + g.lessons.length - 1, 0)
}
