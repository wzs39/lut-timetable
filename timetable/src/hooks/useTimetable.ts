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
  loadOverrides,
  saveOverride,
  deleteOverride,
  removeTombstone,
  removeHiddenKeys,
  lessonKey,
  backfillLessonTypes,
  loadHiddenKeys,
  addHiddenKeys,
  clearHiddenKeys,
} from '../lib/store'
import { KEYS } from '../lib/storage'
import { pickSlots, restoreSlots, type LessonSlot, type TimetableUndo } from '../lib/undo'
import { pushWidgetData } from '../lib/widgetData'
import { pushBackgroundSeed } from '../lib/backgroundSeed'
import { syncBackgroundSchedule } from '../lib/backgroundSchedule'
import {
  appendAudit,
  CHANGE_KIND_KEY,
  clearAudits,
  diffLessons,
  firstNotableChange,
  hasNotableChanges,
  loadAudits,
  saveAudits,
  type SyncAudit,
} from '../lib/syncAudit'
import { useI18n } from '../i18n'
import { ensurePermission, notifyNow } from '../lib/notifications'
import { logError } from '../lib/errorLog'

const AUTO_SYNC_INTERVAL = 15 * 60 * 1000 // 15 menit
const MIN_SYNC_GAP = 5 * 60 * 1000 // lewati sumber yang baru saja disinkron
const LS_AUTOSYNC = KEYS.autosync
const LS_NOTIF = KEYS.notif
const LS_DIGEST = KEYS.digest

function loadAutoSync(): boolean {
  return localStorage.getItem(LS_AUTOSYNC) !== 'false'
}

function loadNotif(): boolean {
  return localStorage.getItem(LS_NOTIF) === 'true'
}

function loadDigest(): boolean {
  return localStorage.getItem(LS_DIGEST) === 'true'
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
  /** 每日摘要：与「上课前提醒」各自独立的开关，但共用通知权限 */
  const [digestEnabled, setDigestEnabledState] = useState<boolean>(() => loadDigest())
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => loadHiddenKeys())
  /** 同步变更审计（最近几次），持久化在 effect 里（不在 setState 里写副作用） */
  const [audits, setAudits] = useState<SyncAudit[]>(() => loadAudits())
  useEffect(() => saveAudits(audits), [audits])

  const lessonsRef = useRef(lessons)
  useEffect(() => {
    lessonsRef.current = lessons
  }, [lessons])

  /** syncSource 的依赖里没有 notifEnabled，用 ref 读最新值（开关后同步仍按新值走） */
  const notifEnabledRef = useRef(notifEnabled)
  useEffect(() => {
    notifEnabledRef.current = notifEnabled
  }, [notifEnabled])

  useEffect(() => saveLessons(lessons), [lessons])
  useEffect(() => void pushWidgetData(lessons), [lessons])
  useEffect(() => saveSources(sources), [sources])
  /** 后台刷新的输入（种子）：课程/源/审计/隐藏任一变化就重抓一份——
   *  必须排在 saveLessons 之后（种子里读的就是刚写下的 localStorage）。 */
  useEffect(() => void pushBackgroundSeed(), [lessons, sources, audits, hiddenKeys])
  /** 「自动同步」同时决定后台周期刷新的开/关（不另加一个用户看不见的开关）。 */
  useEffect(() => void syncBackgroundSchedule(autoSync), [autoSync])
  useEffect(() => localStorage.setItem(LS_AUTOSYNC, String(autoSync)), [autoSync])
  useEffect(() => localStorage.setItem(LS_NOTIF, String(notifEnabled)), [notifEnabled])
  useEffect(() => localStorage.setItem(LS_DIGEST, String(digestEnabled)), [digestEnabled])

  /** Aktifkan notifikasi: minta izin dulu; gagal -> tetap off */
  /** 摘要同样要先拿到通知权限，否则开关打开也推不出来 */
  const setDigestEnabled = useCallback(async (v: boolean) => {
    if (!v) {
      setDigestEnabledState(false)
      return
    }
    const ok = await ensurePermission()
    if (ok) setDigestEnabledState(true)
  }, [])

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

  /**
   * 导入分享链接里的课表。作为本机手动课加入（源就是「手动」——用户自己
   * 拿到的课表），已在课表里的（同代码同时段，lessonKey 判定）跳过，所以
   * 重复点同一个链接不会把课表堆成两倍。
   */
  const importSharedLessons = useCallback(
    (incoming: Omit<Lesson, 'id' | 'source'>[]): { added: number; skipped: number } => {
      const existing = new Set(lessonsRef.current.map((l) => lessonKey(l)))
      const fresh: Lesson[] = []
      let skipped = 0
      for (const l of incoming) {
        const candidate: Lesson = { ...l, id: uid(), source: 'manual' }
        const key = lessonKey(candidate)
        if (existing.has(key)) {
          skipped++
          continue
        }
        existing.add(key)
        fresh.push(candidate)
      }
      if (fresh.length > 0) setLessons((prev) => [...prev, ...fresh])
      return { added: fresh.length, skipped }
    },
    [],
  )

  /**
   * Sync protection untuk jalur hapus: tulis tombstone + singkirkan override.
   * Mengembalikan kunci yang harus dicabut bila pengguna menekan 「撤销」.
   */
  const protectForDelete = useCallback((slots: LessonSlot[]) => {
    const synced = slots.map((s) => s.lesson).filter((l) => l.syncId)
    const tombstones: string[] = []
    const overrides: Record<string, Partial<Lesson>> = {}
    if (synced.length === 0) return { tombstones, overrides }
    addTombstones(synced)
    const all = loadOverrides()
    for (const l of synced) {
      const key = lessonKey(l)
      const patch = all[key]
      if (patch) overrides[key] = patch
      deleteOverride(key)
      tombstones.push(key)
    }
    return { tombstones, overrides }
  }, [])

  const removeLesson = useCallback(
    (id: string): TimetableUndo | null => {
      const slots = pickSlots(lessonsRef.current, [id])
      if (slots.length === 0) return null
      const protection = protectForDelete(slots)
      setLessons((prev) => prev.filter((l) => l.id !== id))
      return { slots, hidden: [], ...protection }
    },
    [protectForDelete],
  )

  /** Sembunyikan lesson dari kalender tanpa menghapus (bisa dibuka lagi) */
  const hideLessons = useCallback((ids: string[]): TimetableUndo | null => {
    const slots = pickSlots(lessonsRef.current, ids)
    if (slots.length === 0) return null
    const victims = slots.map((s) => s.lesson)
    addHiddenKeys(victims)
    setHiddenKeys(loadHiddenKeys())
    return {
      slots: [],
      tombstones: [],
      overrides: {},
      hidden: victims.map((l) => lessonKey(l)),
    }
  }, [])

  /**
   * 「撤销」的唯一实现：把快照放回原位 + 撤销同步保护副作用
   * （tombstone 移除 → 课程能再次同步进来；override 写回 → 用户编辑不丢；
   * hidden key 移除 → 再次显示）。幂等，重复调用安全。
   */
  const restoreUndo = useCallback((u: TimetableUndo) => {
    if (u.slots.length > 0) {
      setLessons((prev) => {
        const next = restoreSlots(prev, u.slots)
        lessonsRef.current = next
        return next
      })
    }
    for (const key of u.tombstones) removeTombstone(key)
    for (const [key, patch] of Object.entries(u.overrides)) saveOverride(key, patch)
    if (u.hidden.length > 0) {
      removeHiddenKeys(u.hidden)
      setHiddenKeys(loadHiddenKeys())
    }
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

  const removeMany = useCallback(
    (ids: string[]): TimetableUndo | null => {
      const s = new Set(ids)
      const slots = pickSlots(lessonsRef.current, ids)
      if (slots.length === 0) return null
      const protection = protectForDelete(slots)
      setLessons((prev) => prev.filter((l) => !s.has(l.id)))
      return { slots, hidden: [], ...protection }
    },
    [protectForDelete],
  )

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
      // 同步前的课表快照：用来 diff 出「到底改了什么」（新增/时间/教室/取消）
      const before = lessonsRef.current
      try {
        const { lessons: next, result } = await syncSource(src, before)
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

        // 变更审计：明细落盘 + （开启通知时）把值得反应的变动推给用户
        const changes = diffLessons(before, next)
        if (changes.length > 0) {
          const audit: SyncAudit = {
            at: new Date().toISOString(),
            sourceId: src.id,
            sourceLabel: src.label,
            changes,
          }
          setAudits((prev) => appendAudit(audit, prev))
          const first = firstNotableChange(changes)
          if (notifEnabledRef.current && first && hasNotableChanges(changes)) {
            void notifyNow(
              t('notifyChangesTitle'),
              t('notifyChangesBody', {
                n: changes.length,
                first: `${first.label} · ${t(CHANGE_KIND_KEY[first.kind])}`,
              }),
            )
          }
        }
      } catch (e) {
        setSyncMessage(t('syncFail', { label: src.label, e: String(e) }))
        // 同步失败是跨端问题里最常见的一类（代理被限流 / 网络被拦）——
        // 落到本地错误日志，用户导出诊断时能带上真实原因。
        logError('sync', e, src.type)
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
    digestEnabled,
    setDigestEnabled,
    addManualLesson,
    importSharedLessons,
    removeLesson,
    removeMany,
    restoreUndo,
    updateLesson,
    addSource: setSources,
    removeSource,
    sync,
    syncAll,
    audits,
    clearAudits: useCallback(() => {
      clearAudits()
      setAudits([])
    }, []),
  }
}
