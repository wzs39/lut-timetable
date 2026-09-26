import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Lesson, SyncSource } from './types'
import { useTimetable } from './hooks/useTimetable'
import { useMoodleData } from './hooks/useMoodleData'
import { MoodleProvider } from './hooks/useMoodleData'
import { useDesktopBridge } from './hooks/useDesktopBridge'
import { useSubscriptions } from './hooks/useSubscriptions'
import { useDiagnostics } from './hooks/useDiagnostics'
import { useShareLinks } from './hooks/useShareLinks'
import { useWidgetTaskBridge } from './hooks/useWidgetTaskBridge'
import WeekGrid from './components/WeekGrid'
import TodayView from './components/TodayView'
import LessonDetail from './components/LessonDetail'
import DuplicateResolver from './components/DuplicateResolver'
import BatchFilter from './components/BatchFilter'
import ConflictCheck from './components/ConflictCheck'
import NotificationManager from './components/NotificationManager'
import Settings from './components/Settings'
import MoodleView from './components/MoodleView'
import {
  ensureTranslatorSession,
  loadTranslatorUrl,
  saveTranslatorUrl,
} from './lib/translator'
import Sidebar from './components/Sidebar'
import MoreSheet from './components/MoreSheet'
import type { SheetAction } from './lib/sheetActions'
import CommandPalette from './components/CommandPalette'
import Onboarding from './components/Onboarding'
import { useI18n } from './i18n'
import { KEYS as STORE_KEYS, readString as readStored, writeString as writeStored } from './lib/storage'
import { sourceFromUrl } from './lib/store'
import { exportBackup } from './lib/backup'
import { exportTimetableIcs } from './lib/exportIcs'
import { parseShareHash } from './lib/shareLink'
import { isSubscribed } from './lib/subscriptions'
import ShareImportDialog from './components/ShareImportDialog'
import ShareQrDialog from './components/ShareQrDialog'
import { buildPalette, type PaletteAction } from './lib/palette'
import {
  applyA11y,
  SIDEBAR_DEFAULT_PX,
  clampSidebarWidth,
  loadUiPrefs,
  saveUiPrefs,
  type Contrast,
  type TextScale,
  type WeekDensity,
} from './lib/uiPrefs'
import { openExternal } from './lib/openExternal'
import { addTask, loadTasks, pendingTasks, saveTasks, updateTask, type Task } from './lib/tasks'
import { installWidgetNavBridge, pushTasksData } from './lib/widgetData'
import { useDelayedUnmount } from './lib/useExitAnimation'
import { checkApkUpdate } from './lib/apkUpdate'
import { maybeCleanOldApks } from './lib/apkUpdate'
import Icon from './components/Icon'
import { findDuplicateGroups, removableCount } from './lib/dedupe'
import {
  startOfWeek,
  addDays,
  lessonsInRange,
  sameDay,
  formatWeekRange,
  isoWeekNumber,
  findCourseTarget,
  findLessonByTitle,
  sameDayQueue,
} from './lib/date'
import {
  loadNotes,
  noteForLesson,
  noteKeyOf,
  removeNote,
  saveNote,
  type NotesMap,
} from './lib/notes'

/** Belum-dibaca Moodle → badge di tab navigasi (nol bila tak ada). */
function MoodleUnreadBadge() {
  const { unread } = useMoodleData()
  if (unread <= 0) return null
  return (
    /* .app-badge 携带自己的 bg/fg 对，选中/未选中两态都可读（同作业徽章）。
       不另引入 info 色：未读语义由「出现在 Moodle tab 上」本身传达。 */
    <span className="app-badge ml-1 font-semibold tabular-nums">{unread > 9 ? '9+' : unread}</span>
  )
}

function AppInner({
  tasks,
  setTasks,
  tt,
}: {
  tasks: Task[]
  setTasks: (t: Task[]) => void
  tt: ReturnType<typeof useTimetable>
}) {
  const { lang, locale, setLang, t } = useI18n()
  const md = useMoodleData()

  // 小组件后台回调（勾选回灌 + 任务变化时重抓后台种子）全在 useWidgetTaskBridge。
  useWidgetTaskBridge({ tasks, setTasks, pushTaskCompletion: md.pushTaskCompletion })
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [view, setView] = useState<'today' | 'week' | 'moodle'>(() => {
    // Windows 跳转列表 / 深链入口：#/view/today|week|moodle
    // 【2026-09-26】作业模块并入 Moodle 时间线：#/view/assign 兼容映射到 moodle。
    const m = /^#\/view\/(today|week|assign|moodle)$/.exec(location.hash)
    const v = m?.[1] === 'assign' ? 'moodle' : (m?.[1] as 'today' | 'week' | 'moodle')
    return v || 'today'
  })
  /** 作业模块（Moodle 时间线内嵌）的预置筛选/搜索词。null filter = 无预置。
   *  跳转点：成绩卡未评项、今日页横幅、课程详情、命令面板任务项。 */
  const [assignFilter, setAssignFilter] = useState<'overdue' | 'due7' | 'later' | null>(null)
  const [assignQuery, setAssignQuery] = useState<string | undefined>(undefined)
  /** 跳到作业模块（Moodle 时间线内嵌）的唯一入口：筛选/搜索词与视图一起变，
   *  各跳转点不再各自拼 setAssignFilter/setAssignQuery/setView 三连。 */
  const openAssignments = useCallback(
    (filter: 'overdue' | 'due7' | 'later' | null, query?: string) => {
      setAssignFilter(filter)
      setAssignQuery(query)
      setView('moodle')
    },
    [],
  )
  /** 清掉预置但不动视图（时间线卡片点击时用：卡片筛选接管列表）。 */
  const clearAssignPreset = useCallback(() => {
    setAssignFilter(null)
    setAssignQuery(undefined)
  }, [])
  /** 传给 MoodleView 的跳转预置：只有真带筛选/搜索词才非 null。
   *  必须按值 memo——内联对象每次渲染都是新引用，MoodleView 里「预置到达
   *  就切时间线」的 effect 会在每次 App 重渲染（后台同步、未读数变化…）
   *  时把用户从成绩/课程页拽回时间线。 */
  const assignPreset = useMemo(
    () =>
      assignFilter != null || assignQuery != null
        ? { filter: assignFilter, query: assignQuery }
        : null,
    [assignFilter, assignQuery],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // 分享 / 导入、诊断、订阅各是一个关注点——状态都在自己的 hook 里，App 只接线。
  const share = useShareLinks({
    lessons: tt.visibleLessons,
    weekStart,
    t,
    importLessons: tt.importSharedLessons,
  })
  const { errorCount, reloadErrorCount, exportDiagnostics, clearErrorLog } = useDiagnostics({
    locale,
    t,
    sourceCount: tt.sources.length,
    lessonCount: tt.lessons.length,
    taskCount: tasks.length,
  })
  const { subscriptions, watchCourse, watchRoom, markFiredAt, toggle, remove } = useSubscriptions()
  const [showDupResolver, setShowDupResolver] = useState(false)
  const [showBatchFilter, setShowBatchFilter] = useState(false)
  const [showConflicts, setShowConflicts] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMoreActions, setShowMoreActions] = useState(false)
  /** 移动端「更多」抽屉（<md 才渲染）：低频入口全部收进去，主界面只留信息 */
  const [sheetOpen, setSheetOpen] = useState(false)
  const sheetMounted = useDelayedUnmount(sheetOpen)
  const [notes, setNotes] = useState<NotesMap>(() => loadNotes())
  const [updateState, setUpdateState] = useState<{
    version: string
    kind: 'ready' | 'downloading' | 'available' | 'latest' | 'error'
    percent?: number
    /** Android: direct APK asset URL to download */
    apkUrl?: string
  } | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [translatorUrl, setTranslatorUrl] = useState(() => loadTranslatorUrl())
  const [translatorMsg, setTranslatorMsg] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // 布局偏好（周视图密度 / 侧栏宽度）——单一存储键，改动即持久化。
  const [uiPrefs, setUiPrefs] = useState(() => loadUiPrefs())
  useEffect(() => saveUiPrefs(uiPrefs), [uiPrefs])
  // 无障碍偏好是 DOM 属性（CSS 读它）——存储与显示分开，这里只负责同步
  useEffect(() => applyA11y(uiPrefs), [uiPrefs])
  /** 侧栏拖拽调宽：拖动期间实时更新（state 即持久化），双击恢复默认 */
  const startSidebarResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = uiPrefs.sidebarWidth
      const onMove = (ev: PointerEvent) =>
        setUiPrefs((prev) => ({
          ...prev,
          sidebarWidth: clampSidebarWidth(startW + ev.clientX - startX),
        }))
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [uiPrefs.sidebarWidth],
  )
  // 首次启动引导：仅「无来源 + 无课程 + 未看过」时自动弹出；可从菜单/命令面板重开。
  const [showOnboarding, setShowOnboarding] = useState(
    () =>
      !readStored(STORE_KEYS.onboardingDone) &&
      tt.sources.length === 0 &&
      tt.lessons.length === 0,
  )
  // 撤销条：一条消息 + 一个复原动作，6 秒后自动消失（新操作顶掉旧的）。
  const [undoNotice, setUndoNotice] = useState<{ message: string } | null>(null)
  const undoActionRef = useRef<(() => void) | null>(null)
  const undoTimerRef = useRef<number | null>(null)
  const clearUndoTimer = useCallback(() => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
  }, [])
  const dismissUndo = useCallback(() => {
    clearUndoTimer()
    undoActionRef.current = null
    setUndoNotice(null)
  }, [clearUndoTimer])
  const showUndo = useCallback(
    (message: string, action: () => void) => {
      undoActionRef.current = action
      setUndoNotice({ message })
      clearUndoTimer()
      undoTimerRef.current = window.setTimeout(() => {
        undoTimerRef.current = null
        undoActionRef.current = null
        setUndoNotice(null)
      }, 6000)
    },
    [clearUndoTimer],
  )
  const runUndo = useCallback(() => {
    const action = undoActionRef.current
    undoActionRef.current = null
    clearUndoTimer()
    setUndoNotice(null)
    action?.()
  }, [clearUndoTimer])
  useEffect(() => clearUndoTimer, [clearUndoTimer])

  // Widget 深链：view 只在挂载时读一次 hash，运行中由 widget tap 经
  // MainActivity → __widgetNav 写 hash；此 listener 把 hash 变化接到 view 状态。
  useEffect(() => {
    installWidgetNavBridge()
    const onHash = () => {
      const m = /^#\/view\/(today|week|assign|moodle)$/.exec(location.hash)
      if (m) {
        if (m[1] === 'assign') { setAssignFilter(null); setAssignQuery(undefined) } // 普通深链不带筛选
        // assign 视图已并入 Moodle 时间线：hash 兼容映射。
        setView(m[1] === 'assign' ? 'moodle' : (m[1] as 'today' | 'week' | 'moodle'))
      }
      // 分享链接：#/import/<payload> — 挂载时和运行中改 hash 都要处理
      const payload = parseShareHash(location.hash)
      if (payload) share.openShareImport(payload)
    }
    onHash()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [share.openShareImport])

  /**
   * 打开设置：顺手刷新错误条数（后台报的错要能及时看到）。
   * 放在这里而不是 useEffect——effect 里同步 setState 会触发一次额外渲染。
   */
  const openSettings = useCallback(() => {
    reloadErrorCount()
    setShowSettings(true)
  }, [reloadErrorCount])

  // Manual one-click link: only touches Lecture Translator when the user
  // presses the sidebar button — never automatic, never in the background.
  const linkTranslatorNow = useCallback(() => {
    const lesson = tt.lessons
      .filter((l) => {
        const t0 = new Date(l.start).getTime()
        const t1 = new Date(l.end).getTime()
        const now = Date.now()
        return now >= t0 - 60_000 && now <= t1 + 10 * 60_000
      })
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())[0]
    if (!lesson) {
      setTranslatorMsg(t('translatorNoLesson'))
      return
    }
    setTranslatorMsg(t('translatorLinking'))
    ensureTranslatorSession(translatorUrl, lesson).then((id) => {
      setTranslatorMsg(
        id ? t('translatorLinked', { title: lesson.title }) : t('translatorFail'),
      )
    })
  }, [tt.lessons, translatorUrl, t])

  const appVersion = import.meta.env.VITE_APP_VERSION as string | undefined
  const checkForUpdate = useCallback(async () => {
    const bridge = (window as unknown as { lutUpdate?: any }).lutUpdate
    if (!bridge?.check) {
      // 无 Electron 桥：Android 上走 GitHub Releases 检查 APK 更新。
      setUpdateChecking(true)
      try {
        const apk = await checkApkUpdate(appVersion ?? '0.0.0')
        setUpdateChecking(false)
        if (apk) {
          setUpdateState({ version: apk.version, kind: 'available', apkUrl: apk.apkUrl })
        } else {
          setUpdateState({ version: appVersion ?? '?', kind: 'latest' })
        }
      } catch {
        setUpdateChecking(false)
        setUpdateState({ version: appVersion ?? '?', kind: 'error' })
      }
      return
    }
    setUpdateChecking(true)
    const r = await bridge.check()
    setUpdateChecking(false)
    if (!r?.ok) setUpdateState({ version: appVersion ?? '?', kind: 'error' })
    // ok 的结果由 update-status 事件驱动后续状态（available/downloading/ready）。
  }, [appVersion])

  useEffect(() => {
    const bridge = (window as unknown as { lutUpdate?: any }).lutUpdate
    if (!bridge?.onUpdate) return
    const off = bridge.onUpdate(
      (p: { type?: string; version?: string; percent?: number }) => {
        const v = String(p?.version ?? '')
        if (p?.type === 'update-available') {
          setUpdateState({ version: v, kind: 'available' })
        } else if (p?.type === 'download-progress') {
          setUpdateState((prev) => ({
            version: prev?.version ?? '?',
            kind: 'downloading',
            percent: p.percent,
          }))
        } else if (p?.type === 'update-downloaded') {
          setUpdateState({ version: v, kind: 'ready' })
        } else if (p?.type === 'update-not-available') {
          setUpdateState({ version: appVersion ?? '?', kind: 'latest' })
        } else if (p?.type === 'update-error') {
          setUpdateChecking(false)
          setUpdateState((prev) =>
            !prev || prev.kind === 'downloading' || prev.kind === 'available'
              ? { version: appVersion ?? '?', kind: 'error' }
              : prev,
          )
        }
      },
    )
    return off
  }, [appVersion])

  // ---- 桌面端（Electron）：托盘 + 全局快捷键的接线全在 useDesktopBridge，
  // 状态的唯一所有者在主进程（userData/desktop-prefs.json）。
  const { desktop, applyDesktopPrefs } = useDesktopBridge(lang, checkForUpdate)

  const selectedLesson: Lesson | null = useMemo(
    () => tt.lessons.find((l) => l.id === selectedId) ?? null,
    [tt.lessons, selectedId],
  )
  const dupGroups = useMemo(() => findDuplicateGroups(tt.lessons), [tt.lessons])
  const dupCount = removableCount(dupGroups)

  /**
   * 移动端抽屉动作：桌面 ⋯ 菜单 + 语言开关的等价集合。
   * 这里只声明「有没有待处理事项」（pending 数量 / attention）与优先权重，
   * 排前/置底由 `orderSheetActions` 决定（见 lib/sheetActions.ts）。
   */
  const sheetActions = useMemo<SheetAction[]>(() => {
    // 后台已经拿到新版本（ready）/ 正在下载 / 已发现可下载 APK：都算「有事要做」
    const updatePending =
      !!updateState &&
      (updateState.kind === 'available' ||
        updateState.kind === 'ready' ||
        updateState.kind === 'downloading')
    return [
      {
        key: 'update',
        icon: 'sync',
        label: updatePending
          ? t(updateState?.kind === 'ready' ? 'updateTileReady' : 'updateTileAvailable', {
              v: updateState?.version ?? '',
            })
          : updateChecking
            ? t('updateChecking')
            : t('updateCheck'),
        onRun: () => void checkForUpdate(),
        attention: updatePending,
        priority: 4,
      },
      {
        key: 'dups',
        icon: 'puzzle',
        label: t('dupsTile'),
        onRun: () => setShowDupResolver(true),
        pending: dupCount,
        priority: 3,
      },
      {
        key: 'unhide',
        icon: 'eye-off',
        label: t('unhideTile'),
        onRun: () => tt.unhideAll(),
        pending: tt.hiddenKeys.size,
        priority: 2,
      },
      { key: 'settings', icon: 'settings', label: t('settingsTitle'), onRun: openSettings },
      { key: 'batch', icon: 'search', label: t('batchButton'), onRun: () => setShowBatchFilter(true) },
      { key: 'conflicts', icon: 'warn', label: t('conflictsButton'), onRun: () => setShowConflicts(true) },
      {
        key: 'lang',
        icon: 'globe',
        label: `${t('langTitle')} · ${lang === 'zh' ? 'EN' : '中文'}`,
        onRun: () => setLang(lang === 'zh' ? 'en' : 'zh'),
      },
      { key: 'onboarding', icon: 'compass', label: t('obReplay'), onRun: () => setShowOnboarding(true) },
    ]
  }, [checkForUpdate, dupCount, lang, openSettings, setLang, t, tt, updateChecking, updateState])
  const pendingTaskCount = pendingTasks(tasks).length
  /** 课程详情里的「上一节/下一节」：同一天内的队列位置 */
  const lessonQueue = useMemo(
    () => (selectedLesson ? sameDayQueue(tt.visibleLessons, selectedLesson.id) : null),
    [selectedLesson, tt.visibleLessons],
  )

  /** Lompat ke minggu kemunculan berikutnya dari kode kursus + pilih sesinya.
   *  Satu pemilik untuk ketiga view (today/moodle/assign). */
  /** 跳到某节课所在周并选中它（视图跳转的公共尾部） */
  const jumpToLesson = useCallback((target: Lesson | undefined) => {
    if (!target) return
    setWeekStart(startOfWeek(new Date(target.start)))
    setView('week')
    setSelectedId(target.id)
  }, [])

  const jumpToCourse = useCallback(
    (code: string) => jumpToLesson(findCourseTarget(tt.visibleLessons, code)),
    [jumpToLesson, tt.visibleLessons],
  )

  /** 删除 / 隐藏课程的唯一入口：把 useTimetable 的快照挂到撤销条上 */
  const removeLessonsUndoable = useCallback(
    (ids: string[], mode: 'delete' | 'hide') => {
      const snapshot = mode === 'delete' ? tt.removeMany(ids) : tt.hideLessons(ids)
      if (!snapshot) return
      showUndo(
        mode === 'delete'
          ? t('undoRemovedLessons', { n: snapshot.slots.length })
          : t('undoHiddenLessons', { n: snapshot.hidden.length }),
        () => tt.restoreUndo(snapshot),
      )
    },
    [showUndo, t, tt],
  )

  /** 课程备注删除（设置页 + 课程详情共用同一条可撤销路径） */
  const removeNoteUndoable = useCallback(
    (key: string) => {
      const snapshot = notes
      if (!snapshot[key]) return
      setNotes(removeNote(snapshot, key))
      showUndo(t('undoNoteRemoved'), () => setNotes(snapshot))
    },
    [notes, showUndo, t],
  )

  /** 作业页的所有写操作：数组变短 = 删除了条目 → 给一次撤销机会 */
  const applyTasks = useCallback(
    (next: Task[]) => {
      if (next.length < tasks.length) {
        const snapshot = tasks
        showUndo(t('undoTaskRemoved', { n: tasks.length - next.length }), () =>
          setTasks(saveTasks(snapshot)),
        )
      }
      setTasks(saveTasks(next))
    },
    [setTasks, showUndo, t, tasks],
  )

  const paletteItems = useMemo(
    () => (paletteOpen ? buildPalette({ t, locale, lessons: tt.lessons, tasks, dupCount }) : []),
    [paletteOpen, t, locale, tt.lessons, tasks, dupCount],
  )

  /** 命令面板动作的唯一派发点 */
  const runPaletteAction = useCallback(
    (action: PaletteAction) => {
      setPaletteOpen(false)
      switch (action.kind) {
        case 'view':
          if (action.view === 'assign') {
            // assign 视图已并入 Moodle 时间线：命令面板的「作业」落到 moodle。
            openAssignments(null)
          } else {
            setView(action.view)
          }
          break
        case 'week':
          if (action.delta === 0) setWeekStart(startOfWeek(new Date()))
          else setWeekStart(addDays(weekStart, action.delta * 7))
          if (action.delta !== 0) setView('week')
          break
        case 'course':
          // 有代码走代码前缀；无代码的手动课回退到标题匹配
          jumpToLesson(
            action.code
              ? findCourseTarget(tt.visibleLessons, action.code)
              : findLessonByTitle(tt.visibleLessons, action.title),
          )
          break
        case 'task': {
          const task = tasks.find((x) => x.id === action.taskId)
          openAssignments(null, task?.title)
          break
        }
        case 'settings':
          openSettings()
          break
        case 'sync':
          void tt.syncAll()
          break
        case 'batch':
          setShowBatchFilter(true)
          break
        case 'conflicts':
          setShowConflicts(true)
          break
        case 'dupes':
          setShowDupResolver(true)
          break
        case 'exportBackup':
          void exportBackup()
          break
        case 'exportIcs':
          // 导出的是用户实际看到的课表（含手动课，已去掉隐藏项）
          void exportTimetableIcs(tt.visibleLessons)
          break
        case 'shareWeek':
          void share.shareWeek()
          break
        case 'quickAddTask': {
          // 命令面板一行话直接落库：新增任务 + 跳到作业模块看到它
          applyTasks(
            addTask(tasks, { title: action.title, course: '', dueAt: action.dueAt, note: '' }),
          )
          openAssignments(null)
          break
        }
        case 'checkUpdate':
          void checkForUpdate()
          break
        case 'onboarding':
          setShowOnboarding(true)
          break
      }
    },
    [applyTasks, checkForUpdate, jumpToLesson, openAssignments, openSettings, share.shareWeek, tasks, tt, weekStart],
  )

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])
  const isCurrentWeek = useMemo(
    () => sameDay(startOfWeek(new Date()), weekStart),
    [weekStart],
  )
  const weekNum = isoWeekNumber(weekStart)
  const weekRangeText = formatWeekRange(weekStart, locale)
  const weekVisibleLessons = useMemo(
    () => lessonsInRange(tt.visibleLessons, weekStart, weekEnd),
    [tt.visibleLessons, weekStart, weekEnd],
  )
  const onPrevWeek = useCallback(() => setWeekStart(addDays(weekStart, -7)), [weekStart])
  const onNextWeek = useCallback(() => setWeekStart(addDays(weekStart, 7)), [weekStart])
  const onThisWeek = useCallback(() => setWeekStart(startOfWeek(new Date())), [])

  /** 添加来源 = 立刻拉一次；不让用户加完再自己找「同步」按钮 */
  const addSourceNow = useCallback(
    (src: SyncSource) => {
      tt.addSource([...tt.sources, src])
      void tt.sync(src)
    },
    [tt],
  )

  /** 首次引导用：URL → 来源（sourceFromUrl 是唯一的链接解析器） */
  const addSourceFromUrl = useCallback(
    (url: string): string | null => {
      const src = sourceFromUrl(url)
      if (!src) return null
      addSourceNow(src)
      return src.id
    },
    [addSourceNow],
  )

  // 键盘快捷键：Ctrl/Cmd+K 面板 · 1-4 切视图 · ←/→ 切周 · T 回到本周。
  // 输入框内、带修饰键的组合、弹层打开时一律让路（不抢键）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      const mod = e.ctrlKey || e.metaKey
      if (mod && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (typing || mod || e.altKey || paletteOpen) return
      if (e.key === 'Escape') {
        setShowMoreActions(false)
        setSheetOpen(false)
        return
      }
      const overlayOpen =
        showSettings ||
        showDupResolver ||
        showBatchFilter ||
        showConflicts ||
        showOnboarding ||
        !!selectedId
      if (overlayOpen) return
      if (e.key === '1') setView('today')
      else if (e.key === '2') setView('week')
      else if (e.key === '3') {
        // 「3」= 作业模块（并入 Moodle 时间线）：与命令面板同语义
        openAssignments(null)
      } else if (e.key === '4') setView('moodle')
      else if (e.key === 'ArrowLeft') {
        setView('week')
        onPrevWeek()
      } else if (e.key === 'ArrowRight') {
        setView('week')
        onNextWeek()
      } else if (e.key === 't' || e.key === 'T') {
        setView('week')
        onThisWeek()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    onNextWeek,
    onPrevWeek,
    onThisWeek,
    openAssignments,
    paletteOpen,
    selectedId,
    showBatchFilter,
    showConflicts,
    showDupResolver,
    showOnboarding,
    showSettings,
  ])

  // Catatan kursus: kunci = kode kursus ternormalisasi + jenis sesi.
  const saveNoteForLesson = useCallback((lesson: Lesson, text: string) => {
    setNotes((prev) => saveNote(prev, lesson, text))
  }, [])

  return (
    <div className="app-shell h-screen flex flex-col">
      <header className="app-header safe-top flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 border-b border-[var(--line)]">
        <div className="flex items-center gap-3">
          {/* 移动端不再放汉堡按钮：主导航已下到底部标签栏（拇指可达） */}
          <h1 className="text-sm font-semibold">{t('appName')}</h1>
          <span className="hidden sm:inline text-[11px] text-[var(--text-3)]">
            {t('lessonsSources', { n: tt.lessons.length, m: tt.sources.length })}
          </span>
        </div>
        <div className="app-actions flex flex-wrap items-center justify-end gap-1.5 text-xs ml-auto">
          {/* 视图切换：桌面/平板保留在头部（移动端交给底部标签栏） */}
          <div className="app-seg hidden md:flex">
            <button onClick={() => setView('today')} aria-pressed={view === 'today'}>
              {t('viewToday')}
            </button>
            <button onClick={() => setView('week')} aria-pressed={view === 'week'}>
              {t('viewWeek')}
            </button>
            {/* 作业模块已并入 Moodle 时间线：导航三项，任务数徽标挂在 Moodle 上 */}
            <button
              onClick={() => setView('moodle')}
              aria-pressed={view === 'moodle'}
              title={t('moodleNav')}
            >
              <span className="inline-flex items-center gap-2"><Icon name="book" size={15} /><span className="hidden sm:inline"> {t('moodleNav')}</span></span>
              {pendingTaskCount > 0 && (
                <span className="app-badge ml-1 font-semibold tabular-nums">{pendingTaskCount}</span>
              )}
              <MoodleUnreadBadge />
            </button>
          </div>
          {view === 'week' && (
            <div className="hidden md:flex items-center gap-1.5">
              <button
                onClick={onPrevWeek}
                className="app-btn px-2.5 min-h-9"
                aria-label={t('prevWeek')}
              >
                <Icon name="chevron-left" size={15} />
              </button>
              <span
                className="inline-block max-w-[24vw] truncate align-middle rounded-md border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1.5 text-[11px] sm:max-w-none sm:text-xs tabular-nums text-[var(--text-2)]"
                title={t('weekRange', { w: weekNum, range: weekRangeText })}
              >
                {t('weekRange', { w: weekNum, range: weekRangeText })}
              </span>
              <button
                onClick={onNextWeek}
                className="app-btn px-2.5 min-h-9"
                aria-label={t('nextWeek')}
              >
                <Icon name="chevron-right" size={15} />
              </button>
              {!isCurrentWeek && (
                <button onClick={onThisWeek} className="app-btn-primary px-2.5 min-h-9">
                  {t('thisWeek')}
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => setPaletteOpen(true)}
            className="app-btn inline-flex items-center gap-1.5 px-2 sm:px-2.5 min-h-9"
            title={t('paletteShortcuts')}
          >
            <Icon name="search" size={14} />
            <span className="hidden sm:inline text-[10px] text-[var(--text-3)]">Ctrl K</span>
          </button>
          <button
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            className="app-btn max-md:hidden px-2.5 min-h-9 font-medium"
            title="切换语言 / Switch language"
          >
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
          <div className="relative max-md:hidden">
            <button
              onClick={() => setShowMoreActions((open) => !open)}
              className="app-btn px-2 sm:px-2.5 min-h-9"
              title={t('moreActions')}
              aria-expanded={showMoreActions}
            >
              <span aria-hidden="true" className="inline-flex items-center"><Icon name="more" size={16} /></span><span className="hidden sm:inline"> {t('moreActions')}</span>
            </button>
            {showMoreActions && (
              <div className="animate-pop-in absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-1.5 shadow-2xl shadow-black/50">
                <button
                  onClick={() => { openSettings(); setShowMoreActions(false) }}
                  className="app-menu-item"
                >
                  <span className="inline-flex items-center gap-2"><Icon name="settings" /> {t('settingsTitle')}</span><span className="text-[var(--text-3)]"><Icon name="chevron-right" size={12} /></span>
                </button>
                <button
                  onClick={() => { setShowOnboarding(true); setShowMoreActions(false) }}
                  className="app-menu-item"
                >
                  <span className="inline-flex items-center gap-2"><Icon name="compass" /> {t('obReplay')}</span><span className="text-[var(--text-3)]"><Icon name="chevron-right" size={12} /></span>
                </button>
                <button
                  onClick={() => { setShowBatchFilter(true); setShowMoreActions(false) }}
                  className="app-menu-item"
                >
                  <span className="inline-flex items-center gap-2"><Icon name="search" /> {t('batchButton')}</span><span className="text-[var(--text-3)]"><Icon name="chevron-right" size={12} /></span>
                </button>
                <button
                  onClick={() => { setShowConflicts(true); setShowMoreActions(false) }}
                  className="app-menu-item"
                >
                  <span className="inline-flex items-center gap-2"><Icon name="warn" /> {t('conflictsButton')}</span><span className="text-[var(--text-3)]"><Icon name="chevron-right" size={12} /></span>
                </button>
                {dupCount > 0 && (
                  <button
                    onClick={() => { setShowDupResolver(true); setShowMoreActions(false) }}
                    className="app-menu-item text-[var(--due)]"
                  >
                    <span className="inline-flex items-center gap-2"><Icon name="puzzle" /> {t('dupButton', { n: dupCount })}</span><span className="text-[var(--text-3)]"><Icon name="chevron-right" size={12} /></span>
                  </button>
                )}
                {tt.hiddenKeys.size > 0 && (
                  <button
                    onClick={() => { tt.unhideAll(); setShowMoreActions(false) }}
                    className="app-menu-item text-[var(--text-2)]"
                  >
                    <span className="inline-flex items-center gap-2"><Icon name="eye-off" /> {t('hiddenN', { n: tt.hiddenKeys.size })}</span><span className="text-[var(--text-3)]"><Icon name="restore" size={12} /></span>
                  </button>
                )}
                <div className="my-1 border-t border-[var(--line)]/60" />
                <button
                  onClick={() => { void checkForUpdate(); setShowMoreActions(false) }}
                  disabled={updateChecking}
                  className="app-menu-item"
                >
                  <span className="inline-flex items-center gap-2"><Icon name="sync" /> {updateChecking ? t('updateChecking') : t('updateCheck')}</span><span className="text-[var(--text-3)]"><Icon name="chevron-right" size={12} /></span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {/* 底部标签栏占位：移动端内容不被导航盖住（桌面无此栏） */}
      <div className="flex flex-1 min-h-0 pb-[calc(3.4rem+env(safe-area-inset-bottom,0px))] md:pb-0">
        {/* 桌面端：固定侧栏（宽度可拖拽，偏好持久化） */}
        <div
          className="hidden md:flex h-full shrink-0"
          style={{ width: uiPrefs.sidebarWidth }}
        >
          <Sidebar
            sources={tt.sources}
            syncing={tt.syncing}
            syncMessage={tt.syncMessage}
            onSync={tt.sync}
            onAddManual={tt.addManualLesson}
            onOpenSettings={openSettings}
          />
        </div>
        {/* 拖拽手柄：双击恢复默认宽度 */}
        <div
          role="separator"
          aria-orientation="vertical"
          title={t('sidebarResizeHint')}
          onPointerDown={startSidebarResize}
          onDoubleClick={() =>
            setUiPrefs((prev) => ({ ...prev, sidebarWidth: SIDEBAR_DEFAULT_PX }))
          }
          className="hidden md:block w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--hover-1)]"
        />
        <main className="flex-1 flex flex-col min-w-0">
          <div key={view} className="animate-view-in flex flex-1 min-h-0 flex-col">
          {view === 'today' && (
            <TodayView
              lessons={tt.visibleLessons}
              onSelect={setSelectedId}
              notes={notes}
              tasks={tasks}
              onJumpToCourse={jumpToCourse}
              onToggleTask={(task, completed) => setTasks(updateTask(tasks, task.id, { completed }))}
              onOpenAssignments={() =>
                openAssignments(null) /* 今日页横幅/卡片：无预置筛选，作业模块在 Moodle 时间线里 */
              }
              onOpenSettings={openSettings}
              hasSources={tt.sources.length > 0}
              subscriptions={subscriptions}
              onWatchRoom={watchRoom}
            />
          )}
          {view === 'week' && (
            <WeekGrid
              lessons={weekVisibleLessons}
              weekStart={weekStart}
              onSelect={setSelectedId}
              notes={notes}
              onShiftWeek={(delta) => setWeekStart((w) => addDays(w, delta * 7))}
              onThisWeek={onThisWeek}
              density={uiPrefs.density}
              onDensity={(d: WeekDensity) => setUiPrefs((prev) => ({ ...prev, density: d }))}
            />
          )}
          {view === 'moodle' && (
            <MoodleView
              tasks={tasks}
              lessons={tt.lessons}
              onTasks={applyTasks}
              onJumpToCourse={jumpToCourse}
              assignPreset={assignPreset}
              onOpenAssignments={openAssignments}
              onClearAssignPreset={clearAssignPreset}
              onOpenSettings={openSettings}
            />
          )}
          </div>
        </main>
      </div>
      {/* 移动端主导航：底部标签栏（拇指可达、始终可见；桌面端由侧栏 + 头部承担） */}
      <nav
        className="md:hidden fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--line)] bg-[var(--surface-1)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {(
          [
            { key: 'today', icon: 'live', label: t('viewToday'), badge: 0 },
            { key: 'week', icon: 'clock', label: t('viewWeek'), badge: 0 },
            // 作业模块已并入 Moodle 时间线：底部标签三项 + 更多抽屉
            { key: 'moodle', icon: 'book', label: t('moodleNav'), badge: md.unread + pendingTaskCount },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            onClick={() => {
              clearAssignPreset() // 底部导航 = 无预置筛选（同侧栏）
              setView(item.key)
            }}
            aria-pressed={view === item.key}
            className={
              'relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ' +
              (view === item.key ? 'text-[var(--text-1)]' : 'text-[var(--text-3)]')
            }
          >
            <Icon name={item.icon} size={17} />
            <span className="max-w-full truncate">{item.label}</span>
            {item.badge > 0 && (
              <span className="app-badge absolute right-[16%] top-2.5 px-1 text-[9px] font-semibold tabular-nums">
                {item.badge > 9 ? '9+' : item.badge}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={() => setSheetOpen(true)}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] text-[var(--text-3)]"
          title={t('moreActions')}
        >
          <Icon name="menu" size={17} />
          <span className="max-w-full truncate">{t('moreActions')}</span>
        </button>
      </nav>
      {sheetMounted && (
        <MoreSheet
          open={sheetOpen}
          actions={sheetActions}
          sources={tt.sources}
          syncing={tt.syncing}
          syncMessage={tt.syncMessage}
          onSync={tt.sync}
          onAddManual={tt.addManualLesson}
          onOpenSettings={openSettings}
          onClose={() => setSheetOpen(false)}
        />
      )}
      {selectedLesson && (
        <LessonDetail
          lesson={selectedLesson}
          onSave={tt.updateLesson}
          onDelete={(id) => removeLessonsUndoable([id], 'delete')}
          nav={
            lessonQueue
              ? {
                  index: lessonQueue.index,
                  total: lessonQueue.total,
                  onPrev: lessonQueue.prevId
                    ? () => setSelectedId(lessonQueue.prevId as string)
                    : undefined,
                  onNext: lessonQueue.nextId
                    ? () => setSelectedId(lessonQueue.nextId as string)
                    : undefined,
                }
              : undefined
          }
          onHide={(id) => removeLessonsUndoable([id], 'hide')}
          watched={
            !!selectedLesson.code &&
            isSubscribed(subscriptions, 'course-change', selectedLesson.code)
          }
          onWatch={
            selectedLesson.code
              ? (on) => watchCourse(selectedLesson, on)
              : undefined
          }
          timeEditUrl={
            tt.sources.find(
              (s) =>
                s.type === 'timeedit' &&
                (selectedLesson.syncId === s.id ||
                  selectedLesson.mergedSources?.includes('timeedit')),
            )?.url
          }
          onClose={() => setSelectedId(null)}
          note={
            selectedLesson ? noteForLesson(notes, selectedLesson) : undefined
          }
          onSaveNote={(text) => saveNoteForLesson(selectedLesson, text)}
          onRemoveNote={() => removeNoteUndoable(noteKeyOf(selectedLesson))}
          assignments={tasks}
          onOpenAssignments={() => {
            setSelectedId(null)
            openAssignments(null) // 课程详情跳转：无预置筛选，作业模块在 Moodle 时间线里
          }}
        />
      )}
      {share.shareQr && (
        <ShareQrDialog
          link={share.shareQr.link}
          qr={share.shareQr.qr}
          count={share.shareQr.count}
          onClose={share.closeShareQr}
        />
      )}
      {share.shareImport && (
        <ShareImportDialog
          decoded={share.shareImport.kind === 'confirm' ? share.shareImport.decoded : null}
          failed={share.shareImport.kind === 'failed'}
          imported={share.shareImport.kind === 'done' ? share.shareImport : null}
          onConfirm={share.confirmShareImport}
          onClose={share.closeShareImport}
        />
      )}
      {showDupResolver && (
        <DuplicateResolver
          groups={dupGroups}
          onRemoveMany={(ids) => removeLessonsUndoable(ids, 'delete')}
          onClose={() => setShowDupResolver(false)}
        />
      )}
      {showBatchFilter && (
        <BatchFilter
          lessons={tt.lessons}
          onRemoveMany={(ids) => removeLessonsUndoable(ids, 'delete')}
          onHideMany={(ids) => removeLessonsUndoable(ids, 'hide')}
          onClose={() => setShowBatchFilter(false)}
        />
      )}
      {showSettings && (
        <Settings
          sources={tt.sources}
          syncing={tt.syncing}
          syncMessage={tt.syncMessage}
          autoSync={tt.autoSync}
          onToggleAutoSync={tt.setAutoSync}
          notifEnabled={tt.notifEnabled}
          onToggleNotif={tt.setNotifEnabled}
          digestEnabled={tt.digestEnabled}
          onToggleDigest={tt.setDigestEnabled}
          onAddSource={addSourceNow}
          onRemoveSource={tt.removeSource}
          onSync={tt.sync}
          translatorUrl={translatorUrl}
          onTranslatorUrl={(u) => {
            setTranslatorUrl(u)
            saveTranslatorUrl(u)
          }}
          onLinkTranslator={linkTranslatorNow}
          translatorMsg={translatorMsg}
          notes={notes}
          onRemoveNote={removeNoteUndoable}
          onExportIcs={() => void exportTimetableIcs(tt.visibleLessons)}
          onShareWeek={share.shareWeek}
          subscriptions={subscriptions}
          onToggleSubscription={toggle}
          onRemoveSubscription={remove}
          textScale={uiPrefs.textScale}
          contrast={uiPrefs.contrast}
          onTextScale={(v: TextScale) => setUiPrefs((prev) => ({ ...prev, textScale: v }))}
          onContrast={(v: Contrast) => setUiPrefs((prev) => ({ ...prev, contrast: v }))}
          errorCount={errorCount}
          onExportDiagnostics={exportDiagnostics}
          onClearErrors={clearErrorLog}
          audits={tt.audits}
          onClearAudits={tt.clearAudits}
          desktop={desktop}
          onDesktopPrefs={applyDesktopPrefs}
          onClose={() => setShowSettings(false)}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          items={paletteItems}
          onRun={runPaletteAction}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {showOnboarding && (
        <Onboarding
          onAddSource={addSourceFromUrl}
          onLoginMoodle={() => md.loginWithSso((url) => openExternal(url))}
          onFinish={() => {
            writeStored(STORE_KEYS.onboardingDone, '1')
            setShowOnboarding(false)
          }}
          onOpenSettings={openSettings}
        />
      )}
      {showConflicts && (
        <ConflictCheck
          lessons={tt.lessons}
          onOpenLesson={(id) => {
            const l = tt.lessons.find((x) => x.id === id)
            if (l) {
              setWeekStart(startOfWeek(new Date(l.start)))
              setView('week')
            }
            setSelectedId(id)
          }}
          onClose={() => setShowConflicts(false)}
        />
      )}

      <NotificationManager
        enabled={tt.notifEnabled}
        digestEnabled={tt.digestEnabled}
        lessons={tt.lessons}
        tasks={tasks}
        subscriptions={subscriptions}
        onSubscriptionsFired={markFiredAt}
      />
      {undoNotice && (
        <div className="fixed bottom-4 inset-x-0 z-50 flex justify-center px-4 animate-modal-in">
          <div className="flex max-w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--text-1)] shadow-lg">
            <span>{undoNotice.message}</span>
            <button onClick={runUndo} className="app-btn-primary px-3 min-h-9 font-medium">
              {t('undoBtn')}
            </button>
            <button
              onClick={dismissUndo}
              className="opacity-80 transition hover:opacity-100"
              title={t('closeHint')}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        </div>
      )}
      {updateState && (
        <div
          className={
            'fixed inset-x-0 z-50 flex justify-center px-4 animate-modal-in ' +
            (undoNotice ? 'bottom-20' : 'bottom-4')
          }
        >
          <div
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg text-sm px-4 py-3 shadow-lg max-w-full ${
              updateState.kind === 'error'
                ? 'bg-[var(--btn-danger)] text-white'
                : updateState.kind === 'ready'
                  ? 'bg-[var(--btn-ok)] text-white'
                  : 'bg-[var(--surface-2)] text-[var(--text-1)] border border-[var(--line)]'
            }`}
          >
            <span>
              {updateState.kind === 'ready' && (
                <span className="inline-flex items-center gap-2"><Icon name="sync" /> {t('updateReady', { v: updateState.version })}</span>
              )}
              {updateState.kind === 'downloading' &&
                t('updateDownloading', { p: updateState.percent ?? 0 })}
              {updateState.kind === 'available' &&
                (updateState.apkUrl
                  ? t('updateApkAvailable', { v: updateState.version })
                  : t('updateAvailable', { v: updateState.version }))}
              {updateState.kind === 'latest' &&
                t('updateUpToDate', { v: updateState.version })}
              {updateState.kind === 'error' && t('updateCheckFail')}
            </span>
            {updateState.kind === 'ready' && (
              <button
                className="rounded bg-white text-[var(--ok)] px-3 min-h-9 font-medium"
                onClick={() =>
                  (window as unknown as { lutUpdate?: any }).lutUpdate?.install()
                }
              >
                {t('updateInstallNow')}
              </button>
            )}
            {updateState.kind === 'available' && updateState.apkUrl && (
              <a
                href={updateState.apkUrl}
                download="app-release.apk"
                onClick={() => {
                  // Unduhan lama di Download/ (APK versi sebelumnya) dibuang:
                  // installed APK tidak terpakai lagi & memakan storage.
                  try {
                    const cds = (window as unknown as { caches?: CacheStorage }).caches
                    void cds?.keys?.()
                  } catch { /* noop */ }
                  void maybeCleanOldApks()
                }}
                className="inline-flex items-center gap-1.5 rounded bg-white text-[var(--text-3)] px-3 min-h-9 font-medium"
              >
                <Icon name="external" size={13} /> {t('updateGetApk')}
              </a>
            )}
            <button
              className="opacity-80 transition hover:opacity-100"
              onClick={() => setUpdateState(null)}
            >
              {t('updateLater')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Moodle 状态的单一所有者：Settings（配置）与作业页（信息展示）
 * 共用同一份连接/成绩/提交状态，互不持有副本。
 * tasks/lessons 在 AppInner 内部初始化后经 prop 传入 provider。
 */
export default function App() {
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks())
  const tt = useTimetable()
  // Widget 任务列表：tasks 变化即推新 payload（同 lessons 的 push 模式）。
  useEffect(() => void pushTasksData(tasks), [tasks])
  return (
    <MoodleProvider tasks={tasks} lessons={tt.lessons} onTasks={(n) => setTasks(saveTasks(n))}>
      <AppInner tasks={tasks} setTasks={setTasks} tt={tt} />
    </MoodleProvider>
  )
}
