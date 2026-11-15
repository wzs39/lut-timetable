import { describe, expect, it } from 'vitest'
import { buildWidgetPayload } from '../lib/widgetData'
import type { Lesson } from '../types'

function lesson(start: string, end: string, code = 'BM20A9200', title = 'Mathematics A', location = 'M19_AUD1B'): Lesson {
  return {
    id: start + code,
    title,
    code,
    location,
    start,
    end,
    source: 'sisu',
    type: 'lecture',
  } as unknown as Lesson
}

// 2026-09-18 adalah Jumat. Pekan Sen 14.9 – Min 20.9.
const NOW = new Date('2026-09-18T09:30:00')

describe('buildWidgetPayload', () => {
  it('mengambil pelajaran hari ini urut waktu, memotong ke hm lokal', () => {
    const p = buildWidgetPayload(
      [
        lesson('2026-09-18T12:00:00', '2026-09-18T14:00:00'),
        lesson('2026-09-18T08:00:00', '2026-09-18T10:00:00'),
        lesson('2026-09-19T08:00:00', '2026-09-19T10:00:00'), // besok — bukan hari ini
      ],
      NOW,
    )
    expect(p.items).toHaveLength(2) // payload selalu per-sesi; merge dilakukan native
    expect(p.items[0].s).toBe('08:00')
    expect(p.items[0].e).toBe('10:00')
    expect(p.items[1].s).toBe('12:00')
    expect(p.items[1].e).toBe('14:00')
    expect(p.items[0].name).toBe('BM20A9200') // kode menang atas judul
    expect(p.date).toBe('2026-09-18')
  })

  it('menghitung pelajaran pekan ini (Sen–Min) termasuk hari lain', () => {
    const p = buildWidgetPayload(
      [
        lesson('2026-09-14T08:00:00', '2026-09-14T09:00:00'), // Senin
        lesson('2026-09-18T08:00:00', '2026-09-18T09:00:00'), // Jumat
        lesson('2026-09-20T08:00:00', '2026-09-20T09:00:00'), // Minggu
        lesson('2026-09-21T08:00:00', '2026-09-21T09:00:00'), // Senin depan — di luar
      ],
      NOW,
    )
    expect(p.weekCount).toBe(3)
  })

  it('next = pelajaran hari ini yang belum berakhir; null bila semua selesai', () => {
    const p1 = buildWidgetPayload(
      [
        lesson('2026-09-18T08:00:00', '2026-09-18T10:00:00'),
        lesson('2026-09-18T14:00:00', '2026-09-18T16:00:00'),
      ],
      NOW, // 09:30 — pelajaran 1 sedang berjalan
    )
    expect(p1.next?.at).toBe('08:00')
    const p2 = buildWidgetPayload(
      [lesson('2026-09-18T08:00:00', '2026-09-18T09:00:00')],
      NOW,
    )
    expect(p2.next).toBeNull()
  })

  it('tidak memutasi input; kosong tetap aman', () => {
    const input = [lesson('2026-09-18T08:00:00', '2026-09-18T09:00:00')]
    const snapshot = JSON.stringify(input)
    buildWidgetPayload(input, NOW)
    expect(JSON.stringify(input)).toBe(snapshot)
    const empty = buildWidgetPayload([], NOW)
    expect(empty.items).toEqual([])
    expect(empty.weekCount).toBe(0)
    expect(empty.next).toBeNull()
  })

  it('per-sesi TANPA merge: sesi paralel & sesi berturut sama-sama tampil', () => {
    const p = buildWidgetPayload(
      [
        // CT60A0250 tiga sesi paralel "pilih salah satu" (pola nyata LUT)
        lesson('2026-09-18T08:00:00', '2026-09-18T10:00:00', 'CT60A0250', 'Fundamentals of Programming', 'NIE73_B101'),
        lesson('2026-09-18T14:00:00', '2026-09-18T16:00:00', 'CT60A0250', 'Fundamentals of Programming', 'NIE73_B101'),
        lesson('2026-09-18T17:00:00', '2026-09-18T19:00:00', 'CT60A0250', 'Fundamentals of Programming', 'NIE73_B101'),
        // dua sesi HDD5020 sambung (12-14, 14-16)
        lesson('2026-09-18T12:00:00', '2026-09-18T14:00:00', 'HDD5020', 'Foundations of Information Processing', 'M19_AUD1B'),
        lesson('2026-09-18T14:00:00', '2026-09-18T16:00:00', 'HDD5020', 'Foundations of Information Processing', 'M19_AUD1B'),
      ],
      NOW,
    )
    expect(p.items).toHaveLength(5)
    expect(p.items.filter((i) => i.name === 'CT60A0250')).toHaveLength(3)
    // epoch ms tersedia untuk penanda NOW di sisi native
    expect(p.items[0].sms).toBe(new Date('2026-09-18T08:00:00').getTime())
    expect(p.items[0].ems).toBe(new Date('2026-09-18T10:00:00').getTime())
    // nama kursus penuh dibawa (segmen pertama judul)
    expect(p.items[0].title).toBe('Fundamentals of Programming')
  })

  it('mid: resolver diinjeksi → courseid Moodle per baris; tanpa resolver → null', () => {
    // Resolver meniru CourseIdentityIndex.idForCode (widget klik → course page)
    const p = buildWidgetPayload(
      [
        lesson('2026-09-18T08:00:00', '2026-09-18T10:00:00', 'CT60A0250'),
        lesson('2026-09-18T12:00:00', '2026-09-18T14:00:00', 'HDD5020'),
        lesson('2026-09-18T14:00:00', '2026-09-18T16:00:00'), // tanpa kode
      ],
      NOW,
      (code) => (code === 'CT60A0250' ? 29428 : code === 'HDD5020' ? 30565 : null),
    )
    expect(p.items[0].mid).toBe(29428)
    expect(p.items[1].mid).toBe(30565)
    expect(p.items[2].mid).toBeNull()
    // Tanpa resolver (payload lama / web): mid null — baris tetap buka app
    const legacy = buildWidgetPayload([lesson('2026-09-18T08:00:00', '2026-09-18T10:00:00')], NOW)
    expect(legacy.items[0].mid).toBeNull()
  })

  it('chg: hanya baris yang tersentuh perubahan sinkron terakhir yang ditandai', () => {
    const p = buildWidgetPayload(
      [
        lesson('2026-09-18T08:00:00', '2026-09-18T10:00:00', 'CT60A0250'),
        lesson('2026-09-18T12:00:00', '2026-09-18T14:00:00', 'HDD5020'),
      ],
      NOW,
      undefined,
      { codes: ['CT60A0250'], n: 2 },
    )
    expect(p.items[0].chg).toBe(true)
    expect(p.items[1].chg).toBeUndefined()
    expect(p.chgN).toBe(2)
    // tanpa marks（无变动 / 过期）→ 字段不出现，原生就不打标
    const plain = buildWidgetPayload([lesson('2026-09-18T08:00:00', '2026-09-18T10:00:00')], NOW)
    expect(plain.items[0].chg).toBeUndefined()
    expect(plain.chgN).toBeUndefined()
  })
})

describe('nextStartMs (countdown anchor)', () => {
  it('is the epoch ms of the next unfinished lesson today', () => {
    const now = new Date('2026-09-19T09:00:00.000Z') // 12:00 Helsinki
    const lessons = [
      { id: 'a', source: 'manual' as const, title: 'Done', start: '2026-09-19T06:00:00.000Z', end: '2026-09-19T08:00:00.000Z' },
      { id: 'b', source: 'manual' as const, title: 'Running', start: '2026-09-19T08:00:00.000Z', end: '2026-09-19T10:00:00.000Z' },
      { id: 'c', source: 'manual' as const, title: 'Later', start: '2026-09-19T13:00:00.000Z', end: '2026-09-19T15:00:00.000Z' },
    ]
    const p = buildWidgetPayload(lessons, now)
    expect(p.nextStartMs).toBe(new Date('2026-09-19T08:00:00.000Z').getTime())
  })

  it('is null when nothing remains today', () => {
    const now = new Date('2026-09-19T20:00:00.000Z')
    const lessons = [
      { id: 'a', source: 'manual' as const, title: 'Over', start: '2026-09-19T06:00:00.000Z', end: '2026-09-19T08:00:00.000Z' },
    ]
    const p = buildWidgetPayload(lessons, now)
    expect(p.nextStartMs).toBeNull()
    expect(p.next).toBeNull()
  })
})

// ---- buildTasksPayload: widget tugas (deadline terdekat dulu, tanpa batas) ----
import { buildTasksPayload } from '../lib/widgetData'
import type { Task } from '../lib/tasks'

function task(partial: Partial<Task> & { id: string }): Task {
  return {
    title: partial.id,
    completed: false,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...partial,
  } as Task
}

describe('buildTasksPayload', () => {
  const NOW = new Date('2026-09-18T09:30:00')

  it('hanya tugas belum selesai, urut deadline, tanpa dueAt dilewati', () => {
    const p = buildTasksPayload(
      [
        task({ id: 'a', title: 'Late one', dueAt: '2026-09-15T12:00:00', completed: false }),
        task({ id: 'b', title: 'Done one', dueAt: '2026-09-14T12:00:00', completed: true }),
        task({ id: 'c', title: 'Future', dueAt: '2026-09-25T12:00:00' }),
        task({ id: 'd', title: 'No due date' }),
      ],
      NOW,
    )
    expect(p.items).toHaveLength(2)
    expect(p.items[0].t).toBe('Late one') // 15.9 < 25.9
    expect(p.items[1].t).toBe('Future')
    expect(p.items[0].late).toBe(true) // 15.9 < 18.9
    expect(p.items[1].late).toBe(false)
    expect(p.openCount).toBe(3) // a + c + d (tanpa dueAt tetap terbuka)
  })

  it('membawa id asli tiap baris — checkbox widget mengirim balik id ini', () => {
    const p = buildTasksPayload(
      [
        task({ id: 'moodle-act:123', title: 'Persona', dueAt: '2026-09-20T12:00:00' }),
        task({ id: 'manual-uuid', title: 'Manual', dueAt: '2026-09-21T12:00:00' }),
      ],
      NOW,
    )
    expect(p.items.map((i) => i.id)).toEqual(['moodle-act:123', 'manual-uuid'])
  })

  it('tanggal tampilan dd.MM. dan tanpa cap (ListView scrollable)', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      task({ id: `t${i}`, title: `Task ${i}`, dueAt: `2026-10-${String(i + 1).padStart(2, '0')}T12:00:00` }),
    )
    const p = buildTasksPayload(many, NOW)
    expect(p.items).toHaveLength(12)
    expect(p.openCount).toBe(12)
    expect(p.items[0].d).toBe('01.10.')
    expect(p.items[11].d).toBe('12.10.')
  })

  it('course fallback kosong (native melewati baris course)', () => {
    const p = buildTasksPayload(
      [task({ id: 'x', title: 'Upload CV', course: 'CT10A9900', dueAt: '2026-09-20T12:00:00' })],
      NOW,
    )
    expect(p.items[0].c).toBe('CT10A9900')
    expect(buildTasksPayload([task({ id: 'y', title: 'Bare', dueAt: '2026-09-20T12:00:00' })], NOW).items[0].c).toBe('')
  })
})

import { buildPomodoroPayload } from '../lib/widgetData'
import type { PomodoroTimer } from '../lib/pomodoro'

describe('buildWidgetPayload multi-day lookahead & buildPomodoroPayload', () => {
  it('populates days lookahead buckets across midnight for 4 local days', () => {
    const now = new Date(2026, 8, 18, 22, 30, 0) // 2026-09-18 22:30 local
    const lToday = new Date(2026, 8, 18, 14, 0, 0).toISOString()
    const lTodayEnd = new Date(2026, 8, 18, 16, 0, 0).toISOString()
    const lTomorrow = new Date(2026, 8, 19, 10, 15, 0).toISOString()
    const lTomorrowEnd = new Date(2026, 8, 19, 12, 0, 0).toISOString()
    const lDay3 = new Date(2026, 8, 21, 9, 0, 0).toISOString()
    const lDay3End = new Date(2026, 8, 21, 10, 30, 0).toISOString()
    const lDay4 = new Date(2026, 8, 22, 9, 0, 0).toISOString()
    const lDay4End = new Date(2026, 8, 22, 10, 30, 0).toISOString()

    const p = buildWidgetPayload(
      [
        { id: '0', source: 'manual', title: 'Today Past', code: 'TODAY', start: lToday, end: lTodayEnd },
        { id: '1', source: 'manual', title: 'Tomorrow Class', code: 'TMR', start: lTomorrow, end: lTomorrowEnd, location: '1324' },
        { id: '2', source: 'manual', title: 'Day3 Class', code: 'D3', start: lDay3, end: lDay3End },
        { id: '3', source: 'manual', title: 'Outside Lookahead', code: 'OUT', start: lDay4, end: lDay4End },
      ],
      now,
    )

    expect(p.date).toBe('2026-09-18')
    expect(Object.keys(p.days ?? {})).toEqual(['2026-09-18', '2026-09-19', '2026-09-20', '2026-09-21'])
    expect(p.days?.['2026-09-18'].items).toHaveLength(1)
    expect(p.days?.['2026-09-18'].weekCount).toBe(2)
    expect(p.days?.['2026-09-18'].next).toBeNull()
    expect(p.days?.['2026-09-19'].items.map((i) => i.name)).toEqual(['TMR'])
    expect(p.days?.['2026-09-21'].weekCount).toBe(2) // Mon 21 + Tue 22 roll into next week!
    expect(p.days?.['2026-09-19'].next).toEqual({ name: 'TMR', room: '1324', at: '10:15' })
    expect(p.days?.['2026-09-19'].nextStartMs).toBe(new Date(lTomorrow).getTime())
    expect(p.days?.['2026-09-20'].items).toEqual([])
    expect(p.days?.['2026-09-21'].items.map((i) => i.name)).toEqual(['D3'])
    expect(p.days?.['2026-09-22']).toBeUndefined()
  })

  it('serializes active running, paused, and idle pomodoro states', () => {
    const now = new Date('2026-09-18T10:00:00.000Z')
    const idle = buildPomodoroPayload(null, 2, now)
    expect(idle).toEqual({
      updatedAt: now.getTime(),
      active: false,
      phase: null,
      running: false,
      endsAt: null,
      pausedRemainingMs: null,
      roundsToday: 2,
      courseCode: null,
      label: null,
    })

    const runningTimer: PomodoroTimer = {
      phase: 'focus',
      totalMs: 25 * 60_000,
      endsAt: now.getTime() + 18 * 60_000,
      pausedRemainingMs: null,
      completedRounds: 1,
      studyBlockId: null,
      courseCode: 'CT30A2910',
      label: 'Read chapter 4',
    }
    const running = buildPomodoroPayload(runningTimer, 1, now)
    expect(running.active).toBe(true)
    expect(running.running).toBe(true)
    expect(running.phase).toBe('focus')
    expect(running.endsAt).toBe(now.getTime() + 18 * 60_000)
    expect(running.courseCode).toBe('CT30A2910')
    expect(running.label).toBe('Read chapter 4')

    const pausedTimer: PomodoroTimer = {
      phase: 'short',
      totalMs: 5 * 60_000,
      endsAt: null,
      pausedRemainingMs: 180_000,
      completedRounds: 2,
      studyBlockId: null,
      courseCode: null,
      label: null,
    }
    const paused = buildPomodoroPayload(pausedTimer, 2, now)
    expect(paused.active).toBe(true)
    expect(paused.running).toBe(false)
    expect(paused.pausedRemainingMs).toBe(180_000)
  })
})
