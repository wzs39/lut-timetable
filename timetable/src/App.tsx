import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Lesson, SyncSource } from './types'
import { useTimetable } from './hooks/useTimetable'
import WeekGrid from './components/WeekGrid'
import TodayView from './components/TodayView'
import LessonDetail from './components/LessonDetail'
import DuplicateResolver from './components/DuplicateResolver'
import BatchFilter from './components/BatchFilter'
import NotificationManager from './components/NotificationManager'
import TranslationLinker from './components/TranslationLinker'
import {
  loadTranslatorUrl,
  saveTranslatorUrl,
} from './lib/translator'
import Sidebar from './components/Sidebar'
import { useI18n } from './i18n'
import { findDuplicateGroups, removableCount } from './lib/dedupe'
import { startOfWeek, addDays, lessonsInRange, formatDay } from './lib/date'

function App() {
  const tt = useTimetable()
  const { lang, setLang, t } = useI18n()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [view, setView] = useState<'today' | 'week'>('today')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showDupResolver, setShowDupResolver] = useState(false)
  const [showBatchFilter, setShowBatchFilter] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [updateState, setUpdateState] = useState<{ version: string } | null>(null)
  const [translatorUrl, setTranslatorUrl] = useState(() => loadTranslatorUrl())
  const [translatorOn, setTranslatorOn] = useState(false)

  useEffect(() => {
    const bridge = (window as unknown as { lutUpdate?: any }).lutUpdate
    if (!bridge?.onUpdate) return
    const off = bridge.onUpdate((p: { type?: string; version?: string }) => {
      if (p?.type === 'update-downloaded') {
        setUpdateState({ version: String(p.version) })
      }
    })
    return off
  }, [])
  const selectedLesson: Lesson | null = useMemo(
    () => tt.lessons.find((l) => l.id === selectedId) ?? null,
    [tt.lessons, selectedId],
  )
  const dupGroups = useMemo(() => findDuplicateGroups(tt.lessons), [tt.lessons])
  const dupCount = removableCount(dupGroups)

  const weekEnd = useMemo(() => addDays(weekStart, 7), [weekStart])
  const weekVisibleLessons = useMemo(
    () => lessonsInRange(tt.visibleLessons, weekStart, weekEnd),
    [tt.visibleLessons, weekStart, weekEnd],
  )
  const onPrevWeek = useCallback(() => setWeekStart(addDays(weekStart, -7)), [weekStart])
  const onNextWeek = useCallback(() => setWeekStart(addDays(weekStart, 7)), [weekStart])
  const onThisWeek = useCallback(() => setWeekStart(startOfWeek(new Date())), [])

  return (
    <div className="h-screen flex flex-col bg-zinc-900 text-zinc-100">
      <header className="safe-top flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 border-b border-zinc-800">
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
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs ml-auto">
          {/* 视图切换：今日 / 周 */}
          <div className="flex rounded-md overflow-hidden border border-zinc-700">
            <button
              onClick={() => setView('today')}
              className={
                'px-2.5 min-h-9 ' +
                (view === 'today'
                  ? 'bg-sky-600 text-white'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300')
              }
            >
              {t('viewToday')}
            </button>
            <button
              onClick={() => setView('week')}
              className={
                'px-2.5 min-h-9 ' +
                (view === 'week'
                  ? 'bg-sky-600 text-white'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300')
              }
            >
              {t('viewWeek')}
            </button>
          </div>
          {view === 'week' && (
            <>
          <button
            onClick={onPrevWeek}
            className="rounded-md bg-zinc-800 hover:bg-zinc-700 px-2.5 min-h-9"
          >
            ←
          </button>
          <span className="hidden md:inline-block text-zinc-400 md:min-w-40 text-center">
            {formatDay(weekStart, lang === 'zh' ? 'zh-CN' : 'en-US')} —{' '}
            {formatDay(addDays(weekStart, 6), lang === 'zh' ? 'zh-CN' : 'en-US')}
          </span>
          <button
            onClick={onNextWeek}
            className="rounded-md bg-zinc-800 hover:bg-zinc-700 px-2.5 min-h-9"
          >
            →
          </button>
          <button
            onClick={onThisWeek}
            className="rounded-md bg-zinc-800 hover:bg-zinc-700 px-2.5 min-h-9"
          >
            {t('thisWeek')}
          </button>
            </>
          )}
          <button
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            className="rounded-md bg-sky-600/80 hover:bg-sky-600 px-2.5 min-h-9 font-medium"
            title="切换语言 / Switch language"
          >
            {lang === 'zh' ? 'EN' : '中文'}
          </button>
          {dupCount > 0 && (
            <button
              onClick={() => setShowDupResolver(true)}
              className="rounded-md bg-amber-600/80 hover:bg-amber-600 px-2.5 min-h-9 font-medium"
              title={t('dupIntro')}
            >
              {t('dupButton', { n: dupCount })}
            </button>
          )}
          <button
            onClick={() => setShowBatchFilter(true)}
            className="rounded-md bg-zinc-800 hover:bg-zinc-700 px-2.5 min-h-9"
            title={t('batchTitle')}
          >
            🔍 {t('batchButton')}
          </button>
          {tt.hiddenKeys.size > 0 && (
            <button
              onClick={tt.unhideAll}
              className="rounded-md bg-zinc-700 hover:bg-zinc-600 px-2.5 min-h-9 text-zinc-300"
              title={t('unhideAll')}
            >
              🙈 {t('hiddenN', { n: tt.hiddenKeys.size })} · {t('unhideAll')}
            </button>
          )}
        </div>
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
            translatorOn={translatorOn}
            onToggleTranslator={(v) => setTranslatorOn(v)}
            translatorUrl={translatorUrl}
            onTranslatorUrl={(u) => {
              setTranslatorUrl(u)
              saveTranslatorUrl(u)
            }}
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
            translatorOn={translatorOn}
            onToggleTranslator={(v) => setTranslatorOn(v)}
            translatorUrl={translatorUrl}
            onTranslatorUrl={(u) => {
              setTranslatorUrl(u)
              saveTranslatorUrl(u)
            }}
          />
        </div>
        <main className="flex-1 flex flex-col min-w-0">
          {view === 'today' ? (
            <TodayView lessons={tt.visibleLessons} onSelect={setSelectedId} />
          ) : (
            <WeekGrid
              lessons={weekVisibleLessons}
              weekStart={weekStart}
              onSelect={setSelectedId}
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
      <NotificationManager enabled={tt.notifEnabled} lessons={tt.lessons} />
      <TranslationLinker
        enabled={translatorOn}
        lessons={tt.visibleLessons}
        translatorUrl={translatorUrl}
      />
      {updateState && (
        <div className="fixed bottom-4 inset-x-0 z-50 flex justify-center px-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-emerald-600 text-white text-sm px-4 py-3 shadow-lg max-w-full">
            <span>🔄 {t('updateReady', { v: updateState.version })}</span>
            <button
              className="rounded bg-white text-emerald-700 px-3 min-h-9 font-medium"
              onClick={() =>
                (window as unknown as { lutUpdate?: any }).lutUpdate?.install()
              }
            >
              {t('updateInstallNow')}
            </button>
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
