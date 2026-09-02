/**
 * Parser ICS minimal — cukup untuk format SISU (Funidata) dan TimeEdit:
 * - Line unfolding (baris lanjutan diawali spasi/tab)
 * - Unescape \, \; \n \\
 * - VEVENT: DTSTART, DTEND, DURATION, SUMMARY, LOCATION, UID
 * - Tanggal: UTC (Z) atau floating/TZID → dikonversi ke waktu lokal browser
 */

import type { Lesson, LessonType } from '../types'

export interface IcsEvent {
  uid?: string
  summary?: string
  location?: string
  start: Date
  end: Date
}

/**
 * Kenali jenis sesi dari kata kunci di SUMMARY ( Inggris + Finlandia).
 * Urutan penting: "Exam" dicek duluan agar "Final lecture exam" tidak salah.
 */
const TYPE_KEYWORDS: [LessonType, RegExp][] = [
  ['exam', /\b(exam|tentti|koe|midterm|finals?)\b|loppukoe|välikoe/i],
  ['lecture', /\blectures?\b|luen(t|o)/i],
  ['exercise', /exc?erc?is|harjoitus|harjoituksia|demonstraatio|\bdemo\b/i],
  ['tutorial', /\btutorials?\b|\bohjaus\b/i],
  ['seminar', /seminars?|seminaari/i],
  ['lab', /\blabs?\b|laboratorio|laborator/i],
  ['workshop', /workshop|työpaja/i],
]

export function detectLessonType(summary?: string): LessonType | undefined {
  if (!summary) return undefined
  for (const [type, re] of TYPE_KEYWORDS) {
    if (re.test(summary)) return type
  }
  return undefined
}

function unfold(raw: string): string[] {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += line.slice(1)
    } else {
      out.push(line)
    }
  }
  return out
}

function unescapeText(s: string): string {
  return s
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

function parseIcsDate(value: string): Date | null {
  const v = value.trim()
  // Format: 20261126T060000Z (UTC) atau 20261126T060000 (floating/TZID) atau 20261126 (all-day)
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/)
  if (!m) return null
  const [, y, mo, d, hh = '00', mm = '00', ss = '00', z] = m
  if (z) {
    return new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss))
  }
  // TZID (mis. Europe/Helsinki): Date constructor memakai timezone lokal.
  // SISU selalu kirim Z; untuk floating kita perlakukan sebagai waktu lokal.
  return new Date(+y, +mo - 1, +d, +hh, +mm, +ss)
}

function parseDuration(v: string): number | null {
  // PT2H / PT1H30M / P1DT2H / PT45M
  const m = v.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i)
  if (!m) return null
  const [, d, h, min, s] = m
  return (
    (+(d || 0) * 86400 + +(h || 0) * 3600 + +(min || 0) * 60 + +(s || 0)) * 1000
  )
}

export function parseIcs(raw: string): IcsEvent[] {
  const lines = unfold(raw)
  const events: IcsEvent[] = []
  let cur: Record<string, { params: string[]; value: string }> | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === 'BEGIN:VEVENT') {
      cur = {}
      continue
    }
    if (trimmed === 'END:VEVENT') {
      if (cur && cur.DTSTART) {
        const start = parseIcsDate(cur.DTSTART.value)
        if (start) {
          let end: Date | null = cur.DTEND ? parseIcsDate(cur.DTEND.value) : null
          if (!end && cur.DURATION) {
            const dur = parseDuration(cur.DURATION.value)
            if (dur) end = new Date(start.getTime() + dur)
          }
          if (!end) end = new Date(start.getTime() + 60 * 60 * 1000)
          events.push({
            uid: cur.UID?.value,
            summary: cur.SUMMARY ? unescapeText(cur.SUMMARY.value) : undefined,
            location: cur.LOCATION ? unescapeText(cur.LOCATION.value) : undefined,
            start,
            end,
          })
        }
      }
      cur = null
      continue
    }
    if (!cur) continue

    const colon = line.indexOf(':')
    if (colon === -1) continue
    const left = line.slice(0, colon)
    const value = line.slice(colon + 1)
    const parts = left.split(';')
    const name = parts[0].toUpperCase()
    const params = parts.slice(1)
    if (
      [
        'UID',
        'SUMMARY',
        'LOCATION',
        'DTSTART',
        'DTEND',
        'DURATION',
      ].includes(name)
    ) {
      cur[name] = { params, value }
    }
  }

  return events
}

/**
 * Ekstrak kode kursus dari summary. Menangani pola LUT/LAB:
 * BM20A9200, CT60A0250, CT10A9900 (XX00X0000), HDD5020 (XXX0000), KMA0126,
 * serta kode dengan nomor grup 4 digit: K200DJ96-3015 -> K200DJ96
 * (nomor grup dibuang agar grup paralel dianggap kursus yang sama).
 */
export function extractCourseCode(summary?: string): string | undefined {
  if (!summary) return undefined
  const m = summary.match(/\b([A-Z]{1,4}\d{1,3}[A-Z]{0,3}\d{0,4})(?:-\d{4})?\b/)
  return m ? m[1] : undefined
}

/**
 * Normalisasi kode kursus: buang nomor grup 4 digit di belakang tanda strip
 * (K200DJ96-3015 -> K200DJ96) dan satukan huruf besar. Dipakai untuk warna
 * dan kunci dedup agar grup paralel konsisten dengan kursus induknya.
 */
export function normalizeCourseCode(code: string): string {
  return code.trim().replace(/-\d{4}$/i, '').toUpperCase()
}

/* ---------------- Export ICS (untuk Outlook / Google Calendar) ---------------- */

/** ISO string -> UTC 'YYYYMMDDTHHMMSSZ'; null bila tanggal tidak valid. */
function toIcsDate(iso: string): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Escape karakter khusus ICS di nilai teks. */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/** Lipat baris > 75 oktet (aturan RFC 5545: lanjutan diawali spasi, CRLF). */
function foldIcs(line: string): string {
  if (line.length <= 75) return line
  const chunks: string[] = []
  for (let rest = line; rest.length > 0; ) {
    chunks.push(rest.slice(0, 75))
    rest = rest.slice(75)
  }
  return chunks.join('\r\n ')
}

/**
 * Bangun file .ics (iCalendar) dari daftar pelajaran, siap diimpor ke
 * Outlook / Google Calendar / Apple Calendar. Urut ascending oleh waktu mulai.
 */
export function buildIcs(lessons: Lesson[]): string {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LUT Timetable//EN',
    'CALSCALE:GREGORIAN',
  ]
  const sorted = [...lessons].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  )
  for (const l of sorted) {
    const start = toIcsDate(l.start)
    const end = toIcsDate(l.end)
    if (!start || !end) continue
    const uid = (l.uid || l.id).replace(/[^A-Za-z0-9._@-]/g, '') || 'lesson'
    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${uid}@lut-timetable`)
    lines.push(`DTSTAMP:${now}`)
    lines.push(`DTSTART:${start}`)
    lines.push(`DTEND:${end}`)
    if (l.title) lines.push(foldIcs(`SUMMARY:${icsEscape(l.title)}`))
    if (l.location) lines.push(foldIcs(`LOCATION:${icsEscape(l.location)}`))
    const cats = [l.type, l.source, ...(l.mergedSources ?? [])].filter(Boolean).join(',')
    if (cats) lines.push(foldIcs(`CATEGORIES:${icsEscape(cats)}`))
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
