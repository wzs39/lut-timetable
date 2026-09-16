import { describe, expect, it } from 'vitest'

/**
 * Penjaga: tautan luar hanya boleh dibuka lewat <ExternalLink> ->
 * lib/openExternal. Tab baru (target kosong) dan jendela lewat JS diabaikan
 * diam-diam di WebView native — itu penyebab tombol "下载 APK" mati di Android
 * (lihat lib/openExternal.ts).
 */
const sources = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Satu-satunya tempat yang boleh menyentuh API platform. */
const ALLOWED = new Set(['../lib/openExternal.ts'])

/**
 * Tes sendiri boleh menyebut polanya. Glob mengembalikan nama relatif dengan
 * bentuk berbeda ("../components/X.tsx" vs "./X.test.ts"), jadi penyaringnya
 * tidak boleh bergantung pada satu bentuk path saja.
 */
const isTestFile = (path: string) => path.includes('__tests__') || /\.test\.tsx?$/.test(path)

const FORBIDDEN = [/target="_blank"/, /window\.open\s*\(/]

describe('external links', () => {
  it('routes every external link through lib/openExternal', () => {
    const offenders: string[] = []
    for (const [path, text] of Object.entries(sources)) {
      // Tes boleh menyebut polanya (penjaga ini sendiri) — hanya kode produksi
      // yang diperiksa.
      if (isTestFile(path) || ALLOWED.has(path)) continue
      text.split('\n').forEach((line, i) => {
        if (FORBIDDEN.some((re) => re.test(line))) offenders.push(`${path}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
