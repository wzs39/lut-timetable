import type { Lesson } from '../types'

/**
 * Bridge to Lecture Translator: the timetable tells the translator which
 * course is currently in session, so its live captions/translation land in
 * the right course session and its AI gets the right topic context.
 *
 * The translator exposes POST /api/sessions {title, category} and POST
 * /api/sessions/{id}/activate. We cache the session id per lesson code so
 * repeat lectures reuse the same course (and its glossary/materials).
 */

const LS_TRANSLATOR_URL = 'tt_translator_url'
const LS_SESSION_MAP = 'tt_translator_sessions_v1' // lesson code -> session id

export function loadTranslatorUrl(): string {
  return localStorage.getItem(LS_TRANSLATOR_URL) ?? 'http://localhost:8000'
}

export function saveTranslatorUrl(url: string): void {
  try {
    localStorage.setItem(LS_TRANSLATOR_URL, url.replace(/\/+$/, ''))
  } catch {
    // quota/private-mode: the in-memory value still works this session
  }
}

function loadSessionMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LS_SESSION_MAP) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function saveSessionMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(LS_SESSION_MAP, JSON.stringify(map))
  } catch {
    // non-fatal: worst case we create a duplicate session next time
  }
}

async function postJson(base: string, path: string, body: unknown): Promise<any> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * Make sure the translator has an active session for this lesson. Reuses the
 * cached session per course code; falls back to creating one. Returns the
 * session id, or null when the translator is unreachable (never throws).
 */
export async function ensureTranslatorSession(
  base: string,
  lesson: Lesson,
): Promise<string | null> {
  const key = lesson.code || lesson.title
  const map = loadSessionMap()

  if (map[key]) {
    try {
      await postJson(base, `/api/sessions/${map[key]}/activate`, {})
      return map[key]
    } catch {
      // session deleted or translator reinstalled: recreate below
    }
  }
  try {
    const s = await postJson(base, '/api/sessions', {
      title: lesson.title,
      category: lesson.code || '',
    })
    map[key] = s.id
    saveSessionMap(map)
    await postJson(base, `/api/sessions/${s.id}/activate`, {})
    return s.id as string
  } catch {
    return null
  }
}
