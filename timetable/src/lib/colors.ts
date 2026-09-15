import type { CSSProperties } from 'react'
import type { Lesson } from '../types'
import { extractCourseCode, normalizeCourseCode } from './ics'

export interface CourseColor {
  /**
   * Triplet HSL "hue sat" — satu-satunya angka yang ditulis inline pada
   * elemen (`--ch`). Lightness, alpha, dan varian tema hidup di CSS, jadi
   * tema terang/gelap tidak perlu menghitung ulang warna di JS.
   */
  ch: string
  /** background fill */
  bg: string
  /** border */
  border: string
  /** text */
  text: string
}

/** 12 hue yang mudah dibedakan; lightness/alpha diatur CSS per tema */
const PALETTE: string[] = [
  '199 89%', // sky
  '258 90%', // violet
  '160 84%', // emerald
  '38 92%', // amber
  '349 89%', // rose
  '189 94%', // cyan
  '85 78%', // lime
  '25 95%', // orange
  '292 91%', // fuchsia
  '173 80%', // teal
  '239 84%', // indigo
  '48 96%', // yellow
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
 */
export function courseColorByKey(code: string): CourseColor {
  const ch = PALETTE[hashString(normalizeCourseCode(code)) % PALETTE.length]
  return {
    ch,
    bg: 'hsl(var(--ch) var(--cc-l) / var(--cc-bg-a))',
    border: 'hsl(var(--ch) var(--cc-l) / var(--cc-border-a))',
    text: 'hsl(var(--ch) var(--cc-text-l) / var(--cc-text-a))',
  }
}

/**
 * Warna konsisten per mata kuliah: kunci = kode kursus ternormalisasi.
 * Tanpa kode, coba ekstrak dari judul; fallback terakhir: judul utuh.
 */
export function courseColor(l: Lesson): CourseColor {
  return courseColorByKey(l.code || extractCourseCode(l.title) || l.title)
}

/**
 * Style blok kursus: menulis `--ch` sekaligus warna turunannya, sehingga
 * semua anak elemen mewarisi hue yang sama (teks/badge di dalam kartu).
 */
export function courseStyle(c: CourseColor): CSSProperties {
  return { background: c.bg, borderColor: c.border, '--ch': c.ch } as CSSProperties
}

/** Hanya mendefinisikan hue — untuk elemen yang memakai `c.text` saja. */
export function courseTextStyle(c: CourseColor): CSSProperties {
  return { color: c.text, '--ch': c.ch } as CSSProperties
}
