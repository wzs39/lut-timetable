import type { Lesson } from '../types'

/** Hasil layout satu pelajaran dalam sehari */
export interface PlacedLesson {
  lesson: Lesson
  col: number
  cols: number
  /** bentrok dengan pelajaran lain */
  conflict: boolean
  /** kunci stabil untuk mengidentifikasi cluster konflik ini */
  clusterKey: string
}

export function conflictFingerprint(cluster: Lesson[]): string {
  return cluster
    .map((l) => l.uid || `${l.code || l.title}|${l.start}|${l.end}`)
    .sort()
    .join('~')
}

/**
 * Kelompokkan pelajaran yang saling tumpang tindih menjadi cluster,
 * lalu bagikan setiap cluster ke beberapa kolom (greedy interval graph
 * coloring). Pelajaran yang tidak bentrok tetap lebar penuh.
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
      placed.push({
        lesson: l,
        col: assignment[idx],
        cols: colEnds.length,
        conflict: colEnds.length > 1,
        clusterKey: `${dateKey}|${fp}`,
      })
    })
  }

  return placed
}
