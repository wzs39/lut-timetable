import { useCallback, useContext, useMemo, useState, createContext, type ReactNode } from 'react'
import type { Lesson } from '../types'
import type { Task } from '../lib/tasks'
import {
  loadMoodleSource,
  normalizeMoodleUrl,
  saveMoodleSource,
  syncMoodle,
  type MoodleSource,
} from '../lib/moodle'
import {
  fetchGrades,
  gradesErrorKind,
  loadGradesSource,
  saveGradesSource,
  validateGradesToken,
  type CourseGrades,
  type GradesError,
} from '../lib/grades'
import {
  applySubmissionStatus,
  fetchSubmissionStatus,
  type SubmissionStatus,
} from '../lib/submissions'
import { fetchActionEvents, mergeActionEvents } from '../lib/actions'
import { useI18n } from '../i18n'

/**
 * Satu-satunya pemilik status koneksi Moodle (ICS + token webservice),
 * nilai, dan status pengumpulan. Konfigurasi ada di Settings; halaman
 * tugas hanya menampilkan informasi dari konteks ini — tidak pernah
 * memuat/menyimpan kredensial sendiri.
 */
export interface MoodleData {
  /** ICS calendar source (fallback path), or null */
  ics: MoodleSource | null
  /** webservice token source (grades + timeline + submissions), or null */
  token: { token: string; userid?: number; lastSync?: string } | null
  connected: boolean
  grades: CourseGrades[] | null
  subStatus: ReadonlyMap<string, SubmissionStatus>
  busy: 'idle' | 'sync' | 'grades' | 'subs'
  message: string | null
  setIcsUrl: (url: string) => boolean
  disconnectIcs: () => void
  connectToken: (token: string) => Promise<boolean>
  disconnectToken: () => void
  syncNow: () => Promise<void>
  refreshGrades: () => Promise<void>
  syncSubmissions: () => Promise<void>
}

const Ctx = createContext<MoodleData | null>(null)

/** Jalankan sesuatu saat pengguna menekan tombol sinkron, bukan saat memuat. */
export function useMoodleData(): MoodleData {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useMoodleData must be used inside MoodleProvider')
  return ctx
}

export function MoodleProvider({
  tasks,
  lessons,
  onTasks,
  children,
}: {
  tasks: Task[]
  lessons: Lesson[]
  onTasks: (next: Task[]) => void
  children: ReactNode
}) {
  const { t, locale } = useI18n()
  const [ics, setIcs] = useState<MoodleSource | null>(() => loadMoodleSource())
  const [token, setToken] = useState(() => loadGradesSource())
  const [grades, setGrades] = useState<CourseGrades[] | null>(null)
  const [subMap, setSubMap] = useState<Map<string, SubmissionStatus>>(new Map())
  const [busy, setBusy] = useState<MoodleData['busy']>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const gradesErrMsg = useCallback(
    (e: unknown): string => {
      const kind = gradesErrorKind(e) as GradesError | null
      if (!kind) return t('gradesFailNetwork', { d: String(e).replace('Error: ', '') })
      if (kind.kind === 'badToken') return t('gradesFailToken', { d: kind.detail ?? 'access denied' })
      if (kind.kind === 'http') return t('gradesFailHttp', { s: kind.status })
      if (kind.kind === 'empty') return t('gradesFailEmpty')
      return t('gradesFailNetwork', { d: kind.detail })
    },
    [t],
  )

  const timeStr = useCallback(
    () => new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
    [locale],
  )

  const setIcsUrl = useCallback(
    (url: string): boolean => {
      const icsUrl = normalizeMoodleUrl(url)
      if (!icsUrl) {
        setMessage(t('moodleBadUrl'))
        return false
      }
      const next: MoodleSource = { url: icsUrl, count: 0 }
      setIcs(next)
      saveMoodleSource(next)
      setMessage(null)
      return true
    },
    [t],
  )

  const disconnectIcs = useCallback(() => {
    onTasks(tasks.filter((task) => !task.id.startsWith('moodle:') && !task.id.startsWith('moodle-act:')))
    setIcs(null)
    saveMoodleSource(null)
    setMessage(null)
  }, [tasks, onTasks])

  const connectToken = useCallback(
    async (raw: string): Promise<boolean> => {
      const tokenStr = raw.trim()
      if (!tokenStr) return false
      setBusy('grades')
      setMessage(t('gradesFetching'))
      try {
        const userid = await validateGradesToken(tokenStr)
        const src = { token: tokenStr, userid, lastSync: new Date().toISOString() }
        saveGradesSource(src)
        setToken(src)
        setMessage(t('gradesConnected', { time: timeStr() }))
        return true
      } catch (e) {
        setMessage(gradesErrMsg(e))
        return false
      } finally {
        setBusy('idle')
      }
    },
    [gradesErrMsg, t, timeStr],
  )

  const disconnectToken = useCallback(() => {
    saveGradesSource(null)
    setToken(null)
    setGrades(null)
    setSubMap(new Map())
    setMessage(null)
  }, [])

  const syncNow = useCallback(async () => {
    if (busy !== 'idle') return
    setBusy('sync')
    setMessage(t('moodleSyncing'))
    try {
      if (token?.token) {
        const events = await fetchActionEvents(token)
        const r = mergeActionEvents(tasks, events, lessons)
        onTasks(r.tasks)
        setMessage(t('actionSyncOk', { a: r.added, u: r.updated, n: events.length }))
        return
      }
      if (!ics) {
        setMessage(t('moodleCta'))
        return
      }
      const r = await syncMoodle(ics, tasks, lessons)
      onTasks(r.tasks)
      setIcs(loadMoodleSource())
      setMessage(t('moodleSyncOk', { a: r.added, u: r.updated }))
    } catch (e) {
      // token path failed (revoked/expired) -> fall back to ICS so sync never blocks
      if (ics) {
        try {
          const r = await syncMoodle(ics, tasks, lessons)
          onTasks(r.tasks)
          setIcs(loadMoodleSource())
          setMessage(t('moodleSyncOk', { a: r.added, u: r.updated }))
          return
        } catch { /* fall through to error message */ }
      }
      setMessage(t('moodleSyncFail', { e: String(e).replace('Error: ', '') }))
    } finally {
      setBusy('idle')
    }
  }, [busy, token, ics, tasks, lessons, onTasks, t])

  const refreshGrades = useCallback(async () => {
    if (busy !== 'idle' || !token) return
    setBusy('grades')
    setMessage(t('gradesFetching'))
    try {
      const list = await fetchGrades(token, lessons)
      setGrades(list)
      const withTime = { ...token, lastSync: new Date().toISOString() }
      saveGradesSource(withTime)
      setToken(withTime)
      setMessage(t('gradesLastSync', { n: list.length, time: timeStr() }))
    } catch (e) {
      setMessage(gradesErrMsg(e))
    } finally {
      setBusy('idle')
    }
  }, [busy, token, lessons, gradesErrMsg, t, timeStr])

  const syncSubmissions = useCallback(async () => {
    if (busy !== 'idle' || !token) return
    setBusy('subs')
    setMessage(t('subSyncing'))
    try {
      const map = await fetchSubmissionStatus(token)
      setSubMap(map)
      const r = applySubmissionStatus(tasks, map)
      if (r.archived > 0) onTasks(r.tasks)
      setMessage(t(r.archived > 0 ? 'subSyncOk' : 'subSyncNone', { n: r.archived }))
    } catch (e) {
      setMessage(gradesErrMsg(e))
    } finally {
      setBusy('idle')
    }
  }, [busy, token, tasks, onTasks, gradesErrMsg, t])

  const value = useMemo<MoodleData>(
    () => ({
      ics,
      token,
      connected: !!(ics || token),
      grades,
      subStatus: subMap,
      busy,
      message,
      setIcsUrl,
      disconnectIcs,
      connectToken,
      disconnectToken,
      syncNow,
      refreshGrades,
      syncSubmissions,
    }),
    [ics, token, grades, subMap, busy, message, setIcsUrl, disconnectIcs, connectToken, disconnectToken, syncNow, refreshGrades, syncSubmissions],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
