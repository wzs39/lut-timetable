import type { Lesson } from '../types'
import { courseKeyOf } from './conflicts'

/** Hasil layout satu pelajaran dalam sehari */
export interface PlacedLesson {
  lesson: Lesson
  col: number
  cols: number
  /** Bentrok dengan pelajaran dari kursus LAIN (grup paralel kursus sama tidak dihitung) */
  conflict: boolean
  /** Kunci stabil untuk mengidentifikasi cluster konflik ini */
  clusterKey: string
}

/** Satu "collision group": semua pelajaran yang bertabrakan pada satu slot waktu */
export interface ConflictGroup {
  /** = clusterKey (stabil: date|uids), kompatibel dengan tt_conflict_dismissed */
  key: string
  lessons: PlacedLesson[]
}

export function conflictFingerprint(cluster: Lesson[]): string {
  return cluster
    .map((l) => l.uid || `${l.code || l.title}|${l.start}|${l.end}`)
    .sort()
    .join('~')
}

/** overlap waktu (> 0 detik) antara dua pelajaran */
function timeOverlap(a: Lesson, b: Lesson): boolean {
  const as = new Date(a.start).getTime()
  const ae = new Date(a.end).getTime()
  const bs = new Date(b.start).getTime()
  const be = new Date(b.end).getTime()
  return as < be && bs < ae
}

/**
 * Kelompokkan pelajaran yang saling tumpang tindih menjadi cluster,
 * lalu bagikan setiap cluster ke beberapa kolom (greedy interval graph
 * coloring). Pelajaran yang tidak bentrok tetap lebar penuh.
 *
 * `conflict` diberi makna "berbenturan dengan kursus LAIN": dua pelajaran
 * dari kursus yang sama (mis. grup paralel K200DJ96-3015 vs -3016) tetap
 * dibagi kolom agar terbaca, tapi TIDAK dianggap konflik — konsisten dengan
 * pemeriksaan konflik (courseKeyOf ternormalisasi di lib/conflicts).
 */
export function layoutDay(lessons: Lesson[], dateKey: string): PlacedLesson[] {
  const sorted = [...lessons].sort(
    (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
  )

  const clusters: Lesson[][] = []
  let cur: Lesson[] = []
  let clusterEnd = -Infinity
  for (const l of sorted) {
    const s = new Date(l.start).getTime()
    if (cur.length > 0 && s >= clusterEnd) {
      clusters.push(cur)
      cur = []
      clusterEnd = -Infinity
    }
    cur.push(l)
    clusterEnd = Math.max(clusterEnd, new Date(l.end).getTime())
  }
  if (cur.length > 0) clusters.push(cur)

  const placed: PlacedLesson[] = []
  for (const cluster of clusters) {
    const colEnds: number[] = []
    const assignment: number[] = []
    for (const l of cluster) {
      const s = new Date(l.start).getTime()
      let col = colEnds.findIndex((end) => end <= s)
      if (col === -1) {
        col = colEnds.length
        colEnds.push(new Date(l.end).getTime())
      } else {
        colEnds[col] = new Date(l.end).getTime()
      }
      assignment.push(col)
    }
    const fp = conflictFingerprint(cluster)
    cluster.forEach((l, idx) => {
      const clash = cluster.some(
        (m) => m !== l && timeOverlap(l, m) && courseKeyOf(m) !== courseKeyOf(l),
      )
      placed.push({
        lesson: l,
        col: assignment[idx],
        cols: colEnds.length,
        conflict: clash,
        clusterKey: `${dateKey}|${fp}`,
      })
    })
  }

  return placed
}

/**
 * Aggregasi tunggal konflik per hari: pelajaran yang `conflict` dikelompokkan
 * menurut clusterKey-nya, diurutkan dari slot paling pagi. Konsumen (chip hari,
 * blok desktop, kontainer mobile, strip mingguan) semuanya memakai ini.
 */
export function conflictGroupsOf(placed: PlacedLesson[]): ConflictGroup[] {
  const byKey = new Map<string, PlacedLesson[]>()
  for (const p of placed) {
    if (!p.conflict) continue
    const arr = byKey.get(p.clusterKey)
    if (arr) arr.push(p)
    else byKey.set(p.clusterKey, [p])
  }
  return [...byKey.entries()]
    .map(([key, items]) => ({
      key,
      lessons: items.sort(
        (a, b) =>
          a.lesson.start.localeCompare(b.lesson.start) ||
          a.lesson.end.localeCompare(b.lesson.end),
      ),
    }))
    .sort((a, b) =>
      a.lessons[0]!.lesson.start.localeCompare(b.lessons[0]!.lesson.start),
    )
}
