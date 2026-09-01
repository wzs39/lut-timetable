import type { Lesson } from '../types'
import { extractCourseCode, normalizeCourseCode } from './ics'

interface CourseColor {
  /** background fill */
  bg: string
  /** border */
  border: string
  /** text */
  text: string
}

/** Palet 12 warna yang mudah dibedakan pada tema gelap */
const PALETTE: CourseColor[] = [
  { bg: 'rgba(14,165,233,0.22)', border: 'rgba(14,165,233,0.55)', text: '#bae6fd' }, // sky
  { bg: 'rgba(139,92,246,0.22)', border: 'rgba(139,92,246,0.55)', text: '#ddd6fe' }, // violet
  { bg: 'rgba(16,185,129,0.20)', border: 'rgba(16,185,129,0.55)', text: '#a7f3d0' }, // emerald
  { bg: 'rgba(245,158,11,0.20)', border: 'rgba(245,158,11,0.55)', text: '#fde68a' }, // amber
  { bg: 'rgba(244,63,94,0.20)', border: 'rgba(244,63,94,0.55)', text: '#fecdd3' }, // rose
  { bg: 'rgba(6,182,212,0.20)', border: 'rgba(6,182,212,0.55)', text: '#a5f3fc' }, // cyan
  { bg: 'rgba(132,204,22,0.20)', border: 'rgba(132,204,22,0.55)', text: '#d9f99d' }, // lime
  { bg: 'rgba(249,115,22,0.20)', border: 'rgba(249,115,22,0.55)', text: '#fed7aa' }, // orange
  { bg: 'rgba(217,70,239,0.18)', border: 'rgba(217,70,239,0.50)', text: '#f5d0fe' }, // fuchsia
  { bg: 'rgba(20,184,166,0.20)', border: 'rgba(20,184,166,0.55)', text: '#99f6e4' }, // teal
  { bg: 'rgba(99,102,241,0.22)', border: 'rgba(99,102,241,0.55)', text: '#c7d2fe' }, // indigo
  { bg: 'rgba(234,179,8,0.18)', border: 'rgba(234,179,8,0.50)', text: '#fef08a' }, // yellow
]

/** FNV-1a hash — deterministik, distribusi merata */
function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Warna konsisten per mata kuliah: kunci = kode kursus ternormalisasi
 * (nomor grup 4 digit dibuang — grup paralel = warna sama).
 * Tanpa kode, coba ekstrak dari judul; fallback terakhir: judul utuh.
 */
export function courseColor(l: Lesson): CourseColor {
  const raw = l.code || extractCourseCode(l.title) || l.title
  const key = normalizeCourseCode(raw)
  return PALETTE[hashString(key) % PALETTE.length]
}
