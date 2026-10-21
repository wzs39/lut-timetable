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
import AppHeader from './components/AppHeader'
import BottomNav from './components/BottomNav'
import UpdateToast, { type UpdateToastState } from './components/UpdateToast'
import WeekGrid from './components/WeekGrid'
import TodayView from './components/TodayView'
import LessonDetail from './components/LessonDetail'
import PrintWeek from './components/PrintWeek'
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
import { buildAppCommands, toSheetActions } from './lib/commands'
import CommandPalette from './components/CommandPalette'
import Onboarding from './components/Onboarding'
import { useI18n } from './i18n'
import { KEYS as STORE_KEYS, readString as readStored, writeString as writeStored } from './lib/storage'
import { sourceFromUrl } from './lib/store'
import { exportBackup } from './lib/backup'
import { exportTimetableIcs } from './lib/exportIcs'
import { canPrintSchedule } from './lib/print'
import { parseShareHash } from './lib/shareLink'
import { isSubscribed } from './lib/subscriptions'
import { useStudyBlocks } from './hooks/useStudyBlocks'
import { useOverlays } from './hooks/useOverlays'
import { loadStudyBlockPrefs } from './lib/studyBlockPrefs'
import ShareImportDialog from './components/ShareImportDialog'
import ShareQrDialog from './components/ShareQrDialog'
import { buildPalette, type PaletteAction } from './lib/palette'
import {
  WEEK_NAV,
  viewDeclForKey,
  viewDeclForRoute,
  viewDeclFromHash,
  weekNavForKey,
  weekStartAfter,
  type AppView,
  type ViewDecl,
  type WeekNavId,
} from './lib/navigation'
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
  // 深链/Windows 跳转列表入口：#/view/<route> 的词表在 lib/navigation；
  // 认不出的 hash 落回今日（不猜一个视图）。
  const [view, setView] = useState<AppView>(() => viewDeclFromHash(location.hash)?.view ?? 'today')
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
  /** 切换视图的唯一出口：声明说要清预置（`assign` 入口）就先清，再切页。 */
  const openView = useCallback(
    (decl: ViewDecl) => {
      if (decl.clearsAssignPreset) clearAssignPreset()
      setView(decl.view)
    },
    [clearAssignPreset],
  )
  /** 已确认的学习时段（周视图/今日页只读呈现）：变更即重算，见 useStudyBlocks。 */
  const studyBlocks = useStudyBlocks()

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
  /**
   * 弹层唯一所有者（lib/overlays 登记表）：新增弹层 = 表里加一行 + 下面
   * 渲染一行，不再新开 useState；「哪些弹层要拦快捷键」也从表推导。
   * 首次启动引导：仅「无来源 + 无课程 + 未看过」时作为初始栈打开。
   */
  const overlays = useOverlays(
    !readStored(STORE_KEYS.onboardingDone) &&
      tt.sources.length === 0 &&
      tt.lessons.length === 0
      ? ['onboarding']
      : [],
  )
  const sheetMounted = useDelayedUnmount(overlays.isOpen('sheet'))
  /** 课程详情：栈里携带的 lesson id（「打开哪节」与「是否打开」只有一份真相） */
  const selectedId = overlays.value('lesson')
  const setSelectedId = useCallback(
    (id: string | null) => (id ? overlays.open('lesson', id) : overlays.close('lesson')),
    [overlays],
  )
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
  // 设置里的学习偏好/目标改动后递增，让计划页重新读取存储。
  const [sisuPrefsRevision, setSisuPrefsRevision] = useState(0)
  /**
   * 学习块提醒开关（通知排期用）：初值现读，之后由设置页保存时推上来——
   * 不在这里按修订号重读存储（那是一条永远用不到的 memo 依赖，会被 lint 判为
   * 多余依赖，也容易在下次重构里被顺手删掉而静默失效）。
   */
  const [studyBlockRemindEnabled, setStudyBlockRemindEnabled] = useState(
    () => loadStudyBlockPrefs().remindEnabled,
  )
  const [notes, setNotes] = useState<NotesMap>(() => loadNotes())
  const [updateState, setUpdateState] = useState<UpdateToastState | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [translatorUrl, setTranslatorUrl] = useState(() => loadTranslatorUrl())
  const [translatorMsg, setTranslatorMsg] = useState<string | null>(null)
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
      const decl = viewDeclFromHash(location.hash)
      if (decl) {
        // assign 视图已并入 Moodle 时间线：声明里标了 clearsAssignPreset。
        if (decl.clearsAssignPreset) { setAssignFilter(null); setAssignQuery(undefined) }
        setView(decl.view)
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
    overlays.open('settings')
  }, [overlays, reloadErrorCount])

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
   * 应用动作的唯一清单（lib/commands）：命令面板、桌面 ⋯ 菜单、移动端
   * 「更多」抽屉三处都从这里派生。新增动作只改 buildAppCommands 一处。
   */
  const shareWeek = share.shareWeek
  const commands = useMemo(
    () =>
      buildAppCommands({
        t,
        lang,
        onToggleLang: () => setLang(lang === 'zh' ? 'en' : 'zh'),
        openSettings,
        openBatch: () => overlays.open('batch'),
        openConflicts: () => overlays.open('conflicts'),
        openDupResolver: () => overlays.open('dupes'),
        unhideAll: tt.unhideAll,
        hiddenCount: tt.hiddenKeys.size,
        syncAll: () => void tt.syncAll(),
        exportBackup: () => void exportBackup(),
        exportIcs: () => void exportTimetableIcs(tt.visibleLessons),
        printWeek: () => window.print(),
        shareWeek: () => void shareWeek(),
        checkUpdate: () => void checkForUpdate(),
        openOnboarding: () => overlays.open('onboarding'),
        dupCount,
        update: updateState,
        updateChecking,
        canPrint: canPrintSchedule(),
      }),
    [
      t,
      lang,
      setLang,
      openSettings,
      overlays,
      tt,
      dupCount,
      updateState,
      updateChecking,
      checkForUpdate,
      shareWeek,
    ],
  )
  const sheetActions = useMemo(() => toSheetActions(commands), [commands])
  const menuCommands = useMemo(() => commands.filter((c) => c.showInMenu), [commands])
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
  }, [setSelectedId])

  const jumpToCourse = useCallback(
    (code: string) => jumpToLesson(findCourseTarget(tt.visibleLessons, code)),
    [jumpToLesson, tt.visibleLessons],
  )

  /** 学期全景带点某一周：只切周起点与视图，不选中任何课 */
  const openWeek = useCallback((weekStartOfDay: Date) => {
    setWeekStart(startOfWeek(weekStartOfDay))
    setView('week')
  }, [])

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

  const paletteOpen = overlays.isOpen('palette')
  const paletteItems = useMemo(
    () =>
      paletteOpen
        ? buildPalette({
            t,
            locale,
            lessons: tt.lessons,
            tasks,
            commands: commands
              .filter((c) => c.showInPalette)
              .map((c) => ({ id: c.id, label: c.label, icon: c.icon })),
          })
        : [],
    [paletteOpen, t, locale, tt.lessons, tasks, commands],
  )

  /** 命令面板动作的唯一派发点 */
  const runPaletteAction = useCallback(
    (action: PaletteAction) => {
      overlays.close('palette')
      switch (action.kind) {
        case 'view': {
          const decl = viewDeclForRoute(action.view)
          if (decl) openView(decl)
          break
        }
        case 'week': {
          const nav = Object.values(WEEK_NAV).find((entry) => entry.delta === action.delta)
          if (!nav) break
          setWeekStart((ws) => weekStartAfter(ws, nav))
          if (nav.delta !== 0) setView('week')
          break
        }
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
        case 'command':
          // 动作由注册表执行（App 不再为每个动作写一条分支）
          commands.find((c) => c.id === action.id)?.run()
          break
        case 'quickAddTask': {
          // 命令面板一行话直接落库：新增任务 + 跳到作业模块看到它
          applyTasks(
            addTask(tasks, { title: action.title, course: '', dueAt: action.dueAt, note: '' }),
          )
          openAssignments(null)
          break
        }
      }
    },
    [applyTasks, commands, jumpToLesson, openAssignments, openView, overlays, tasks],
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
  /** 周导航的唯一出口（头部 / 周视图 / 面板 / 快捷键共用同一份声明）。 */
  const onWeekNav = useCallback((id: WeekNavId) => {
    setWeekStart((ws) => weekStartAfter(ws, WEEK_NAV[id]))
  }, [])

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

  /** 分享 / 导入弹层的状态在 useShareLinks 里，但同样要拦快捷键：这里派生出
   *  一个布尔，快捷键闸门就不再只盯着弹层栈。 */
  const shareDialogOpen = !!share.shareQr || !!share.shareImport

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
        overlays.toggle('palette')
        return
      }
      // 弹层闸门：登记表里 blocking 的（设置/各种弹窗/分享/面板）一律接管，
      // 不再手写布尔枚举——新加弹层时忘了枚举也不会再有“按键穿透到后台”。
      if (typing || mod || e.altKey || overlays.blocking || shareDialogOpen) return
      if (e.key === 'Escape') {
        overlays.closeTopLightweight()
        return
      }
      // 视图与周导航的键位都来自 lib/navigation，这里不再写 1/2/3/4/←/→/T。
      const target = viewDeclForKey(e.key)
      if (target) {
        openView(target)
        return
      }
      const weekNav = weekNavForKey(e.key)
      if (weekNav) {
        setView('week')
        setWeekStart((ws) => weekStartAfter(ws, weekNav))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openView, overlays, shareDialogOpen])

  // Catatan kursus: kunci = kode kursus ternormalisasi + jenis sesi.
  const saveNoteForLesson = useCallback((lesson: Lesson, text: string) => {
    setNotes((prev) => saveNote(prev, lesson, text))
  }, [])

  return (
    <div className="app-shell h-screen flex flex-col">
      <AppHeader
        view={view}
        onView={setView}
        lessonCount={tt.lessons.length}
        sourceCount={tt.sources.length}
        pendingTaskCount={pendingTaskCount}
        weekNum={weekNum}
        weekRangeText={weekRangeText}
        isCurrentWeek={isCurrentWeek}
        onWeekNav={onWeekNav}
        onOpenPalette={() => overlays.open('palette')}
        menuOpen={overlays.isOpen('actionSheet')}
        onToggleMenu={() => overlays.toggle('actionSheet')}
        onCloseMenu={() => overlays.close('actionSheet')}
        menuCommands={menuCommands}
      />
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
              studyBlocks={studyBlocks}
              onOpenWeek={openWeek}
            />
          )}
          {view === 'week' && (
            <WeekGrid
              lessons={weekVisibleLessons}
              weekStart={weekStart}
              onSelect={setSelectedId}
              notes={notes}
              onWeekNav={onWeekNav}
              density={uiPrefs.density}
              onDensity={(d: WeekDensity) => setUiPrefs((prev) => ({ ...prev, density: d }))}
              studyBlocks={studyBlocks}
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
              sisuPrefsRevision={sisuPrefsRevision}
            />
          )}
          </div>
        </main>
      </div>
      {/* 移动端主导航：底部标签栏（拇指可达、始终可见；桌面端由侧栏 + 头部承担） */}
      <BottomNav
        view={view}
        pendingTaskCount={pendingTaskCount}
        onView={(v) => {
          clearAssignPreset() // 底部导航 = 无预置筛选（同侧栏）
          setView(v)
        }}
        onOpenSheet={() => overlays.open('sheet')}
      />
      {sheetMounted && (
        <MoreSheet
          open={overlays.isOpen('sheet')}
          actions={sheetActions}
          sources={tt.sources}
          syncing={tt.syncing}
          syncMessage={tt.syncMessage}
          onSync={tt.sync}
          onAddManual={tt.addManualLesson}
          onOpenSettings={openSettings}
          onClose={() => overlays.close('sheet')}
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
          allLessons={tt.visibleLessons}
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
      {overlays.isOpen('dupes') && (
        <DuplicateResolver
          groups={dupGroups}
          onRemoveMany={(ids) => removeLessonsUndoable(ids, 'delete')}
          onClose={() => overlays.close('dupes')}
        />
      )}
      {overlays.isOpen('batch') && (
        <BatchFilter
          lessons={tt.lessons}
          onRemoveMany={(ids) => removeLessonsUndoable(ids, 'delete')}
          onHideMany={(ids) => removeLessonsUndoable(ids, 'hide')}
          onClose={() => overlays.close('batch')}
        />
      )}
      {overlays.isOpen('settings') && (
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
          lessons={tt.visibleLessons}
          audits={tt.audits}
          onClearAudits={tt.clearAudits}
          desktop={desktop}
          onDesktopPrefs={applyDesktopPrefs}
          onSisuPrefsChanged={() => setSisuPrefsRevision((r) => r + 1)}
          onStudyBlockPrefsChanged={(prefs) => setStudyBlockRemindEnabled(prefs.remindEnabled)}
          onClose={() => overlays.close('settings')}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          items={paletteItems}
          onRun={runPaletteAction}
          onClose={() => overlays.close('palette')}
        />
      )}
      {overlays.isOpen('onboarding') && (
        <Onboarding
          onAddSource={addSourceFromUrl}
          ssoAvailable={md.ssoAvailable}
          onLoginMoodle={() => md.loginWithSso((url) => openExternal(url))}
          onFinish={() => {
            writeStored(STORE_KEYS.onboardingDone, '1')
            overlays.close('onboarding')
          }}
          onOpenSettings={openSettings}
        />
      )}
      {overlays.isOpen('conflicts') && (
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
          onClose={() => overlays.close('conflicts')}
        />
      )}

      {/* 打印用：屏幕上隐藏，@media print 才显示；始终反映当前周 */}
      <PrintWeek lessons={weekVisibleLessons} weekStart={weekStart} />

      <NotificationManager
        enabled={tt.notifEnabled}
        digestEnabled={tt.digestEnabled}
        lessons={tt.lessons}
        tasks={tasks}
        studyBlocks={studyBlocks}
        studyBlockRemindEnabled={studyBlockRemindEnabled}
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
        <UpdateToast
          state={updateState}
          raised={!!undoNotice}
          onInstall={() => (window as unknown as { lutUpdate?: any }).lutUpdate?.install()}
          onDismiss={() => setUpdateState(null)}
        />
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
