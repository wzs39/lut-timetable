import type { Lesson } from '../types'
import { buildingOf, roomOf } from './display'

export interface FreeRoom {
  building: string
  room: string
  /** ISO time of the next lesson start (if any) that will occupy this room */
  nextBusyAt: string | null
}

/**
 * Rooms that are free *right now* (and stay free for the next `minutes`),
 * derived from rooms that lessons actually occupy. A room is only known if
 * some lesson names it; unknown rooms cannot be inferred.
 */
export function freeRoomsNow(
  lessons: Lesson[],
  now: Date,
  horizonMin = 60,
): FreeRoom[] {
  const t = now.getTime()
  const horizon = t + horizonMin * 60 * 1000

  // All rooms seen busy (any lesson in the data), with their busy windows
  const windows = new Map<
    string,
    { building: string; room: string; busy: { s: number; e: number }[] }
  >()
  for (const l of lessons) {
    if (!l.location) continue
    const b = buildingOf(l.location)
    if (!b) continue
    const key = `${b}_${roomOf(l.location)}`
    const entry =
      windows.get(key) ?? { building: b, room: roomOf(l.location), busy: [] }
    entry.busy.push({
      s: new Date(l.start).getTime(),
      e: new Date(l.end).getTime(),
    })
    windows.set(key, entry)
  }

  const out: FreeRoom[] = []
  for (const { building, room, busy } of windows.values()) {
    const busyNowOrSoon = busy.some(({ s, e }) => s <= horizon && e > t)
    if (busyNowOrSoon) continue
    // Room is free for at least the horizon. When is it next occupied?
    const next = busy
      .map(({ s }) => s)
      .filter((s) => s > t)
      .sort((a, b) => a - b)[0]
    out.push({
      building,
      room,
      nextBusyAt: next ? new Date(next).toISOString() : null,
    })
  }
  return out
    .sort(
      (a, b) =>
        a.building.localeCompare(b.building) ||
        a.room.localeCompare(b.room),
    )
    .slice(0, 12)
}
