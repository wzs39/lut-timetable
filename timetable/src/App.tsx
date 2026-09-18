import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Lesson, SyncSource } from './types'
import { useTimetable } from './hooks/useTimetable'
import { useMoodleData } from './hooks/useMoodleData'
import { MoodleProvider } from './hooks/useMoodleData'
import WeekGrid from './components/WeekGrid'
import TodayView from './components/TodayView'
import LessonDetail from './components/LessonDetail'
import DuplicateResolver from './components/DuplicateResolver'
import BatchFilter from './components/BatchFilter'
import ConflictCheck from './components/ConflictCheck'
import NotificationManager from './components/NotificationManager'
import Settings from './components/Settings'
import AssignmentsView from './components/AssignmentsView'
import MoodleView from './components/MoodleView'
import {
  ensureTranslatorSession,
  loadTranslatorUrl,
  saveTranslatorUrl,
} from './lib/translator'
import Sidebar from './components/Sidebar'
import { useI18n } from './i18n'
import { loadTasks, pendingTasks, saveTasks, type Task } from './lib/tasks'
import { useDelayedUnmount } from './lib/useExitAnimation'
import { checkApkUpdate } from './lib/apkUpdate'
import ExternalLink from './components/ExternalLink'
import Icon from './components/Icon'
import { findDuplicateGroups, removableCount } from './lib/dedupe'
import { startOfWeek, addDays, lessonsInRange, sameDay, formatWeekRange, isoWeekNumber, findCourseTarget } from './lib/date'
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
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [view, setView] = useState<'today' | 'week' | 'assign' | 'moodle'>('today')
  /** 作业页进入时预置的分组筛选（Moodle 时间线卡片跳转用） */
  const [assignFilter, setAssignFilter] = useState<'overdue' | 'due7' | 'later'>('overdue')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showDupResolver, setShowDupResolver] = useState(false)
  const [showBatchFilter, setShowBatchFilter] = useState(false)
  const [showConflicts, setShowConflicts] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMoreActions, setShowMoreActions] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const drawerMounted = useDelayedUnmount(menuOpen)
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
  const selectedLesson: Lesson | null = useMemo(
    () => tt.lessons.find((l) => l.id === selectedId) ?? null,
    [tt.lessons, selectedId],
  )
  const dupGroups = useMemo(() => findDuplicateGroups(tt.lessons), [tt.lessons])
  const dupCount = removableCount(dupGroups)
  const pendingTaskCount = pendingTasks(tasks).length

  /** Lompat ke minggu kemunculan berikutnya dari kode kursus + pilih sesinya.
   *  Satu pemilik untuk ketiga view (today/moodle/assign). */
  const jumpToCourse = useCallback(
    (code: string) => {
      const target = findCourseTarget(tt.visibleLessons, code)
      if (!target) return
      setWeekStart(startOfWeek(new Date(target.start)))
      setView('week')
      setSelectedId(target.id)
    },
    [tt.visibleLessons],
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

  // Catatan kursus: kunci = kode kursus ternormalisasi + jenis sesi.
  const saveNoteForLesson = useCallback((lesson: Lesson, text: string) => {
    setNotes((prev) => saveNote(prev, lesson, text))
  }, [])
  const removeNoteByKey = useCallback((key: string) => {
    setNotes((prev) => removeNote(prev, key))
  }, [])

  return (
    <div className="app-shell h-screen flex flex-col">
      <header className="app-header safe-top flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 border-b border-[var(--line)]">
        <div className="flex items-center gap-3">
          <button
            className="app-btn md:hidden px-2.5 min-h-9"
            onClick={() => setMenuOpen(true)}
            title="菜单"
          >
            <Icon name="menu" size={16} />
          </button>
          <h1 className="text-sm font-semibold">{t('appName')}</h1>
          <span className="hidden sm:inline text-[11px] text-[var(--text-3)]">
            {t('lessonsSources', { n: tt.lessons.length, m: tt.sources.length })}
          </span>
        </div>
        <div className="app-actions flex flex-wrap items-center justify-end gap-1.5 text-xs ml-auto">
          {/* 视图切换：今日 / 周 / 作业 */}
          <div className="app-seg">
            <button onClick={() => setView('today')} aria-pressed={view === 'today'}>
              {t('viewToday')}
            </button>
            <button onClick={() => setView('week')} aria-pressed={view === 'week'}>
              {t('viewWeek')}
            </button>
            <button
              onClick={() => setView('assign')}
              aria-pressed={view === 'assign'}
              title={t('assignTitle')}
            >
                <span className="inline-flex items-center gap-2"><Icon name="graduation" size={16} /><span className="hidden sm:inline"> {t('assignNav')}</span></span>
              {pendingTaskCount > 0 && (
                /* .app-badge 携带自己的 bg/fg 对（surface-2 + text-2），所以数字在
                   选中（accent 底、accent-text 继承）和未选中两种状态下都可读。 */
                <span className="app-badge ml-1 font-semibold tabular-nums">{pendingTaskCount}</span>
              )}
            </button>
            <button
              onClick={() => setView('moodle')}
              aria-pressed={view === 'moodle'}
              title={t('moodleNav')}
            >
              <span className="inline-flex items-center gap-2"><Icon name="book" size={15} /><span className="hidden sm:inline"> {t('moodleNav')}</span></span>
              <MoodleUnreadBadge />
            </button>
          </div>
          {view === 'week' && (
            <div className="hidden sm:flex items-center gap-1.5">
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
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            className="app-btn px-2.5 min-h-9 font-medium"
            title="切换语言 / Switch language"
          >
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
          <div className="relative">
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
                  onClick={() => { setShowSettings(true); setShowMoreActions(false) }}
                  className="app-menu-item"
                >
                  <span className="inline-flex items-center gap-2"><Icon name="settings" /> {t('settingsTitle')}</span><span className="text-[var(--text-3)]"><Icon name="chevron-right" size={12} /></span>
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
        {/* Baris navigasi minggu khusus ponsel: teks rentang utuh, tidak terpotong */}
        {view === 'week' && (
          <div className="sm:hidden flex w-full items-center gap-1 pb-0.5">
            <button
              onClick={onPrevWeek}
              className="app-btn shrink-0 px-2 min-h-9"
              title={t('prevWeek')}
            >
              <Icon name="chevron-left" size={15} />
            </button>
            <span
              className="min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--surface-1)] px-2 py-1 text-center text-[11px] leading-snug tabular-nums text-[var(--text-2)]"
            >
              {t('weekRange', { w: weekNum, range: weekRangeText })}
            </span>
            <button
              onClick={onNextWeek}
              className="app-btn shrink-0 px-2 min-h-9"
              title={t('nextWeek')}
            >
              <Icon name="chevron-right" size={15} />
            </button>
            {!isCurrentWeek && (
              <button
                onClick={onThisWeek}
                className="app-btn-primary shrink-0 px-2 min-h-9"
              >
                {t('thisWeek')}
              </button>
            )}
          </div>
        )}
      </header>
      <div className="flex flex-1 min-h-0">
        {/* 移动端：侧栏变成抽屉（<md）。进入滑入、退出滑出（useDelayedUnmount
            在退出帧期间保持挂载，动画结束后才真正卸载）。 */}
        {drawerMounted && (
          <div
            className={
              (menuOpen ? 'animate-fade-in ' : 'animate-fade-out ') +
              'fixed inset-0 z-40 flex bg-black/60 md:hidden'
            }
            onClick={(e) => e.target === e.currentTarget && setMenuOpen(false)}
          >
            <div
              className={
                (menuOpen ? 'animate-drawer-in ' : 'animate-exit-left ') + 'h-full'
              }
            >
              <Sidebar
                sources={tt.sources}
                syncing={tt.syncing}
                syncMessage={tt.syncMessage}
                onSync={tt.sync}
                onAddManual={tt.addManualLesson}
                onOpenSettings={() => setShowSettings(true)}
                onCloseDrawer={() => setMenuOpen(false)}
              />
            </div>
          </div>
        )}
        {/* 桌面端：固定侧栏 */}
        <div className="hidden md:flex h-full">
          <Sidebar
            sources={tt.sources}
            syncing={tt.syncing}
            syncMessage={tt.syncMessage}
            onSync={tt.sync}
            onAddManual={tt.addManualLesson}
            onOpenSettings={() => setShowSettings(true)}
          />
        </div>
        <main className="flex-1 flex flex-col min-w-0">
          <div key={view} className="animate-view-in flex flex-1 min-h-0 flex-col">
          {view === 'today' && (
            <TodayView
              lessons={tt.visibleLessons}
              onSelect={setSelectedId}
              notes={notes}
              tasks={tasks}
              onJumpToCourse={jumpToCourse}
              onOpenAssignments={() => setView('assign')}
            />
          )}
          {view === 'week' && (
            <WeekGrid
              lessons={weekVisibleLessons}
              weekStart={weekStart}
              onSelect={setSelectedId}
              notes={notes}
            />
          )}
          {view === 'moodle' && (
            <MoodleView
              tasks={tasks}
              lessons={tt.lessons}
              onJumpToCourse={jumpToCourse}
              onOpenAssignments={(filter) => {
                setAssignFilter(filter)
                setView('assign')
              }}
              onOpenSettings={() => setShowSettings(true)}
            />
          )}
          {view === 'assign' && (
            <AssignmentsView
              tasks={tasks}
              lessons={tt.lessons}
              onChange={(next) => setTasks(saveTasks(next))}
              key={assignFilter}
              initialFilter={assignFilter}
              onJumpToCourse={jumpToCourse}
            />
          )}
          </div>
        </main>
      </div>
      {selectedLesson && (
        <LessonDetail
          lesson={selectedLesson}
          onSave={tt.updateLesson}
          onDelete={tt.removeLesson}
          onHide={(id) => tt.hideLessons([id])}
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
          onRemoveNote={() => removeNoteByKey(noteKeyOf(selectedLesson))}
          assignments={tasks}
          onOpenAssignments={() => {
            setSelectedId(null)
            setView('assign')
          }}
        />
      )}
      {showDupResolver && (
        <DuplicateResolver
          groups={dupGroups}
          onRemoveMany={tt.removeMany}
          onClose={() => setShowDupResolver(false)}
        />
      )}
      {showBatchFilter && (
        <BatchFilter
          lessons={tt.lessons}
          onRemoveMany={tt.removeMany}
          onHideMany={tt.hideLessons}
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
          onAddSource={(s: SyncSource) => tt.addSource([...tt.sources, s])}
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
          onRemoveNote={removeNoteByKey}
          onClose={() => setShowSettings(false)}
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

      <NotificationManager enabled={tt.notifEnabled} lessons={tt.lessons} tasks={tasks} />
      {updateState && (
        <div className="fixed bottom-4 inset-x-0 z-50 flex justify-center px-4 animate-modal-in">
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
              <ExternalLink
                href={updateState.apkUrl}
                className="inline-flex items-center gap-1.5 rounded bg-white text-[var(--text-3)] px-3 min-h-9 font-medium"
              >
                <Icon name="external" size={13} /> {t('updateGetApk')}
              </ExternalLink>
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
  return (
    <MoodleProvider tasks={tasks} lessons={tt.lessons} onTasks={(n) => setTasks(saveTasks(n))}>
      <AppInner tasks={tasks} setTasks={setTasks} tt={tt} />
    </MoodleProvider>
  )
}
