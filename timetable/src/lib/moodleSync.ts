import { readJson, writeJson, TRANSIENT_KEYS } from './storage'
import { fetchEnrolledCourses, type EnrolledCourse } from './courses'

/**
 * Registri sinkron Moodle deklaratif: satu pemilik pola
 * "cache baca → network → cache tulis → fallback cache" yang sebelumnya
 * disalin di lima domain (announcements, notifications, submissions, grades,
 * contents) — masing-masing dengan TTL, bentuk cache, dan penelanan error
 * versinya sendiri. Tambah domain baru = satu entri, bukan satu salinan.
 *
 * Yang TIDAK diubah: fungsi fetch per domain tetap diekspor dari modulnya
 * (panggilan lama tetap bekerja); di dalamnya sekarang memakai helper di
 * sini. Tingkah laku persis seperti sebelumnya (urutan cache/jaringan sama,
 * penelanan error sama) — ini konsolidasi, bukan perubahan perilaku.
 */

/** Enam panggilan enrol-anchor yang tadinya disalin per domain kini satu. */
export async function primeEnrolAnchor(
  src: { token: string; userid?: number },
  lessons?: import('../types').Lesson[],
): Promise<EnrolledCourse[]> {
  return (await fetchEnrolledCourses(src, lessons).catch(() => null)) ?? []
}

/* ------------------------------ cache helpers ----------------------------- */

export interface CacheEnvelope<T> {
  fetchedAt: number
  items: T[]
}

export function readCache<T>(key: string, ttlMs: number, pick: (raw: CacheEnvelope<T>) => T[] | null): T[] | null {
  try {
    const raw = readJson<CacheEnvelope<T> | null>(key, null)
    if (raw && Array.isArray(raw.items) && Date.now() - raw.fetchedAt <= ttlMs) {
      return pick(raw)
    }
  } catch {
    /* non-fatal */
  }
  return null
}

export function writeCache<T>(key: string, items: T[]): void {
  try {
    writeJson(key, { fetchedAt: Date.now(), items } satisfies CacheEnvelope<T>)
  } catch {
    /* kuota penuh: cache memori cukup */
  }
}

/** Kunci cache domain (TRANSIENT — tidak ikut backup). */
export function domainCacheKey(name: string, scope?: string | number): string {
  return TRANSIENT_KEYS.icsCachePrefix + (scope == null ? name : `${name}_${scope}`)
}

/* ------------------------------- run pattern ------------------------------ */

/**
 * Pola bawaan lima domain:
 *   cached → (no token: cached) → network → simpan bila ada isi →
 *   network-atau-cache. Network gagal → cache (tidak pernah error keras untuk
 *   domain opsional). `keepWhenEmpty` mengatur simpan- hasil kosong.
 */
export async function syncDomain<T>(opts: {
  cacheKey: string
  ttlMs: number
  /** Baca cache; parameternya envelope mentah (untuk migrasi kolom). */
  load: (raw: CacheEnvelope<T>) => T[] | null
  save: (items: T[]) => void
  /** null = tanpa token → cache saja. */
  src: { token: string; userid?: number } | null
  force?: boolean
  /** Network call inti (src sudah pasti bertoken di sini). Melempar = gagal → cache. */
  network: (src: { token: string; userid?: number }) => Promise<T[]>
  /** Simpan hasil kosong? (default: hanya bila cache belum ada). */
  keepWhenEmpty?: boolean
}): Promise<T[]> {
  const cached = readCache(opts.cacheKey, opts.ttlMs, opts.load)
  if (!opts.force && cached) return cached
  if (!opts.src?.token) return cached ?? []
  try {
    const list = await opts.network(opts.src)
    if (list.length > 0 || opts.keepWhenEmpty || cached === null) opts.save(list)
    return list.length > 0 ? list : cached ?? []
  } catch {
    return cached ?? []
  }
}
