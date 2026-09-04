import type { Lesson, LessonType } from '../types'
import { normalizeCourseCode } from './ics'

export interface CourseNote {
  note: string
  updatedAt: string
}

export type NotesMap = Record<string, CourseNote>

const LS_NOTES = 'tt_course_notes'

/** Slug dari judul untuk pelajaran tanpa kode (manual). */
function titleSlug(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 40)
  return slug || '?'
}

/**
 * Kunci catatan: kode kursus ternormalisasi (nomor grup 4 digit dibuang,
 * jadi K200DJ96-3015 dan K200DJ96-3016 berbagi kunci) + jenis sesi.
 * Pelajaran tanpa kode memakai slug judul agar tidak menimpa kursus lain.
 */
export function noteKeyOf(l: Pick<Lesson, 'code' | 'type' | 'title'>): string {
  const code = l.code ? normalizeCourseCode(l.code) : titleSlug(l.title)
  return `${code}|${l.type || 'other'}`
}

/** Baca semua catatan dari localStorage. */
export function loadNotes(): NotesMap {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_NOTES) || '{}') as unknown
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as NotesMap) : {}
  } catch {
    return {}
  }
}

/** Simpan/hapus catatan untuk kunci pelajaran; return state baru (persisted). */
export function saveNote(
  notes: NotesMap,
  lesson: Pick<Lesson, 'code' | 'type' | 'title'>,
  note: string,
): NotesMap {
  const trimmed = note.trim()
  const next = { ...notes }
  const key = noteKeyOf(lesson)
  if (!trimmed) delete next[key]
  else next[key] = { note: trimmed, updatedAt: new Date().toISOString() }
  localStorage.setItem(LS_NOTES, JSON.stringify(next))
  return next
}

/** Hapus catatan berdasarkan kunci; return state baru (persisted). */
export function removeNote(notes: NotesMap, key: string): NotesMap {
  const next = { ...notes }
  delete next[key]
  localStorage.setItem(LS_NOTES, JSON.stringify(next))
  return next
}

/** Catatan untuk pelajaran tertentu (cocok lewat kunci ternormalisasi). */
export function noteForLesson(
  notes: NotesMap,
  l: Pick<Lesson, 'code' | 'type' | 'title'>,
): string | undefined {
  return notes[noteKeyOf(l)]?.note
}

/** Label cakupan catatan: "KODE · jenis" (jenis sudah diterjemahkan pemanggil). */
export function scopeText(code: string, typeLabel: string): string {
  return `${code} · ${typeLabel}`
}

export interface NoteKeyParts {
  code: string
  type?: LessonType
}

/** Pecah kunci tersimpan "KODE|type" untuk ditampilkan di pengaturan. */
export function parseNoteKey(key: string): NoteKeyParts {
  const idx = key.lastIndexOf('|')
  if (idx === -1) return { code: key, type: undefined }
  const type = key.slice(idx + 1)
  const known: LessonType[] = [
    'lecture',
    'exercise',
    'tutorial',
    'seminar',
    'lab',
    'exam',
    'workshop',
    'other',
  ]
  return {
    code: key.slice(0, idx),
    type: (known as string[]).includes(type) ? (type as LessonType) : undefined,
  }
}