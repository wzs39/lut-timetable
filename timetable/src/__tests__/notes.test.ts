import { beforeEach, describe, expect, it } from 'vitest'
import type { Lesson } from '../types'
import {
  loadNotes,
  noteForLesson,
  noteKeyOf,
  parseNoteKey,
  removeNote,
  saveNote,
} from '../lib/notes'

const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
} as Storage

beforeEach(() => store.clear())

const lesson = (p: Partial<Lesson>): Pick<Lesson, 'code' | 'type' | 'title'> => ({
  code: 'HDD4010',
  type: 'exercise',
  title: 'HDD4010 · Engineering Mathematics I',
  ...p,
})

describe('noteKeyOf', () => {
  it('normalizes group numbers so parallel groups share one key', () => {
    expect(noteKeyOf(lesson({ code: 'K200DJ96-3015' }))).toBe(
      noteKeyOf(lesson({ code: 'K200DJ96-3016' })),
    )
  })

  it('is case-insensitive on codes', () => {
    expect(noteKeyOf(lesson({ code: 'bm20a9200' }))).toBe(noteKeyOf(lesson({ code: 'BM20A9200' })))
  })

  it('separates session types (lecture vs exercise)', () => {
    expect(noteKeyOf(lesson({ type: 'lecture' }))).not.toBe(noteKeyOf(lesson({ type: 'exercise' })))
  })

  it('falls back to a title slug for lessons without a code', () => {
    const a = lesson({ code: undefined, title: 'Finnish 1 · KKIE26LABH' })
    const b = lesson({ code: undefined, title: 'Finnish 1 · KKIE26LUTH' })
    // dua grup manual beda lokasi di judul -> beda kunci (aman, tidak menimpa)
    expect(noteKeyOf(a)).not.toBe(noteKeyOf(b))
    expect(noteKeyOf(a)).toBe(
      noteKeyOf(lesson({ code: undefined, title: 'finnish 1 · kkie26labh' })),
    )
  })
})

describe('saveNote / removeNote / noteForLesson', () => {
  it('saves and reads back a note, trimming whitespace', () => {
    let notes = saveNote({}, lesson({}), '  bring a calculator  ')
    expect(notes[noteKeyOf(lesson({}))].note).toBe('bring a calculator')
    expect(noteForLesson(notes, lesson({}))).toBe('bring a calculator')
    expect(loadNotes()).toEqual(notes)
  })

  it('matches a lesson whose stored code has a group suffix against a base-code note', () => {
    const notes = saveNote({}, lesson({ code: 'K200DJ96', type: 'exercise' }), 'demo')
    expect(noteForLesson(notes, lesson({ code: 'K200DJ96-3015', type: 'exercise' }))).toBe('demo')
  })

  it('does not leak a note to a different course or session type', () => {
    const notes = saveNote({}, lesson({}), 'math')
    expect(noteForLesson(notes, lesson({ code: 'CT60A0250' }))).toBeUndefined()
    expect(noteForLesson(notes, lesson({ type: 'lecture' }))).toBeUndefined()
  })

  it('empty note text deletes the note', () => {
    const withNote = saveNote({}, lesson({}), 'x')
    const after = saveNote(withNote, lesson({}), '   ')
    expect(after[noteKeyOf(lesson({}))]).toBeUndefined()
    expect(loadNotes()).toEqual({})
  })

  it('removeNote drops exactly the requested key and persists', () => {
    const notes = saveNote({}, lesson({}), 'x')
    const kept = saveNote(notes, lesson({ code: 'CT60A0250', type: 'lab' }), 'y')
    const after = removeNote(kept, noteKeyOf(lesson({})))
    expect(after[noteKeyOf(lesson({}))]).toBeUndefined()
    expect(after[noteKeyOf(lesson({ code: 'CT60A0250', type: 'lab' }))]).toBeDefined()
    expect(loadNotes()).toEqual(after)
  })
})

describe('parseNoteKey', () => {
  it('round-trips code and type', () => {
    expect(parseNoteKey('HDD4010|exercise')).toEqual({ code: 'HDD4010', type: 'exercise' })
    expect(parseNoteKey('CT60A0250|other')).toEqual({ code: 'CT60A0250', type: 'other' })
  })

  it('treats unknown type tokens as code-only keys', () => {
    expect(parseNoteKey('finnish 1 · kkie26labh|other')).toEqual({
      code: 'finnish 1 · kkie26labh',
      type: 'other',
    })
    expect(parseNoteKey('HDD4010|2026')).toEqual({ code: 'HDD4010', type: undefined })
  })
})