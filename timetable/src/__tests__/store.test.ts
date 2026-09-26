import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchIcsText } from '../lib/fetchIcs'
import {
  addHiddenKeys,
  backfillLessonTypes,
  cleanTimeEditTitle,
  dedupeLessons,
  isCrossSourceDup,
  lessonKey,
  loadHiddenKeys,
  loadSources,
  normalizeSisuUrl,
  normalizeTimeEditUrl,
  removeHiddenKeys,
  sourceFromUrl,
  syncSource,
} from '../lib/store'
import type { Lesson, SyncSource } from '../types'

// syncSource memanggil fetchIcsText (jaringan) — mock untuk pengujian
vi.mock('../lib/fetchIcs', () => ({ fetchIcsText: vi.fn() }))

// localStorage polyfill untuk environment node
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
} as Storage

beforeEach(() => store.clear())

/**
 * FIXTUR SINTETIS — pengganti placeholder, BUKAN link langganan asli.
 * Bentuknya sengaja dibuat identik dengan nilai asli (UUID 36 karakter,
 * id TimeEdit 32 karakter) supaya parser URL di bawah diuji dengan cara
 * yang sama persis.
 */
const FAKE_SISU_ID = 'deadbeef-dead-4dea-8dbe-deadbeefdead'
const FAKE_TIMEEDIT_ID = 'riEXAMPLESYNTHETIC00000000000000'
const FAKE_SISU_URL = `https://sisu.lut.fi/ilmo/api/calendar-share/${FAKE_SISU_ID}`
const TIMEEDIT_BASE = 'https://cloud.timeedit.net/lut-saimia/web/lutpublic'
const FAKE_TIMEEDIT_HTML = `${TIMEEDIT_BASE}/${FAKE_TIMEEDIT_ID}.html`
const FAKE_TIMEEDIT_ICS = `${TIMEEDIT_BASE}/${FAKE_TIMEEDIT_ID}.ics`

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
    expect(normalizeSisuUrl(FAKE_SISU_URL)).toBe(FAKE_SISU_URL)
  })

  it('accepts a URL with query string intact', () => {
    const url = `${FAKE_SISU_URL}?x=1`
    expect(normalizeSisuUrl(url)).toBe(url)
  })

  it('rejects other hosts', () => {
    expect(
      normalizeSisuUrl(`https://evil.example.com/ilmo/api/calendar-share/${FAKE_SISU_ID}`),
    ).toBeNull()
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
    expect(normalizeTimeEditUrl(FAKE_TIMEEDIT_HTML)).toBe(FAKE_TIMEEDIT_ICS)
  })

  it('accepts an .ics URL as-is', () => {
    expect(normalizeTimeEditUrl(FAKE_TIMEEDIT_ICS)).toBe(FAKE_TIMEEDIT_ICS)
  })

  it('rejects other hosts and garbage', () => {
    expect(normalizeTimeEditUrl('https://example.com/ri1Y8.html')).toBeNull()
    expect(normalizeTimeEditUrl(`${TIMEEDIT_BASE}/${FAKE_TIMEEDIT_ID}`)).toBeNull()
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

describe('cleanTimeEditTitle', () => {
  it('strips leading code, group code and programme codes (K200DJ96 form)', () => {
    expect(
      cleanTimeEditTitle(
        'K200DJ96 Finnish 1 K200DJ96-3015 · KKIE26LABH · KKIE26LUTH',
        'K200DJ96',
      ),
    ).toBe('Finnish 1')
  })

  it('handles reversed order (K200DJ99 form)', () => {
    expect(
      cleanTimeEditTitle(
        'K200DJ99 K200DJ99-3014 Finnish 2 · KKIE26LABH · KKIE26LUTH',
        'K200DJ99',
      ),
    ).toBe('Finnish 2')
  })

  it('strips programme codes, room number and Tunnus id (KE00DA03 form)', () => {
    expect(
      cleanTimeEditTitle(
        'KE00DA03 KE00DA03-3013 English for the Hebei University of Technology, KKIE26LUTH, KoBScDDhebei1, SaBScDDhebei1, 1304 Tunnus 586895',
        'KE00DA03',
      ),
    ).toBe('English for the Hebei University of Technology')
  })

  it('removes unknown leading code when code is not provided', () => {
    expect(
      cleanTimeEditTitle('XX0000 Guest lecture · KKIE26LABH'),
    ).toBe('Guest lecture')
  })

  it('falls back to cleanTitle for empty results', () => {
    expect(cleanTimeEditTitle(undefined, 'K200DJ96')).toBe('Untitled')
  })
})

describe('syncSource rolling window (TimeEdit upsert)', () => {
  /** ICS sintetis — window feed = [2026-09-21, 2026-12-11] */
  const teSource = (id = 'te-src-1'): SyncSource => ({
    id,
    type: 'timeedit',
    url: 'https://cloud.timeedit.net/x/y.ics',
    icsUrl: 'https://cloud.timeedit.net/x/y.ics',
    label: 'TimeEdit',
    count: 0,
    windowDays: 14,
  })
  const icsOf = (uid: string, day: string) =>
    [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:${day}T100000Z`,
      `DTEND:${day}T120000Z`,
      'SUMMARY:K200DJ96 Finnish 1 K200DJ96-3015',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

  it('preserves past lessons outside the rolling window', async () => {
    vi.mocked(fetchIcsText).mockResolvedValue(icsOf('teA', '20260921'))
    const past: Lesson = {
      id: 'old1', source: 'timeedit', title: 'Past lesson',
      code: 'K200DJ96', start: '2026-09-15T10:00:00.000Z',
      end: '2026-09-15T12:00:00.000Z', uid: 'teOld', syncId: 'te-src-1',
    }
    const { lessons, result } = await syncSource(teSource(), [past])
    expect(lessons.some((l) => l.id === 'old1')).toBe(true)
    expect(result.total).toBe(1)
  })

  it('preserves future lessons beyond the current window too', async () => {
    vi.mocked(fetchIcsText).mockResolvedValue(icsOf('teA', '20260921'))
    const far: Lesson = {
      id: 'far1', source: 'timeedit', title: 'Far future',
      code: 'K200DJ96', start: '2027-03-03T10:00:00.000Z',
      end: '2027-03-03T12:00:00.000Z', uid: 'teFar', syncId: 'te-src-1',
    }
    const { lessons } = await syncSource(teSource(), [far])
    expect(lessons.some((l) => l.id === 'far1')).toBe(true)
  })

  it('replaces in-window lessons by uid instead of duplicating', async () => {
    const uid = 'teA'
    vi.mocked(fetchIcsText).mockResolvedValueOnce(icsOf(uid, '20260921'))
    const first = await syncSource(teSource(), [])
    vi.mocked(fetchIcsText).mockResolvedValueOnce(icsOf(uid, '20260921'))
    const second = await syncSource(teSource(), first.lessons)
    expect(second.lessons.filter((l) => l.uid === uid)).toHaveLength(1)
    expect(second.result.total).toBe(1)
  })

  it('does not wipe the source when the feed comes back empty', async () => {
    vi.mocked(fetchIcsText).mockResolvedValue(
      'BEGIN:VCALENDAR\r\nEND:VCALENDAR',
    )
    const past: Lesson = {
      id: 'old1', source: 'timeedit', title: 'Past',
      start: '2026-09-15T10:00:00.000Z', end: '2026-09-15T12:00:00.000Z',
      uid: 'teOld', syncId: 'te-src-1',
    }
    const { lessons } = await syncSource(teSource(), [past])
    expect(lessons.some((l) => l.id === 'old1')).toBe(true)
  })

  it('still full re-syncs sources without windowDays (SISU)', async () => {
    vi.mocked(fetchIcsText).mockResolvedValue(icsOf('sisu1', '20260921'))
    const stale: Lesson = {
      id: 'g1', source: 'sisu', title: 'Old sisu lesson',
      start: '2026-09-15T10:00:00.000Z', end: '2026-09-15T12:00:00.000Z',
      uid: 'sisuOld', syncId: 'sisu-src-1',
    }
    const { lessons } = await syncSource(
      {
        id: 'sisu-src-1', type: 'sisu', url: 'x', icsUrl: 'x',
        label: 'SISU', count: 0,
      },
      [stale],
    )
    expect(lessons.some((l) => l.id === 'g1')).toBe(false)
  })

  it('migrates legacy TimeEdit sources by adding windowDays', () => {
    store.set(
      'tt_sources_v1',
      JSON.stringify([
        {
          id: 'legacy', type: 'timeedit', url: 'x', icsUrl: 'x',
          label: 'TimeEdit', count: 0,
        },
      ]),
    )
    const out = loadSources()
    expect(out[0].windowDays).toBe(14)
  })
})

/** 隐藏 / 撤销隐藏：设置与批量筛选共用的存储层 */
const hiddenFixture = (id: string, code: string): Lesson => ({
  id,
  source: 'manual',
  title: `Lesson ${id}`,
  code,
  start: '2026-09-21T08:00:00.000Z',
  end: '2026-09-21T10:00:00.000Z',
})

describe('removeHiddenKeys', () => {
  it('removes only the given keys so undo restores the rest', () => {
    const a = hiddenFixture('a', 'X1')
    const b = hiddenFixture('b', 'X2')
    addHiddenKeys([a, b])
    expect(loadHiddenKeys().size).toBe(2)
    removeHiddenKeys([lessonKey(a)])
    expect([...loadHiddenKeys()]).toEqual([lessonKey(b)])
  })

  it('is a no-op for unknown keys and empty input', () => {
    addHiddenKeys([hiddenFixture('a', 'X1')])
    removeHiddenKeys(['nope'])
    removeHiddenKeys([])
    expect(loadHiddenKeys().size).toBe(1)
  })
})

describe('sourceFromUrl', () => {
  it('builds a SISU source from a calendar-share link (trimmed)', () => {
    const src = sourceFromUrl(`  ${FAKE_SISU_URL}  `)
    expect(src).toMatchObject({
      type: 'sisu',
      url: FAKE_SISU_URL,
      icsUrl: FAKE_SISU_URL,
      label: 'SISU calendar-share',
      count: 0,
    })
    expect(src?.id).toBeTruthy()
  })

  it('builds a TimeEdit source from a .html page link', () => {
    expect(sourceFromUrl(FAKE_TIMEEDIT_HTML)).toMatchObject({
      type: 'timeedit',
      icsUrl: FAKE_TIMEEDIT_ICS,
      label: 'TimeEdit',
    })
  })

  it('accepts an already-.ics TimeEdit link too', () => {
    expect(sourceFromUrl(FAKE_TIMEEDIT_ICS)?.icsUrl).toBe(FAKE_TIMEEDIT_ICS)
  })

  it('rejects empty and unrecognised URLs', () => {
    expect(sourceFromUrl('')).toBeNull()
    expect(sourceFromUrl('   ')).toBeNull()
    expect(sourceFromUrl('https://example.com/calendar.ics')).toBeNull()
  })

  it('mints a fresh id per added source', () => {
    expect(sourceFromUrl(FAKE_SISU_URL)?.id).not.toBe(sourceFromUrl(FAKE_SISU_URL)?.id)
  })
})

