import { useEffect, useRef } from 'react'
import type { Lesson } from '../types'
import { currentLesson, ensureTranslatorSession } from '../lib/translator'

interface Props {
  enabled: boolean
  lessons: Lesson[] // visible lessons only
  translatorUrl: string
}

/**
 * Invisible component: while a lesson is in session, keeps Lecture
 * Translator's active course session in sync (activate on start; re-assert
 * every 5 minutes in case the translator restarted). No-op otherwise.
 */
export default function TranslationLinker({ enabled, lessons, translatorUrl }: Props) {
  // A lesson-id ref so the effect below can re-run without stale closures
  const linkedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled) return

    const link = () => {
      const lesson = currentLesson(lessons)
      const key = lesson?.id ?? null
      if (key === linkedRef.current) return // no change since last tick
      linkedRef.current = key
      if (lesson) {
        ensureTranslatorSession(translatorUrl, lesson).then((id) => {
          if (id) console.info(`[translator] linked to session ${id} (${lesson.title})`)
          else console.warn('[translator] unreachable, will retry next tick')
        })
      }
    }

    link()
    const iv = setInterval(link, 5 * 60 * 1000)
    return () => clearInterval(iv)
  }, [enabled, lessons, translatorUrl])

  return null
}
