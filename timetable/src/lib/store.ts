import type { Lesson, SyncSource } from '../types'
import {
  parseIcs,
  extractCourseCode,
  detectLessonType,
  normalizeCourseCode,
} from './ics'
import { fetchIcsText } from './fetchIcs'
import { KEYS, readJson, writeJson } from './storage'

export function loadLessons(): Lesson[] {
  return readJson<Lesson[]>(KEYS.lessons, [])
}

export function saveLessons(l: Lesson[]) {
  writeJson(KEYS.lessons, l)
}

/**
 * Migration sekali-jalan: sumber TimeEdit lama belum punya flag windowDays
 * (feed hanya mengirim ~7 hari ke depan — window bergulir). Ditandai di
 * sini supaya syncSource melindungi pelajaran di luar window.
 */
function migrateSourceWindowFlags(sources: SyncSource[]): SyncSource[] {
  let changed = false
  const out = sources.map((s) => {
    if (s.type === 'timeedit' && s.windowDays == null) {
      changed = true
      return { ...s, windowDays: 14 }
    }
    return s
  })
  if (changed) saveSources(out)
  return out
}

export function loadSources(): SyncSource[] {
  return migrateSourceWindowFlags(
    readJson<SyncSource[]>(KEYS.sources, []),
  )
}

export function saveSources(s: SyncSource[]) {
  writeJson(KEYS.sources, s)
}

export function uid(): string {
  return crypto.randomUUID()
}

/** Normalisasi URL share SISU menjadi URL ICS */
export function normalizeSisuUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    if (!u.hostname.endsWith('sisu.lut.fi')) return null
    // Bentuk yang didukung:
    //  - https://sisu.lut.fi/ilmo/api/calendar-share/<uuid>
    //  - https://sisu.lut.fi/student/calendar/enrolments (halaman — minta user copy link share)
    if (u.pathname.includes('/api/calendar-share/')) return u.toString()
    const m = u.pathname.match(/calendar-share\/([0-9a-f-]{36})/i)
    if (m) return `${u.origin}/ilmo/api/calendar-share/${m[1]}`
    return null
  } catch {
    return null
  }
}

/** TimeEdit: halaman .html → URL langganan .ics yang setara */
export function normalizeTimeEditUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    if (!u.hostname.includes('timeedit.net')) return null
    if (u.pathname.endsWith('.ics')) return u.toString()
    if (u.pathname.endsWith('.html')) {
      const objUrl = new URL(u.toString())
      objUrl.pathname = u.pathname.replace(/\.html$/, '.ics')
      return objUrl.toString()
    }
    return null
  } catch {
    return null
  }
}

export interface SyncResult {
  added: number
  updated: number
  removed: number
  total: number
  /** pelajaran sumber lain yang digabung (cross-source dedup) */
  merged: number
  /** pelajaran yang dilewati karena dihapus pengguna (tombstone) */
  skipped: number
}

/** Kunci identitas pelajaran lintas sync: kode+waktu, fallback uid */
export function lessonKey(l: Lesson): string {
  return dedupeKeyOf(l) ?? (l.uid ? `uid:${l.uid}` : `id:${l.id}`)
}

/** Semua tombstone yang tersimpan (untuk panel manajemen di sidebar) */
export function loadTombstones(): Set<string> {
  return new Set(readJson<string[]>(KEYS.tombstones, []))
}

/** Cabut satu tombstone — pelajaran akan diimpor ulang pada sync berikutnya */
export function removeTombstone(key: string) {
  const set = loadTombstones()
  if (set.delete(key)) {
    writeJson(KEYS.tombstones, [...set])
  }
}

/** Hapus semua tombstone */
export function clearTombstones() {
  writeJson(KEYS.tombstones, [])
}

/** Kunci lesson yang disembunyikan sementara (tampilan saja, tanpa hapus).
 *  Pakai lessonKey agar tetap tersembunyi walau re-sync memberi id baru. */
export function loadHiddenKeys(): Set<string> {
  return new Set(readJson<string[]>(KEYS.hidden, []))
}

function saveHiddenKeys(keys: Set<string>) {
  writeJson(KEYS.hidden, [...keys])
}

/** Sembunyikan lesson (berdasarkan id) dari kalender — bisa dibuka lagi */
export function addHiddenKeys(lessons: Lesson[]) {
  const set = loadHiddenKeys()
  let changed = false
  for (const l of lessons) {
    const k = lessonKey(l)
    if (k && !set.has(k)) {
      set.add(k)
      changed = true
    }
  }
  if (changed) saveHiddenKeys(set)
}

/** Tampilkan lagi semua lesson yang disembunyikan */
export function clearHiddenKeys() {
  writeJson(KEYS.hidden, [])
}

/** Ingat pelajaran yang dihapus pengguna — tidak akan diimpor ulang saat sync */
export function addTombstones(lessons: Lesson[]) {
  const set = loadTombstones()
  let changed = false
  for (const l of lessons) {
    const k = lessonKey(l)
    if (k && !set.has(k)) {
      set.add(k)
      changed = true
    }
  }
  if (changed) writeJson(KEYS.tombstones, [...set])
}

/** Semua override yang tersimpan: key -> patch (untuk panel manajemen) */
export function loadOverrides(): Record<string, Partial<Lesson>> {
  return readJson<Record<string, Partial<Lesson>>>(KEYS.overrides, {})
}

const CONTENT_FIELDS = ['title', 'code', 'location', 'start', 'end'] as const

/** Ingat hasil editan pengguna pada pelajaran sync — dipakai ulang saat sync */
export function saveOverride(key: string, patch: Partial<Lesson>) {
  const all = loadOverrides()
  const prev = all[key] || {}
  for (const f of CONTENT_FIELDS) {
    if (patch[f] !== undefined) (prev as any)[f] = patch[f]
  }
  all[key] = prev
  writeJson(KEYS.overrides, all)
}

/** Hapus semua override */
export function clearOverrides() {
  writeJson(KEYS.overrides, {})
}

export function deleteOverride(key: string) {
  const all = loadOverrides()
  if (all[key]) {
    delete all[key]
    writeJson(KEYS.overrides, all)
  }
}

/** Kunci dedup lintas sumber: kode (ternormalisasi, tanpa no. grup) + waktu */
function dedupeKeyOf(l: Lesson): string | null {
  if (!l.code) return null
  return `${normalizeCourseCode(l.code)}|${l.start}|${l.end}`
}

/**
 * Apakah dua pelajaran boleh dianggap duplikat lintas sumber?
 * SYARAT KETAT (agar pengulangan kuliah yang wajar tidak terhapus):
 * 1. Keduanya punya kode kursus — tanpa kode, jangan pernah merge otomatis
 * 2. Kode sama (case-insensitive)
 * 3. Waktu mulai DAN selesai persis sama (ISO) — kuliah mingguan berulang
 *    selalu berbeda tanggal, jadi aman
 * 4. Sumber berbeda — grup paralel dari sumber yang sama tetap dipertahankan
 */
export function isCrossSourceDup(a: Lesson, b: Lesson): boolean {
  if (!a.code || !b.code) return false
  if (normalizeCourseCode(a.code) !== normalizeCourseCode(b.code)) return false
  if (a.start !== b.start || a.end !== b.end) return false
  return a.source !== b.source
}

/**
 * Gabungkan anotasi sumber ke lesson yang sudah ada (tidak menimpa data).
 */
function mergeSourceInto(l: Lesson, source: Lesson['source']): Lesson {
  const existing = l.mergedSources ?? [l.source]
  if (existing.includes(source)) return l
  return { ...l, mergedSources: [...existing, source] }
}

/**
 * Safety-net saat load: gabungkan HANYA duplikat lintas sumber yang persis
 * sama (kode + mulai + selesai + sumber berbeda). Pengulangan kuliah yang
 * wajar (mingguan, grup paralel dari sumber yang sama) tidak pernah
 * digabung. Urutan awal dipertahankan, sumber digabung ke anotasi.
 */
export function dedupeLessons(lessons: Lesson[]): Lesson[] {
  const out: Lesson[] = []
  // kunci dedup -> indeks di `out` (bisa beberapa pelajaran per kunci
  // bila sumbernya sama — grup paralel)
  const byKey = new Map<string, number[]>()
  for (const l of lessons) {
    const k = dedupeKeyOf(l)
    let mergedIntoExisting = false
    if (k) {
      const idxs = byKey.get(k) || []
      for (const i of idxs) {
        if (isCrossSourceDup(out[i], l)) {
          out[i] = mergeSourceInto(out[i], l.source)
          mergedIntoExisting = true
          break
        }
      }
    }
    if (!mergedIntoExisting) {
      out.push(l)
      if (k) {
        const idxs = byKey.get(k) || []
        idxs.push(out.length - 1)
        byKey.set(k, idxs)
      }
    }
  }
  return out
}

/**
 * Backfill jenis sesi dari judul untuk lesson lama yang belum punya `type`
 * (data sebelum fitur ini ada, atau sumber yang tidak menyediakan type).
 * Judul hasil cleanTitle SISU tetap membawa "· Exam" / "· Contact teaching".
 */
export function backfillLessonTypes(lessons: Lesson[]): Lesson[] {
  let changed = false
  const out = lessons.map((l) => {
    if (l.type) return l
    const t = detectLessonType(l.title)
    if (!t) return l
    changed = true
    return { ...l, type: t }
  })
  return changed ? out : lessons
}

/**
 * Fetch + parse ICS dari satu sumber, lalu merge ke daftar lesson.
 * Lesson lama dari sumber yang sama dihapus dulu (full re-sync), kecuali
 * lesson manual yang tidak pernah disentuh.
 *
 * Sumber rolling-window (windowDays ditentukan, mis. TimeEdit hanya
 * mengirim ~7 hari ke depan): lesson di luar window TIDAK dihapus —
 * sync diperlakukan sebagai upsert. Tanpa ini, setiap sync menghapus
 * semua pelajaran yang sudah lewat dari window feed.
 */
export async function syncSource(
  src: SyncSource,
  existing: Lesson[],
): Promise<{ lessons: Lesson[]; result: SyncResult }> {
  const text = await fetchIcsText(src.icsUrl)
  const events = parseIcs(text)

  const windowMs =
    src.windowDays != null ? src.windowDays * 24 * 60 * 60 * 1000 : null
  /**
   * Rentang window feed saat ini [min, max] (undefined = full re-sync).
   * Hanya lesson DI DALAM rentang ini yang boleh dihapus — event feed
   * pasti menggantikannya. Lesson sebelum window (sudah lewat) dan
   * sesudah window (diimpor saat window sebelumnya lebih jauh) tidak
   * pernah dikirim lagi feed, jadi harus dipertahankan.
   */
  let windowMin: number | undefined
  let windowMax: number | undefined
  if (windowMs != null && events.length > 0) {
    const starts = events.map((e) => e.start.getTime())
    windowMin = Math.min(...starts)
    windowMax = Math.max(...starts)
  } else if (windowMs != null) {
    // feed kosong (mis. respons sesaat): jangan hapus apa pun —
    // semua lesson sumber ini dipertahankan sampai sync berikutnya
    windowMin = Number.POSITIVE_INFINITY
    windowMax = Number.NEGATIVE_INFINITY
  }

  const kept = existing.filter((l) => {
    if (l.syncId !== src.id || l.source === 'manual') return true
    if (windowMin == null || windowMax == null) return false
    const t = new Date(l.start).getTime()
    // di luar window rolling (lampau atau masa depan) — dipertahankan
    return t < windowMin || t > windowMax
  })
  const keptUids = new Set(kept.map((l) => l.uid).filter(Boolean))
  /** pelajaran lama milik sumber ini — untuk membawa ulang anotasi merged */
  const oldByUid = new Map(
    existing
      .filter((l) => l.syncId === src.id && l.uid)
      .map((l) => [l.uid as string, l]),
  )

  // indeks dedup lintas sumber dari pelajaran yang dipertahankan
  // (bisa beberapa pelajaran per kunci bila sumbernya sama — grup paralel)
  const byKey = new Map<string, Lesson[]>()
  for (const l of kept) {
    const k = dedupeKeyOf(l)
    if (!k) continue
    const arr = byKey.get(k) || []
    arr.push(l)
    byKey.set(k, arr)
  }

  let added = 0
  let updated = 0
  let merged = 0
  let skipped = 0
  const codeOf = (s: string | undefined) => extractCourseCode(s)
  /** judul bersih: format SISU vs format TimeEdit beda tata letak */
  const titleOf = (s: string | undefined, code: string | undefined) =>
    src.type === 'timeedit'
      ? cleanTimeEditTitle(s, code)
      : cleanTitle(s, code)
  const tombstones = loadTombstones()
  const overrides = loadOverrides()
  const mergedIds = new Map<string, Lesson>()
  const incoming: Lesson[] = []
  for (const e of events) {
    const isNew = e.uid ? !keptUids.has(e.uid) : true
    if (isNew) added++
    else updated++
    const prev = e.uid ? oldByUid.get(e.uid) : undefined
    const lesson: Lesson = {
      id: uid(),
      source: src.type,
      title: titleOf(e.summary, codeOf(e.summary)),
      code: codeOf(e.summary),
      type: detectLessonType(e.summary),
      location: e.location,
      start: e.start.toISOString(),
      end: e.end.toISOString(),
      uid: e.uid,
      syncId: src.id,
      // pertahankan anotasi merged dari re-sync sebelumnya
      ...(prev?.mergedSources ? { mergedSources: prev.mergedSources } : {}),
    }
    // sync protection: pelajaran yang dihapus pengguna tidak diimpor ulang
    const rawKey = lessonKey(lesson)
    if (tombstones.has(rawKey)) {
      skipped++
      continue
    }
    // sync protection: terapkan kembali editan pengguna
    const ov = overrides[rawKey]
    if (ov) Object.assign(lesson, ov)

    const k = dedupeKeyOf(lesson)
    let dup: Lesson | undefined
    if (k) {
      for (const candidate of byKey.get(k) || []) {
        if (isCrossSourceDup(candidate, lesson)) {
          dup = candidate
          break
        }
      }
    }
    if (dup) {
      // duplikat lintas sumber: gabungkan anotasi, jangan tambah dua kali
      merged++
      mergedIds.set(dup.id, mergeSourceInto(dup, lesson.source))
      continue
    }
    incoming.push(lesson)
    if (k) {
      const arr = byKey.get(k) || []
      arr.push(lesson)
      byKey.set(k, arr)
    }
  }

  // rolling window: event yang tadinya di luar window lalu masuk kembali
  // menimpa lesson lama sumber ini yang dipertahankan (uid sama) — buang
  // yang lama agar tidak dobel
  const incomingUids = new Set(
    incoming.map((l) => l.uid).filter(Boolean) as string[],
  )
  const keptMerged = kept
    .filter((l) => !(l.syncId === src.id && l.uid && incomingUids.has(l.uid)))
    .map((l) => {
      const withMerged = mergedIds.get(l.id) ?? l
      // lesson rolling-window lama tidak pernah dikirim ulang feed —
      // bersihkan judul format lama (masih memuat kode) sekali di sini.
      // Judul hasil editan pengguna (override) tidak disentuh.
      if (
        src.type === 'timeedit' &&
        l.syncId === src.id &&
        !overrides[lessonKey(l)]?.title
      ) {
        const cleaned = cleanTimeEditTitle(withMerged.title, withMerged.code)
        if (cleaned !== withMerged.title) {
          return { ...withMerged, title: cleaned }
        }
      }
      return withMerged
    })
  const lessons = [...keptMerged, ...incoming]
  const sources = loadSources().map((s) =>
    s.id === src.id
      ? {
          ...s,
          lastSync: new Date().toISOString(),
          count:
            windowMs != null
              ? [...keptMerged, ...incoming].filter(
                  (l) => l.syncId === src.id && l.source !== 'manual',
                ).length
              : incoming.length,
        }
      : s,
  )
  saveSources(sources)

  return {
    lessons,
    result: {
      added,
      updated,
      removed: existing.length - kept.length,
      total: incoming.length,
      merged,
      skipped,
    },
  }
}

/**
 * Rapikan summary TimeEdit: kode kursus muncul dua kali (di depan dan
 * dengan nomor grup di tengah), lalu diikuti kode program studi.
 * "K200DJ96 Finnish 1 K200DJ96-3015 · KKIE26LABH · KKIE26LUTH"
 *   -> "Finnish 1"
 * "KE00DA03 KE00DA03-3013 English for the Hebei University of Technology,\nKKIE26LUTH, KoBScDDhebei1, ... 1304 Tunnus 586895"
 *   -> "English for the Hebei University of Technology"
 */
export function cleanTimeEditTitle(summary?: string, code?: string): string {
  if (!summary) return 'Untitled'
  let s = unescapeIcsText(summary)
  // "KODE-3015" (dengan nomor grup) dibuang utuh lebih dulu
  s = s.replace(/\b[A-Z]{1,4}\d{1,3}[A-Z]{0,3}\d{0,4}-\d{4}\b/gi, ' ')
  if (code) s = s.replace(new RegExp(`\\b${escapeRegExp(code)}\\b`, 'gi'), ' ')
  // sisa kode kursus apa pun (pembuka yang tidak diketahui kodenya)
  s = s.replace(/\b[A-Z]{1,4}\d{1,3}[A-Z]{0,3}\d{0,4}\b/g, ' ')
  const segs = s.split(/[·,]/).map((p) => p.trim())
  const meaningful: string[] = []
  for (const p of segs) {
    if (!p) continue
    if (/tunnus\s+\d+/i.test(p)) break // ID reservasi — akhir dari judul
    if (/^\d+$/.test(p)) continue // nomor ruang yang lepas dari kolom
    if (
      !/\s/.test(p) &&
      p.length >= 6 &&
      /\d/.test(p) &&
      /[A-Za-z]/.test(p)
    )
      break // kode program studi (KKIE26LABH, KoBScDDhebei1) — sisanya metadata
    meaningful.push(p)
    if (meaningful.length >= 3) break
  }
  const out = meaningful
    .join(' · ')
    .replace(/\s+-\d{1,4}\b/g, '') // sisa nomor grup terpotong dari SUMMARY
    .replace(/\s{2,}/g, ' ')
    .trim()
  return out || cleanTitle(summary, code)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Unescape \, \; \n \\ — dipakai juga di luar parser (cleanTitle TE). */
function unescapeIcsText(s: string): string {
  return s
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
}

/** Rapikan summary SISU yang panjang: ambil nama kursus yang bermakna.
 *  Bagian yang sama dengan kode kursus dibuang (tidak diulang di judul). */
function cleanTitle(summary?: string, code?: string): string {
  if (!summary) return 'Untitled'
  // SISU: "BM20A9200, Mathematics A, Contact teaching, Lahti 31.8.–11.12.2026 - ..."
  const parts = summary.split(' - ')[0].split(',')
  const meaningful = parts
    .map((p) => p.trim())
    .filter(
      (p) =>
        p &&
        !/^\d{2}\.\d{1,2}\.\d{4}/.test(p) &&
        !(code && p.toUpperCase() === code.toUpperCase()),
    )
  return meaningful.slice(0, 3).join(' · ') || summary
}
