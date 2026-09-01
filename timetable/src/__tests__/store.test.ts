import { beforeEach, describe, expect, it } from 'vitest'
import {
  backfillLessonTypes,
  dedupeLessons,
  isCrossSourceDup,
  lessonKey,
  normalizeSisuUrl,
  normalizeTimeEditUrl,
} from '../lib/store'
import type { Lesson } from '../types'

// localStorage polyfill untuk environment node
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
} as Storage

beforeEach(() => store.clear())

/** Pelajaran SISU dasar (dipakai beberapa describe) */
const sisu: Lesson = {
  id: 's1', source: 'sisu', title: 'CT60A4050 · SWE', code: 'CT60A4050',
  start: '2026-08-31T11:00:00.000Z', end: '2026-08-31T13:00:00.000Z', uid: 'u-s1',
}
/** Duplikat TimeEdit persis sama (kode + waktu) */
const timeedit: Lesson = {
  id: 't1', source: 'timeedit', title: 'CT60A4050 duplicated', code: 'CT60A4050',
  start: '2026-08-31T11:00:00.000Z', end: '2026-08-31T13:00:00.000Z', uid: 'u-t1',
}

describe('normalizeSisuUrl', () => {
  it('accepts a calendar-share API URL as-is', () => {
    const url = 'https://sisu.lut.fi/ilmo/api/calendar-share/2729035f-30c8-4947-870c-ec6230de5ed1'
    expect(normalizeSisuUrl(url)).toBe(url)
  })

  it('accepts a URL with query string intact', () => {
    const url = 'https://sisu.lut.fi/ilmo/api/calendar-share/2729035f-30c8-4947-870c-ec6230de5ed1?x=1'
    expect(normalizeSisuUrl(url)).toBe(url)
  })

  it('rejects other hosts', () => {
    expect(normalizeSisuUrl('https://evil.example.com/ilmo/api/calendar-share/2729035f-30c8-4947-870c-ec6230de5ed1')).toBeNull()
  })

  it('rejects sisu pages without calendar-share', () => {
    expect(normalizeSisuUrl('https://sisu.lut.fi/student/calendar/enrolments')).toBeNull()
  })

  it('rejects garbage', () => {
    expect(normalizeSisuUrl('not a url')).toBeNull()
    expect(normalizeSisuUrl('')).toBeNull()
  })
})

describe('normalizeTimeEditUrl', () => {
  it('converts a .html viewer page to an .ics subscription URL', () => {
    expect(
      normalizeTimeEditUrl(
        'https://cloud.timeedit.net/lut-saimia/web/lutpublic/ri1Y8X1QQ7wZ16QfQ5079675yYY95Z7.html',
      ),
    ).toBe(
      'https://cloud.timeedit.net/lut-saimia/web/lutpublic/ri1Y8X1QQ7wZ16QfQ5079675yYY95Z7.ics',
    )
  })

  it('accepts an .ics URL as-is', () => {
    const url = 'https://cloud.timeedit.net/lut-saimia/web/lutpublic/ri1Y8X1QQ7wZ16QfQ5079675yYY95Z7.ics'
    expect(normalizeTimeEditUrl(url)).toBe(url)
  })

  it('rejects other hosts and garbage', () => {
    expect(normalizeTimeEditUrl('https://example.com/ri1Y8.html')).toBeNull()
    expect(normalizeTimeEditUrl('https://cloud.timeedit.net/lut-saimia/web/lutpublic/ri1Y8X1QQ7wZ16QfQ5079675yYY95Z7')).toBeNull()
    expect(normalizeTimeEditUrl('oops')).toBeNull()
  })
})

describe('lessonKey', () => {
  it('uses code + start + end for coded lessons', () => {
    const l: Lesson = {
      id: '1', source: 'sisu', title: 'X', code: 'bm20a9200',
      start: '2026-08-31T07:00:00.000Z', end: '2026-08-31T10:00:00.000Z',
    }
    expect(lessonKey(l)).toBe('BM20A9200|2026-08-31T07:00:00.000Z|2026-08-31T10:00:00.000Z')
  })

  it('falls back to uid for uncoded lessons', () => {
    const l: Lesson = {
      id: '1', source: 'sisu', title: 'HDD5020 · Something',
      start: '2026-08-31T07:00:00.000Z', end: '2026-08-31T10:00:00.000Z',
      uid: 'lut-99.0',
    }
    expect(lessonKey(l)).toBe('uid:lut-99.0')
  })
})

describe('dedupeLessons', () => {
  it('merges exact cross-source duplicates and annotates mergedSources', () => {
    const out = dedupeLessons([sisu, timeedit])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('s1') // urutan awal dipertahankan
    expect(out[0].mergedSources).toEqual(['sisu', 'timeedit'])
  })

  it('keeps both when times differ', () => {
    const different: Lesson = { ...timeedit, id: 't2', uid: 'u-t2', start: '2026-08-31T09:00:00.000Z' }
    const out = dedupeLessons([sisu, different])
    expect(out).toHaveLength(2)
    expect(out.every((l) => !l.mergedSources)).toBe(true)
  })

  it('keeps manual lesson and merges source annotation onto it', () => {
    const manual: Lesson = { ...sisu, id: 'm1', source: 'manual', uid: undefined, syncId: undefined }
    const out = dedupeLessons([manual, timeedit])
    expect(out).toHaveLength(1)
    expect(out[0].source).toBe('manual')
    expect(out[0].mergedSources).toEqual(['manual', 'timeedit'])
  })

  it('preserves original order after dedupe', () => {
    const later: Lesson = { ...sisu, id: 's2', start: '2026-09-01T11:00:00.000Z', end: '2026-09-01T13:00:00.000Z' }
    const out = dedupeLessons([later, sisu, timeedit])
    expect(out.map((l) => l.id)).toEqual(['s2', 's1'])
  })

  it('is idempotent', () => {
    const once = dedupeLessons([sisu, timeedit])
    const twice = dedupeLessons(once)
    expect(twice).toEqual(once)
  })
})

describe('backfillLessonTypes', () => {
  it('fills type from title keywords for legacy lessons', () => {
    const legacy: Lesson = {
      id: '1', source: 'sisu', title: 'BM20A9301 · Statistics · Exam',
      start: '2026-08-31T07:00:00.000Z', end: '2026-08-31T09:00:00.000Z',
    }
    const out = backfillLessonTypes([legacy])
    expect(out[0].type).toBe('exam')
  })

  it('keeps existing type and leaves untyped-but-keywordless lessons alone', () => {
    const typed: Lesson = {
      id: '1', source: 'sisu', title: 'X · Exam', type: 'lecture',
      start: '2026-08-31T07:00:00.000Z', end: '2026-08-31T09:00:00.000Z',
    }
    const plain: Lesson = {
      id: '2', source: 'timeedit', title: 'Kukkonen Noora',
      start: '2026-08-31T07:00:00.000Z', end: '2026-08-31T09:00:00.000Z',
    }
    const out = backfillLessonTypes([typed, plain])
    expect(out[0].type).toBe('lecture') // tidak ditimpa
    expect(out[1].type).toBeUndefined()
  })
})

describe('legitimate course repetition is never removed', () => {
  /** Kuliah mingguan yang sama persis, beda pekan */
  const week = (sat: string) => ({
    ...sisu,
    id: `s-${sat}`,
    uid: `u-${sat}`,
    start: `2026-10-${sat}T11:00:00.000Z`,
    end: `2026-10-${sat}T13:00:00.000Z`,
  })

  it('keeps the same course repeating every week', () => {
    const out = dedupeLessons([week('06'), week('13'), week('20'), week('27')])
    expect(out).toHaveLength(4)
    expect(out.every((l) => !l.mergedSources)).toBe(true)
  })

  it('keeps parallel group sessions from the SAME source at the same time', () => {
    // CT60A0250 punya 3 grup paralel di slot yang sama — wajar, salah satunya diikuti
    const g1: Lesson = { ...timeedit, id: 'g1', uid: 'u-g1', location: 'Room A' }
    const g2: Lesson = { ...timeedit, id: 'g2', uid: 'u-g2', location: 'Room B' }
    const g3: Lesson = { ...timeedit, id: 'g3', uid: 'u-g3', location: 'Room C' }
    const out = dedupeLessons([g1, g2, g3])
    expect(out).toHaveLength(3)
  })

  it('keeps uncoded lessons even when they look identical', () => {
    const a: Lesson = { ...sisu, id: 'ua', code: undefined, uid: 'u-ua' }
    const b: Lesson = { ...timeedit, id: 'ub', code: undefined, uid: 'u-ub' }
    expect(dedupeLessons([a, b])).toHaveLength(2)
  })

  it('keeps lessons whose times only differ by a few minutes', () => {
    // 09:00 vs 09:15 — jadwal beda sumber memang sering geser sedikit;
    // bukan duplikat persis, biarkan resolver manual yang menangani
    const shifted: Lesson = { ...timeedit, id: 't9', uid: 'u-t9', start: '2026-08-31T11:15:00.000Z' }
    const out = dedupeLessons([sisu, shifted])
    expect(out).toHaveLength(2)
  })

  it('does not treat a different course at the same time as a duplicate', () => {
    const other: Lesson = { ...timeedit, id: 'o1', uid: 'u-o1', code: 'CT10A9900' }
    expect(dedupeLessons([sisu, other])).toHaveLength(2)
    expect(isCrossSourceDup(sisu, other)).toBe(false)
  })

  it('isCrossSourceDup requires code, exact time, and different sources', () => {
    expect(isCrossSourceDup(sisu, timeedit)).toBe(true)
    expect(isCrossSourceDup(sisu, { ...timeedit, code: undefined })).toBe(false)
    expect(isCrossSourceDup(sisu, { ...timeedit, source: 'sisu' })).toBe(false)
    expect(isCrossSourceDup(sisu, { ...timeedit, start: '2026-08-31T11:30:00.000Z' })).toBe(false)
    expect(isCrossSourceDup(sisu, { ...timeedit, end: '2026-08-31T13:30:00.000Z' })).toBe(false)
  })

  it('merges three-way duplicates into one with all sources annotated', () => {
    const te: Lesson = { ...timeedit, id: 'te', uid: 'u-te' }
    const out = dedupeLessons([sisu, te, { ...sisu, id: 's2', uid: 'u-s2' }])
    // s2 sumbernya sama dengan s1 -> grup paralel, tetap ada
    expect(out).toHaveLength(2)
    const annotated = out.find((l) => l.id === 's1')!
    expect(annotated.mergedSources).toEqual(['sisu', 'timeedit'])
  })
})
