import type { Lesson } from '../types'
import { extractCourseCode, normalizeCourseCode } from './ics'

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Ekstrak kode gedung dari lokasi ("M19_AUD1B Auditorio 1" -> "M19",
 * "NIE73_B211 Teorialuokka" -> "NIE73"). Null bila tidak dikenali.
 */
export function buildingOf(location?: string): string | null {
  if (!location) return null
  const m = location.trim().match(/^([A-Za-z]{1,6}\d{0,4}[A-Za-z]?)_/)
  if (m) return m[1]
  const tok = location.trim().split(/[\s,]+/)[0] || ''
  return /^[A-Za-z]{1,6}\d{1,4}[A-Za-z]?$/.test(tok) ? tok : null
}

/** Ruangan: token setelah prefiks gedung ("M19_AUD1B Auditorio 1" -> "AUD1B") */
export function roomOf(location: string): string {
  const m = location.trim().match(/^[A-Za-z0-9]+_([A-Za-z0-9]+)/)
  if (m) return m[1]
  return location.trim().split(/[\s,]+/)[0] || location.trim()
}

/**
 * Judul bersih untuk tampilan: buang kode kursus (dan nomor grup) yang
 * berulang di dalam judul, mis.
 * "CT60A0250 · CT60A0250 · Fundamentals..." -> "Fundamentals..."
 * "Finnish 1 K200DJ96-3015 · KKIE26LABH"    -> "Finnish 1 · KKIE26LABH"
 * Kode tetap ditampilkan terpisah di baris pertama blok jadwal.
 */
export function displayTitle(l: Lesson): string {
  let title = l.title

  // Buang "KODE-1234" (dengan nomor grup) langsung dari judul
  const withGroup = title.match(/\b[A-Z]{1,4}\d{1,3}[A-Z]{0,3}\d{0,4}-\d{4}\b/i)
  if (withGroup) {
    title = title.replace(new RegExp(escapeRe(withGroup[0]), 'gi'), '')
  }

  // Buang kode kursus yang berulang (kode lesson + hasil ekstraksi judul)
  const codes = new Set<string>()
  if (l.code) codes.add(normalizeCourseCode(l.code))
  const extracted = extractCourseCode(l.title)
  if (extracted) codes.add(normalizeCourseCode(extracted))
  for (const c of codes) {
    if (c.length < 4) continue // hindari hapus kata pendek yang kebetulan sama
    title = title.replace(new RegExp(`\\b${escapeRe(c)}\\b\\s*·?\\s*`, 'gi'), '')
  }

  const cleaned = title
    .replace(/\s*·\s*·\s*/g, ' · ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s·]+|[\s·]+$/g, '')
    .trim()
  return cleaned || l.title
}
