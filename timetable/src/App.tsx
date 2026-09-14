import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Lesson, SyncSource } from './types'
import { useTimetable } from './hooks/useTimetable'
import WeekGrid from './components/WeekGrid'
import TodayView from './components/TodayView'
import LessonDetail from './components/LessonDetail'
import DuplicateResolver from './components/DuplicateResolver'
import BatchFilter from './components/BatchFilter'
import ConflictCheck from './components/ConflictCheck'
import NotificationManager from './components/NotificationManager'
import Settings from './components/Settings'
import AssignmentsView from './components/AssignmentsView'
import {
  ensureTranslatorSession,
  loadTranslatorUrl,
  saveTranslatorUrl,
} from './lib/translator'
import Sidebar from './components/Sidebar'
import { useI18n } from './i18n'
import { loadTasks, pendingTasks, saveTasks, type Task } from './lib/tasks'
import { findDuplicateGroups, removableCount } from './lib/dedupe'
import { startOfWeek, addDays, lessonsInRange, sameDay, formatWeekRange, isoWeekNumber } from './lib/date'
import {
  loadNotes,
  noteForLesson,
  noteKeyOf,
  removeNote,
  saveNote,
  type NotesMap,
} from './lib/notes'

function App() {
  const tt = useTimetable()
  const { lang, setLang, t } = useI18n()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [view, setView] = useState<'today' | 'week' | 'assign'>('today')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showDupResolver, setShowDupResolver] = useState(false)
  const [showBatchFilter, setShowBatchFilter] = useState(false)
  const [showConflicts, setShowConflicts] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMoreActions, setShowMoreActions] = useState(false)
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks())
  const [menuOpen, setMenuOpen] = useState(false)
  const [notes, setNotes] = useState<NotesMap>(() => loadNotes())
  const [updateState, setUpdateState] = useState<{
    version: string
    kind: 'ready' | 'downloading' | 'available' | 'latest' | 'error'
    percent?: number
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
      // 无桥接（浏览器/开发模式）：直接报告当前版本。
      setUpdateState({ version: appVersion ?? '?', kind: 'latest' })
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
  const viewBtn = (v: 'today' | 'week' | 'assign') =>
    'px-2.5 min-h-9 ' + (view === v ? 'bg-sky-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300')

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])
  const isCurrentWeek = useMemo(
    () => sameDay(startOfWeek(new Date()), weekStart),
    [weekStart],
  )
  const weekNum = isoWeekNumber(weekStart)
  const weekRangeText = formatWeekRange(weekStart, lang === 'zh' ? 'zh-CN' : 'en-US')
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
    <div className="app-shell h-screen flex flex-col bg-zinc-950 text-zinc-100">
      <header className="app-header safe-top flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 border-b border-zinc-800/80">
        <div className="flex items-center gap-3">
          <button
            className="md:hidden rounded-md bg-zinc-800 hover:bg-zinc-700 px-2.5 min-h-9"
            onClick={() => setMenuOpen(true)}
            title="菜单"
          >
            ☰
          </button>
          <h1 className="text-sm font-semibold">{t('appName')}</h1>
          <span className="hidden sm:inline text-[11px] text-zinc-500">
            {t('lessonsSources', { n: tt.lessons.length, m: tt.sources.length })}
          </span>
        </div>
        <div className="app-actions flex flex-wrap items-center justify-end gap-1.5 text-xs ml-auto">
          {/* 视图切换：今日 / 周 / 作业 */}
          <div className="flex rounded-md overflow-hidden border border-zinc-700">
            <button onClick={() => setView('today')} className={viewBtn('today')}>
              {t('viewToday')}
            </button>
            <button onClick={() => setView('week')} className={viewBtn('week')}>
              {t('viewWeek')}
            </button>
            <button
              onClick={() => setView('assign')}
              className={viewBtn('assign')}
              title={t('assignTitle')}
            >
              🎓<span className="hidden sm:inline"> {t('assignNav')}</span>
              {pendingTaskCount > 0 && (
                <span className="ml-1 rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white">{pendingTaskCount}</span>
              )}
            </button>
          </div>
          {view === 'week' && (
            <div className="hidden sm:flex items-center gap-1.5">
              <button
                onClick={onPrevWeek}
                className="app-header-btn rounded-md bg-zinc-800 hover:bg-zinc-700 px-2.5 min-h-9"
              >
                ←
              </button>
              <span
                className={
                  'inline-block max-w-[24vw] truncate align-middle rounded-md border px-2 py-1.5 text-[11px] sm:max-w-none sm:text-xs tabular-nums ' +
                  (isCurrentWeek
                    ? 'bg-sky-600/15 border-sky-600/50 text-sky-300'
                    : 'bg-amber-500/15 border-amber-500/60 text-amber-300')
                }
                title={t('weekRange', { w: weekNum, range: weekRangeText })}
              >
                {t('weekRange', { w: weekNum, range: weekRangeText })}
              </span>
              <button
                onClick={onNextWeek}
                className="app-header-btn rounded-md bg-zinc-800 hover:bg-zinc-700 px-2.5 min-h-9"
              >
                →
              </button>
              <button
                onClick={onThisWeek}
                className={
                  'rounded-md px-2.5 min-h-9 ' +
                  (isCurrentWeek
                    ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                    : 'bg-amber-600/90 hover:bg-amber-500 font-medium text-white')
                }
              >
                {t('thisWeek')}
              </button>
            </div>
          )}
          <button
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            className="app-header-btn rounded-md bg-sky-600/80 hover:bg-sky-600 px-2.5 min-h-9 font-medium"
            title="切换语言 / Switch language"
          >
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowMoreActions((open) => !open)}
              className="app-header-btn rounded-md bg-zinc-800 hover:bg-zinc-700 px-2 sm:px-2.5 min-h-9"
              title={t('moreActions')}
              aria-expanded={showMoreActions}
            >
              <span aria-hidden="true">⋯</span><span className="hidden sm:inline"> {t('moreActions')}</span>
            </button>
            {showMoreActions && (
              <div className="animate-pop-in absolute right-0 top-full z-30 mt-2 w-56 overflow-hidden rounded-xl border border-zinc-700/80 bg-zinc-900/95 p-1.5 shadow-2xl shadow-black/40 backdrop-blur-xl">
                <button
                  onClick={() => { setShowSettings(true); setShowMoreActions(false) }}
                  className="app-menu-item"
                >
                  <span>⚙ {t('settingsTitle')}</span><span>›</span>
                </button>
                <button
                  onClick={() => { setShowBatchFilter(true); setShowMoreActions(false) }}
                  className="app-menu-item"
                >
                  <span>🔍 {t('batchButton')}</span><span>›</span>
                </button>
                <button
                  onClick={() => { setShowConflicts(true); setShowMoreActions(false) }}
                  className="app-menu-item"
                >
                  <span>⚔ {t('conflictsButton')}</span><span>›</span>
                </button>
                {dupCount > 0 && (
                  <button
                    onClick={() => { setShowDupResolver(true); setShowMoreActions(false) }}
                    className="app-menu-item text-amber-300"
                  >
                    <span>🧩 {t('dupButton', { n: dupCount })}</span><span>›</span>
                  </button>
                )}
                {tt.hiddenKeys.size > 0 && (
                  <button
                    onClick={() => { tt.unhideAll(); setShowMoreActions(false) }}
                    className="app-menu-item text-zinc-300"
                  >
                    <span>🙈 {t('hiddenN', { n: tt.hiddenKeys.size })}</span><span>↩</span>
                  </button>
                )}
                <div className="my-1 border-t border-zinc-700/60" />
                <button
                  onClick={() => { void checkForUpdate(); setShowMoreActions(false) }}
                  disabled={updateChecking}
                  className="app-menu-item"
                >
                  <span>⬇ {updateChecking ? t('updateChecking') : t('updateCheck')}</span>
                  <span aria-hidden="true">›</span>
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
              className="shrink-0 rounded-md bg-zinc-800 hover:bg-zinc-700 px-2 min-h-9"
              title={t('prevWeek')}
            >
              ←
            </button>
            <span
              className={
                'min-w-0 flex-1 rounded-md border px-2 py-1 text-center text-[11px] leading-snug tabular-nums ' +
                (isCurrentWeek
                  ? 'bg-sky-600/15 border-sky-600/50 text-sky-300'
                  : 'bg-amber-500/15 border-amber-500/60 text-amber-300')
              }
            >
              {t('weekRange', { w: weekNum, range: weekRangeText })}
            </span>
            <button
              onClick={onNextWeek}
              className="shrink-0 rounded-md bg-zinc-800 hover:bg-zinc-700 px-2 min-h-9"
              title={t('nextWeek')}
            >
              →
            </button>
            <button
              onClick={onThisWeek}
              className={
                'shrink-0 rounded-md px-2 min-h-9 ' +
                (isCurrentWeek
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                  : 'bg-amber-600/90 hover:bg-amber-500 font-medium text-white')
              }
            >
              {t('thisWeek')}
            </button>
          </div>
        )}
      </header>
      <div className="flex flex-1 min-h-0">
        {/* 移动端：侧栏变成抽屉（<md） */}
        <div
          className={
            (menuOpen ? 'fixed inset-0 z-40 flex bg-black/60' : 'hidden') + ' md:hidden'
          }
          onClick={(e) => e.target === e.currentTarget && setMenuOpen(false)}
        >
          <Sidebar
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
            onAddManual={tt.addManualLesson}
            onCloseDrawer={() => setMenuOpen(false)}
          />
        </div>
        {/* 桌面端：固定侧栏 */}
        <div className="hidden md:flex h-full">
          <Sidebar
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
            onAddManual={tt.addManualLesson}
          />
        </div>
        <main className="flex-1 flex flex-col min-w-0">
          {view === 'today' && (
            <TodayView
              lessons={tt.visibleLessons}
              onSelect={setSelectedId}
              notes={notes}
              tasks={tasks}
              onJumpToCourse={(code) => {
                const target = tt.visibleLessons
                  .filter((l) => l.code && l.code.toUpperCase().startsWith(code.toUpperCase()))
                  .sort((a, b) => a.start.localeCompare(b.start))
                  .find((l) => new Date(l.end).getTime() >= Date.now()) ??
                  tt.visibleLessons
                    .filter((l) => l.code && l.code.toUpperCase().startsWith(code.toUpperCase()))
                    .sort((a, b) => b.start.localeCompare(a.start))[0]
                if (target) {
                  setWeekStart(startOfWeek(new Date(target.start)))
                  setView('week')
                  setSelectedId(target.id)
                }
              }}
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
          {view === 'assign' && (
            <AssignmentsView
              tasks={tasks}
              lessons={tt.lessons}
              onChange={(next) => setTasks(saveTasks(next))}
              onJumpToCourse={(code) => {
                // 跳到该课程下一次出现的周视图，并选中那节课
                const target = tt.visibleLessons
                  .filter((l) => l.code && l.code.toUpperCase().startsWith(code.toUpperCase()))
                  .sort((a, b) => a.start.localeCompare(b.start))
                  .find((l) => new Date(l.end).getTime() >= Date.now()) ??
                  tt.visibleLessons
                    .filter((l) => l.code && l.code.toUpperCase().startsWith(code.toUpperCase()))
                    .sort((a, b) => b.start.localeCompare(a.start))[0]
                if (target) {
                  setWeekStart(startOfWeek(new Date(target.start)))
                  setView('week')
                  setSelectedId(target.id)
                }
              }}
            />
          )}
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
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg text-white text-sm px-4 py-3 shadow-lg max-w-full ${
              updateState.kind === 'error'
                ? 'bg-rose-600'
                : updateState.kind === 'ready'
                  ? 'bg-emerald-600'
                  : 'bg-zinc-800 border border-zinc-700'
            }`}
          >
            <span>
              {updateState.kind === 'ready' && (
                <>🔄 {t('updateReady', { v: updateState.version })}</>
              )}
              {updateState.kind === 'downloading' &&
                t('updateDownloading', { p: updateState.percent ?? 0 })}
              {updateState.kind === 'available' &&
                t('updateAvailable', { v: updateState.version })}
              {updateState.kind === 'latest' &&
                t('updateUpToDate', { v: updateState.version })}
              {updateState.kind === 'error' && t('updateCheckFail')}
            </span>
            {updateState.kind === 'ready' && (
              <button
                className="rounded bg-white text-emerald-700 px-3 min-h-9 font-medium"
                onClick={() =>
                  (window as unknown as { lutUpdate?: any }).lutUpdate?.install()
                }
              >
                {t('updateInstallNow')}
              </button>
            )}
            <button
              className="text-white/80 hover:text-white"
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

export default App
