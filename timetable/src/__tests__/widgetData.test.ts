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
