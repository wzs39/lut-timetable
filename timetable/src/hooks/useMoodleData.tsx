import { useCallback, useContext, useEffect, useMemo, useRef, useState, createContext, type ReactNode } from 'react'
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
  clearGradesSnapshot,
  fetchGrades,
  gradesErrorKind,
  loadGradesSnapshot,
  loadGradesSource,
  saveGradesSnapshot,
  saveGradesSource,
  validateGradesToken,
  type CourseGrades,
  type GradesError,
} from '../lib/grades'
import {
  applyCompletionToTasks,
  applySubmissionStatus,
  fetchSubmissionStatus,
  type SubmissionStatus,
} from '../lib/submissions'
import { markActivityCompletion, updateCachedCompletion } from '../lib/contents'
import { primeEnrolAnchor } from '../lib/moodleSync'
import { fetchActionEvents, fetchActivityUrls, mergeActionEvents, upgradeIcsTaskUrls } from '../lib/actions'
import {
  countUnread,
  fetchNotifications,
  loadCachedNotifications,
  markRead,
  type MoodleNotification,
} from '../lib/notificationsFeed'
import {
  runSsoFlow,
  androidSsoHooks,
  coldStartLaunchUrl,
  type SsoOutcome,
} from '../lib/ssoLogin'
import {
  buildLaunchUrl,
  decodeLaunchUrl,
  md5,
  newPassport,
  URL_SCHEME,
  WWWROOT,
} from '../lib/ssoLaunch'
import { readString } from '../lib/storage'
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
  /** cmid 键控的提交状态（内容树按模块 cmid 精确联接 assign 提交态） */
  subByCmid: ReadonlyMap<number, SubmissionStatus>
  busy: 'idle' | 'sync' | 'grades' | 'subs'
  message: string | null
  /** Aliran notifikasi Moodle (satu pemilik: provider ini) */
  notifications: MoodleNotification[] | null
  /** Belum dibaca — badge navigasi */
  unread: number
  /** Tandai satu notifikasi dibaca (lokal persist, offline-safe) */
  markNotificationRead: (id: string) => void
  /** Ambil ulang aliran notifikasi (force melewati cache 30 menit) */
  refreshNotifications: (force?: boolean) => Promise<void>
  setIcsUrl: (url: string) => boolean
  disconnectIcs: () => void
  connectToken: (token: string) => Promise<boolean>
  disconnectToken: () => void
  /** SSO 浏览器登录（LUT SSO + Duo）：返回登录 URL，令牌经 deep link 异步送达 */
  loginWithSso: (openUrl: (url: string) => void) => void
  ssoState: 'idle' | 'pending' | 'connecting' | 'error'
  ssoMessage: string | null
  syncNow: () => Promise<void>
  refreshGrades: () => Promise<void>
  syncSubmissions: () => Promise<void>
  /** 内容树勾选 → 同步归档/恢复对应任务（cmid 联接，只动 moodle: 任务） */
  applyCompletion: (cmid: number, completed: boolean) => void
  /** 任务卡勾选 → 推 Moodle 服务器完成状态并刷 contents 缓存（树↔任务不漂移） */
  pushTaskCompletion: (cmid: number, completed: boolean) => void
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
  // 冷启动快照：重启/断网时先展示上次成绩（首屏即有内容），网络刷新成功后覆盖。
  const [grades, setGrades] = useState<CourseGrades[] | null>(() => loadGradesSnapshot()?.courses ?? null)
  const [subMap, setSubMap] = useState<Map<string, SubmissionStatus>>(new Map())
  const [subByCmid, setSubByCmid] = useState<Map<number, SubmissionStatus>>(new Map())
  /**
   * 树徽标的合并视图：submissions 域（教师视角 API，部分站点可用）优先，
   * grades 域（学生可读的 gradeitems）填补 LUT 等拒绝学生调 mod_assign 的站点。
   * 同 cmid 两域都有数据时以 submissions 为准（带 feedback，信息更全）。
   */
  const mergeGradeStatus = useCallback((fromGrades: Map<number, import('../lib/grades').GradeCmidStatus>) => {
    setSubByCmid((prev) => {
      const next = new Map(prev)
      for (const [cmid, gs] of fromGrades) {
        if (!next.has(cmid)) {
          // grades 域没有 dueAt（gradeitems 不含 duedate）——留空，树里该行
          // 自然不显示截止；submissions 域的行才带。
          next.set(cmid, { state: gs.state, grade: gs.grade, submittedAt: gs.submittedAt })
        }
      }
      return next.size === prev.size ? prev : next
    })
  }, [])
  const [busy, setBusy] = useState<MoodleData['busy']>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [notifications, setNotifications] = useState<MoodleNotification[] | null>(() => loadCachedNotifications())

  /* ---------------- Background auto-refresh (30 min tick) ----------------
   * Satu owner: interval tunggal di provider. Setiap tick menyegarkan nilai,
   * status pengumpulan, dan pengumuman secara berurutan. GAGAL = SENYAP
   * (tidak ada banner) — latar belakang tidak boleh lebih berisik dari
   * data yang ditampilkan. Dijalankan sekali segera setelah login sukses,
   * lalu setiap REFRESH_INTERVAL_MS selama token ada. */
  const REFRESH_INTERVAL_MS = 30 * 60 * 1000
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const lessonsRef = useRef(lessons)
  lessonsRef.current = lessons
  const inFlightRef = useRef(false)

  const backgroundRefresh = useCallback(async () => {
    if (inFlightRef.current) return
    const tk = loadGradesSource()
    if (!tk?.token) return
    inFlightRef.current = true
    try {
      // Satu titik enrol-anchor: cache 24 jam, menulis tabel identitas
      // (courseid ↔ kode jadwal) yang dipakai grades/tasks — KETERGANTUNGAN
      // nyata, harus selesai sebelum domain lain mulai mencocokkan kursus.
      try {
        await primeEnrolAnchor(tk, lessonsRef.current)
      } catch { /* silent */ }
      // Empat domain di-paralelkan (dulu serial await): total waktu = max,
      // bukan jumlah. Semua gagal independen (allSettled = semantik try/catch
      // per domain yang lama).
      const [gradesR, subsR, eventsR, notifR] = await Promise.allSettled([
        fetchGrades(tk, lessonsRef.current),
        fetchSubmissionStatus(tk),
        fetchActionEvents(tk, lessonsRef.current),
        fetchNotifications(tk),
      ])
      // Penerapan berurutan di utas utama: dua domain yang mengubah task
      // (submissions arsip + timeline merge) re-read tasksRef.current saat
      // diterapkan — paralel di sini akan saling menimpa (stale write).
      try {
        if (gradesR.status === 'fulfilled') {
          setGrades(gradesR.value.courses)
          mergeGradeStatus(gradesR.value.statusByCmid)
          saveGradesSnapshot(gradesR.value.courses)
          saveGradesSource({ ...tk, lastSync: new Date().toISOString() })
          setToken((prev) => (prev ? { ...prev, lastSync: new Date().toISOString() } : prev))
        }
      } catch { /* silent */ }
      try {
        if (subsR.status === 'fulfilled') {
          const { status, urlByKey, statusByCmid } = subsR.value
          setSubMap(status)
          setSubByCmid(statusByCmid)
          const r = applySubmissionStatus(tasksRef.current, status, urlByKey)
          if (r.archived > 0) onTasks(r.tasks)
        }
      } catch { /* silent */ }
      try {
        // Timeline → tasks: tugas baru muncul TANPA tekan sinkron manual.
        if (eventsR.status === 'fulfilled') {
          const events = eventsR.value
          const r = mergeActionEvents(tasksRef.current, events, lessonsRef.current)
          let next = r.tasks
          try {
            // Tugas ICS lama: URL halaman event → halaman aktivitas. Network
            // hanya untuk event belum tercache (cache permanen) — biaya
            // seri di fase apply ini sekali seumur event.
            const staleIds = r.tasks
              .map((task) => Number(task.id.match(/^moodle:(\d+)@moodle\.lut\.fi$/i)?.[1]))
              .filter((n): n is number => Number.isFinite(n))
            const urls = await fetchActivityUrls(tk.token, staleIds)
            next = upgradeIcsTaskUrls(r.tasks, urls).tasks
          } catch { /* silent */ }
          if (r.added > 0 || r.updated > 0 || next !== r.tasks) onTasks(next)
        }
      } catch { /* silent */ }
      try {
        if (notifR.status === 'fulfilled') setNotifications(notifR.value)
      } catch { /* silent */ }
    } finally {
      inFlightRef.current = false
    }
  }, [onTasks])

  // Interval tunggal: hanya berjalan saat token ada. Tick di-skip bila tab
  // tersembunyi (hemat baterai), sedang ada operasi manual, atau refresh
  // sebelumnya masih berjalan.
  useEffect(() => {
    if (!token?.token) return
    const id = window.setInterval(() => {
      if (document.hidden || busy !== 'idle') return
      void backgroundRefresh()
    }, REFRESH_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [token?.token, busy, backgroundRefresh])

  // Saat token BARU saja terhubung (login/connect) ATAU saat aplikasi start
  // dengan token tersimpan — jalankan satu putaran langsung sehingga
  // pengguna tidak menunggu 30 menit untuk data pertama. Guard dicek SAAT
  // timeout terpicu (bukan saat dijadwalkan) agar StrictMode double-mount
  // tidak membatalkan run pertama lalu memblokir run kedua.
  const initialRunRef = useRef<string | null>(null)
  useEffect(() => {
    const tk = token?.token
    if (!tk || busy !== 'idle') return
    const id = window.setTimeout(() => {
      if (initialRunRef.current === tk) return
      initialRunRef.current = tk
      void backgroundRefresh()
    }, 1500)
    return () => window.clearTimeout(id)
  }, [token?.token, busy, backgroundRefresh])

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
    clearGradesSnapshot()
    setSubMap(new Map())
    setSubByCmid(new Map())
    setMessage(null)
  }, [])

  const loginErrMsg = useCallback(
    (e: unknown): string => {
      const err = e as { kind?: string; detail?: string; status?: number } | undefined
      if (err && typeof err === 'object' && 'kind' in err) {
        if (err.kind === 'invalid-credentials') return t('loginFailCreds')
        if (err.kind === 'rate-limit') return t('loginFailRate')
        if (err.kind === 'service-unavailable') return t('loginFailService', { d: err.detail ?? '' })
        if (err.kind === 'http') return t('gradesFailHttp', { s: err.status ?? 0 })
        return t('loginFailNetwork', { d: err.detail ?? '' })
      }
      return t('loginFailNetwork', { d: String(e).replace('Error: ', '') })
    },
    [t],
  )

  /* --------------- SSO browser login (LUT SSO + Duo) ---------------
   * Alur: buka launch.php di browser (SSO+Duo di sana) → Moodle mengarahkan
   * ke lut-timetable://token=... → token diverifikasi passport → disimpan.
   * Kegagalan timeout/invalid ditampilkan; sukses langsung terhubung. */
  const [ssoState, setSsoState] = useState<MoodleData['ssoState']>('idle')
  const [ssoMessage, setSsoMessage] = useState<string | null>(null)

  const loginWithSso = useCallback(
    (openUrl: (url: string) => void) => {
      if (ssoState === 'pending') return

      /** Passport tersimpan saat ini (satu kali pakai, dibaca decoder). */
      const passportNow = (): string => readString('tt_moodle_sso_passport') ?? ''

      /** Token mentah → verifikasi passport (renderer memiliki passport)
       *  → site-info → simpan. Dipakai kedua jalur di bawah. */
      const acceptToken = async (raw: string): Promise<boolean> => {
        const decoded = decodeLaunchUrl(`${URL_SCHEME}://token=${btoa(`${md5(WWWROOT + passportNow())}:::${raw}`)}`)
        if (!decoded) return false
        setSsoState('connecting')
        setSsoMessage(t('ssoConnecting'))
        const userid = await validateGradesToken(decoded.token)
        const src = { token: decoded.token, userid, lastSync: new Date().toISOString() }
        saveGradesSource(src)
        setToken(src)
        setSsoState('idle')
        setSsoMessage(null)
        setMessage(t('gradesConnected', { time: timeStr() }))
        return true
      }

      const hooks = androidSsoHooks()
      // Android: async hooks; Electron: window.lutSso bridge; web: tidak didukung.
      void Promise.resolve(hooks).then((h) => {
        if (h) {
          const flow = runSsoFlow(h)
          setSsoState('pending')
          setSsoMessage(t('ssoBrowserHint'))
          flow.promise
            .then(async (outcome: SsoOutcome) => {
              if (outcome.ok && (await acceptToken(outcome.token))) return
              setSsoState(outcome.ok ? 'error' : outcome.reason === 'timeout' ? 'error' : 'idle')
              setSsoMessage(t(outcome.ok ? 'ssoFail' : outcome.reason === 'timeout' ? 'ssoTimeout' : 'ssoCancelled', { d: 'checksum' }))
            })
            .catch((e) => {
              setSsoState('error')
              setSsoMessage(loginErrMsg(e))
            })
          openUrl(flow.loginUrl)
          return
        }
        const bridge = (window as unknown as { lutSso?: { start: (u: string) => Promise<unknown>; onResult: (cb: (r: { ok: boolean; token?: string; error?: string }) => void) => () => void } }).lutSso
        if (!bridge) {
          setSsoMessage(t('ssoUnsupported'))
          setSsoState('error')
          return
        }
        setSsoState('pending')
        // 登录发生在系统默认浏览器（Electron main 用 shell.openExternal 打开），
        // token 经 OS 协议回调（second-instance/open-url）→ lut-sso-result。
        setSsoMessage(t('ssoBrowserHint'))
        const off = bridge.onResult((r) => {
          off()
          if (r?.ok && r.token) {
            acceptToken(r.token).then((ok) => {
              if (!ok) {
                setSsoState('error')
                setSsoMessage(t('ssoFail', { d: 'checksum' }))
              }
            }).catch((e) => {
              setSsoState('error')
              setSsoMessage(loginErrMsg(e))
            })
          } else {
            setSsoState('error')
            setSsoMessage(t('ssoFail', { d: r?.error ?? 'cancelled' }))
          }
        })
        const passport = newPassport()
        void bridge.start(buildLaunchUrl(passport))
      })
    },
    [ssoState, loginErrMsg, t, timeStr],
  )

  const syncNow = useCallback(async () => {
    if (busy !== 'idle') return
    setBusy('sync')
    setMessage(t('moodleSyncing'))
    try {
      if (token?.token) {
        const events = await fetchActionEvents(token, lessons)
        const r = mergeActionEvents(tasks, events, lessons)
        // Tugas ICS lama masih menempel halaman event kalender → naikkan ke
        // URL aktivitas (eventid di ID task dipakai langsung, tanpa ICS feed).
        const staleIds = r.tasks
          .map((task) => Number(task.id.match(/^moodle:(\d+)@moodle\.lut\.fi$/i)?.[1]))
          .filter((n): n is number => Number.isFinite(n))
        let finalTasks = r.tasks
        try {
          const urls = await fetchActivityUrls(token.token, staleIds)
          const up = upgradeIcsTaskUrls(r.tasks, urls)
          finalTasks = up.tasks
          if (up.upgraded > 0) setMessage(t('actionSyncOk', { a: r.added, u: r.updated + up.upgraded, n: events.length }))
        } catch { /* URL kalender tetap */ }
        onTasks(finalTasks)
        if (finalTasks === r.tasks) setMessage(t('actionSyncOk', { a: r.added, u: r.updated, n: events.length }))
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
      const res = await fetchGrades(token, lessons)
      setGrades(res.courses)
      mergeGradeStatus(res.statusByCmid)
      saveGradesSnapshot(res.courses)
      const withTime = { ...token, lastSync: new Date().toISOString() }
      saveGradesSource(withTime)
      setToken(withTime)
      setMessage(t('gradesLastSync', { n: res.courses.length, time: timeStr() }))
    } catch (e) {
      setMessage(gradesErrMsg(e))
    } finally {
      setBusy('idle')
    }
  }, [busy, token, lessons, gradesErrMsg, t, timeStr])

  const markNotificationRead = useCallback((id: string) => {
    markRead(id)
    setNotifications((prev) =>
      prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? prev,
    )
  }, [])

  const refreshNotifications = useCallback(
    async (force = false) => {
      const tk = loadGradesSource()
      setNotifications(await fetchNotifications(tk, { force }))
    },
    [],
  )

  const applyCompletion = useCallback(
    (cmid: number, completed: boolean) => {
      const r = applyCompletionToTasks(tasksRef.current, cmid, completed)
      if (r.changed > 0) onTasks(r.tasks)
    },
    [onTasks],
  )

  /**
   * 反向同步：任务卡勾选 → Moodle 服务器完成状态 + contents 缓存。
   * 任务列表的更新由调用方（AssignmentsView 的 onChange）负责——本函数只
   * 推服务器和刷缓存，失败静默（树下次同步会自然对齐，不阻塞 UI）。
   */
  const pushTaskCompletion = useCallback(
    (cmid: number, completed: boolean) => {
      void markActivityCompletion(token, cmid, completed).then((ok) => {
        if (ok) updateCachedCompletion(cmid, completed)
      })
    },
    [token],
  )

  const syncSubmissions = useCallback(async () => {
    if (busy !== 'idle' || !token) return
    setBusy('subs')
    setMessage(t('subSyncing'))
    try {
      const { status, urlByKey, statusByCmid } = await fetchSubmissionStatus(token)
      setSubMap(status)
      setSubByCmid(statusByCmid)
      const r = applySubmissionStatus(tasks, status, urlByKey)
      if (r.archived > 0) onTasks(r.tasks)
      setMessage(t(r.archived > 0 ? 'subSyncOk' : 'subSyncNone', { n: r.archived }))
    } catch (e) {
      setMessage(gradesErrMsg(e))
    } finally {
      setBusy('idle')
    }
  }, [busy, token, tasks, onTasks, gradesErrMsg, t])

  /* --------- Cold-start deep link (app dibunuh saat di browser) ---------
   * Official app menangani ini lewat checkIntent pada deviceready: Android
   * boleh membunuh app ketika pengguna masih mengerjakan SSO di browser;
   * redirect lut-timetable:// kemudian MELUNCURKAN app baru sehingga
   * listener appUrlOpen tidak pernah terpasang. Passport masih di storage
   * → verifikasi tetap berhasil. */
  const coldStartDoneRef = useRef(false)
  useEffect(() => {
    if (coldStartDoneRef.current) return
    coldStartDoneRef.current = true
    void (async () => {
      const url = await coldStartLaunchUrl()
      if (!url) return
      const passport = readString('tt_moodle_sso_passport')
      if (!passport) return
      const decoded = decodeLaunchUrl(url, { passport })
      if (!decoded) return
      setSsoState('connecting')
      setSsoMessage(t('ssoConnecting'))
      try {
        const userid = await validateGradesToken(decoded.token)
        const src = { token: decoded.token, userid, lastSync: new Date().toISOString() }
        saveGradesSource(src)
        setToken(src)
        setSsoState('idle')
        setSsoMessage(null)
        setMessage(t('gradesConnected', { time: timeStr() }))
      } catch (e) {
        setSsoState('error')
        setSsoMessage(loginErrMsg(e))
      }
    })()
  }, [])

  const value = useMemo<MoodleData>(
    () => ({
      ics,
      token,
      connected: !!(ics || token),
      grades,
      subStatus: subMap,
    subByCmid,
      busy,
      message,
      notifications,
      unread: countUnread(notifications),
      markNotificationRead,
      refreshNotifications,
      setIcsUrl,
      disconnectIcs,
      connectToken,
      disconnectToken,
      loginWithSso,
      ssoState,
      ssoMessage,
      syncNow,
      refreshGrades,
      syncSubmissions,
      applyCompletion,
      pushTaskCompletion,
    }),
    [ics, token, grades, subMap, subByCmid, busy, message, notifications, markNotificationRead, refreshNotifications, ssoState, ssoMessage, setIcsUrl, disconnectIcs, connectToken, disconnectToken, loginWithSso, syncNow, refreshGrades, syncSubmissions, applyCompletion, pushTaskCompletion],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
