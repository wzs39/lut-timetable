import { describe, expect, it } from 'vitest'
import { buildIdentityDiagnostics } from '../lib/diagnostics'
import type { Lesson, SyncSource } from '../types'

// Kontrak diagnostik identitas: hitungan per sumber, coverage dua arah
// (baris tabel berkode + pelajaran yang resolve ke courseid), stempel waktu.

const src = (id: string, type: 'sisu' | 'timeedit', lastSync?: string): SyncSource => ({
  id,
  type,
  url: `https://x/${id}`,
  icsUrl: `https://x/${id}/ics`,
  label: `src-${id}`,
  count: 999, // sengaja salah: diagnostik harus hitung ulang dari lessons
  lastSync,
})

const lesson = (o: Partial<Lesson>): Lesson => ({
  id: o.id ?? Math.random().toString(36).slice(2),
  source: o.source ?? 'sisu',
  title: o.title ?? 'X',
  start: '2026-09-22T08:00:00.000Z',
  end: '2026-09-22T10:00:00.000Z',
  ...o,
})

describe('buildIdentityDiagnostics', () => {
  it('counts per source from the merged list (ignores stale s.count) + manual bucket', () => {
    const lessons = [
      lesson({ syncId: 'a', source: 'sisu' }),
      lesson({ syncId: 'a', source: 'sisu' }),
      lesson({ syncId: 'b', source: 'timeedit' }),
      lesson({ source: 'manual' }),
    ]
    const d = buildIdentityDiagnostics([src('a', 'sisu'), src('b', 'timeedit')], lessons, [], null, null, null)
    expect(d.sources.map((s) => [s.type, s.count])).toEqual([
      ['sisu', 2],
      ['timeedit', 1],
      ['manual', 1],
    ])
  })

  it('omits the manual bucket when there are no manual lessons', () => {
    const d = buildIdentityDiagnostics([src('a', 'sisu')], [lesson({ syncId: 'a' })], [], null, null, null)
    expect(d.sources).toHaveLength(1)
  })

  it('coverage: coded identity rows and resolved lessons join by normalized code', () => {
    const lessons = [
      lesson({ syncId: 'a', code: 'bm20a9200' }), // resolve (case-insensitive)
      lesson({ syncId: 'a', code: 'BM20A9200 ' }), // resolve (trim)
      lesson({ syncId: 'a', code: 'BM20A9200-3001' }), // resolve (group suffix stripped)
      lesson({ syncId: 'a', code: 'ZZ99XX99' }), // coded but unresolved
      lesson({ source: 'manual', code: 'BM20A9200' }), // manual excluded from resolution
      lesson({ syncId: 'a' }), // uncoded → not counted
    ]
    const d = buildIdentityDiagnostics(
      [src('a', 'sisu')],
      lessons,
      [{ code: 'BM20A9200' }, { code: 'CT60A4050' }, { code: null }],
      1727000000000,
      null,
      null,
    )
    expect(d.identityCoded).toBe(2)
    expect(d.identityTotal).toBe(3)
    expect(d.lessonCoded).toBe(4) // manual lesson with code excluded
    expect(d.lessonResolved).toBe(3)
    expect(d.identityUpdatedAt).toBe(new Date(1727000000000).toISOString())
  })

  it('empty table / uncoded lessons degrade to null percentages, not NaN', () => {
    const d = buildIdentityDiagnostics([src('a', 'sisu')], [lesson({ syncId: 'a' })], [], null, '2026-09-22T06:00:00.000Z', null)
    expect(d.identityTotal).toBe(0)
    expect(d.identityCoded).toBe(0)
    expect(d.lessonCoded).toBe(0)
    expect(d.lessonResolved).toBe(0)
    expect(d.identityUpdatedAt).toBeNull()
    expect(d.moodleLastSync).toBe('2026-09-22T06:00:00.000Z')
    expect(d.moodleIcsLastSync).toBeNull()
  })
})
