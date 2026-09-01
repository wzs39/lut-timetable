import { describe, expect, it } from 'vitest'
import {
  detectLessonType,
  extractCourseCode,
  normalizeCourseCode,
  parseIcs,
} from '../lib/ics'

/** Bungkus baris VEVENT menjadi teks ICS utuh (persis format SISU) */
function icsOf(...eventLines: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'PRODID:-//Funidata//SISU//FI',
    'VERSION:2.0',
    'BEGIN:VTIMEZONE',
    'TZID:Europe/Helsinki',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    ...eventLines,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

describe('detectLessonType', () => {
  it('detects SISU English session types', () => {
    expect(
      detectLessonType(
        'BM20A9200, Mathematics A, Contact teaching, Lahti - LAHTI-Excercises - BM20A9200 1 LAHTI Tutorial 5 - NIE73_B209',
      ),
    ).toBe('exercise') // "Excercises" (sic)  Bagian latihan lebih spesifik
    expect(detectLessonType('CT60A0250, Programming, Contact teaching - Lectures')).toBe('lecture')
    expect(detectLessonType('XX0000, Course, Seminar - Group A')).toBe('seminar')
    expect(detectLessonType('BM20A9301, Statistics, Exam')).toBe('exam')
  })

  it('detects Finnish keywords from TimeEdit feeds', () => {
    expect(detectLessonType('CT60A0250 1 LPR Luentoja kaikille')).toBe('lecture')
    expect(detectLessonType('CT60A0250 1 LPR Harjoituksia kaikille')).toBe('exercise')
    expect(detectLessonType('TY0000 Tentti 1')).toBe('exam')
  })

  it('prefers exam over lecture when both appear', () => {
    expect(detectLessonType('Final lecture exam, MA0000')).toBe('exam')
  })

  it('returns undefined for summaries without type keywords', () => {
    expect(detectLessonType('Kukkonen Noora')).toBeUndefined()
    expect(detectLessonType(undefined)).toBeUndefined()
  })
})

describe('parseIcs', () => {
  it('parses a SISU-style event with DTSTART + DURATION (UTC)', () => {
    const events = parseIcs(
      icsOf(
        'DTSTAMP:20260901T103825Z',
        'DTSTART:20261126T060000Z',
        'DURATION:PT2H',
        'SUMMARY:BM20A9200\\, Mathematics A\\, Contact teaching',
        'LOCATION:NIE73_B209 Teorialuokka',
        'UID:lut-583311.0',
      ),
    )
    expect(events).toHaveLength(1)
    expect(events[0].start.toISOString()).toBe('2026-11-26T06:00:00.000Z')
    expect(events[0].end.toISOString()).toBe('2026-11-26T08:00:00.000Z')
    expect(events[0].uid).toBe('lut-583311.0')
    expect(events[0].location).toBe('NIE73_B209 Teorialuokka')
  })

  it('unfolds long SUMMARY lines split with leading whitespace', () => {
    const events = parseIcs(
      icsOf(
        'DTSTART:20261126T060000Z',
        'DURATION:PT1H',
        'SUMMARY:BM20A9200\\, Mathematics A\\, Contact teaching\\, Lahti 31.8.–11.12.2026 - LAHTI\r\n - BM20A9200 1 LAHTI Tutorial 5 - NIE73_B209',
        'UID:lut-1.0',
      ),
    )
    expect(events[0].summary).toContain('- LAHTI- BM20A9200 1 LAHTI Tutorial 5 - NIE73_B209')
  })

  it('unescapes commas, semicolons and newlines', () => {
    const events = parseIcs(
      icsOf(
        'DTSTART:20261126T060000Z',
        'SUMMARY:A\\, B\\; C\\nD\\\\E',
        'UID:x',
      ),
    )
    expect(events[0].summary).toBe('A, B; C D\\E')
  })

  it('uses DTEND when present instead of DURATION', () => {
    const events = parseIcs(
      icsOf(
        'DTSTART:20261126T060000Z',
        'DTEND:20261126T073000Z',
        'UID:x',
      ),
    )
    expect(events[0].end.toISOString()).toBe('2026-11-26T07:30:00.000Z')
  })

  it('supports complex DURATION with days and minutes', () => {
    const events = parseIcs(
      icsOf('DTSTART:20261126T060000Z', 'DURATION:P1DT0H45M0S', 'UID:x'),
    )
    // 1 hari + 45 menit
    expect(events[0].end.getTime() - events[0].start.getTime()).toBe(
      (24 * 60 + 45) * 60 * 1000,
    )
  })

  it('defaults to 1 hour when neither DTEND nor DURATION exists', () => {
    const events = parseIcs(icsOf('DTSTART:20261126T060000Z', 'UID:x'))
    expect(events[0].end.getTime() - events[0].start.getTime()).toBe(3600_000)
  })

  it('parses multiple events and skips VTIMEZONE', () => {
    const raw = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20261126T060000Z',
      'DURATION:PT1H',
      'UID:a',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'DTSTART:20261127T060000Z',
      'DURATION:PT1H',
      'UID:b',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    const events = parseIcs(raw)
    expect(events.map((e) => e.uid)).toEqual(['a', 'b'])
  })

  it('treats floating local datetime as local wall time', () => {
    const events = parseIcs(
      icsOf('DTSTART:20261126T060000', 'DURATION:PT1H', 'UID:x'),
    )
    // 06:00 waktu lokal (Tanpa Z) — memakai constructor lokal
    expect(events[0].start.getHours()).toBe(6)
  })

  it('returns empty array for input without events', () => {
    expect(parseIcs('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toEqual([])
  })
})

describe('extractCourseCode', () => {
  it.each([
    ['BM20A9200, Mathematics A, Contact teaching', 'BM20A9200'],
    ['CT60A0250 Fundamentals of Programming Blended teaching', 'CT60A0250'],
    ['CT10A9900 · Introduction to DD Studies', 'CT10A9900'],
    ['HDD4010 · Engineering Mathematics I', 'HDD4010'],
    ['HDD5020 · Foundations of Information Processing', 'HDD5020'],
    ['KMA0126 · Basic Engineering Mathematics', 'KMA0126'],
    ['Finnish 1 K200DJ96-3015 · KKIE26LABH · KKIE26LUTH', 'K200DJ96'],
    ['Finnish 1 K200DJ96-3018 · KKIE26LABH', 'K200DJ96'],
  ])('extracts %s', (summary, expected) => {
    expect(extractCourseCode(summary)).toBe(expected)
  })

  it('returns undefined when no code pattern exists', () => {
    expect(extractCourseCode('Guest lecture in auditorium')).toBeUndefined()
    expect(extractCourseCode(undefined)).toBeUndefined()
  })
})

describe('normalizeCourseCode', () => {
  it('strips 4-digit group suffix and uppercases', () => {
    expect(normalizeCourseCode('k200dj96-3015')).toBe('K200DJ96')
    expect(normalizeCourseCode('K200DJ96')).toBe('K200DJ96')
    expect(normalizeCourseCode('BM20A9200')).toBe('BM20A9200') // tidak menghack bagian akhir kode
  })
})
