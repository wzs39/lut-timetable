import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Lesson, SyncSource } from '../types'
import {
  loadLessons,
  saveLessons,
  loadSources,
  saveSources,
  syncSource,
  uid,
  dedupeLessons,
  addTombstones,
  saveOverride,
  deleteOverride,
  lessonKey,
  backfillLessonTypes,
  loadHiddenKeys,
  addHiddenKeys,
  clearHiddenKeys,
} from '../lib/store'
import { useI18n } from '../i18n'
import { ensurePermission } from '../lib/notifications'

const AUTO_SYNC_INTERVAL = 15 * 60 * 1000 // 15 menit
const MIN_SYNC_GAP = 5 * 60 * 1000 // lewati sumber yang baru saja disinkron
const LS_AUTOSYNC = 'tt_autosync'
const LS_NOTIF = 'tt_notif'

function loadAutoSync(): boolean {
  return localStorage.getItem(LS_AUTOSYNC) !== 'false'
}

function loadNotif(): boolean {
  return localStorage.getItem(LS_NOTIF) === 'true'
}

export function useTimetable() {
  const { t } = useI18n()
  const [lessons, setLessons] = useState<Lesson[]>(() =>
    dedupeLessons(backfillLessonTypes(loadLessons())),
  )
  const [sources, setSources] = useState<SyncSource[]>(() => loadSources())
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [autoSync, setAutoSync] = useState<boolean>(() => loadAutoSync())
  const [notifEnabled, setNotifEnabledState] = useState<boolean>(() => loadNotif())
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => loadHiddenKeys())

  const lessonsRef = useRef(lessons)
  useEffect(() => {
    lessonsRef.current = lessons
  }, [lessons])

  useEffect(() => saveLessons(lessons), [lessons])
  useEffect(() => saveSources(sources), [sources])
  useEffect(() => localStorage.setItem(LS_AUTOSYNC, String(autoSync)), [autoSync])
  useEffect(() => localStorage.setItem(LS_NOTIF, String(notifEnabled)), [notifEnabled])

  /** Aktifkan notifikasi: minta izin dulu; gagal -> tetap off */
  const setNotifEnabled = useCallback(async (v: boolean) => {
    if (!v) {
      setNotifEnabledState(false)
      return
    }
    const ok = await ensurePermission()
    if (ok) setNotifEnabledState(true)
  }, [])

  const addManualLesson = useCallback(
    (l: Omit<Lesson, 'id' | 'source'>) => {
      setLessons((prev) => [...prev, { ...l, id: uid(), source: 'manual' }])
    },
    [],
  )

  const removeLesson = useCallback((id: string) => {
    const victim = lessonsRef.current.find((l) => l.id === id)
    if (victim?.syncId) {
      // sync protection: pelajaran sync yang dihapus tidak diimpor ulang
      addTombstones([victim])
      deleteOverride(lessonKey(victim))
    }
    setLessons((prev) => prev.filter((l) => l.id !== id))
  }, [])

  /** Sembunyikan lesson dari kalender tanpa menghapus (bisa dibuka lagi) */
  const hideLessons = useCallback((ids: string[]) => {
    const s = new Set(ids)
    const victims = lessonsRef.current.filter((l) => s.has(l.id))
    addHiddenKeys(victims)
    setHiddenKeys(loadHiddenKeys())
  }, [])

  /** Tampilkan kembali semua lesson yang disembunyikan */
  const unhideAll = useCallback(() => {
    clearHiddenKeys()
    setHiddenKeys(new Set())
  }, [])

  /** Lesson yang tampil di kalender (yang disembunyikan disaring) */
  const visibleLessons = useMemo(
    () => lessons.filter((l) => !hiddenKeys.has(lessonKey(l))),
    [lessons, hiddenKeys],
  )

  const removeMany = useCallback((ids: string[]) => {
    const s = new Set(ids)
    const victims = lessonsRef.current.filter((l) => s.has(l.id))
    const synced = victims.filter((l) => l.syncId)
    if (synced.length > 0) {
      addTombstones(synced)
      synced.forEach((l) => deleteOverride(lessonKey(l)))
    }
    setLessons((prev) => prev.filter((l) => !s.has(l.id)))
  }, [])

  const updateLesson = useCallback((id: string, patch: Partial<Lesson>) => {
    const old = lessonsRef.current.find((l) => l.id === id)
    if (old?.syncId) {
      // sync protection: simpan editan agar tidak ditimpa saat sync
      saveOverride(lessonKey(old), patch)
    }
    setLessons((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }, [])

  const removeSource = useCallback((id: string) => {
    setSources((prev) => prev.filter((s) => s.id !== id))
    setLessons((prev) => prev.filter((l) => l.syncId !== id))
  }, [])

  /** Sinkron satu sumber; memakai lessonsRef agar tidak ada stale state */
  const sync = useCallback(
    async (src: SyncSource) => {
      setSyncing(true)
      setSyncMessage(null)
      try {
        const { lessons: next, result } = await syncSource(
          src,
          lessonsRef.current,
        )
        lessonsRef.current = next
        setLessons(next)
        setSources((prev) =>
          prev.map((s) =>
            s.id === src.id
              ? {
                  ...s,
                  lastSync: new Date().toISOString(),
                  count: result.total,
                }
              : s,
          ),
        )
        const base = t('syncOk', {
          label: src.label,
          a: result.added,
          u: result.updated,
          m: result.merged,
        })
        setSyncMessage(
          result.skipped > 0
            ? base + t('syncSkipped', { s: result.skipped })
            : base,
        )
      } catch (e) {
        setSyncMessage(t('syncFail', { label: src.label, e: String(e) }))
      } finally {
        setSyncing(false)
      }
    },
    [t],
  )

  /** Sinkron semua sumber; lewati yang baru saja disinkron (opsi) */
  const syncAll = useCallback(
    async (skipRecent = false) => {
      const now = Date.now()
      const current = loadSources()
      const due = current.filter(
        (s) =>
          !skipRecent ||
          !s.lastSync ||
          now - new Date(s.lastSync).getTime() > MIN_SYNC_GAP,
      )
      if (due.length === 0) return
      for (const s of due) await sync(s)
    },
    [sync],
  )

  // Auto-sync saat aplikasi dibuka
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    if (!autoSync) return
    const timer = setTimeout(() => syncAll(true), 800)
    return () => clearTimeout(timer)
  }, [autoSync, syncAll])

  // Auto-sync berkala
  useEffect(() => {
    if (!autoSync) return
    const iv = setInterval(() => syncAll(true), AUTO_SYNC_INTERVAL)
    return () => clearInterval(iv)
  }, [autoSync, syncAll])

  return {
    lessons,
    visibleLessons,
    hiddenKeys,
    hideLessons,
    unhideAll,
    sources,
    syncing,
    syncMessage,
    autoSync,
    setAutoSync,
    notifEnabled,
    setNotifEnabled,
    addManualLesson,
    removeLesson,
    removeMany,
    updateLesson,
    addSource: setSources,
    removeSource,
    sync,
    syncAll,
  }
}
