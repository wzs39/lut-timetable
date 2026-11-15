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

export interface RoomStatus {
  room: string
  building?: string
  state: 'free' | 'occupied'
  until?: string | null
  currentTitle?: string
  currentCode?: string
}

export interface RoomSlotInterval {
  start: string
  end: string
  state: 'free' | 'occupied'
  lessonTitle?: string
  lessonCode?: string
}

export interface RoomDayTimeline {
  room: string
  currentStatus: RoomStatus
  freeMinutesRemainingToday: number
  intervals: RoomSlotInterval[]
}

/**
 * Compute full-day (`08:00`–`20:00` local date of `now`) room occupancy/free intervals
 * for all known campus rooms seen in `lessons`, optionally filtered by `roomQuery`.
 */
export function roomTimelinesForDay(
  lessons: Lesson[],
  now: Date = new Date(),
  roomQuery?: string,
): RoomDayTimeline[] {
  const dayStart = new Date(now)
  dayStart.setHours(8, 0, 0, 0)
  const dayEnd = new Date(now)
  dayEnd.setHours(20, 0, 0, 0)

  const dayStartMs = dayStart.getTime()
  const dayEndMs = dayEnd.getTime()
  const nowMs = now.getTime()

  interface BusySlice {
    s: number
    e: number
    title?: string
    code?: string
  }

  const rooms = new Map<
    string,
    { building: string; room: string; label: string; busy: BusySlice[] }
  >()

  for (const l of lessons) {
    if (!l.location) continue
    const b = buildingOf(l.location)
    const r = roomOf(l.location)
    if (!b && !r) continue
    const label = b && r && !r.startsWith(b) ? `${b}_${r}` : r || b || l.location.trim()
    const key = label.toUpperCase()
    const entry = rooms.get(key) ?? {
      building: b || '',
      room: r || label,
      label,
      busy: [],
    }
    const s = new Date(l.start).getTime()
    const e = new Date(l.end).getTime()
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
      entry.busy.push({ s, e, title: l.title, code: l.code })
    }
    rooms.set(key, entry)
  }

  const q = roomQuery?.trim().toLowerCase() ?? ''
  const timelines: RoomDayTimeline[] = []

  for (const entry of rooms.values()) {
    if (q) {
      const hay = `${entry.label} ${entry.building} ${entry.room}`.toLowerCase()
      if (!hay.includes(q)) continue
    }

    // Clip and sort busy intervals overlapping [dayStartMs, dayEndMs]
    const todaysBusy = entry.busy
      .filter(({ s, e }) => e > dayStartMs && s < dayEndMs)
      .map(({ s, e, title, code }) => ({
        s: Math.max(dayStartMs, s),
        e: Math.min(dayEndMs, e),
        title,
        code,
      }))
      .sort((a, b) => a.s - b.s || a.e - b.e)

    // Merge overlapping busy slices
    const mergedBusy: BusySlice[] = []
    for (const slice of todaysBusy) {
      const last = mergedBusy[mergedBusy.length - 1]
      if (last && slice.s <= last.e) {
        if (slice.e > last.e) last.e = slice.e
        if (!last.title && slice.title) last.title = slice.title
        if (!last.code && slice.code) last.code = slice.code
      } else {
        mergedBusy.push({ ...slice })
      }
    }

    // Build contiguous intervals covering [dayStartMs, dayEndMs]
    const intervals: RoomSlotInterval[] = []
    let cursor = dayStartMs
    for (const busy of mergedBusy) {
      if (busy.s > cursor) {
        intervals.push({
          start: new Date(cursor).toISOString(),
          end: new Date(busy.s).toISOString(),
          state: 'free',
        })
      }
      intervals.push({
        start: new Date(busy.s).toISOString(),
        end: new Date(busy.e).toISOString(),
        state: 'occupied',
        lessonTitle: busy.title,
        lessonCode: busy.code,
      })
      cursor = Math.max(cursor, busy.e)
    }
    if (cursor < dayEndMs) {
      intervals.push({
        start: new Date(cursor).toISOString(),
        end: new Date(dayEndMs).toISOString(),
        state: 'free',
      })
    }

    // Determine current status at `now`
    const activeBusy = entry.busy.find(({ s, e }) => s <= nowMs && e > nowMs)
    let currentStatus: RoomStatus
    if (activeBusy) {
      currentStatus = {
        room: entry.room,
        building: entry.building || undefined,
        state: 'occupied',
        until: new Date(activeBusy.e).toISOString(),
        currentTitle: activeBusy.title,
        currentCode: activeBusy.code,
      }
    } else {
      const nextBusy = entry.busy
        .filter(({ s }) => s > nowMs)
        .sort((a, b) => a.s - b.s)[0]
      currentStatus = {
        room: entry.room,
        building: entry.building || undefined,
        state: 'free',
        until: nextBusy ? new Date(nextBusy.s).toISOString() : null,
      }
    }

    // Compute remaining free minutes today from max(nowMs, dayStartMs) to dayEndMs
    const evalStart = Math.min(dayEndMs, Math.max(dayStartMs, nowMs))
    let freeMs = 0
    for (const iv of intervals) {
      if (iv.state !== 'free') continue
      const ivStart = new Date(iv.start).getTime()
      const ivEnd = new Date(iv.end).getTime()
      const overlapStart = Math.max(evalStart, ivStart)
      const overlapEnd = Math.min(dayEndMs, ivEnd)
      if (overlapEnd > overlapStart) {
        freeMs += overlapEnd - overlapStart
      }
    }

    timelines.push({
      room: entry.room,
      currentStatus,
      freeMinutesRemainingToday: Math.round(freeMs / 60_000),
      intervals,
    })
  }

  return timelines.sort((a, b) => a.room.localeCompare(b.room))
}
